import { Upload } from 'lucide-react'
import Modal from '../../../components/Modal'

export default function ImportModal({
  importStep, importData, importMapping, setImportMapping,
  handleFileUpload, handleImportConfirm, resetImport,
}) {
  return (
    <Modal
      title={importStep === 1 ? '匯入 CSV — 上傳檔案' : importStep === 2 ? '匯入 CSV — 預覽與欄位對應' : '匯入完成'}
      onClose={resetImport}
      onSubmit={importStep === 2 ? handleImportConfirm : resetImport}
      submitLabel={importStep === 2 ? `確認匯入 (${importData?.rows?.length || 0} 筆)` : '完成'}
    >
      {importStep === 1 && (
        <div>
          <div style={{
            border: '2px dashed var(--border-medium)', borderRadius: 12,
            padding: 32, textAlign: 'center', cursor: 'pointer',
            background: 'var(--glass-light)',
          }}>
            <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>選擇 CSV 檔案上傳</div>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ fontSize: 12 }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            支援欄位：客戶姓名、公司、電話、Email、狀態、標籤、來源、負責業務、備註、信用額度
          </div>
        </div>
      )}

      {importStep === 2 && importData && (
        <div>
          {importData.errors.length > 0 && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-red-dim, rgba(255,0,0,0.1))', color: 'var(--accent-red)', fontSize: 12, marginBottom: 12 }}>
              {importData.errors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}

          {/* Field mapping */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>欄位對應</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {importData.headers.map(h => (
                <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ minWidth: 80, color: 'var(--text-muted)' }}>{h}</span>
                  <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                  <select
                    className="form-input"
                    style={{ flex: 1, fontSize: 12, padding: '3px 6px' }}
                    value={importMapping[h] || ''}
                    onChange={e => setImportMapping(prev => ({ ...prev, [h]: e.target.value }))}
                  >
                    <option value="">（忽略）</option>
                    <option value="name">姓名</option>
                    <option value="company">公司</option>
                    <option value="phone">電話</option>
                    <option value="email">Email</option>
                    <option value="status">狀態</option>
                    <option value="tags">標籤</option>
                    <option value="source">來源</option>
                    <option value="assigned_to">負責業務</option>
                    <option value="notes">備註</option>
                    <option value="credit_limit">信用額度</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
            資料預覽（前 5 筆，共 {importData.rows.length} 筆）
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 200, border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    {importData.headers.map(h => (
                      <th key={h} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importData.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {importData.headers.map(h => (
                        <td key={h} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{row[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {importStep === 3 && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>匯入完成</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>已成功匯入客戶資料</div>
        </div>
      )}
    </Modal>
  )
}
