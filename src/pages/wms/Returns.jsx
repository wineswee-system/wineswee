import { useState, useEffect } from 'react'
import { Plus, Search, CheckCircle, XCircle, Package, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { getEventBus } from '../../lib/events/index.js'

const REASONS = [
  { value: 'defective', label: '瑕疵品' },
  { value: 'wrong_item', label: '出貨錯誤' },
  { value: 'customer_change', label: '客戶改變心意' },
  { value: 'damaged', label: '運送損壞' },
  { value: 'expired', label: '過期' },
]

const STATUS_FLOW = ['待收貨', '已收貨', '品檢中', '已入庫', '已報廢', '已取消']

const STATUS_COLORS = {
  '待收貨': 'badge-warning',
  '已收貨': 'badge-info',
  '品檢中': 'badge-cyan',
  '已入庫': 'badge-success',
  '已報廢': 'badge-danger',
  '已取消': 'badge-neutral',
}

export default function Returns() {
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [showInspect, setShowInspect] = useState(null)
  const [form, setForm] = useState({
    customer_name: '', reason: 'defective', warehouse: '', notes: '',
    items: [{ sku_code: '', sku_name: '', qty: 1 }],
  })
  const [inspectForm, setInspectForm] = useState({ inspector: '', notes: '', items: [] })

  useEffect(() => {
    supabase.from('return_orders').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setReturns(data || []))
      .catch(err => { console.error(err); setError('資料載入失敗') })
      .finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateItem = (idx, field, value) => {
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === idx ? { ...item, [field]: value } : item)
    }))
  }

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { sku_code: '', sku_name: '', qty: 1 }] }))
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  const handleCreate = async () => {
    if (!form.customer_name || form.items.some(i => !i.sku_code)) return
    const returnNumber = `RMA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const { data } = await supabase.from('return_orders').insert({
      return_number: returnNumber,
      customer_name: form.customer_name,
      reason: form.reason,
      warehouse: form.warehouse,
      notes: form.notes,
      items: form.items,
      status: '待收貨',
    }).select().single()
    if (data) {
      setReturns(prev => [data, ...prev])
      setShowCreate(false)
      setForm({ customer_name: '', reason: 'defective', warehouse: '', notes: '', items: [{ sku_code: '', sku_name: '', qty: 1 }] })
    }
  }

  const updateStatus = async (id, newStatus) => {
    const { data } = await supabase.from('return_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data) {
      setReturns(prev => prev.map(r => r.id === id ? data : r))
      const bus = getEventBus()
      if (newStatus === '已收貨') {
        await bus.publish('wms.return.received', { return_id: String(id), return_number: data.return_number, customer: data.customer_name, reason: data.reason })
      } else if (newStatus === '已入庫') {
        await bus.publish('wms.return.restocked', { return_id: String(id), return_number: data.return_number, customer: data.customer_name })
      } else if (newStatus === '已報廢') {
        await bus.publish('wms.return.scrapped', { return_id: String(id), return_number: data.return_number, customer: data.customer_name })
      }
    }
  }

  const openInspection = (ret) => {
    setShowInspect(ret)
    setInspectForm({
      inspector: '',
      notes: '',
      items: (ret.items || []).map(i => ({ sku_code: i.sku_code, pass_qty: i.qty, fail_qty: 0 }))
    })
  }

  const handleInspection = async () => {
    if (!showInspect) return
    const result = {
      inspector: inspectForm.inspector,
      date: new Date().toISOString(),
      notes: inspectForm.notes,
      items: inspectForm.items,
    }
    const hasFailures = inspectForm.items.some(i => i.fail_qty > 0)
    const allFailed = inspectForm.items.every(i => i.pass_qty === 0)
    const nextStatus = allFailed ? '已報廢' : '已入庫'

    const { data } = await supabase.from('return_orders')
      .update({
        inspection_result: result,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', showInspect.id).select().single()
    if (data) {
      setReturns(prev => prev.map(r => r.id === showInspect.id ? data : r))
      setShowInspect(null)
      const bus = getEventBus()
      if (nextStatus === '已入庫') {
        await bus.publish('wms.return.restocked', { return_id: String(data.id), return_number: data.return_number, customer: data.customer_name })
      } else if (nextStatus === '已報廢') {
        await bus.publish('wms.return.scrapped', { return_id: String(data.id), return_number: data.return_number, customer: data.customer_name })
      }
    }
  }

  const filtered = returns
    .filter(r => filterStatus === 'all' || r.status === filterStatus)
    .filter(r => r.return_number?.includes(search) || r.customer_name?.includes(search))

  const stats = {
    total: returns.length,
    pending: returns.filter(r => r.status === '待收貨').length,
    inspecting: returns.filter(r => r.status === '品檢中').length,
    restocked: returns.filter(r => r.status === '已入庫').length,
    scrapped: returns.filter(r => r.status === '已報廢').length,
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon"><RotateCcw size={20} /></span> 退貨管理 (RMA)</h2><p>退貨收貨、品檢、入庫/報廢流程</p></div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> 新增退貨單</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總退貨單</div><div className="stat-card-value">{stats.total}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待收貨</div><div className="stat-card-value">{stats.pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">品檢中</div><div className="stat-card-value">{stats.inspecting}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已入庫</div><div className="stat-card-value">{stats.restocked}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已報廢</div><div className="stat-card-value">{stats.scrapped}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Package size={16} /></span> 退貨單列表</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ width: 120 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">全部狀態</option>
              {STATUS_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋單號/客戶..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>退貨單號</th><th>客戶</th><th>原因</th><th>品項數</th><th>狀態</th><th>建立時間</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無退貨單</td></tr>}
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{r.return_number}</td>
                  <td>{r.customer_name}</td>
                  <td><span className="badge badge-info">{REASONS.find(x => x.value === r.reason)?.label || r.reason}</span></td>
                  <td>{(r.items || []).length}</td>
                  <td><span className={`badge ${STATUS_COLORS[r.status] || 'badge-neutral'}`}><span className="badge-dot"></span>{r.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.status === '待收貨' && (
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => updateStatus(r.id, '已收貨')}>確認收貨</button>
                      )}
                      {r.status === '已收貨' && (
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => updateStatus(r.id, '品檢中')}>開始品檢</button>
                      )}
                      {r.status === '品檢中' && (
                        <button className="btn btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openInspection(r)}>
                          <CheckCircle size={12} /> 完成品檢
                        </button>
                      )}
                      {['待收貨', '已收貨'].includes(r.status) && (
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--accent-red)' }} onClick={() => updateStatus(r.id, '已取消')}>
                          <XCircle size={12} /> 取消
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增退貨單 Modal */}
      {showCreate && (
        <Modal title="新增退貨單" onClose={() => setShowCreate(false)} onSubmit={handleCreate}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="客戶 *"><input className="form-input" style={{ width: '100%' }} placeholder="客戶名稱" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} /></Field>
            <Field label="退貨原因"><select className="form-input" style={{ width: '100%' }} value={form.reason} onChange={e => set('reason', e.target.value)}>{REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
          </div>
          <Field label="倉庫"><input className="form-input" style={{ width: '100%' }} placeholder="退回倉庫" value={form.warehouse} onChange={e => set('warehouse', e.target.value)} /></Field>
          <Field label="備註"><input className="form-input" style={{ width: '100%' }} placeholder="備註說明" value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>退貨品項</span>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 11 }} onClick={addItem}><Plus size={12} /> 新增品項</button>
            </div>
            {form.items.map((item, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 30px', gap: 8, marginBottom: 6 }}>
                <input className="form-input" placeholder="品號" value={item.sku_code} onChange={e => updateItem(idx, 'sku_code', e.target.value)} />
                <input className="form-input" placeholder="品名" value={item.sku_name} onChange={e => updateItem(idx, 'sku_name', e.target.value)} />
                <input className="form-input" type="number" min={1} value={item.qty} onChange={e => updateItem(idx, 'qty', Number(e.target.value))} />
                {form.items.length > 1 && (
                  <button type="button" className="btn btn-ghost" style={{ color: 'var(--accent-red)', padding: 0 }} onClick={() => removeItem(idx)}><XCircle size={14} /></button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* 品檢 Modal */}
      {showInspect && (
        <Modal title={`品檢 — ${showInspect.return_number}`} onClose={() => setShowInspect(null)} onSubmit={handleInspection}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="品檢人員 *"><input className="form-input" style={{ width: '100%' }} placeholder="品檢人員" value={inspectForm.inspector} onChange={e => setInspectForm(f => ({ ...f, inspector: e.target.value }))} /></Field>
            <Field label="品檢備註"><input className="form-input" style={{ width: '100%' }} placeholder="備註" value={inspectForm.notes} onChange={e => setInspectForm(f => ({ ...f, notes: e.target.value }))} /></Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'block' }}>品項品檢結果</span>
            {inspectForm.items.map((item, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.sku_code}</span>
                <Field label="合格數">
                  <input className="form-input" type="number" min={0} style={{ width: '100%' }} value={item.pass_qty}
                    onChange={e => setInspectForm(f => ({
                      ...f, items: f.items.map((it, i) => i === idx ? { ...it, pass_qty: Number(e.target.value) } : it)
                    }))} />
                </Field>
                <Field label="不合格數">
                  <input className="form-input" type="number" min={0} style={{ width: '100%' }} value={item.fail_qty}
                    onChange={e => setInspectForm(f => ({
                      ...f, items: f.items.map((it, i) => i === idx ? { ...it, fail_qty: Number(e.target.value) } : it)
                    }))} />
                </Field>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
