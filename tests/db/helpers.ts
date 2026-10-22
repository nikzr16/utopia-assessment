import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const SEED_FILE = join(ROOT, 'supabase', 'seed.sql')

export type Row = Record<string, unknown>

/**
 * A small stand-in for what Supabase provides before our migrations run: the
 * three API roles, the `auth` schema with `auth.users`, and `auth.uid()` reading
 * the request's JWT claims exactly like Supabase does. It also mimics Supabase's
 * default privileges (new objects are open to the API roles) so the access
 * migration is tested against the worst case: it must revoke what it does not
 * want to expose. The migrations themselves contain no test-only code.
 */
export const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    created_at         timestamptz not null default now()
  );

  create function auth.uid() returns uuid
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant all on auth.users to service_role;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  -- Supabase Storage's tables, as the Storage API sees them: it inserts and
  -- deletes objects as the caller's role, so the policies on storage.objects
  -- decide; direct SQL deletes are refused unless the API's flag is set.
  create schema storage;
  create table storage.buckets (
    id                 text primary key,
    name               text not null unique,
    public             boolean not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz not null default now()
  );
  create table storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text references storage.buckets (id),
    name       text not null,
    owner      uuid,
    owner_id   text,
    metadata   jsonb,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;

  create function storage.protect_delete() returns trigger
  language plpgsql as $$
  begin
    if coalesce(current_setting('storage.allow_delete_query', true), '') <> 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.';
    end if;
    return old;
  end;
  $$;
  create trigger protect_objects_delete before delete on storage.objects
    for each row execute function storage.protect_delete();

  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
`

export type DbRole = 'anon' | 'authenticated' | 'service_role'

/** Who a request runs as: the database role plus the JWT subject (auth user id). */
export interface Identity {
  role: DbRole
  sub: string | null
}

/** A staff member id (their linked sign-in account acts) or an explicit identity. */
export type Actor = string | Identity

/** A signed-out visitor: the anon role and no JWT. */
export const SIGNED_OUT: Identity = { role: 'anon', sub: null }
/** The Supabase secret key: the service_role role, no user. */
export const SERVICE_ROLE: Identity = { role: 'service_role', sub: null }

/** The seeded staff members the tests act as. */
export interface People {
  admin: string // Aisyah Rahman, Kuala Lumpur
  admin2: string // Farid Hakim, Shah Alam
  ali: string // technician, Shah Alam
  john: string // technician, Kuala Lumpur
  bala: string // technician, Shah Alam
  yusoff: string // technician, Shah Alam
  managerSA: string // Nurul Huda, Shah Alam
  managerKL: string // Tan Wei Ming, Kuala Lumpur
  finance: string // Siti Aminah
}

export interface TestDb {
  db: PGlite
  /** Run SQL as the database owner (superuser: bypasses RLS, no signed-in user). */
  q: <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>
  /**
   * Run SQL the way the API does: in one transaction, as the actor's database
   * role with their JWT claims set. Grants and row-level security apply.
   */
  qAs: <T = Row>(actor: Actor, sql: string, params?: unknown[]) => Promise<T[]>
  /** Call an RPC (named arguments) as the actor and return the first row. */
  rpcAs: <T = Row>(actor: Actor, fn: string, args?: Record<string, unknown>) => Promise<T>
  /** Call an RPC as whoever the test is currently acting as (see actAs). */
  rpc: <T = Row>(fn: string, args?: Record<string, unknown>) => Promise<T>
  /** Act as this staff member (their sign-in account) for later `rpc` calls. */
  actAs: (staffId: string) => Promise<void>
  /** Act as a sign-in account directly (it may have no staff profile). */
  actAsUser: (authUserId: string) => void
  /** Act as a signed-out visitor (role anon, no JWT). */
  actSignedOut: () => void
  /** The identity `rpc` currently runs as. */
  currentIdentity: () => Identity
  /** The identity of a staff member's linked sign-in account. */
  identityOf: (staffId: string) => Promise<Identity>
  /**
   * Run a migration held back with `holdBackMigrations` (name or file prefix),
   * for tests that need data in place before it runs.
   */
  applyMigration: (name: string) => Promise<void>
  /** Create a Supabase Auth user (the link trigger fires) and return its id. */
  createAuthUser: (email: string) => Promise<string>
  people: People
  branchId: (name: string) => Promise<string>
  serviceTypeId: (name: string) => Promise<string>
  /** Create an order as Admin. Pass `technician` to create it as Assigned. */
  createOrder: (opts?: CreateOrderOptions) => Promise<Row>
  /** Move an order to `target` along the normal happy path. */
  advance: (orderId: string, target: AdvanceTarget, opts?: AdvanceOptions) => Promise<Row>
  /** Read the order's row from order_summary (as the database owner). */
  summary: (orderId: string) => Promise<Row>
  /** transition_order shorthand, as the given staff member. */
  transition: (
    actor: string,
    orderId: string,
    to: string,
    note?: string | null,
    technician?: string | null,
  ) => Promise<Row>
  /**
   * record_payment shorthand as the given staff member (cash by default).
   * A non-cash payment without `receiptPath` gets a receipt uploaded for it.
   */
  pay: (actor: string, orderId: string, amount: number, method?: string, opts?: PayOptions) => Promise<Row>
  /** submit_completion shorthand as the given staff member. */
  submit: (
    actor: string,
    orderId: string,
    opts?: { workDone?: string; extraCharges?: number; remarks?: string | null },
  ) => Promise<Row>
  /** A fresh job-files path for an order (`<order>/<uuid>.<ext>` or `<order>/receipts/…`). */
  filePath: (orderId: string, opts?: { receipt?: boolean; ext?: string }) => string
  /**
   * Upload an object to the job-files bucket the way the Storage API does: an
   * insert into storage.objects as the actor (storage policies apply), owned by
   * their sign-in account, with Storage's metadata. Returns the path.
   */
  upload: (actor: Actor, path: string, file?: { mime?: string; size?: number }) => Promise<string>
  /** Delete an object the way the Storage API does (as the actor, policies apply). */
  removeObject: (actor: Actor, path: string) => Promise<number>
  /** Names of the objects stored for an order. */
  objects: (orderId: string) => Promise<string[]>
  /** Audit entries for an order, oldest first. */
  audit: (orderId: string) => Promise<AuditRow[]>
  /** Notifications for an order, oldest first. */
  notifications: (orderId: string) => Promise<NotificationRow[]>
  /** Move an order all the way to Closed (fully paid by Finance). */
  closeOrder: (orderId: string) => Promise<Row>
  close: () => Promise<void>
}

export interface CreateOrderOptions {
  actor?: string
  technician?: string | null
  branch?: string // branch name, default Shah Alam
  quotedPrice?: number
  scheduledAt?: string | null
  customerName?: string
  /** Stored or typed form; default is a mobile number (`60123456789`). */
  customerPhone?: string
}

export interface PayOptions {
  note?: string | null
  clientKey?: string | null
  receiptPath?: string | null
}

export interface AuditRow {
  id: string
  order_id: string
  actor_id: string
  actor_role: string
  action: string
  from_status: string | null
  to_status: string | null
  note: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface NotificationRow {
  id: string
  recipient_id: string
  order_id: string
  event: string
  message: string
  read_at: string | null
}

export interface CreateTestDbOptions {
  /** Extra SQL to run after the Supabase shim and before the migrations. */
  beforeMigrations?: string
  /**
   * Create a sign-in account for every seeded staff member (like
   * `npm run auth:create-staff-logins`); the link trigger attaches each one to
   * its staff row. Default true.
   */
  provisionLogins?: boolean
  /**
   * Migration files (name or file prefix) not to run when the database is
   * created; run one later with `applyMigration`. For testing what a migration
   * does to data that already exists (a backfill).
   */
  holdBackMigrations?: string[]
}

export type AdvanceTarget =
  | 'assigned'
  | 'acknowledged'
  | 'in_progress'
  | 'job_done'
  | 'reviewed'

export interface AdvanceOptions {
  technician?: string
  extraCharges?: number
}

/**
 * Fresh in-memory Postgres with the Supabase shim, every migration (filename
 * order), the seed, and (by default) a linked sign-in account per staff member.
 */
export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestDb> {
  const db = await PGlite.create()
  await db.exec(SUPABASE_SHIM)
  if (options.beforeMigrations) await db.exec(options.beforeMigrations)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const heldBack = options.holdBackMigrations ?? []
  for (const file of files) {
    if (heldBack.some((name) => file.startsWith(name))) continue
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  await db.exec(readFileSync(SEED_FILE, 'utf8'))

  if (options.provisionLogins ?? true) {
    // Like the login script: one confirmed account per staff email. The trigger
    // on auth.users links each account to its staff row.
    await db.exec(
      'insert into auth.users (email, email_confirmed_at) select email, now() from staff order by email',
    )
  }

  const q = async <T = Row>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const res = await db.query<T>(sql, params)
    return res.rows
  }

  // -- Acting as someone ------------------------------------------------------
  // The identity is applied per call, inside that call's own transaction
  // (`set local role` + `set_config(..., true)`), so nothing leaks between calls
  // or tests, even when a call fails or several run concurrently.
  let current: Identity = SIGNED_OUT

  const identityOf = async (staffId: string): Promise<Identity> => {
    const rows = await q<{ auth_user_id: string | null }>(
      'select auth_user_id from staff where id = $1',
      [staffId],
    )
    if (rows.length !== 1) throw new Error(`No staff member ${staffId}`)
    if (!rows[0].auth_user_id) throw new Error(`Staff member ${staffId} has no linked sign-in account`)
    return { role: 'authenticated', sub: rows[0].auth_user_id }
  }

  const resolve = (actor: Actor): Promise<Identity> =>
    typeof actor === 'string' ? identityOf(actor) : Promise.resolve(actor)

  const runAs = async <T = Row>(
    actor: Actor,
    sql: string,
    params: unknown[] = [],
    settings: Record<string, string> = {},
  ): Promise<T[]> => {
    const identity = await resolve(actor)
    const claims = identity.sub
      ? JSON.stringify({ sub: identity.sub, role: identity.role, aud: 'authenticated' })
      : ''
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      for (const [name, value] of Object.entries(settings)) {
        await tx.query('select set_config($1, $2, true)', [name, value])
      }
      await tx.exec(`set local role ${identity.role}`)
      const res = await tx.query<T>(sql, params)
      return res.rows
    })
  }

  const qAs = <T = Row>(actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> =>
    runAs<T>(actor, sql, params)

  const rpcAs = async <T = Row>(
    actor: Actor,
    fn: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const entries = Object.entries(args).filter(([, v]) => v !== undefined)
    const named = entries.map(([k], i) => `${k} => $${i + 1}`).join(', ')
    const rows = await qAs<T>(actor, `select * from ${fn}(${named})`, entries.map(([, v]) => v))
    return rows[0] as T
  }

  const rpc = <T = Row>(fn: string, args: Record<string, unknown> = {}): Promise<T> =>
    rpcAs<T>(current, fn, args)

  const actAs = async (staffId: string) => {
    current = await identityOf(staffId)
  }
  const actAsUser = (authUserId: string) => {
    current = { role: 'authenticated', sub: authUserId }
  }
  const actSignedOut = () => {
    current = SIGNED_OUT
  }

  const applyMigration = async (name: string): Promise<void> => {
    const file = files.find((f) => f.startsWith(name))
    if (!file) throw new Error(`No migration named ${name}`)
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  const createAuthUser = async (email: string): Promise<string> => {
    const rows = await q<{ id: string }>(
      'insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id',
      [email],
    )
    return rows[0].id
  }

  const idByName = async (table: string, name: string): Promise<string> => {
    const rows = await q<{ id: string }>(`select id from ${table} where name = $1`, [name])
    if (rows.length !== 1) throw new Error(`Expected exactly one ${table} named ${name}`)
    return rows[0].id
  }

  const staff = (name: string) => idByName('staff', name)
  const people: People = {
    admin: await staff('Aisyah Rahman'),
    admin2: await staff('Farid Hakim'),
    ali: await staff('Ali'),
    john: await staff('John'),
    bala: await staff('Bala'),
    yusoff: await staff('Yusoff'),
    managerSA: await staff('Nurul Huda'),
    managerKL: await staff('Tan Wei Ming'),
    finance: await staff('Siti Aminah'),
  }

  const branchId = (name: string) => idByName('branches', name)
  const serviceTypeId = (name: string) => idByName('service_types', name)

  const createOrder = async (opts: CreateOrderOptions = {}): Promise<Row> => {
    return rpcAs(opts.actor ?? people.admin, 'create_order', {
      p_branch_id: await branchId(opts.branch ?? 'Shah Alam'),
      p_customer_name: opts.customerName ?? 'Encik Hafiz',
      p_customer_phone: opts.customerPhone ?? '60123456789',
      p_customer_address: '12 Jalan Mawar, Seksyen 7, Shah Alam',
      p_problem_description: 'Aircond not cold',
      p_service_type_id: await serviceTypeId('Repair'),
      p_quoted_price: opts.quotedPrice ?? 250,
      p_scheduled_at: opts.scheduledAt === undefined ? '2026-10-26T02:00:00Z' : opts.scheduledAt,
      p_admin_notes: null,
      p_technician_id: opts.technician ?? null,
    })
  }

  const summary = async (orderId: string): Promise<Row> => {
    const rows = await q('select * from order_summary where id = $1', [orderId])
    return rows[0]
  }

  const transition = (
    actor: string,
    orderId: string,
    to: string,
    note?: string | null,
    technician?: string | null,
  ): Promise<Row> =>
    rpcAs(actor, 'transition_order', {
      p_order_id: orderId,
      p_to_status: to,
      p_note: note ?? null,
      p_technician_id: technician ?? null,
    })

  const filePath = (orderId: string, opts: { receipt?: boolean; ext?: string } = {}) =>
    `${orderId}/${opts.receipt ? 'receipts/' : ''}${randomUUID()}.${opts.ext ?? 'jpg'}`

  const upload = async (
    actor: Actor,
    path: string,
    file: { mime?: string; size?: number } = {},
  ): Promise<string> => {
    const identity = await resolve(actor)
    await runAs(
      identity,
      `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
       values ('job-files', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', $3::text, 'size', $4::bigint))`,
      [path, identity.sub, file.mime ?? 'image/jpeg', file.size ?? 250_000],
    )
    return path
  }

  const removeObject = async (actor: Actor, path: string): Promise<number> => {
    const rows = await runAs<{ n: number }>(
      actor,
      `with d as (delete from storage.objects where bucket_id = 'job-files' and name = $1 returning 1)
       select count(*)::int as n from d`,
      [path],
      { 'storage.allow_delete_query': 'true' },
    )
    return rows[0].n
  }

  const objects = async (orderId: string): Promise<string[]> => {
    const rows = await q<{ name: string }>(
      `select name from storage.objects where bucket_id = 'job-files' and name like $1 order by name`,
      [`${orderId}/%`],
    )
    return rows.map((r) => r.name)
  }

  const pay = async (
    actor: string,
    orderId: string,
    amount: number,
    method = 'cash',
    opts: PayOptions = {},
  ): Promise<Row> => {
    let receiptPath = opts.receiptPath ?? null
    if (receiptPath === null && opts.receiptPath === undefined && method !== 'cash') {
      receiptPath = await upload(actor, filePath(orderId, { receipt: true }))
    }
    return rpcAs(actor, 'record_payment', {
      p_order_id: orderId,
      p_amount: amount,
      p_method: method,
      p_note: opts.note ?? null,
      p_client_key: opts.clientKey ?? null,
      p_receipt_path: receiptPath,
    })
  }

  const submit = (
    actor: string,
    orderId: string,
    opts: { workDone?: string; extraCharges?: number; remarks?: string | null } = {},
  ): Promise<Row> =>
    rpcAs(actor, 'submit_completion', {
      p_order_id: orderId,
      p_work_done: opts.workDone ?? 'Done',
      p_extra_charges: opts.extraCharges ?? 0,
      // Extra charges need an explanation (0002); default one unless given.
      p_remarks:
        opts.remarks !== undefined ? opts.remarks : (opts.extraCharges ?? 0) > 0 ? 'Extra parts' : null,
    })

  const advance = async (
    orderId: string,
    target: AdvanceTarget,
    opts: AdvanceOptions = {},
  ): Promise<Row> => {
    const order = await summary(orderId)
    const tech = (order.assigned_technician_id as string | null) ?? opts.technician ?? people.ali
    const order_status = order.status as string
    if (order_status === 'new') {
      await transition(people.admin, orderId, 'assigned', null, tech)
    }
    if (target === 'assigned') return summary(orderId)
    if (target === 'acknowledged') {
      await transition(tech, orderId, 'acknowledged')
      return summary(orderId)
    }
    await transition(tech, orderId, 'in_progress')
    if (target === 'in_progress') return summary(orderId)
    await submit(tech, orderId, {
      workDone: 'Cleaned indoor unit and refilled gas',
      extraCharges: opts.extraCharges ?? 0,
    })
    if (target === 'job_done') return summary(orderId)
    await transition(people.managerSA, orderId, 'reviewed')
    return summary(orderId)
  }

  const audit = (orderId: string) =>
    q<AuditRow>('select * from audit_log where order_id = $1 order by id', [orderId])

  const notifications = (orderId: string) =>
    q<NotificationRow>('select * from notifications where order_id = $1 order by id', [orderId])

  const closeOrder = async (orderId: string): Promise<Row> => {
    const order = await advance(orderId, 'reviewed')
    const balance = Number(order.balance)
    if (balance > 0) await pay(people.finance, orderId, balance)
    return transition(people.finance, orderId, 'closed')
  }

  return {
    db,
    q,
    qAs,
    rpcAs,
    rpc,
    actAs,
    actAsUser,
    actSignedOut,
    currentIdentity: () => current,
    identityOf,
    applyMigration,
    createAuthUser,
    people,
    branchId,
    serviceTypeId,
    createOrder,
    advance,
    summary,
    transition,
    pay,
    submit,
    filePath,
    upload,
    removeObject,
    objects,
    audit,
    notifications,
    closeOrder,
    close: () => db.close(),
  }
}

/**
 * Assert the promise rejects with a message containing `message`.
 * Also guarantees nothing was written: the caller checks state afterwards.
 */
export async function expectRejects(promise: Promise<unknown>, message: string | RegExp) {
  let error: unknown
  try {
    await promise
  } catch (e) {
    error = e
  }
  expect(error, 'expected the call to be rejected').toBeInstanceOf(Error)
  const text = (error as Error).message
  if (typeof message === 'string') expect(text).toContain(message)
  else expect(text).toMatch(message)
}
