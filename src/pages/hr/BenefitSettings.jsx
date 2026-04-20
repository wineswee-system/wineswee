import { useState, useEffect } from 'react'
import { Gift, Calendar, DollarSign, Plus, Edit2, Trash2, Building2, User, Shield } from 'lucide-react'
import Modal from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'
import { supabase } from '../../lib/supabase'
import { getBenefitPolicies, createBenefitPolicy, updateBenefitPolicy, deleteBenefitPolicy } from '../../lib/db'
import { LEAVE_TYPES } from '../../lib/leavePolicy'
import { validateBenefitPolicy, BONUS_TYPE_LABELS, getLeaveLabel } from '../../lib/benefitPolicy'

const TABS = [
  { key: 'leave', label: '假別政策', icon: Calendar },
  { key: 'bonus', label: '獎金政策', icon: DollarSign },
]

const emptyLeaveForm = { code: '', extra_days: 0, notes: '' }
const emptyBonusForm = { code: '', type: 'fixed', amount: 0, rate: 0, base: 'sales', cap: 0, period: 'monthly', notes: '' }

export default function BenefitSettings() {
  const [tab, setTab] = useState('leave')
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [selectedStoreId, setSelectedStoreId] = useState(null) // null = 全公司
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null)
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [leaveForm, setLeaveForm] = useState(emptyLeaveForm)
  const [bonusForm, setBonusForm] = useState(emptyBonusForm)
  const [error, setError] = useState('')

  // Load stores + employees
  useEffect(() => {
    Promise.all([
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('employees').select('id, name, store_id, stores!store_id(name)').order('name'),
    ]).then(([s, e]) => {
      setStores(s.data || [])
      setEmployees(e.data || [])
    })
  }, [])

  // Load policies when filter changes
  useEffect(() => {
    loadPolicies()
  }, [selectedStoreId, tab])

  const loadPolicies = async () => {
    setLoading(true)
    const filters = { category: tab, isActive: true }
    if (selectedStoreId) filters.storeId = selectedStoreId
    else if (selectedStoreId === null) { /* show all */ delete filters.storeId }
    const { data } = await getBenefitPolicies(filters)
    setPolicies(data || [])
    setLoading(false)
  }

  const scopeLabel = (p) => {
    if (p.employee_id && p.store_id) return `${p.employees?.name || '員工'} @ ${p.stores?.name || '門市'}`
    if (p.employee_id) return `${p.employees?.name || '員工'}（全公司）`
    if (p.store_id) return p.stores?.name || '門市'
    return '全公司（預設）'
  }

  const openCreate = () => {
    setEditingId(null)
    setLeaveForm(emptyLeaveForm)
    setBonusForm(emptyBonusForm)
    setSelectedEmployeeId(null)
    setError('')
    setShowModal(true)
  }

  const openEdit = (p) => {
    setEditingId(p.id)
    setSelectedEmployeeId(p.employee_id || null)
    setError('')
    if (p.category === 'leave') {
      setLeaveForm({ code: p.code, extra_days: p.config?.extra_days || 0, notes: p.notes || '' })
    } else {
      setBonusForm({
        code: p.code,
        type: p.config?.type || 'fixed',
        amount: p.config?.amount || 0,
        rate: p.config?.rate || 0,
        base: p.config?.base || 'sales',
        cap: p.config?.cap || 0,
        period: p.config?.period || 'monthly',
        notes: p.notes || '',
      })
    }
    setShowModal(true)
  }

  const handleSave = async () => {
    const category = tab
    const isLeave = category === 'leave'
    const form = isLeave ? leaveForm : bonusForm

    const config = isLeave
      ? { extra_days: Number(form.extra_days) || 0 }
      : {
          type: form.type,
          ...(form.type === 'fixed' && { amount: Number(form.amount) || 0, period: form.period }),
          ...(form.type === 'percent' && { base: form.base, rate: Number(form.rate) || 0, cap: Number(form.cap) || 0 }),
          ...(form.type === 'milestone' && { base: form.base, tiers: [] }),
        }

    const validation = validateBenefitPolicy(category, form.code, config)
    if (!validation.valid) {
      setError(validation.error)
      return
    }

    const payload = {
      category,
      code: form.code,
      config,
      store_id: selectedStoreId || null,
      employee_id: selectedEmployeeId || null,
      is_active: true,
      notes: form.notes || null,
    }

    let result
    if (editingId) {
      result = await updateBenefitPolicy(editingId, payload)
    } else {
      result = await createBenefitPolicy(payload)
    }

    if (result.error) {
      setError(result.error.message || '儲存失敗')
      return
    }

    setShowModal(false)
    loadPolicies()
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此福利政策？')) return
    await deleteBenefitPolicy(id)
    loadPolicies()
  }

  // ── Leave codes not yet configured
  const configuredLeaveCodes = new Set(policies.filter(p => p.category === 'leave').map(p => p.code))
  const availableLeaveCodes = LEAVE_TYPES.filter(t => !configuredLeaveCodes.has(t.code))

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Gift size={28} style={{ color: 'var(--accent-purple)' }} />
        <h2 style={{ margin: 0 }}>福利政策設定</h2>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--bg-success)', color: 'var(--text-success)', fontSize: 13 }}>
          <Shield size={14} />
          法令保護：假別只能加給，不可低於法定最低標準
        </div>
      </div>

      {/* Store filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Building2 size={16} style={{ color: 'var(--text-secondary)' }} />
        <select
          className="input"
          style={{ width: 240 }}
          value={selectedStoreId ?? ''}
          onChange={e => setSelectedStoreId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">全部門市</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer',
              background: tab === t.key ? 'var(--accent-purple)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--text-secondary)',
              borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
            }}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={openCreate} style={{ marginBottom: 4 }}>
          <Plus size={16} /> 新增{tab === 'leave' ? '假別' : '獎金'}政策
        </button>
      </div>

      {/* Content */}
      {loading ? <LoadingSpinner /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                {tab === 'leave' ? (
                  <>
                    <th>假別</th>
                    <th>法定天數</th>
                    <th>加給天數</th>
                    <th>合計</th>
                    <th>適用範圍</th>
                    <th>備註</th>
                    <th>操作</th>
                  </>
                ) : (
                  <>
                    <th>獎金名稱</th>
                    <th>類型</th>
                    <th>金額/比例</th>
                    <th>週期</th>
                    <th>適用範圍</th>
                    <th>備註</th>
                    <th>操作</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                  尚未設定{tab === 'leave' ? '假別' : '獎金'}政策，點擊「新增」開始設定
                </td></tr>
              ) : policies.map(p => (
                <tr key={p.id}>
                  {tab === 'leave' ? (
                    <>
                      <td><strong>{getLeaveLabel(p.code)}</strong></td>
                      <td>{LEAVE_TYPES.find(t => t.code === p.code)?.maxDays ?? '依年資'}</td>
                      <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>+{p.config?.extra_days || 0} 天</td>
                      <td style={{ fontWeight: 700 }}>
                        {(LEAVE_TYPES.find(t => t.code === p.code)?.maxDays || 0) + (p.config?.extra_days || 0)} 天
                      </td>
                      <td>{scopeLabel(p)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{p.notes || '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEdit(p)}><Edit2 size={14} /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td><strong>{p.code}</strong></td>
                      <td>{BONUS_TYPE_LABELS[p.config?.type] || p.config?.type}</td>
                      <td style={{ fontWeight: 600 }}>
                        {p.config?.type === 'fixed' && `$${(p.config.amount || 0).toLocaleString()}`}
                        {p.config?.type === 'percent' && `${((p.config.rate || 0) * 100).toFixed(1)}%`}
                        {p.config?.type === 'milestone' && `${(p.config.tiers?.length || 0)} 階`}
                      </td>
                      <td>{p.config?.period === 'monthly' ? '每月' : p.config?.period === 'quarterly' ? '每季' : '每年'}</td>
                      <td>{scopeLabel(p)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{p.notes || '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEdit(p)}><Edit2 size={14} /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <Modal
          title={`${editingId ? '編輯' : '新增'}${tab === 'leave' ? '假別' : '獎金'}政策`}
          onClose={() => setShowModal(false)}
          onSubmit={handleSave}
        >
          {error && <div style={{ color: 'var(--accent-red)', marginBottom: 12, padding: '8px 12px', background: 'var(--bg-danger)', borderRadius: 6 }}>{error}</div>}

          {/* 適用範圍 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label>
              <Building2 size={14} style={{ marginRight: 4 }} />適用門市
              <select
                className="input"
                value={selectedStoreId || ''}
                onChange={e => setSelectedStoreId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">全公司</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>
              <User size={14} style={{ marginRight: 4 }} />適用員工
              <select
                className="input"
                value={selectedEmployeeId || ''}
                onChange={e => setSelectedEmployeeId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">所有員工</option>
                {employees
                  .filter(emp => !selectedStoreId || stores.find(s => s.id === selectedStoreId)?.name === emp.store)
                  .map(e => <option key={e.id} value={e.id}>{e.name}</option>)
                }
              </select>
            </label>
          </div>

          {tab === 'leave' ? (
            <>
              <label>
                假別
                <select className="input" value={leaveForm.code} onChange={e => setLeaveForm(f => ({ ...f, code: e.target.value }))}>
                  <option value="">請選擇</option>
                  {(editingId ? LEAVE_TYPES : availableLeaveCodes).map(t => (
                    <option key={t.code} value={t.code}>
                      {t.shortName || t.name} — 法定 {t.maxDays ?? '依年資'} 天
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ marginTop: 12 }}>
                加給天數（在法定基礎上額外增加）
                <input
                  type="number" className="input" min="0"
                  value={leaveForm.extra_days}
                  onChange={e => setLeaveForm(f => ({ ...f, extra_days: e.target.value }))}
                />
              </label>
              {leaveForm.code && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-success)', borderRadius: 6, fontSize: 14 }}>
                  法定 {LEAVE_TYPES.find(t => t.code === leaveForm.code)?.maxDays ?? '依年資'} 天
                  + 加給 <strong>{leaveForm.extra_days || 0}</strong> 天
                  = 共 <strong>{(LEAVE_TYPES.find(t => t.code === leaveForm.code)?.maxDays || 0) + Number(leaveForm.extra_days || 0)}</strong> 天
                </div>
              )}
            </>
          ) : (
            <>
              <label>
                獎金名稱
                <input
                  type="text" className="input" placeholder="如：全勤獎金、業績獎金"
                  value={bonusForm.code}
                  onChange={e => setBonusForm(f => ({ ...f, code: e.target.value }))}
                />
              </label>
              <label style={{ marginTop: 12 }}>
                獎金類型
                <select className="input" value={bonusForm.type} onChange={e => setBonusForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="fixed">固定金額</option>
                  <option value="percent">業績比例</option>
                  <option value="milestone">階梯達標</option>
                </select>
              </label>
              {bonusForm.type === 'fixed' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  <label>金額 (NT$)<input type="number" className="input" min="0" value={bonusForm.amount} onChange={e => setBonusForm(f => ({ ...f, amount: e.target.value }))} /></label>
                  <label>週期<select className="input" value={bonusForm.period} onChange={e => setBonusForm(f => ({ ...f, period: e.target.value }))}>
                    <option value="monthly">每月</option><option value="quarterly">每季</option><option value="yearly">每年</option>
                  </select></label>
                </div>
              )}
              {bonusForm.type === 'percent' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
                  <label>計算基礎<select className="input" value={bonusForm.base} onChange={e => setBonusForm(f => ({ ...f, base: e.target.value }))}>
                    <option value="sales">銷售額</option><option value="profit">毛利</option><option value="revenue">營收</option>
                  </select></label>
                  <label>比例 (%)<input type="number" className="input" min="0" step="0.1" value={(bonusForm.rate * 100) || ''} onChange={e => setBonusForm(f => ({ ...f, rate: Number(e.target.value) / 100 }))} /></label>
                  <label>上限 (NT$)<input type="number" className="input" min="0" value={bonusForm.cap} onChange={e => setBonusForm(f => ({ ...f, cap: e.target.value }))} /></label>
                </div>
              )}
            </>
          )}

          <label style={{ marginTop: 12 }}>
            備註
            <input
              type="text" className="input" placeholder="選填"
              value={tab === 'leave' ? leaveForm.notes : bonusForm.notes}
              onChange={e => tab === 'leave'
                ? setLeaveForm(f => ({ ...f, notes: e.target.value }))
                : setBonusForm(f => ({ ...f, notes: e.target.value }))
              }
            />
          </label>
        </Modal>
      )}
    </div>
  )
}
