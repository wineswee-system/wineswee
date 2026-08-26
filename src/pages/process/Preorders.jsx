import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, Trash2, Edit3, X, Search, Package, Truck, Download } from 'lucide-react'
import DateRangeField from '../../components/DateRangeField'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import { confirm } from '../../lib/confirm'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUSES = ['未出貨', '已出貨']
const emptyItem = () => ({ name: '', qty: 1 })
const emptyForm = () => ({
  order_date: new Date().toISOString().slice(0, 10),
  customer_name: '', phone: '', address: '',
  items: [emptyItem()],
  need_bag: false, need_invoice: false, invoice_tax_id: '',
  specific_delivery: false, delivery_time: '',
  notes: '', status: '未出貨',
})

const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }
const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }

export default function Preorders() {
  const orgId = useOrgId()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const pad = n => String(n).padStart(2, '0')
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const applyPreset = (key) => {
    const today = new Date()
    if (key === 'today') { const t = fmtDate(today); setDateFrom(t); setDateTo(t) }
    else if (key === '7d') { const s = new Date(today); s.setDate(s.getDate() - 6); setDateFrom(fmtDate(s)); setDateTo(fmtDate(today)) }
    else if (key === 'month') { setDateFrom(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`); setDateTo(fmtDate(today)) }
    else { setDateFrom(''); setDateTo('') }
  }

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('preorders').select('*')
      .is('deleted_at', null).order('id', { ascending: false })
    if (error) setError(error.message); else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  const openNew = () => { setForm(emptyForm()); setEditingId(null); setError(null); setShowModal(true) }
  const openEdit = (r) => {
    setForm({
      order_date: r.order_date || '',
      customer_name: r.customer_name || '', phone: r.phone || '', address: r.address || '',
      items: Array.isArray(r.items) && r.items.length ? r.items.map(it => ({ name: it.name || '', qty: it.qty ?? 1 })) : [emptyItem()],
      need_bag: !!r.need_bag, need_invoice: !!r.need_invoice, invoice_tax_id: r.invoice_tax_id || '',
      specific_delivery: !!r.specific_delivery, delivery_time: r.delivery_time || '',
      notes: r.notes || '', status: r.status || '未出貨',
    })
    setEditingId(r.id); setError(null); setShowModal(true)
  }

  const setItem = (i, k, v) => setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }))
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }))
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : f.items }))

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) { setError('請填姓名'); return }
    setSaving(true); setError(null)
    const payload = {
      order_date: form.order_date || null,
      customer_name: form.customer_name.trim(),
      phone: form.phone || null, address: form.address || null,
      items: form.items.filter(it => (it.name || '').trim()).map(it => ({ name: it.name.trim(), qty: Number(it.qty) || 1 })),
      need_bag: form.need_bag, need_invoice: form.need_invoice,
      invoice_tax_id: form.need_invoice ? (form.invoice_tax_id || null) : null,
      specific_delivery: form.specific_delivery,
      delivery_time: form.specific_delivery ? (form.delivery_time || null) : null,
      notes: form.notes || null, status: form.status,
    }
    if (editingId) {
      const { error } = await supabase.from('preorders').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('preorders').insert({ ...payload, organization_id: orgId }).select().single()
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false); setShowModal(false); load()
  }

  const toggleStatus = async (r) => {
    const next = r.status === '已出貨' ? '未出貨' : '已出貨'
    const { error } = await supabase.from('preorders').update({ status: next }).eq('id', r.id)
    if (error) setError(error.message); else setRows(prev => prev.map(x => x.id === r.id ? { ...x, status: next } : x))
  }

  const handleDelete = async (r) => {
    if (!(await confirm({ message: `刪除 ${r.customer_name} 的預購單？` }))) return
    const { error } = await supabase.from('preorders').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)
    if (error) setError(error.message); else setRows(prev => prev.filter(x => x.id !== r.id))
  }

  const matchSearch = (r) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    const inItems = (r.items || []).some(it => (it.name || '').toLowerCase().includes(q))
    return [r.customer_name, r.phone, r.address].some(f => (f || '').toLowerCase().includes(q)) || inItems
  }
  const inDateRange = (r) => {
    if (dateFrom && (r.order_date || '') < dateFrom) return false
    if (dateTo && (r.order_date || '') > dateTo) return false
    return true
  }
  // 日期+搜尋先過(給統計用),狀態再套(讓徽章顯示各狀態筆數)
  const scoped = rows.filter(r => inDateRange(r) && matchSearch(r))
  const counts = { all: scoped.length, 未出貨: scoped.filter(r => r.status === '未出貨').length, 已出貨: scoped.filter(r => r.status === '已出貨').length }
  const filtered = scoped.filter(r => !filterStatus || r.status === filterStatus)

  const itemsSummary = (items) => (items || []).map(it => `${it.name}×${it.qty}`).join('、') || '—'

  const exportCsv = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const headers = ['日期', '姓名', '電話', '地址', '品項', '提袋', '發票統編', '指定送貨時間', '其他交待', '狀態']
    const lines = [headers.join(',')]
    filtered.forEach(r => lines.push([
      r.order_date || '', r.customer_name || '', r.phone || '', r.address || '',
      itemsSummary(r.items), r.need_bag ? '是' : '', r.need_invoice ? (r.invoice_tax_id || '是') : '',
      r.specific_delivery ? (r.delivery_time || '是') : '', r.notes || '', r.status,
    ].map(esc).join(',')))
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `預購清單_${fmtDate(new Date())}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const statPill = (key, label, n, activeColor) => {
    const active = filterStatus === key
    return (
      <button onClick={() => setFilterStatus(active ? '' : key)}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 88, padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
          border: `1.5px solid ${active ? activeColor : 'var(--border)'}`, background: active ? activeColor + '18' : 'var(--bg-card)' }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: activeColor }}>{n}</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      </button>
    )
  }
  const statusPill = (s) => {
    const shipped = s === '已出貨'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
        background: shipped ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)', color: shipped ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
        {shipped ? <Truck size={12} /> : <Package size={12} />}{s}
      </span>
    )
  }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Package size={20} /> 線上預購 / 出貨SOP</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} title="把目前篩選出來的清單匯出成 Excel/CSV(出貨清單)" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>
            <Download size={16} /> 匯出CSV
          </button>
          <button onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={16} /> 新增預購
          </button>
        </div>
      </div>

      {/* 統計徽章(點擊即依狀態篩選) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {statPill('', '全部', counts.all, 'var(--accent-cyan)')}
        {statPill('未出貨', '未出貨', counts.未出貨, 'var(--accent-orange)')}
        {statPill('已出貨', '已出貨', counts.已出貨, 'var(--accent-green)')}
      </div>

      {/* 篩選列:日期區間選擇器 + 搜尋 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <DateRangeField start={dateFrom} end={dateTo} onChange={(s, e) => { setDateFrom(s || ''); setDateTo(e || '') }} />
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋姓名 / 電話 / 地址 / 品項"
            style={{ ...fieldStyle, paddingLeft: 32 }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>共 {filtered.length} 筆{filterStatus ? `（${filterStatus}）` : ''}</div>

      {error && <div style={{ color: 'var(--accent-red)', marginBottom: 10 }}>{error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>
              <th style={{ padding: '10px 12px' }}>日期</th>
              <th style={{ padding: '10px 12px' }}>姓名</th>
              <th style={{ padding: '10px 12px' }}>電話</th>
              <th style={{ padding: '10px 12px' }}>品項</th>
              <th style={{ padding: '10px 12px' }}>需求</th>
              <th style={{ padding: '10px 12px' }}>備註</th>
              <th style={{ padding: '10px 12px' }}>狀態</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>沒有預購單</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)', fontSize: 14 }}>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.order_date || '—'}</td>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.customer_name}</td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.phone || '—'}</td>
                <td style={{ padding: '10px 12px', maxWidth: 240, color: 'var(--text-secondary)' }}>{itemsSummary(r.items)}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {[r.need_bag && '提袋', r.need_invoice && `統編${r.invoice_tax_id ? ' ' + r.invoice_tax_id : ''}`, r.specific_delivery && `指定時間${r.delivery_time ? ' ' + r.delivery_time : ''}`].filter(Boolean).join('、') || '—'}
                </td>
                <td style={{ padding: '10px 12px', maxWidth: 200, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.notes || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <button onClick={() => toggleStatus(r)} title="點擊切換出貨狀態" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>{statusPill(r.status)}</button>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEdit(r)} title="編輯" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-blue)', padding: 4 }}><Edit3 size={16} /></button>
                  <button onClick={() => handleDelete(r)} title="刪除" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 20, width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯預購單' : '新增預購單'}</h3>
              <button onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>日期</label><input type="date" value={form.order_date} onChange={e => set('order_date', e.target.value)} style={fieldStyle} /></div>
                <div><label style={labelStyle}>姓名 <span style={{ color: 'var(--accent-red)' }}>*</span></label><input value={form.customer_name} onChange={e => set('customer_name', e.target.value)} style={fieldStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>電話</label><input value={form.phone} onChange={e => set('phone', e.target.value)} style={fieldStyle} /></div>
                <div><label style={labelStyle}>狀態</label><select value={form.status} onChange={e => set('status', e.target.value)} style={fieldStyle}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
              </div>
              <div><label style={labelStyle}>地址</label><input value={form.address} onChange={e => set('address', e.target.value)} style={fieldStyle} /></div>

              <div>
                <label style={labelStyle}>訂購品項</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {form.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input value={it.name} onChange={e => setItem(i, 'name', e.target.value)} placeholder="品名(例:紅酒A)" style={{ ...fieldStyle, flex: 3 }} />
                      <input type="number" min={1} value={it.qty} onChange={e => setItem(i, 'qty', e.target.value)} placeholder="數量" style={{ ...fieldStyle, flex: 1, minWidth: 70 }} />
                      <button onClick={() => removeItem(i)} disabled={form.items.length <= 1} title="移除" style={{ border: 'none', background: 'none', cursor: form.items.length <= 1 ? 'default' : 'pointer', color: form.items.length <= 1 ? 'var(--text-muted)' : 'var(--accent-red)', padding: 4 }}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={addItem} style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: '1px dashed var(--border)', background: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: 13 }}><Plus size={14} /> 新增品項</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={form.need_bag} onChange={e => set('need_bag', e.target.checked)} /> 是否提袋</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={form.need_invoice} onChange={e => set('need_invoice', e.target.checked)} /> 是否發票統編</label>
                {form.need_invoice && <input value={form.invoice_tax_id} onChange={e => set('invoice_tax_id', e.target.value)} placeholder="統編號碼" style={{ ...fieldStyle, marginLeft: 24, width: 'calc(100% - 24px)' }} />}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={form.specific_delivery} onChange={e => set('specific_delivery', e.target.checked)} /> 是否特定送貨時間</label>
                {form.specific_delivery && <input value={form.delivery_time} onChange={e => set('delivery_time', e.target.value)} placeholder="指定送貨時間(例:週六下午)" style={{ ...fieldStyle, marginLeft: 24, width: 'calc(100% - 24px)' }} />}
              </div>

              <div><label style={labelStyle}>其他交待事項</label><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} style={{ ...fieldStyle, resize: 'vertical' }} /></div>

              {error && <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>{error}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
              <button onClick={handleSubmit} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
