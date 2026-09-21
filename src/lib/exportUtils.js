/**
 * Export utilities — CSV download & print-to-PDF
 */

/**
 * Export data as a CSV file with BOM for Excel CJK support.
 * @param {Array<Object>} data - Array of row objects
 * @param {Array<{key: string, label: string}>} columns - Column definitions
 * @param {string} filename - Download filename (without .csv)
 */
export function exportToCSV(data, columns, filename) {
  const BOM = '\uFEFF'
  const header = columns.map(c => `"${c.label}"`).join(',')
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? ''
      // Escape quotes in string values
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }).join(',')
  )
  const csv = BOM + [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Trigger browser print dialog for a specific element.
 * Adds a temporary print-only class so only that element prints.
 * @param {string} elementId - The ID of the element to print
 * @param {string} _filename - Unused, kept for API consistency
 */
export function exportToPDF(elementId, _filename) {
  // Inject print-only styles if not already present
  const styleId = '__export-print-style'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        .print-target, .print-target * { visibility: visible !important; }
        .print-target {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
        }
        /* Hide export buttons in print */
        .export-btn-group { display: none !important; }
      }
    `
    document.head.appendChild(style)
  }

  const el = document.getElementById(elementId)
  if (el) {
    el.classList.add('print-target')
    window.print()
    // Clean up after print dialog closes
    const cleanup = () => {
      el.classList.remove('print-target')
    }
    window.addEventListener('afterprint', cleanup, { once: true })
    // Fallback for browsers that don't fire afterprint
    setTimeout(cleanup, 3000)
  } else {
    window.print()
  }
}
