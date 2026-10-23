import { BUTTON } from './styles'

/** "Showing 26–50 of 112" with Previous / Next. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pages" className="flex flex-col items-center justify-between gap-2 text-sm sm:flex-row">
      <p className="text-slate-600">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <button type="button" className={BUTTON.secondary} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className={BUTTON.secondary} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  )
}
