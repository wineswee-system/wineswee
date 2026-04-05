import { useState, useEffect } from 'react'
import { Plus, FileText, AlertTriangle } from 'lucide-react'
import { getAccountsPayable, createAccountPayable } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const emptyForm = {
  bill_number: '', supplier: '', po_ref: '',
  amount: '', paid_amount: '0', due_date: '', status: '未付款'
}

export default function AccountsPayable() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    getAccountsPayable().then(({ data }) => {
      setRecords(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.bill_number || !form.supplier) return
    const { data } = await createAccountPayable({
      ...form,
      amount: Number(form.amount) || 0,
      paid_amount: Number(form.paid_amount) || 0,
    })
    if (data) { setRecords(prev => [data, ...prev]); setShowModal(false); setForm(emptyForm) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const today = new Date().toISOString().slice(0, 10)

  const unpaid = records.filter(r => r.status === '未付款')
  const partial = records.filter(r => r.status === '部分付款')
  const paid = records.filter(r => r.status === '已付款')
  const overdue = records.filter(r => r.due_date < today && r.status !== '已付款')

  const unpaidTotal = unpaid.reduce((s, r) => s + (Number(r.amount) || 0) - (Number(r.paid_amount) || 0), 0)
    + partial.reduce((s, r) => s + (Number(r.amount) || 0) - (Number(r.paid_amount) || 0), 0)

  const statusBadge = (status) => {
    if (status === '已付款') return <span className="badge badge-success"><span className="badge-dot"></span>{status}</span>
    if (status === '部分付款') return <span className="badge badge-info"><span className="badge-dot"></span>{status}</span>
    return <span className="badge badge-warning"><span className="badge-dot"></span>{status}</span>
  }

  const isOverdue = (r) => r.due_date < today && r.status !== '已付款'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 應付帳款 (AP)</h2>
            <p>供應商應付帳款追蹤與管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增應付</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">未付款總額</div>
          <div className="stat-card-value">NT$ {unpaidTotal.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">部分付款</div>
          <div className="stat-card-value">{partial.length} 筆</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已付款</div>
          <div className="stat-card-value">{paid.length} 筆</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">逾期筆數</div>
          <div className="stat-card-value">{overdue.length} 筆</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 應付帳款明細</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>帳單號碼</th>
                <th>供應商</th>
                <th>採購單參考</th>
                <th>應付金額</th>
                <th>已付金額</th>
                <th>到期日</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無應付帳款資料</td></tr>}
              {records.map(r => (
                <tr key={r.id} style={isOverdue(r) ? { color: 'var(--accent-red)' } : {}}>
                  <td style={{ fontWeight: 600 }}>
                    {r.bill_number}
                    {isOverdue(r) && <AlertTriangle size={12} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
                  </td>
                  <td>{r.supplier}</td>
                  <td>{r.po_ref || '-'}</td>
                  <td>NT$ {(Number(r.amount) || 0).toLocaleString()}</td>
                  <td>NT$ {(Number(r.paid_amount) || 0).toLocaleString()}</td>
                  <td>{r.due_date}</td>
                  <td>{isOverdue(r) ? <span className="badge badge-danger"><span className="badge-dot"></span>逾期</span> : statusBadge(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增應付帳款" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="帳單號碼 *"><input className="form-input" style={{ width: '100%' }} value={form.bill_number} onChange={e => set('bill_number', e.target.value)} placeholder="BILL-2026-001" /></Field>
            <Field label="供應商 *"><input className="form-input" style={{ width: '100%' }} value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="供應商名稱" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="採購單參考"><input className="form-input" style={{ width: '100%' }} value={form.po_ref} onChange={e => set('po_ref', e.target.value)} placeholder="PO-001" /></Field>
            <Field label="應付金額"><input className="form-input" type="number" style={{ width: '100%' }} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0" /></Field>
            <Field label="已付金額"><input className="form-input" type="number" style={{ width: '100%' }} value={form.paid_amount} onChange={e => set('paid_amount', e.target.value)} placeholder="0" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="到期日"><input className="form-input" type="date" style={{ width: '100%' }} value={form.due_date} onChange={e => set('due_date', e.target.value)} /></Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="未付款">未付款</option>
                <option value="部分付款">部分付款</option>
                <option value="已付款">已付款</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
