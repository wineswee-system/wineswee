import { Upload, Download } from 'lucide-react'

export default function ImportExportTab({ filtered, handleExport, resetImport, setShowImportModal }) {
  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Export section */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Download size={16} style={{ marginRight: 6 }} /> 匯出客戶</div>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            將目前篩選結果匯出為 CSV 檔案（共 {filtered.length} 筆客戶）
          </p>
          <button className="btn btn-primary" onClick={handleExport}>
            <Download size={14} /> 匯出 CSV
          </button>
        </div>
      </div>

      {/* Import section */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Upload size={16} style={{ marginRight: 6 }} /> 匯入客戶</div>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            上傳 CSV 檔案批量匯入客戶資料，系統會自動比對欄位
          </p>
          <button className="btn btn-primary" onClick={() => { resetImport(); setShowImportModal(true) }}>
            <Upload size={14} /> 匯入 CSV
          </button>
        </div>
      </div>
    </div>
  )
}
