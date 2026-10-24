export function SetupNotice() {
  return (
    <section
      role="alert"
      className="mx-auto max-w-2xl rounded-lg border border-warning/40 bg-warning-soft p-5 text-warning-ink"
    >
      <h2 className="text-lg font-semibold">Supabase is not configured</h2>
      <p className="mt-2 text-sm">
        The app needs a Supabase project to sign staff in and load orders. To connect one:
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Copy <code className="rounded bg-warning-soft px-1">.env.example</code> to{' '}
          <code className="rounded bg-warning-soft px-1">.env.local</code>.
        </li>
        <li>
          Set <code className="rounded bg-warning-soft px-1">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-warning-soft px-1">VITE_SUPABASE_ANON_KEY</code> from your
          Supabase project (Settings, then API; the publishable key or the legacy anon key both
          work).
        </li>
        <li>Restart the dev server (environment variables are read at startup).</li>
      </ol>
    </section>
  )
}
