import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, Shield, CheckCircle, XCircle, Clock } from 'lucide-react'
import { getApprovalRules, createApprovalRule, updateApprovalRule, deleteApprovalRule, getApprovalRequests, updateApprovalRequest } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const MODULES = [
  { value: 'purchase', label: '採購' },
  { value: 'finance', label: '財務' },
  { value: 'hr', label: '人資' },
  { value: 'wms', label: '倉儲' },
]
const DOC_TYPES = {
  purchase: ['pr', 'po'],
  finance: ['journal_entry', 'budget'],
  hr: ['leave', 'expense', 'overtime', 'business_trip'],
  wms: ['stock_adjustment'],
}
const OPERATORS = [
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'eq', label: '=' },
]
const ROLES = ['admin', 'manager', 'team_lead']

const emptyForm = {
  module: 'purchase', document_type: 'pr', condition_field: 'total_amount',
  condition_operator: 'gte', condition_value: '0', required_role: 'manager',
  approval_order: '1', is_active: true,
}

export default function ApprovalRules() {
  const [rules, setRules] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('rules') // rules | requests

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [rulesRes, reqRes] = await Promise.all([getApprovalRules(), getApprovalRequests()])
    if (rulesRes.error) setError(rulesRes.error.message)
    else setRules(rulesRes.data || [])
    setRequests(reqRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    setSaving(true)
    const payload = {
      ...form,
      condition_value: Number(form.condition_value),
      approval_order: Number(form.approval_order),
    }
    delete payload.id

    if (editingId) {
      const { error } = await updateApprovalRule(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createApprovalRule(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (rule) => {
    setForm({
      module: rule.module, document_type: rule.document_type,
      condition_field: rule.condition_field || 'total_amount',
      condition_operator: rule.condition_operator || 'gte',
      condition_value: String(rule.condition_value || 0),
      required_role: rule.required_role || 'manager',
      approval_order: String(rule.approval_order || 1),
      is_active: rule.is_active,
    })
    setEditingId(rule.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定要刪除此簽核規則？')) return
    await deleteApprovalRule(id)
    load()
  }

  const handleDecision = async (reqId, status) => {
    await updateApprovalRequest(reqId, { status, decided_at: new Date().toISOString() })
    load()
  }

  const moduleLabel = (m) => MODULES.find(x => x.value === m)?.label || m
  const statusIcon = (s) => s === '已核准' ? <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} /> : s === '已退回' ? <XCircle size={14} style={{ color: 'var(--accent-red)' }} /> : <Clock size={14} style={{ color: '#fbbf24' }} />

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔐</span> 簽核規則</h2>
            <p>Approval Rules — 跨模組通用簽核流程設定</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增規則
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">簽核規則</div>
          <div className="stat-card-value">{rules.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': '#fbbf24', '--card-accent-dim': 'rgba(251,191,36,0.15)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{requests.filter(r => r.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{requests.filter(r => r.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已退回</div>
          <div className="stat-card-value">{requests.filter(r => r.status === '已退回').length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid var(--border)' }}>
        <button onClick={() => setTab('rules')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'rules' ? 'var(--accent-blue)' : 'transparent', color: tab === 'rules' ? '#fff' : 'var(--text-secondary)' }}>
          <Shield size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 規則設定
        </button>
        <button onClick={() => setTab('requests')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'requests' ? 'var(--accent-blue)' : 'transparent', color: tab === 'requests' ? '#fff' : 'var(--text-secondary)' }}>
          <Clock size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 簽核紀錄 ({requests.filter(r => r.status === '待審核').length})
        </button>
      </div>

      {tab === 'rules' && (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>模組</th>
                <th>單據類型</th>
                <th>條件</th>
                <th>需要角色</th>
                <th>順序</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無簽核規則</td></tr>
              ) : rules.map(rule => (
                <tr key={rule.id}>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{moduleLabel(rule.module)}</span></td>
                  <td style={{ fontFamily: 'monospace' }}>{rule.document_type}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{rule.condition_field} {rule.condition_operator} {rule.condition_value?.toLocaleString()}</td>
                  <td>{rule.required_role}</td>
                  <td style={{ textAlign: 'center' }}>{rule.approval_order}</td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: rule.is_active ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)', color: rule.is_active ? 'var(--accent-green)' : 'var(--accent-red)' }}>{rule.is_active ? '啟用' : '停用'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(rule)}><Edit3 size={13} /></button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(rule.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'requests' && (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>模組</th>
                <th>單據</th>
                <th>申請人</th>
                <th>審核人</th>
                <th>狀態</th>
                <th>提交時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無簽核紀錄</td></tr>
              ) : requests.map(req => (
                <tr key={req.id}>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{moduleLabel(req.module)}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{req.document_type} #{req.document_id}</td>
                  <td>{req.requester}</td>
                  <td>{req.approver || '-'}</td>
                  <td><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{statusIcon(req.status)} {req.status}</span></td>
                  <td style={{ fontSize: 12 }}>{req.created_at ? new Date(req.created_at).toLocaleString('zh-TW') : '-'}</td>
                  <td>
                    {req.status === '待審核' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleDecision(req.id, '已核准')}>核准</button>
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12, color: 'var(--accent-red)' }} onClick={() => handleDecision(req.id, '已退回')}>退回</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 460, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯規則' : '新增簽核規則'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>模組</label>
                  <select value={form.module} onChange={e => { set('module', e.target.value); set('document_type', (DOC_TYPES[e.target.value] || [])[0] || '') }} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>單據類型</label>
                  <select value={form.document_type} onChange={e => set('document_type', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {(DOC_TYPES[form.module] || []).map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>條件欄位</label>
                  <input type="text" value={form.condition_field} onChange={e => set('condition_field', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <select value={form.condition_operator} onChange={e => set('condition_operator', e.target.value)} style={{ padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>門檻值</label>
                  <input type="number" value={form.condition_value} onChange={e => set('condition_value', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>需要角色</label>
                  <select value={form.required_role} onChange={e => set('required_role', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>審核順序</label>
                  <input type="number" value={form.approval_order} onChange={e => set('approval_order', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              {editingId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>啟用</span>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
