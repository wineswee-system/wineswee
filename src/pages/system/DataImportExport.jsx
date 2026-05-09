import { useState } from 'react'

import { toast } from '../../lib/toast'
const IMPORT_ITEMS = [
  { key: 'employees', icon: '👥', title: '員工資料匯入', desc: '批次匯入員工名單，支援 Excel/CSV' },
  { key: 'customers', icon: '🤝', title: '客戶資料匯入', desc: '匯入客戶清單與聯絡資訊' },
  { key: 'inventory', icon: '📦', title: '庫存資料匯入', desc: '批次更新庫存數量與品項' },
]

const EXPORT_ITEMS = [
  { key: 'employees', icon: '👥', title: '員工名冊', desc: '匯出所有員工基本資料' },
  { key: 'attendance', icon: '📅', title: '考勤報表', desc: '匯出打卡與出勤紀錄' },
  { key: 'salary', icon: '💰', title: '薪資報表', desc: '匯出薪資明細與統計' },
  { key: 'inventory', icon: '📦', title: '庫存報表', desc: '匯出庫存品項與數量' },
]

export default function DataImportExport() {
  const [files, setFiles] = useState({})

  const handleFileChange = (key, e) => {
    setFiles(prev => ({ ...prev, [key]: e.target.files[0] || null }))
  }

  const handleImport = (key) => {
    if (!files[key]) return toast.error('請先選擇檔案')
    toast.error(`正在匯入: ${files[key].name}（功能開發中）`)
  }

  const handleExport = () => {
    toast.error('功能開發中')
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📥</span> 資料匯入匯出</h2>
            <p>批次匯入資料與匯出報表</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📤</span> 匯入資料</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {IMPORT_ITEMS.map(item => (
              <div key={item.key} style={{
                background: 'var(--bg-secondary)',
                borderRadius: 12,
                padding: 20,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{item.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: 'var(--text-primary)' }}>{item.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{item.desc}</div>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={e => handleFileChange(item.key, e)}
                  style={{ fontSize: 13, marginBottom: 12, width: '100%', color: 'var(--text-secondary)' }}
                />
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => handleImport(item.key)}>
                  開始匯入
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📊</span> 匯出報表</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {EXPORT_ITEMS.map(item => (
              <div key={item.key} style={{
                background: 'var(--bg-secondary)',
                borderRadius: 12,
                padding: 20,
                border: '1px solid var(--border-color)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{item.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: 'var(--text-primary)' }}>{item.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{item.desc}</div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleExport}>
                  下載 Excel
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
