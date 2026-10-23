import type { ReactNode } from 'react'

export interface DataColumn<T> {
  header: string
  cell: (row: T) => ReactNode
  /** Right-align numbers. */
  numeric?: boolean
}

/** The figures behind a chart ("Show as table"): a plain table a screen reader can read. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string
  columns: DataColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-xs font-medium text-slate-600">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-3 py-2 ${c.numeric ? 'text-right' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.header} scope="row" className="px-3 py-2 text-left font-medium">
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.header} className={`whitespace-nowrap px-3 py-2 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
