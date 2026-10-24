import type { ReactNode } from 'react'
import { TABLE } from '../../../components/styles'

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
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className={TABLE.table}>
        <caption className="sr-only">{caption}</caption>
        <thead className={TABLE.head}>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`whitespace-nowrap px-3 py-2.5 font-medium ${c.numeric ? 'text-right' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={TABLE.row}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.header} scope="row" className="px-3 py-2.5 text-left font-medium text-ink">
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.header} className={`whitespace-nowrap px-3 py-2.5 text-ink ${c.numeric ? 'text-right tabular' : ''}`}>
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
