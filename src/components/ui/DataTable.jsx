/**
 * Polished data table with sorting, hover effects, and responsive design
 */
export default function DataTable({ columns, data, emptyText = '目前沒有資料', onRowClick, className = '' }) {
  return (
    <div className={`dt-wrapper ${className}`}>
      <table className="dt-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={col.width ? { width: col.width } : undefined} className={col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="dt-empty">
                <div className="dt-empty-inner">
                  <div className="dt-empty-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                  </div>
                  <span>{emptyText}</span>
                </div>
              </td>
            </tr>
          ) : (
            data.map((row, ri) => (
              <tr
                key={row.id ?? ri}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'dt-clickable' : ''}
              >
                {columns.map((col, ci) => (
                  <td key={ci} className={col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}>
                    {col.render ? col.render(row[col.key], row, ri) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
