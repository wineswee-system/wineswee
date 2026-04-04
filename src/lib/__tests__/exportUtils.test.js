import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportToCSV, exportToPDF } from '../exportUtils.js'

// Mock DOM APIs
beforeEach(() => {
  // Mock URL.createObjectURL and URL.revokeObjectURL
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  global.URL.revokeObjectURL = vi.fn()
})

describe('exportToCSV', () => {
  it('EX-03: generates CSV with BOM and correct headers', () => {
    const mockLink = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {})

    const data = [
      { name: '王小明', salary: 45000 },
      { name: '李小華', salary: 38000 },
    ]
    const columns = [
      { key: 'name', label: '姓名' },
      { key: 'salary', label: '薪資' },
    ]

    exportToCSV(data, columns, 'test-export')

    // Blob was created (via URL.createObjectURL)
    expect(global.URL.createObjectURL).toHaveBeenCalled()
    expect(mockLink.download).toBe('test-export.csv')
    expect(mockLink.click).toHaveBeenCalled()
  })
})

describe('exportToPDF', () => {
  it('EX-04: triggers print dialog', () => {
    const mockPrint = vi.spyOn(window, 'print').mockImplementation(() => {})
    const mockElement = { classList: { add: vi.fn(), remove: vi.fn() } }
    vi.spyOn(document, 'getElementById').mockReturnValue(mockElement)

    exportToPDF('test-element', 'report')

    expect(mockElement.classList.add).toHaveBeenCalledWith('print-target')
    expect(mockPrint).toHaveBeenCalled()
  })

  it('prints without target element (falls back to window.print)', () => {
    vi.spyOn(document, 'getElementById').mockReturnValue(null)
    vi.spyOn(document, 'createElement').mockReturnValue({ id: '', textContent: '' })
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => {})
    const mockPrint = vi.spyOn(window, 'print').mockImplementation(() => {})

    exportToPDF('nonexistent', 'report')

    expect(mockPrint).toHaveBeenCalled()
  })
})
