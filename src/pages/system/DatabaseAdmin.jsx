import { useState, useEffect } from 'react'
import { Database, Table2, RefreshCw, Search, ChevronDown, ChevronRight, Trash2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

// 系統所有資料表
const ALL_TABLES = [
  { name: 'employees', label: '員工', module: '人事' },
  { name: 'attendance_records', label: '出勤紀錄', module: '人事' },
  { name: 'leave_requests', label: '請假單', module: '人事' },
  { name: 'overtime_requests', label: '加班申請', module: '人事' },
  { name: 'salary_records', label: '薪資紀錄', module: '人事' },
  { name: 'schedules', label: '排班', module: '人事' },
  { name: 'holidays', label: '假日', module: '人事' },
  { name: 'performance_reviews', label: '績效考核', module: '人事' },
  { name: 'recruitment_jobs', label: '招募職缺', module: '人事' },
  { name: 'documents', label: '文件', module: '人事' },
  { name: 'business_trips', label: '差旅', module: '人事' },
  { name: 'expenses', label: '費用', module: '人事' },
  { name: 'insurance_settings', label: '勞健保', module: '人事' },
  { name: 'off_requests', label: '排休申請', module: '人事' },
  { name: 'opportunities', label: '商機', module: '客戶' },
  { name: 'customers', label: '客戶', module: '客戶' },
  { name: 'members', label: '會員', module: '客戶' },
  { name: 'point_transactions', label: '點數異動', module: '客戶' },
  { name: 'stock_levels', label: '庫存', module: '倉儲' },
  { name: 'outbound_orders', label: '出貨單', module: '倉儲' },
  { name: 'inventory_lots', label: '批號', module: '倉儲' },
  { name: 'stock_counts', label: '盤點', module: '倉儲' },
  { name: 'suppliers', label: '供應商', module: '採購' },
  { name: 'purchase_requests', label: '採購申請', module: '採購' },
  { name: 'purchase_orders', label: '採購單', module: '採購' },
  { name: 'goods_receipts', label: '驗收', module: '採購' },
  { name: 'supplier_contracts', label: '供應商合約', module: '採購' },
  { name: 'accounts', label: '會計科目', module: '財務' },
  { name: 'journal_entries', label: '傳票', module: '財務' },
  { name: 'journal_lines', label: '傳票明細', module: '財務' },
  { name: 'accounts_receivable', label: '應收帳款', module: '財務' },
  { name: 'accounts_payable', label: '應付帳款', module: '財務' },
  { name: 'budgets', label: '預算', module: '財務' },
  { name: 'bank_transactions', label: '銀行交易', module: '財務' },
  { name: 'invoices', label: '電子發票', module: '財務' },
  { name: 'quotations', label: '報價單', module: '銷售' },
  { name: 'sales_orders', label: '銷售訂單', module: '銷售' },
  { name: 'promotions', label: '促銷活動', module: '銷售' },
  { name: 'returns', label: '退貨', module: '銷售' },
  { name: 'shipments', label: '物流', module: '銷售' },
  { name: 'pos_transactions', label: 'POS交易', module: 'POS' },
  { name: 'pos_shifts', label: 'POS交班', module: 'POS' },
  { name: 'bom', label: '物料清單', module: '生產' },
  { name: 'mrp_results', label: 'MRP結果', module: '生產' },
  { name: 'quality_inspections', label: '品檢', module: '生產' },
  { name: 'manufacturing_orders', label: '製令', module: '生產' },
  { name: 'workflows', label: '流程', module: '流程' },
  { name: 'tasks', label: '任務', module: '流程' },
  { name: 'checklists', label: '查核清單', module: '流程' },
  { name: 'companies', label: '公司', module: '組織' },
  { name: 'stores', label: '門市', module: '組織' },
  { name: 'departments', label: '部門', module: '組織' },
  { name: 'roles', label: '角色', module: '系統' },
  { name: 'permissions', label: '權限', module: '系統' },
  { name: 'role_permissions', label: '角色權限', module: '系統' },
  { name: 'triggers', label: '觸發器', module: '系統' },
  { name: 'notifications', label: '通知', module: '系統' },
  { name: 'audit_logs', label: '稽核日誌', module: '系統' },
  { name: 'kpi_data', label: 'KPI', module: '系統' },
  { name: 'ecommerce_connections', label: '電商連線', module: '串接' },
  { name: 'ecommerce_sync_logs', label: '同步日誌', module: '串接' },
  { name: 'inquiries', label: '諮詢', module: '其他' },
  { name: 'line_users', label: 'LINE用戶', module: '串接' },
]

const MODULE_COLORS = {
  '人事': 'var(--accent-cyan)',
  '客戶': 'var(--accent-blue)',
  '倉儲': 'var(--accent-green)',
  '採購': 'var(--accent-yellow)',
  '財務': 'var(--accent-green)',
  '銷售': 'var(--accent-pink)',
  'POS': 'var(--accent-cyan)',
  '生產': 'var(--accent-red)',
  '流程': 'var(--accent-purple)',
  '組織': 'var(--accent-orange)',
  '系統': 'var(--accent-purple)',
  '串接': 'var(--accent-cyan)',
  '其他': 'var(--text-muted)',
}

export default function DatabaseAdmin() {
  const [tableCounts, setTableCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [expandedTable, setExpandedTable] = useState(null)
  const [tableData, setTableData] = useState(null)
  const [tableDataLoading, setTableDataLoading] = useState(false)

  // 抓每張表的筆數
  const fetchCounts = async () => {
    setLoading(true)
    setError(null)
    try {
      const counts = {}
      await Promise.all(
        ALL_TABLES.map(async (t) => {
          try {
            const { count } = await supabase.from(t.name).select('*', { count: 'exact', head: true })
            counts[t.name] = count || 0
          } catch {
            counts[t.name] = -1 // 表不存在
          }
        })
      )
      setTableCounts(counts)
    } catch (err) {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCounts() }, [])

  // 點擊展開看資料
  const handleExpand = async (tableName) => {
    if (expandedTable === tableName) {
      setExpandedTable(null)
      setTableData(null)
      return
    }
    setExpandedTable(tableName)
    setTableDataLoading(true)
    try {
      const { data } = await supabase.from(tableName).select('*').order('id', { ascending: false }).limit(20)
      setTableData(data || [])
    } catch {
      setTableData([])
    }
    setTableDataLoading(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const modules = [...new Set(ALL_TABLES.map(t => t.module))]
  const filtered = ALL_TABLES.filter(t =>
    (moduleFilter === '' || t.module === moduleFilter) &&
    (search === '' || t.name.includes(search) || t.label.includes(search))
  )

  const totalRows = Object.values(tableCounts).filter(c => c >= 0).reduce((s, c) => s + c, 0)
  const existingTables = Object.values(tableCounts).filter(c => c >= 0).length
  const emptyTables = Object.values(tableCounts).filter(c => c === 0).length
  const missingTables = Object.values(tableCounts).filter(c => c === -1).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🗄️</span> 資料庫管理</h2>
            <p>查看所有資料表狀態與內容</p>
          </div>
          <button className="btn btn-secondary" onClick={fetchCounts}>
            <RefreshCw size={14} /> 重新整理
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-icon"><Database size={16} /></div>
          <div className="stat-card-label">資料表數</div>
          <div className="stat-card-value">{ALL_TABLES.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-icon"><Table2 size={16} /></div>
          <div className="stat-card-label">已建立</div>
          <div className="stat-card-value">{existingTables}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">空表</div>
          <div className="stat-card-value">{emptyTables}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-icon"><AlertTriangle size={16} /></div>
          <div className="stat-card-label">未建立</div>
          <div className="stat-card-value">{missingTables}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">總資料筆數</div>
          <div className="stat-card-value">{totalRows.toLocaleString()}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setModuleFilter('')}
          style={{
            padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
            background: moduleFilter === '' ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: moduleFilter === '' ? '#fff' : 'var(--text-secondary)',
            outline: moduleFilter === '' ? 'none' : '1px solid var(--border-medium)',
          }}
        >全部 ({ALL_TABLES.length})</button>
        {modules.map(m => {
          const count = ALL_TABLES.filter(t => t.module === m).length
          return (
            <button key={m} onClick={() => setModuleFilter(m)} style={{
              padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: moduleFilter === m ? MODULE_COLORS[m] : 'var(--bg-card)',
              color: moduleFilter === m ? '#fff' : 'var(--text-secondary)',
              outline: moduleFilter === m ? 'none' : '1px solid var(--border-medium)',
            }}>{m} ({count})</button>
          )
        })}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-muted)' }} />
          <input className="form-input" type="text" placeholder="搜尋表名..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, width: 180, fontSize: 12 }} />
        </div>
      </div>

      {/* Table List */}
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 50 }}>#</th><th>資料表名稱</th><th>中文說明</th><th>模組</th><th style={{ width: 100 }}>筆數</th><th style={{ width: 80 }}>狀態</th><th style={{ width: 60 }}></th></tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const count = tableCounts[t.name]
                const exists = count >= 0
                const isExpanded = expandedTable === t.name
                return (
                  <>
                    <tr key={t.name} style={{ cursor: 'pointer' }} onClick={() => exists && handleExpand(t.name)}>
                      <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{t.name}</td>
                      <td>{t.label}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                          background: `${MODULE_COLORS[t.module]}15`, color: MODULE_COLORS[t.module],
                        }}>{t.module}</span>
                      </td>
                      <td style={{ fontWeight: 700, color: count > 0 ? 'var(--accent-green)' : count === 0 ? 'var(--text-muted)' : 'var(--accent-red)' }}>
                        {exists ? count.toLocaleString() : '—'}
                      </td>
                      <td>
                        <span className={`badge ${exists ? (count > 0 ? 'badge-success' : 'badge-warning') : 'badge-danger'}`}>
                          <span className="badge-dot"></span>
                          {exists ? (count > 0 ? '有資料' : '空表') : '未建立'}
                        </span>
                      </td>
                      <td>
                        {exists && (
                          isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${t.name}-data`}>
                        <td colSpan={7} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                          <div style={{ padding: '12px 16px', maxHeight: 300, overflowY: 'auto', overflowX: 'auto' }}>
                            {tableDataLoading ? (
                              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>載入中...</div>
                            ) : !tableData || tableData.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>此表無資料</div>
                            ) : (
                              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr>
                                    {Object.keys(tableData[0]).map(col => (
                                      <th key={col} style={{
                                        padding: '6px 8px', textAlign: 'left', fontWeight: 600,
                                        color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)',
                                        whiteSpace: 'nowrap', fontSize: 10,
                                      }}>{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {tableData.map((row, ri) => (
                                    <tr key={ri}>
                                      {Object.values(row).map((val, ci) => (
                                        <td key={ci} style={{
                                          padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)',
                                          maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                          color: 'var(--text-secondary)',
                                        }}>
                                          {val === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> :
                                           typeof val === 'object' ? <span style={{ color: 'var(--accent-purple)', fontSize: 10 }}>{JSON.stringify(val).slice(0, 60)}...</span> :
                                           String(val)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                              顯示最新 20 筆（共 {count} 筆）
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
