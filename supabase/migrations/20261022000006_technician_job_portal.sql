-- 0002 Technician job portal: job files in Supabase Storage, retry-safe
-- payments with receipts, the extra-charges rule, technician notifications,
-- and the technician's job list. Builds on 0000 and 0001; nothing here edits
-- an earlier file.
--
-- * Storage: private bucket `job-files`. Paths are
--     <order_id>/<uuid>.<ext>            job files (photos, videos, PDFs)
--     <order_id>/receipts/<uuid>.<ext>   payment receipts
--   Policies on storage.objects call _can_access_job_file(): files are read
--   by whoever can read the order (the assigned technician, every Admin,
--   Manager and Finance user); job files are uploaded / deleted by the
--   assigned technician or an Admin while the job is In Progress; receipts by
--   the assigned technician or Finance while In Progress, Job Done or
--   Reviewed. A file can be deleted only once no attachments row points at it.
-- * add_attachment / remove_attachment: register an uploaded job file (type
--   and size read from storage.objects, not from the browser) or unregister
--   one; the browser deletes the stored file afterwards.
-- * record_payment is recreated with a client key (a retry returns the first
--   payment instead of recording it twice) and a receipt saved in the same
--   transaction; non-cash payments need a receipt. Finance is notified when a
--   technician records a payment.
-- * submit_completion (same signature): extra charges RM 0.00 - 100,000.00
--   with at most 2 decimals; remarks required when extra charges are above 0.
-- * transition_order (same signature): the technician is notified when their
--   job is cancelled or reassigned to someone else.
-- * mark_all_notifications_read, my_jobs (the job list tabs).
-- * notifications join the supabase_realtime publication (when it exists).
--
-- src/domain/attachments.ts, completionForm.ts and paymentForm.ts mirror the
-- rules; tests/db/parity.test.ts keeps both identical.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table attachments add column file_name text;
alter table attachments add column size_bytes bigint;
create unique index attachments_storage_path_key on attachments (storage_path);

alter table payments add column client_key uuid;
create unique index payments_client_key_key on payments (client_key);

alter table notifications drop constraint notifications_event_check;
alter table notifications add constraint notifications_event_check
  check (event in ('assigned', 'job_done', 'rework', 'reviewed', 'order_updated',
                   'cancelled', 'reassigned_away', 'payment_recorded'));

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- Extra charges: RM 0.00 to RM 100,000.00, at most 2 decimals; empty = 0.
create function _check_extra_charges(p_extra numeric) returns numeric
language plpgsql immutable as $$
begin
  if p_extra is null then
    return 0;
  end if;
  if p_extra < 0 then
    raise exception 'Extra charges cannot be negative';
  end if;
  if p_extra > 100000 then
    raise exception 'Extra charges cannot be more than RM 100,000.00';
  end if;
  if p_extra <> round(p_extra, 2) then
    raise exception 'Extra charges can have at most 2 decimal places';
  end if;
  return p_extra;
end;
$$;

-- The order a job-files path belongs to, or null when the path does not have
-- the expected shape.
create function _job_file_order(p_name text) returns uuid
language sql immutable as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(receipts/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create function _job_file_is_receipt(p_name text) returns boolean
language sql immutable as $$
  select split_part(coalesce(p_name, ''), '/', 2) = 'receipts';
$$;

-- Who may add or remove files, and when. Null = allowed, else the message.
create function _job_file_write_error(p_actor staff, p_order orders, p_receipt boolean) returns text
language plpgsql stable as $$
declare
  v_assigned boolean := p_actor.role = 'technician' and p_order.assigned_technician_id = p_actor.id;
begin
  if p_receipt then
    if not (v_assigned or p_actor.role = 'finance') then
      return 'Only the assigned technician or Finance can attach a receipt';
    end if;
    if p_order.status not in ('in_progress', 'job_done', 'reviewed') then
      return format('Receipts can only be added while the order is In Progress, Job Done or Reviewed (it is currently %s)',
        _status_label(p_order.status));
    end if;
  else
    if not (v_assigned or p_actor.role = 'admin') then
      return 'Only the assigned technician or an Admin can change the files of a job';
    end if;
    if p_order.status <> 'in_progress' then
      return format('Files can only be changed while the job is In Progress (it is currently %s)',
        _status_label(p_order.status));
    end if;
  end if;
  return null;
end;
$$;

-- Allowed file types and sizes. Returns the attachment kind or raises.
-- Photos: JPEG, PNG, WebP, HEIC/HEIF, max 10 MB. Videos: MP4, MOV, WebM,
-- max 50 MB. PDF: max 10 MB. Receipts: photo or PDF only.
create function _job_file_kind(p_mime text, p_size bigint, p_receipt boolean) returns attachment_kind
language plpgsql immutable as $$
declare
  v_mime text := lower(btrim(split_part(coalesce(p_mime, ''), ';', 1)));
  v_kind attachment_kind;
begin
  v_kind := case
    when v_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then 'photo'
    when v_mime in ('video/mp4', 'video/quicktime', 'video/webm') then 'video'
    when v_mime = 'application/pdf' then 'pdf'
  end::attachment_kind;
  if v_kind is null then
    raise exception 'This file type is not allowed. Use a photo (JPEG, PNG, WebP, HEIC), a video (MP4, MOV, WebM) or a PDF';
  end if;
  if p_receipt and v_kind = 'video' then
    raise exception 'A receipt must be a photo or a PDF';
  end if;
  if p_size is null or p_size <= 0 then
    raise exception 'The file is empty';
  end if;
  if v_kind = 'photo' and p_size > 10 * 1024 * 1024 then
    raise exception 'Photos can be at most 10 MB';
  end if;
  if v_kind = 'video' and p_size > 50 * 1024 * 1024 then
    raise exception 'Videos can be at most 50 MB';
  end if;
  if v_kind = 'pdf' and p_size > 10 * 1024 * 1024 then
    raise exception 'PDFs can be at most 10 MB';
  end if;
  return v_kind;
end;
$$;

-- The stored object behind a path, uploaded by this actor: its real MIME type
-- and size as recorded by Supabase Storage.
create function _job_file_object(p_name text, p_actor staff, out mime text, out size bigint)
language plpgsql stable as $$
begin
  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
    into mime, size
    from storage.objects o
   where o.bucket_id = 'job-files'
     and o.name = p_name
     and coalesce(o.owner_id, o.owner::text) = p_actor.auth_user_id::text;
  if not found then
    raise exception 'The file was not uploaded. Try again.';
  end if;
end;
$$;

-- Storage policy helper: may the signed-in user read / upload / delete this
-- job-files object? SECURITY DEFINER so it can read staff and orders.
create function _can_access_job_file(p_name text, p_action text) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid := _job_file_order(p_name);
  v_actor    staff;
  v_order    orders;
begin
  if v_order_id is null then
    return false;
  end if;
  select * into v_actor from staff where auth_user_id = auth.uid() and active;
  if not found then
    return false;
  end if;
  select * into v_order from orders where id = v_order_id;
  if not found then
    return false;
  end if;

  if p_action = 'read' then
    return v_actor.role <> 'technician' or v_order.assigned_technician_id = v_actor.id;
  end if;
  if _job_file_write_error(v_actor, v_order, _job_file_is_receipt(p_name)) is not null then
    return false;
  end if;
  if p_action = 'upload' then
    return true;
  end if;
  if p_action = 'delete' then
    return not exists (select 1 from attachments a where a.storage_path = p_name);
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_attachment / remove_attachment
-- ---------------------------------------------------------------------------
-- Register a job file the browser has uploaded to <order_id>/<uuid>.<ext>.
-- Calling it again for the same file returns the existing row (safe to retry).
create function add_attachment(
  p_order_id     uuid,
  p_storage_path text,
  p_file_name    text default null
) returns attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  staff := _require_actor();
  v_order  orders := _lock_order(p_order_id);
  v_error  text;
  v_object record;
  v_kind   attachment_kind;
  v_row    attachments;
begin
  v_error := _job_file_write_error(v_actor, v_order, false);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if _job_file_order(p_storage_path) is distinct from v_order.id or _job_file_is_receipt(p_storage_path) then
    raise exception 'This file does not belong to %', v_order.order_no;
  end if;

  select * into v_row from attachments where storage_path = p_storage_path;
  if found then
    if v_row.order_id = v_order.id and v_row.payment_id is null and v_row.uploaded_by = v_actor.id then
      return v_row;
    end if;
    raise exception 'This file is already attached';
  end if;

  v_object := _job_file_object(p_storage_path, v_actor);
  v_kind := _job_file_kind(v_object.mime, v_object.size, false);

  insert into attachments (order_id, kind, storage_path, mime_type, file_name, size_bytes, uploaded_by)
  values (v_order.id, v_kind, p_storage_path, lower(split_part(v_object.mime, ';', 1)),
          left(nullif(btrim(coalesce(p_file_name, '')), ''), 200), v_object.size, v_actor.id)
  returning * into v_row;

  perform _audit(v_order.id, v_actor, 'file_added', null, null, null,
    jsonb_build_object(
      'attachment_id', v_row.id,
      'kind', v_row.kind,
      'file_name', v_row.file_name,
      'status', v_order.status));

  return v_row;
end;
$$;

-- Unregister a job file; returns the removed row so the browser can delete
-- the stored file (the delete policy allows it once the row is gone).
create function remove_attachment(p_attachment_id uuid) returns attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_order orders;
  v_row   attachments;
  v_error text;
begin
  select * into v_row from attachments where id = p_attachment_id;
  if not found then
    raise exception 'File not found';
  end if;
  v_order := _lock_order(v_row.order_id);
  -- Re-read under the order lock (it may have been removed meanwhile).
  select * into v_row from attachments where id = p_attachment_id;
  if not found then
    raise exception 'File not found';
  end if;

  if v_actor.role = 'technician' and v_order.assigned_technician_id is distinct from v_actor.id then
    raise exception 'File not found';
  end if;
  if v_row.payment_id is not null then
    raise exception 'A payment receipt cannot be removed';
  end if;
  v_error := _job_file_write_error(v_actor, v_order, false);
  if v_error is not null then
    raise exception '%', v_error;
  end if;

  delete from attachments where id = v_row.id;

  perform _audit(v_order.id, v_actor, 'file_removed', null, null, null,
    jsonb_build_object(
      'attachment_id', v_row.id,
      'kind', v_row.kind,
      'file_name', v_row.file_name,
      'status', v_order.status));

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment: recreated with a client key and a receipt.
-- ---------------------------------------------------------------------------
drop function record_payment(uuid, numeric, payment_method, text);

create function _payment_method_label(p_method payment_method) returns text
language sql immutable as $$
  select case p_method
    when 'cash'          then 'Cash'
    when 'bank_transfer' then 'Bank transfer'
    when 'card'          then 'Card'
    when 'ewallet'       then 'E-wallet'
  end;
$$;

create function record_payment(
  p_order_id          uuid,
  p_amount            numeric,
  p_method            payment_method,
  p_note              text default null,
  p_client_key        uuid default null,
  p_receipt_path      text default null,
  p_receipt_file_name text default null
) returns payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   staff := _require_actor();
  v_order   orders := _lock_order(p_order_id);
  v_payment payments;
  v_object  record;
  v_kind    attachment_kind;
  v_finance record;
begin
  -- A retry of a payment that was already saved returns it unchanged.
  if p_client_key is not null then
    select * into v_payment from payments where client_key = p_client_key;
    if found then
      if v_payment.order_id = v_order.id and v_payment.recorded_by = v_actor.id then
        return v_payment;
      end if;
      raise exception 'This payment key has already been used';
    end if;
  end if;

  if not (
    v_actor.role = 'finance'
    or (v_actor.role = 'technician' and v_order.assigned_technician_id = v_actor.id)
  ) then
    raise exception 'Only the assigned technician or Finance can record a payment';
  end if;
  if v_order.status not in ('in_progress', 'job_done', 'reviewed') then
    raise exception 'Payments can only be recorded while the order is In Progress, Job Done or Reviewed (it is currently %)',
      _status_label(v_order.status);
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_method is null then
    raise exception 'Select a payment method';
  end if;

  if p_receipt_path is null then
    if p_method <> 'cash' then
      raise exception 'Attach a receipt for bank transfer, card or e-wallet payments';
    end if;
  else
    if _job_file_order(p_receipt_path) is distinct from v_order.id or not _job_file_is_receipt(p_receipt_path) then
      raise exception 'This receipt does not belong to %', v_order.order_no;
    end if;
    if exists (select 1 from attachments where storage_path = p_receipt_path) then
      raise exception 'This receipt is already attached to a payment';
    end if;
    v_object := _job_file_object(p_receipt_path, v_actor);
    v_kind := _job_file_kind(v_object.mime, v_object.size, true);
  end if;

  insert into payments (order_id, amount, method, note, recorded_by, client_key)
  values (v_order.id, round(p_amount, 2), p_method,
          nullif(btrim(coalesce(p_note, '')), ''), v_actor.id, p_client_key)
  returning * into v_payment;

  if p_receipt_path is not null then
    insert into attachments (order_id, payment_id, kind, storage_path, mime_type, file_name, size_bytes, uploaded_by)
    values (v_order.id, v_payment.id, v_kind, p_receipt_path, lower(split_part(v_object.mime, ';', 1)),
            left(nullif(btrim(coalesce(p_receipt_file_name, '')), ''), 200), v_object.size, v_actor.id);
  end if;

  perform _audit(v_order.id, v_actor, 'payment_recorded', null, null, p_note,
    jsonb_build_object(
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'method', v_payment.method,
      'receipt', p_receipt_path is not null,
      'status', v_order.status,
      'payment_status_after', _payment_status(v_order.id)));

  if v_actor.role = 'technician' then
    for v_finance in select id from staff where role = 'finance' and active loop
      perform _notify(v_finance.id, v_order.id, 'payment_recorded',
        format('%s: %s recorded a payment of RM %s (%s)', v_order.order_no, v_actor.name,
          to_char(v_payment.amount, 'FM999,999,990.00'), _payment_method_label(v_payment.method)));
    end loop;
  end if;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_completion (same signature): extra-charges rule and remarks.
-- ---------------------------------------------------------------------------
create or replace function submit_completion(
  p_order_id      uuid,
  p_work_done     text,
  p_extra_charges numeric default 0,
  p_remarks       text default null
) returns orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   staff := _require_actor();
  v_order   orders := _lock_order(p_order_id);
  v_extra   numeric;
  v_manager record;
begin
  perform _authorize_transition(v_actor, v_order, 'job_done', null);

  if btrim(coalesce(p_work_done, '')) = '' then
    raise exception 'Describe the work done before submitting';
  end if;
  v_extra := _check_extra_charges(p_extra_charges);
  if v_extra > 0 and btrim(coalesce(p_remarks, '')) = '' then
    raise exception 'Explain the extra charges in the remarks';
  end if;

  insert into order_completions (order_id, work_done, extra_charges, remarks, technician_id, completed_at)
  values (v_order.id, btrim(p_work_done), v_extra,
          nullif(btrim(coalesce(p_remarks, '')), ''), v_actor.id, now())
  on conflict (order_id) do update
    set work_done     = excluded.work_done,
        extra_charges = excluded.extra_charges,
        remarks       = excluded.remarks,
        technician_id = excluded.technician_id,
        completed_at  = excluded.completed_at;

  update orders set status = 'job_done' where id = v_order.id returning * into v_order;

  perform _audit(v_order.id, v_actor, 'completion_submitted', 'in_progress', 'job_done', p_remarks,
    jsonb_build_object(
      'extra_charges', v_extra,
      'final_amount', v_order.quoted_price + v_extra));

  for v_manager in
    select id from staff where role = 'manager' and active and branch_id = v_order.branch_id
  loop
    perform _notify(v_manager.id, v_order.id, 'job_done',
      format('%s is done and awaiting your review', v_order.order_no));
  end loop;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_order (same signature): also tell the technician when their job
-- is cancelled or reassigned to someone else.
-- ---------------------------------------------------------------------------
create or replace function transition_order(
  p_order_id      uuid,
  p_to_status     order_status,
  p_note          text default null,
  p_technician_id uuid default null
) returns orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    staff := _require_actor();
  v_order    orders := _lock_order(p_order_id);
  v_rule     order_status_transitions;
  v_from     order_status := v_order.status;
  v_new_tech staff;
  v_old_tech staff;
  v_action   text;
  v_details  jsonb := '{}'::jsonb;
  v_technician_id uuid := v_order.assigned_technician_id;
  v_finance  record;
begin
  if p_to_status = 'job_done' then
    raise exception 'Submit the completion record to mark a job as done';
  end if;

  v_rule := _authorize_transition(v_actor, v_order, p_to_status, p_note);

  if p_to_status = 'assigned' then
    v_new_tech := _require_technician(p_technician_id);
    if v_from in ('assigned', 'acknowledged') then
      if v_new_tech.id = v_order.assigned_technician_id then
        raise exception 'Choose a different technician to reassign this order';
      end if;
      select * into v_old_tech from staff where id = v_order.assigned_technician_id;
      v_action := 'reassigned';
      v_details := jsonb_build_object(
        'previous_technician_id', v_old_tech.id,
        'previous_technician_name', v_old_tech.name,
        'new_technician_id', v_new_tech.id,
        'new_technician_name', v_new_tech.name);
    else
      v_action := 'assigned';
      v_details := jsonb_build_object(
        'technician_id', v_new_tech.id,
        'technician_name', v_new_tech.name);
    end if;
    v_technician_id := v_new_tech.id;
  else
    v_action := case p_to_status
      when 'acknowledged' then 'acknowledged'
      when 'in_progress'  then case when v_from = 'job_done' then 'returned_for_rework' else 'started' end
      when 'reviewed'     then 'reviewed'
      when 'closed'       then 'closed'
      when 'cancelled'    then 'cancelled'
    end;
  end if;

  update orders
     set status = p_to_status,
         assigned_technician_id = v_technician_id
   where id = v_order.id
   returning * into v_order;

  perform _audit(v_order.id, v_actor, v_action, v_from, p_to_status, p_note, v_details);

  -- Notifications
  if p_to_status = 'assigned' then
    perform _notify(v_technician_id, v_order.id, 'assigned',
      case when v_from = 'new'
           then format('%s has been assigned to you', v_order.order_no)
           else format('%s has been reassigned to you', v_order.order_no) end);
    if v_old_tech.id is not null then
      perform _notify(v_old_tech.id, v_order.id, 'reassigned_away',
        format('%s has been reassigned to another technician', v_order.order_no));
    end if;
  elsif v_action = 'returned_for_rework' then
    perform _notify(v_order.assigned_technician_id, v_order.id, 'rework',
      format('%s was returned for rework: %s', v_order.order_no, btrim(p_note)));
  elsif p_to_status = 'reviewed' then
    for v_finance in select id from staff where role = 'finance' and active loop
      perform _notify(v_finance.id, v_order.id, 'reviewed',
        format('%s has been reviewed and is ready for payment verification', v_order.order_no));
    end loop;
  elsif p_to_status = 'cancelled' and v_order.assigned_technician_id is not null then
    perform _notify(v_order.assigned_technician_id, v_order.id, 'cancelled',
      format('%s was cancelled: %s', v_order.order_no, btrim(p_note)));
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications and the job list
-- ---------------------------------------------------------------------------
-- Mark every unread notification of the signed-in user as read; returns how many.
create function mark_all_notifications_read() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_count integer;
begin
  update notifications
     set read_at = now()
   where recipient_id = v_actor.id
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The signed-in technician's jobs for one tab of the job list:
--   open      Assigned, Acknowledged, In Progress (soonest scheduled first)
--   submitted Job Done, Reviewed (latest first)
--   finished  Closed, Cancelled in the last 30 days (latest first)
create function my_jobs(p_view text default 'open') returns setof order_summary
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
begin
  if v_actor.role <> 'technician' then
    raise exception 'Only technicians have a job list';
  end if;
  if p_view = 'open' then
    return query
      select * from order_summary
       where assigned_technician_id = v_actor.id
         and status in ('assigned', 'acknowledged', 'in_progress')
       order by scheduled_at nulls last, created_at, order_no;
  elsif p_view = 'submitted' then
    return query
      select * from order_summary
       where assigned_technician_id = v_actor.id
         and status in ('job_done', 'reviewed')
       order by updated_at desc, order_no desc;
  elsif p_view = 'finished' then
    return query
      select * from order_summary
       where assigned_technician_id = v_actor.id
         and status in ('closed', 'cancelled')
         and updated_at >= now() - interval '30 days'
       order by updated_at desc, order_no desc;
  else
    raise exception 'Unknown job list view: %', p_view;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: helpers internal; RPCs and the storage policy helper
-- for signed-in staff only. (submit_completion and transition_order keep the
-- grants they already had; record_payment was recreated and needs them again.)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in (
         '_check_extra_charges', '_job_file_order', '_job_file_is_receipt',
         '_job_file_write_error', '_job_file_kind', '_job_file_object',
         '_can_access_job_file', '_payment_method_label',
         'add_attachment', 'remove_attachment', 'record_payment',
         'mark_all_notifications_read', 'my_jobs')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('_can_access_job_file', 'add_attachment', 'remove_attachment', 'record_payment',
                     'mark_all_notifications_read', 'my_jobs') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supabase only: storage bucket and policies, realtime. Skipped where the
-- storage schema / realtime publication does not exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found: job-files bucket and policies skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-files', 'job-files', false, 52428800, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists job_files_read on storage.objects';
  execute 'drop policy if exists job_files_upload on storage.objects';
  execute 'drop policy if exists job_files_delete on storage.objects';

  execute $p$
    create policy job_files_read on storage.objects
      for select to authenticated
      using (bucket_id = 'job-files' and public._can_access_job_file(name, 'read'))
  $p$;
  execute $p$
    create policy job_files_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'job-files' and public._can_access_job_file(name, 'upload'))
  $p$;
  execute $p$
    create policy job_files_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'job-files' and public._can_access_job_file(name, 'delete'))
  $p$;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications')
  then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;
