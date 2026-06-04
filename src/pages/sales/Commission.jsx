import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, DollarSign, Calculator } from 'lucide-react'
import { getCommissionRules, createCommissionRule, updateCommissionRule, deleteCommissionRule, getCommissionRecords, createCommissionRecord, getSalesOrders } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useOrgId } from '../../contexts/AuthContext'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { fmtNT as fmt } from '../../lib/currency'

export default function Commission() {
  const orgId = useOrgId()
  const [rules, setRules] = useState([])
  const [records, setRecords] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('rules')
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [ruleForm, setRuleForm] = useState({ name: '', rate_percent: '', min_amount: '0' })
  const [editingId, setEditingId] = useState(null)
  const [calculating, setCalculating] = useState(false)

  const load = async () => {
    setLoading(true)
    const [rulesRes, recsRes, soRes] = await Promise.all([getCommissionRules(), getCommissionRecords(), getSalesOrders(orgId)])
    setRules(rulesRes.data || [])
    setRecords(recsRes.data || [])
    setOrders(soRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const handleRuleSubmit = async () => {
    if (!ruleForm.name || !ruleForm.rate_percent) return
    const payload = { name: ruleForm.name, rate_percent: Number(ruleForm.rate_percent), min_amount: Number(ruleForm.min_amount) || 0, is_active: true }
    if (editingId) {
      const { error } = await updateCommissionRule(editingId, payload)
      if (error) { setError(error.message); return }
    } else {
      const { error } = await createCommissionRule(payload)
      if (error) { setError(error.message); return }
    }
    setShowRuleModal(false); setRuleForm({ name: '', rate_percent: '', min_amount: '0' }); setEditingId(null); load()
  }

  const handleCalculate = async () => {
    if (rules.length === 0) { toast.warning('請先建立佣金規則'); return }
    const period = new Date().toISOString().slice(0, 7)
    if (!(await confirm({ message: `將根據佣金規則計算 ${period} 的佣金，是否繼續？` }))) return

    setCalculating(true)
    const completedOrders = orders.filter(o => o.payment_status === '已付款' || o.total > 0)
    let created = 0

    for (const order of completedOrders) {
      const amount = order.total || 0
      // Find best matching rule (highest min_amount that qualifies)
      const matchingRules = rules.filter(r => r.is_active && amount >= r.min_amount).sort((a, b) => b.min_amount - a.min_amount)
      const rule = matchingRules[0]
      if (!rule) continue

      const commission = Math.round(amount * rule.rate_percent) / 100
      const { error } = await createCommissionRecord({
        salesperson: order.created_by || '未指定',
        order_id: order.id,
        order_amount: amount,
        commission_rate: rule.rate_percent,
        commission_amount: commission,
        status: '待發放',
        period,
      })
      if (!error) created++
    }

    setCalculating(false)
    toast.success(`已計算 ${created} 筆佣金紀錄`)
    load()
  }

  if (loading) return <LoadingSpinner />

  const totalPending = records.filter(r => r.status === '待發放').reduce((s, r) => s + (r.commission_amount || 0), 0)
  const totalPaid = records.filter(r => r.status === '已發放').reduce((s, r) => s + (r.commission_amount || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💵</span> 業務佣金</h2>
            <p>Sales Commission — 佣金規則與計算</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleCalculate} disabled={calculating}>
              <Calculator size={14} /> {calculating ? '計算中...' : '計算佣金'}
            </button>
            <button className="btn btn-primary" onClick={() => { setRuleForm({ name: '', rate_percent: '', min_amount: '0' }); setEditingId(null); setShowRuleModal(true) }}>
              <Plus size={14} /> 新增規則
            </button>
          </div>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">佣金規則</div>
          <div className="stat-card-value">{rules.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待發放</div>
          <div className="stat-card-value">{fmt(totalPending)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已發放</div>
          <div className="stat-card-value">{fmt(totalPaid)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid var(--border)' }}>
        {['rules', 'records'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === t ? 'var(--accent-blue)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-secondary)' }}>
            {t === 'rules' ? '佣金規則' : `佣金紀錄 (${records.length})`}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        <div className="data-table">
          <table>
            <thead><tr><th>名稱</th><th style={{ textAlign: 'right' }}>佣金率 %</th><th style={{ textAlign: 'right' }}>最低訂單金額</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)', fontWeight: 700 }}>{r.rate_percent}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.min_amount)}</td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: r.is_active ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)', color: r.is_active ? 'var(--accent-green)' : 'var(--accent-red)' }}>{r.is_active ? '啟用' : '停用'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => { setRuleForm({ name: r.name, rate_percent: String(r.rate_percent), min_amount: String(r.min_amount) }); setEditingId(r.id); setShowRuleModal(true) }}><Edit3 size={13} /></button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => { deleteCommissionRule(r.id); load() }}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'records' && (
        <div className="data-table">
          <table>
            <thead><tr><th>業務</th><th>訂單</th><th style={{ textAlign: 'right' }}>訂單金額</th><th style={{ textAlign: 'right' }}>佣金率</th><th style={{ textAlign: 'right' }}>佣金</th><th>期間</th><th>狀態</th></tr></thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無佣金紀錄</td></tr>
              ) : records.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.salesperson}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>#{r.order_id}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.order_amount)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{r.commission_rate}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-green)' }}>{fmt(r.commission_amount)}</td>
                  <td>{r.period}</td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: r.status === '已發放' ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)', color: r.status === '已發放' ? 'var(--accent-green)' : 'var(--accent-orange)' }}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRuleModal && (
        <ModalOverlay onClose={() => setShowRuleModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 380, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>{editingId ? '編輯規則' : '新增佣金規則'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" placeholder="規則名稱 *" value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="number" placeholder="佣金率 % *" value={ruleForm.rate_percent} onChange={e => setRuleForm(f => ({ ...f, rate_percent: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="number" placeholder="最低訂單金額" value={ruleForm.min_amount} onChange={e => setRuleForm(f => ({ ...f, min_amount: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowRuleModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleRuleSubmit}>{editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
