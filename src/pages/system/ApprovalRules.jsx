import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, Shield, CheckCircle, XCircle, Clock } from 'lucide-react'
import { getApprovalRules, createApprovalRule, updateApprovalRule, deleteApprovalRule, getApprovalRequests, updateApprovalRequest } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useOrgId } from '../../contexts/AuthContext'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const MODULES = [
  { value: 'purchase', label: '採購' },
  { value: 'finance', label: '財務' },
  { value: 'hr', label: '人資' },
  { value: 'wms', label: '倉儲' },
]
const DOC_TYPES = {
  purchase: [
    { value: 'pr', label: '請購單 PR' },
    { value: 'po', label: '採購單 PO' },
  ],
  finance: [
    { value: 'journal_entry', label: '傳票' },
    { value: 'budget', label: '預算' },
  ],
  hr: [
    { value: 'leave', label: '請假' },
    { value: 'expense', label: '費用報帳' },
    { value: 'overtime', label: '加班' },
    { value: 'business_trip', label: '出差' },
  ],
  wms: [
    { value: 'stock_adjustment', label: '庫存調整' },
  ],
}
const CONDITION_FIELDS = {
  purchase: [
    { value: 'total_amount', label: '總金額' },
    { value: 'item_count', label: '品項數' },
  ],
  finance: [
    { value: 'total_amount', label: '總金額' },
    { value: 'line_count', label: '分錄數' },
  ],
  hr: [
    { value: 'days', label: '天數' },
    { value: 'amount', label: '金額' },
    { value: 'hours', label: '時數' },
  ],
  wms: [
    { value: 'total_amount', label: '總金額' },
    { value: 'quantity', label: '數量' },
  ],
}
const OPERATORS = [
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'eq', label: '=' },
]
const ROLES = [
  { value: 'admin', label: '管理員' },
  { value: 'manager', label: '部門主管' },
  { value: 'team_lead', label: '組長' },
]

const emptyForm = {
  module: 'purchase', document_type: 'pr', condition_field: 'total_amount',
  condition_operator: 'gte', condition_value: '0', required_role: 'manager',
  approval_order: '1', is_active: true,
}

export default function ApprovalRules() {
  const orgId = useOrgId()
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
    const [rulesRes, reqRes] = await Promise.all([getApprovalRules(undefined, orgId), getApprovalRequests(undefined, orgId)])
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
      organization_id: orgId,
    }
    delete payload.id

    if (editingId) {
      const { error } = await updateApprovalRule(editingId, payload, orgId)
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
    if (!(await confirm({ message: '確定要刪除此簽核規則？' }))) return
    await deleteApprovalRule(id, orgId)
    load()
  }

  const handleDecision = async (reqId, status) => {
    let rejectReason = null
    if (status === '已退回') {
      rejectReason = prompt('請輸入駁回原因：')
      if (!rejectReason) return
    }
    const { error } = await updateApprovalRequest(reqId, {
      status,
      reject_reason: rejectReason,
      decided_at: new Date().toISOString(),
    })
    if (error) { toast.error(`操作失敗：${error.message || error}`); return }
    load()
  }

  const moduleLabel = (m) => MODULES.find(x => x.value === m)?.label || m
  const docTypeLabel = (mod, dt) => (DOC_TYPES[mod] || []).find(x => x.value === dt)?.label || dt
  const roleLabel = (r) => ROLES.find(x => x.value === r)?.label || r
  const fieldLabel = (mod, f) => (CONDITION_FIELDS[mod] || []).find(x => x.value === f)?.label || f
  const statusIcon = (s) => s === '已核准' ? <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} /> : s === '已退回' ? <XCircle size={14} style={{ color: 'var(--accent-red)' }} /> : <Clock size={14} style={{ color: '#fbbf24' }} />

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔐</span> 簽核規則</h2>
            <p>依條件自動觸發審批（如：採購金額 ≥ 50,000 需主管核准）</p>
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
                  <td>{docTypeLabel(rule.module, rule.document_type)}</td>
                  <td style={{ fontSize: 12 }}>{fieldLabel(rule.module, rule.condition_field)} {OPERATORS.find(o => o.value === rule.condition_operator)?.label || rule.condition_operator} {rule.condition_value?.toLocaleString()}</td>
                  <td>{roleLabel(rule.required_role)}</td>
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
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 460, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯規則' : '新增簽核規則'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', lineHeight: 1.6 }}>
                設定當某模組的單據符合條件時，需要哪個角色審核。<br/>
                例：採購單金額 &ge; 50,000 時需要部門主管審核。
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>模組</label>
                  <select value={form.module} onChange={e => { set('module', e.target.value); const types = DOC_TYPES[e.target.value] || []; set('document_type', types[0]?.value || ''); const fields = CONDITION_FIELDS[e.target.value] || []; set('condition_field', fields[0]?.value || 'total_amount') }} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>單據類型</label>
                  <select value={form.document_type} onChange={e => set('document_type', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {(DOC_TYPES[form.module] || []).map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>條件欄位</label>
                  <select value={form.condition_field} onChange={e => set('condition_field', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {(CONDITION_FIELDS[form.module] || []).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <select value={form.condition_operator} onChange={e => set('condition_operator', e.target.value)} style={{ padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>門檻值</label>
                  <input type="number" value={form.condition_value} onChange={e => set('condition_value', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} placeholder="例：50000" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>需要角色</label>
                  <select value={form.required_role} onChange={e => set('required_role', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>審核順序</label>
                  <input type="number" min="1" value={form.approval_order} onChange={e => set('approval_order', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>同一單據若有多條規則，依此順序審核</div>
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
        </ModalOverlay>
      )}
    </div>
  )
}
