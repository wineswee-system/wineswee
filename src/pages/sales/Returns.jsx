import { useState, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { getReturns, createReturn } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const STATUS_BADGE = { '待處理': 'badge-warning', '處理中': 'badge-info', '已完成': 'badge-success', '已拒絕': 'badge-danger' }

export default function Returns() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ return_number: '', original_order: '', customer: '', total_refund: 0, reason: '', refund_method: '原路退回', status: '待處理', processed_by: '' })

  useEffect(() => {
    getReturns().then(({ data }) => { setItems(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.return_number || !form.customer) return
    const refund = Number(form.total_refund)
    // ★ 防呆：退款金額必須 > 0；若有指定 original_order，要不超過原訂單總額
    if (!refund || refund <= 0) { alert('退款金額必須大於 0'); return }
    if (form.original_order) {
      const { data: orig } = await supabase.from('sales_orders')
        .select('total').eq('order_number', form.original_order).maybeSingle()
      if (orig?.total != null && refund > Number(orig.total)) {
        alert(`退款金額 NT$${refund.toLocaleString()} 超過原訂單總額 NT$${Number(orig.total).toLocaleString()}，請確認`)
        return
      }
    }
    const { data } = await createReturn({ ...form, total_refund: refund })
    if (data) {
      setItems(prev => [...prev, data])
      setShowModal(false)
      setForm({ return_number: '', original_order: '', customer: '', total_refund: 0, reason: '', refund_method: '原路退回', status: '待處理', processed_by: '' })

      // 自動串接：折讓傳票（借：營業收入 / 貸：應收帳款）
      if (refund > 0) {
        await supabase.rpc('secure_create_journal_entry', {
          p_entry_date: new Date().toISOString().slice(0, 10),
          p_description: `退貨折讓 - ${form.customer} (${form.return_number})`,
          p_lines: [
            { account_code: '4100', account_name: '營業收入', debit: refund, credit: 0, memo: `退貨沖銷 ${form.return_number}` },
            { account_code: '1300', account_name: '應收帳款', debit: 0, credit: refund, memo: `退貨沖銷 ${form.return_number}` },
          ],
          p_source: '退貨',
          p_source_id: null,
          p_created_by: '系統',
        })
      }
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = items.filter(s =>
    search === '' || s.return_number?.includes(search) || s.customer?.includes(search) || s.original_order?.includes(search)
  )

  const pending = filtered.filter(s => s.status === '待處理').length
  const completed = filtered.filter(s => s.status === '已完成').length
  const now = new Date()
  const monthRefund = filtered
    .filter(s => { const d = new Date(s.created_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
    .reduce((sum, s) => sum + (s.total_refund || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 退貨管理</h2>
            <p>退貨申請與退款處理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增退貨</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待處理</div>
          <div className="stat-card-value">{pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{completed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">本月退款額</div>
          <div className="stat-card-value">NT$ {monthRefund.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 退貨列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋退貨單..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>退貨單號</th><th>原始訂單</th><th>客戶</th><th>退款金額</th><th>原因</th><th>退款方式</th><th>狀態</th><th>處理人</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無退貨紀錄</td></tr>}
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.return_number}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.original_order}</td>
                  <td>{s.customer}</td>
                  <td>NT$ {(s.total_refund || 0).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{s.reason}</td>
                  <td>{s.refund_method}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[s.status] || 'badge-info'}`}>
                      <span className="badge-dot"></span>{s.status}
                    </span>
                  </td>
                  <td>{s.processed_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增退貨" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="退貨單號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="RT-2026-001" value={form.return_number} onChange={e => set('return_number', e.target.value)} />
            </Field>
            <Field label="原始訂單">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="SO-2026-001" value={form.original_order} onChange={e => set('original_order', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="客戶 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="客戶名稱" value={form.customer} onChange={e => set('customer', e.target.value)} />
            </Field>
            <Field label="退款金額">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.total_refund} onChange={e => set('total_refund', e.target.value)} />
            </Field>
          </div>
          <Field label="退貨原因">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="退貨原因說明" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="退款方式">
              <select className="form-input" style={{ width: '100%' }} value={form.refund_method} onChange={e => set('refund_method', e.target.value)}>
                <option>原路退回</option>
                <option>現金退款</option>
                <option>折讓</option>
              </select>
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>待處理</option>
                <option>處理中</option>
                <option>已完成</option>
                <option>已拒絕</option>
              </select>
            </Field>
            <Field label="處理人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="姓名" value={form.processed_by} onChange={e => set('processed_by', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
