/**
 * exportCsv — Pure-JS CSV export with BOM for Excel UTF-8 compatibility.
 *
 * @param {string} filename  - e.g. 'tasks_2026-05-27.csv'
 * @param {Array}  rows      - array of data objects
 * @param {Array}  columns   - [{ label: '任務名稱', value: row => row.title }, ...]
 *                             value can be a function(row) or a string key
 */
export function exportToCsv(filename, rows, columns) {
  const escape = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'

  const header = columns.map(c => escape(c.label)).join(',')
  const body = rows.map(row =>
    columns.map(c => {
      const val = typeof c.value === 'function' ? c.value(row) : (row[c.value] ?? '')
      return escape(val)
    }).join(',')
  ).join('\r\n')

  const csv = '﻿' + header + '\r\n' + body  // BOM prefix for Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Format a date string to YYYY-MM-DD or empty string */
export const fmtDate = (v) => v ? String(v).slice(0, 10) : ''
