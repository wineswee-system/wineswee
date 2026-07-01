import { useState, useEffect, useCallback } from 'react'
import {
  Package, Shield, RefreshCw, Check, X, Building2, Save,
  Users, CreditCard, Handshake, ShoppingCart, Warehouse,
  Factory, BarChart3, GitBranch, Zap, Bot, Monitor, Search,
  ToggleLeft, ToggleRight, AlertTriangle
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getTenants, updateTenantModules } from '../../lib/db'

const ALL_MODULES = [
  { key: 'HR', label: '人力資源', desc: '出勤、請假、薪資、績效、招募、訓練', icon: Users, color: '#a78bfa', group: '人員' },
  { key: 'Finance', label: '財務會計', desc: '傳票、應收/應付、預算、稅務、報表', icon: CreditCard, color: '#fbbf24', group: '財務' },
  { key: 'CRM', label: '客戶管理', desc: '客戶、銷售漏斗、會員、行銷自動化', icon: Handshake, color: '#3b82f6', group: '商務' },
  { key: 'Sales', label: '銷售管理', desc: '報價、訂單、促銷、退貨、物流追蹤', icon: ShoppingCart, color: '#22d3ee', group: '商務' },
  { key: 'POS', label: '收銀系統', desc: '收銀台、交班日結、即時銷售分析', icon: Monitor, color: '#f472b6', group: '商務' },
  { key: 'WMS', label: '倉儲管理', desc: '庫存、進出貨、盤點、批號追蹤、儲位', icon: Warehouse, color: '#34d399', group: '供應鏈' },
  { key: 'Purchase', label: '採購管理', desc: '供應商、採購單、驗收、合約、三方比對', icon: ShoppingCart, color: '#fb923c', group: '供應鏈' },
  { key: 'Manufacturing', label: '製造管理', desc: 'BOM、MRP、製令、排程、品質管理', icon: Factory, color: '#64748b', group: '供應鏈' },
  { key: 'Analytics', label: '數據分析', desc: '預測分析、異常偵測、自訂儀表板、BI', icon: BarChart3, color: '#e879f9', group: '進階' },
  { key: 'Process', label: '流程管理', desc: '工作流程、任務、查核清單、SOP', icon: GitBranch, color: '#06b6d4', group: '進階' },
  { key: 'Integration', label: '外部整合', desc: '電商串接、物流整合、API、文中匯入', icon: Zap, color: '#84cc16', group: '進階' },
  { key: 'AI', label: 'AI 助手', desc: 'Agent 控制台、智能說明、教學中心', icon: Bot, color: '#f43f5e', group: '進階' },
]

const MODULE_GROUPS = ['人員', '財務', '商務', '供應鏈', '進階']

const planModuleDefaults = {
  '免費': ['HR', 'Finance'],
  '標準': ['HR', 'Finance', 'CRM', 'Sales'],
  '專業': ['HR', 'Finance', 'CRM', 'Sales', 'POS', 'WMS', 'Purchase', 'Analytics'],
  '企業': ALL_MODULES.map(m => m.key),
}

export default function ModuleConfig() {
  const { hasPermission } = useAuth()
  const isSuperAdmin = hasPermission('nav.group.super_admin')
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [editState, setEditState] = useState({}) // { [tenantId]: [...features] }
  const [dirty, setDirty] = useState({})
  const [search, setSearch] = useState('')
  const [bulkModule, setBulkModule] = useState('')
  const [bulkAction, setBulkAction] = useState('enable')

  const fetchTenants = useCallback(async () => {
    setLoading(true)
    const { data } = await getTenants()
    if (data) {
      setTenants(data)
      const state = {}
      data.forEach(t => { state[t.id] = Array.isArray(t.features) ? [...t.features] : [] })
      setEditState(state)
      setDirty({})
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTenants() }, [fetchTenants])

  const toggleModule = (tenantId, moduleKey) => {
    setEditState(prev => {
      const current = prev[tenantId] || []
      const updated = current.includes(moduleKey)
        ? current.filter(k => k !== moduleKey)
        : [...current, moduleKey]
      return { ...prev, [tenantId]: updated }
    })
    setDirty(prev => ({ ...prev, [tenantId]: true }))
  }

  const saveModules = async (tenantId) => {
    setSaving(prev => ({ ...prev, [tenantId]: true }))
    const { error } = await updateTenantModules(tenantId, editState[tenantId] || [])
    if (error) console.error('Save error:', error)
    else setDirty(prev => ({ ...prev, [tenantId]: false }))
    setSaving(prev => ({ ...prev, [tenantId]: false }))
    fetchTenants()
  }

  const applyPlanDefaults = (tenantId, plan) => {
    const defaults = planModuleDefaults[plan] || []
    setEditState(prev => ({ ...prev, [tenantId]: [...defaults] }))
    setDirty(prev => ({ ...prev, [tenantId]: true }))
  }

  const handleBulkApply = async () => {
    if (!bulkModule) return
    const updates = {}
    tenants.forEach(t => {
      const current = editState[t.id] || []
      if (bulkAction === 'enable' && !current.includes(bulkModule)) {
        updates[t.id] = [...current, bulkModule]
      } else if (bulkAction === 'disable' && current.includes(bulkModule)) {
        updates[t.id] = current.filter(k => k !== bulkModule)
      }
    })
    if (Object.keys(updates).length === 0) return
    setEditState(prev => ({ ...prev, ...updates }))
    const newDirty = {}
    Object.keys(updates).forEach(id => { newDirty[id] = true })
    setDirty(prev => ({ ...prev, ...newDirty }))
  }

  const saveAll = async () => {
    const dirtyIds = Object.keys(dirty).filter(id => dirty[id])
    for (const id of dirtyIds) {
      await saveModules(parseInt(id))
    }
  }

  const filtered = tenants.filter(t =>
    !search || (t.name || '').includes(search) || (t.tax_id || '').includes(search)
  )

  const dirtyCount = Object.values(dirty).filter(Boolean).length

  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <Shield size={48} style={{ color: 'var(--accent-red)' }} />
        <h2>超級管理員專屬</h2>
        <p style={{ color: 'var(--text-secondary)' }}>此頁面僅限超級管理員存取</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Package size={22} /></span> 模組配置</h2>
            <p>超級管理員 — 管理各組織可使用的功能模組</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {dirtyCount > 0 && (
              <span style={{ fontSize: 12, color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={13} /> {dirtyCount} 個組織有未儲存變更
              </span>
            )}
            <button className="btn btn-secondary" onClick={fetchTenants} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> 重新整理
            </button>
            {dirtyCount > 0 && (
              <button className="btn btn-primary" onClick={saveAll}>
                <Save size={14} /> 全部儲存
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Module Legend */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ paddingBottom: 8 }}>
          <h3 className="card-title" style={{ fontSize: 13 }}>可用模組一覽</h3>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 0 4px' }}>
          {ALL_MODULES.map(m => {
            const Icon = m.icon
            return (
              <div key={m.key} style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                padding: '4px 10px', borderRadius: 6,
                background: m.color + '15', border: `1px solid ${m.color}33`
              }}>
                <Icon size={12} style={{ color: m.color }} />
                <span style={{ fontWeight: 500 }}>{m.label}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>— {m.desc}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bulk Operations */}
      <div className="card" style={{ marginBottom: 16, padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>批次操作：</span>
          <select className="form-input" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 100 }}>
            <option value="enable">啟用</option>
            <option value="disable">停用</option>
          </select>
          <select className="form-input" value={bulkModule} onChange={e => setBulkModule(e.target.value)} style={{ width: 160 }}>
            <option value="">選擇模組...</option>
            {ALL_MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={handleBulkApply} disabled={!bulkModule}>
            套用至所有組織
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative', minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              placeholder="搜尋組織..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* Module Matrix */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">模組啟用矩陣</h3>
        </div>
        <div className="data-table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 180, position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 2 }}>組織</th>
                <th style={{ minWidth: 60 }}>方案</th>
                {ALL_MODULES.map(m => (
                  <th key={m.key} style={{ textAlign: 'center', fontSize: 11, padding: '8px 4px', minWidth: 50 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />
                      {m.key}
                    </div>
                  </th>
                ))}
                <th style={{ minWidth: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={ALL_MODULES.length + 3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>載入中...</td></tr>
              )}
              {!loading && filtered.map(t => {
                const features = editState[t.id] || []
                const isDirty = dirty[t.id]
                const isSaving = saving[t.id]
                return (
                  <tr key={t.id} style={isDirty ? { background: 'var(--accent-amber-dim, rgba(251,191,36,0.08))' } : {}}>
                    <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: isDirty ? 'var(--accent-amber-dim, rgba(251,191,36,0.08))' : 'var(--bg-card)', zIndex: 1 }}>
                      <Building2 size={13} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent-cyan)' }} />
                      {t.name}
                      {isDirty && <span style={{ color: 'var(--accent-amber)', fontSize: 10, marginLeft: 4 }}>*</span>}
                    </td>
                    <td>
                      <span className={`badge ${
                        t.plan === '企業' ? 'badge-danger' :
                        t.plan === '專業' ? 'badge-purple' :
                        t.plan === '標準' ? 'badge-info' : 'badge-neutral'
                      }`} style={{ fontSize: 10 }}>{t.plan}</span>
                    </td>
                    {ALL_MODULES.map(m => {
                      const enabled = features.includes(m.key)
                      return (
                        <td key={m.key} style={{ textAlign: 'center', padding: '4px 2px' }}>
                          <button
                            onClick={() => toggleModule(t.id, m.key)}
                            style={{
                              width: 28, height: 28, borderRadius: 6, border: 'none',
                              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              background: enabled ? m.color + '25' : 'transparent',
                              color: enabled ? m.color : 'var(--text-muted)',
                              transition: 'all 0.15s',
                            }}
                            title={`${enabled ? '停用' : '啟用'} ${m.label}`}
                          >
                            {enabled ? <Check size={14} strokeWidth={3} /> : <X size={12} />}
                          </button>
                        </td>
                      )
                    })}
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 10, padding: '3px 6px' }}
                          onClick={() => applyPlanDefaults(t.id, t.plan)}
                          title="重置為方案預設模組"
                        >
                          重置
                        </button>
                        {isDirty && (
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 10, padding: '3px 8px' }}
                            onClick={() => saveModules(t.id)}
                            disabled={isSaving}
                          >
                            <Save size={11} /> {isSaving ? '儲存中...' : '儲存'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Plan Defaults Reference */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3 className="card-title" style={{ fontSize: 13 }}>方案預設模組對照</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {Object.entries(planModuleDefaults).map(([plan, modules]) => (
            <div key={plan} style={{
              padding: 12, borderRadius: 8, border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{plan}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {ALL_MODULES.map(m => {
                  const included = modules.includes(m.key)
                  return (
                    <span key={m.key} style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: included ? m.color + '22' : 'var(--bg-tertiary)',
                      color: included ? m.color : 'var(--text-muted)',
                      textDecoration: included ? 'none' : 'line-through',
                      opacity: included ? 1 : 0.5,
                    }}>{m.key}</span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
