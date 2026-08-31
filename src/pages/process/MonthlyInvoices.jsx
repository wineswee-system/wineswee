import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { X, Search, Receipt, Paperclip, FileText, Download, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

const BUCKET = 'expense-receipts'
const MAX_FILES = 10
// 叫貨單計入對帳的狀態(已核准之後):金額用 actual(驗收後)優先,退 estimated
const COUNTED = ['已核准', '待核銷', '已核銷']

const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }
const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }
const fileUrl = (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
const isImg = (a) => (a.mime || '').startsWith('image/')
const fmtMoney = (n) => 'NT$ ' + Math.round(Number(n) || 0).toLocaleString()
const nn = (v) => Number(v) || 0

export default function MonthlyInvoices() {
  const orgId = useOrgId()
  const [invoices, setInvoices] = useState([])   // monthly_invoices
  const [orders, setOrders] = useState([])       // 叫貨單(doc_type=order, 已核准之後)
  const [supplierList, setSupplierList] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ invoice_month: '', vendor: '', amount: '', note: '', orderTotal: 0, lockKey: false })
  const [existingFiles, setExistingFiles] = useState([])
  const [newFiles, setNewFiles] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [onlyUnreg, setOnlyUnreg] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [inv, ord, sup] = await Promise.all([
      supabase.from('monthly_invoices').select('*').is('deleted_at', null),
      supabase.from('expense_requests').select('supplier, billing_month, actual_amount, estimated_amount, status')
        .eq('doc_type', 'order').is('deleted_at', null).in('status', COUNTED),
      supabase.from('suppliers').select('name').order('name'),
    ])
    if (inv.error) setError(inv.error.message)
    setInvoices(inv.data || [])
    setOrders((ord.data || []).filter(o => o.supplier && o.billing_month))
    setSupplierList([...new Set((sup.data || []).map(s => s.name).filter(Boolean))])
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  // 叫貨單依「月份|廠商」加總(actual 優先,退 estimated)
  const orderAgg = {}
  orders.forEach(o => {
    const key = `${o.billing_month}|${o.supplier}`
    if (!orderAgg[key]) orderAgg[key] = { total: 0, count: 0 }
    orderAgg[key].total += nn(o.actual_amount) || nn(o.estimated_amount)
    orderAgg[key].count += 1
  })

  // 對帳列 = 叫貨單組合 ∪ 已登記發票,依(月份|廠商)合併
  const invByKey = {}
  invoices.forEach(v => { invByKey[`${v.invoice_month}|${v.vendor}`] = v })
  const keys = [...new Set([...Object.keys(orderAgg), ...Object.keys(invByKey)])]
  let recon = keys.map(k => {
    const [month, vendor] = k.split('|')
    const agg = orderAgg[k] || { total: 0, count: 0 }
    const inv = invByKey[k] || null
    return { key: k, month, vendor, orderTotal: agg.total, orderCount: agg.count, inv, diff: inv ? nn(inv.amount) - agg.total : null }
  })

  // 篩選
  recon = recon.filter(r => {
    if (filterYear && (r.month || '').slice(0, 4) !== filterYear) return false
    if (filterMonth && (r.month || '').split('-')[1] !== filterMonth) return false
    if (onlyUnreg && r.inv) return false
    if (search.trim()) { const q = search.trim().toLowerCase(); if (!(r.vendor || '').toLowerCase().includes(q)) return false }
    return true
  }).sort((a, b) => (b.month || '').localeCompare(a.month || '') || (a.vendor || '').localeCompare(b.vendor || ''))

  const years = [...new Set([...orders.map(o => (o.billing_month || '').slice(0, 4)), ...invoices.map(v => (v.invoice_month || '').slice(0, 4))].filter(Boolean))].sort().reverse()
  const sumOrder = recon.reduce((s, r) => s + r.orderTotal, 0)
  const sumInvoice = recon.reduce((s, r) => s + (r.inv ? nn(r.inv.amount) : 0), 0)
  const unregCount = recon.filter(r => !r.inv && r.orderTotal > 0).length

  const openReg = (r) => {
    if (r.inv) {
      setForm({ invoice_month: r.month, vendor: r.vendor, amount: r.inv.amount ?? '', note: r.inv.note || '', orderTotal: r.orderTotal, lockKey: true })
      setExistingFiles(Array.isArray(r.inv.attachments) ? r.inv.attachments : []); setEditingId(r.inv.id)
    } else {
      setForm({ invoice_month: r.month, vendor: r.vendor, amount: '', note: '', orderTotal: r.orderTotal, lockKey: true })
      setExistingFiles([]); setEditingId(null)
    }
    setNewFiles([]); setError(null); setShowModal(true)
  }
  const openNew = () => {
    setForm({ invoice_month: new Date().toISOString().slice(0, 7), vendor: '', amount: '', note: '', orderTotal: 0, lockKey: false })
    setExistingFiles([]); setNewFiles([]); setEditingId(null); setError(null); setShowModal(true)
  }

  // 開新單時,選了廠商+月份 → 即時帶出叫貨總額
  const previewOrderTotal = (month, vendor) => (orderAgg[`${month}|${vendor}`]?.total) || 0

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || []); e.target.value = ''
    const okType = picked.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (okType.length < picked.length) setError('只接受圖片或 PDF')
    if (existingFiles.length + newFiles.length + okType.length > MAX_FILES) { setError(`附件最多 ${MAX_FILES} 個`); return }
    setNewFiles(prev => [...prev, ...okType])
  }
  const uploadFiles = async (files) => {
    const out = []
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `monthly-invoices/${orgId || 'na'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
      if (upErr) throw new Error('上傳失敗：' + upErr.message)
      out.push({ path, name: file.name, mime: file.type, size: file.size })
    }
    return out
  }

  const handleSubmit = async () => {
    if (!form.invoice_month) { setError('請選月份'); return }
    if (!form.vendor.trim()) { setError('請填/選廠商'); return }
    setSaving(true); setError(null)
    try {
      const uploaded = newFiles.length ? await uploadFiles(newFiles) : []
      const attachments = [...existingFiles, ...uploaded]
      const payload = { invoice_month: form.invoice_month, vendor: form.vendor.trim(), amount: nn(form.amount), note: form.note?.trim() || null, attachments }
      if (editingId) {
        const { error } = await supabase.from('monthly_invoices').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('monthly_invoices').insert({ ...payload, organization_id: orgId }).select().single()
        if (error) throw error
      }
      setShowModal(false); load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!editingId) { setShowModal(false); return }
    const { error } = await supabase.from('monthly_invoices').update({ deleted_at: new Date().toISOString() }).eq('id', editingId)
    if (error) { setError(error.message); return }
    setShowModal(false); load()
  }

  const csvExport = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['月份', '廠商', '叫貨總額', '發票金額', '差異', '狀態'].join(',')]
    recon.forEach(r => lines.push([r.month, r.vendor, r.orderTotal, r.inv ? nn(r.inv.amount) : '', r.inv ? r.diff : '', r.inv ? '已登記' : '未登記'].map(esc).join(',')))
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `月結對帳_${filterYear || '全部'}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (loading) return <LoadingSpinner />
  const pickedCount = existingFiles.length + newFiles.length
  const modalOrderTotal = form.lockKey ? form.orderTotal : previewOrderTotal(form.invoice_month, form.vendor)
  const modalDiff = nn(form.amount) - modalOrderTotal

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Receipt size={20} /> 月結發票對帳</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>系統自動加總各廠商當月叫貨單金額,對上廠商月結發票</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={csvExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>
            <Download size={16} /> 匯出CSV
          </button>
          <button onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            + 登記發票
          </button>
        </div>
      </div>

      {/* 統計 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 140, padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-card)' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-cyan)' }}>{fmtMoney(sumOrder)}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>叫貨總額</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 140, padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-card)' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-green)' }}>{fmtMoney(sumInvoice)}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>發票總額</span>
        </div>
        <button onClick={() => setOnlyUnreg(v => !v)} title="只看有叫貨但還沒登發票的" style={{ display: 'flex', flexDirection: 'column', minWidth: 120, padding: '10px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
          border: `1.5px solid ${onlyUnreg ? 'var(--accent-orange)' : 'var(--border)'}`, background: onlyUnreg ? 'var(--accent-orange-dim)' : 'var(--bg-card)' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-orange)' }}>{unregCount}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未登發票{onlyUnreg ? ' ·篩選中' : ''}</span>
        </button>
      </div>

      {/* 篩選 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ ...fieldStyle, width: 'auto', minWidth: 100 }}>
          <option value="">全部年</option>{years.map(y => <option key={y} value={y}>{y} 年</option>)}
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...fieldStyle, width: 'auto', minWidth: 100 }}>
          <option value="">整年</option>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => <option key={m} value={m}>{m} 月</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋廠商" style={{ ...fieldStyle, paddingLeft: 32 }} />
        </div>
      </div>

      {error && !showModal && <div style={{ color: 'var(--accent-red)', marginBottom: 10 }}>{error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>
              <th style={{ padding: '10px 12px' }}>月份</th>
              <th style={{ padding: '10px 12px' }}>廠商</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>叫貨總額</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>發票金額</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>差異</th>
              <th style={{ padding: '10px 12px' }}>附件</th>
              <th style={{ padding: '10px 12px' }}>狀態</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {recon.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>沒有資料(叫貨單填了「廠商 + 帳務月份」才會出現在這裡對帳)</td></tr>
            ) : recon.map(r => {
              const matched = r.inv && Math.abs(r.diff) < 1
              return (
                <tr key={r.key} style={{ borderTop: '1px solid var(--border)', fontSize: 14 }}>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{r.month}</td>
                  <td style={{ padding: '10px 12px' }}>{r.vendor}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.orderCount ? <>{fmtMoney(r.orderTotal)}<span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · {r.orderCount}單</span></> : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.inv ? fmtMoney(r.inv.amount) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.inv ? (matched ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)' }}>
                    {r.inv ? (matched ? '✓ 相符' : (r.diff > 0 ? '+' : '') + Math.round(r.diff).toLocaleString()) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.inv && (r.inv.attachments || []).length ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {(r.inv.attachments || []).slice(0, 3).map((a, i) => (
                          <a key={i} href={fileUrl(a.path)} target="_blank" rel="noreferrer" title={a.name}>
                            {isImg(a) ? <img src={fileUrl(a.path)} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} /> : <span style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--accent-red)' }}><FileText size={14} /></span>}
                          </a>
                        ))}
                        {(r.inv.attachments || []).length > 3 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{(r.inv.attachments).length - 3}</span>}
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.inv
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}><CheckCircle2 size={12} />已登記</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}><AlertCircle size={12} />未登發票</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openReg(r)} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--accent-cyan)', background: 'none', color: 'var(--accent-cyan)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>{r.inv ? '編輯' : '登記發票'}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 20, width: 'min(520px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯發票登記' : '登記月結發票'}</h3>
              <button onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>月份 <span style={{ color: 'var(--accent-red)' }}>*</span></label><input type="month" value={form.invoice_month} onChange={e => set('invoice_month', e.target.value)} disabled={form.lockKey} style={{ ...fieldStyle, opacity: form.lockKey ? 0.7 : 1 }} /></div>
                <div><label style={labelStyle}>廠商 <span style={{ color: 'var(--accent-red)' }}>*</span></label><input value={form.vendor} onChange={e => set('vendor', e.target.value)} list="mi-vendor-list" disabled={form.lockKey} placeholder="打字選廠商" style={{ ...fieldStyle, opacity: form.lockKey ? 0.7 : 1 }} /><datalist id="mi-vendor-list">{supplierList.map(s => <option key={s} value={s} />)}</datalist></div>
              </div>

              {/* 對帳提示 */}
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>系統叫貨總額</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(modalOrderTotal)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>發票金額</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(nn(form.amount))}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>差異</span>
                  <strong style={{ fontVariantNumeric: 'tabular-nums', color: Math.abs(modalDiff) < 1 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{Math.abs(modalDiff) < 1 ? '✓ 相符' : (modalDiff > 0 ? '+' : '') + Math.round(modalDiff).toLocaleString()}</strong>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>發票金額</label><input type="number" min={0} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0" style={fieldStyle} /></div>
                <div><label style={labelStyle}>備註</label><input value={form.note} onChange={e => set('note', e.target.value)} style={fieldStyle} /></div>
              </div>

              <div>
                <label style={labelStyle}>發票附件（圖片 / PDF,最多 {MAX_FILES} 個） · {pickedCount}/{MAX_FILES}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {existingFiles.map((a, i) => (
                    <div key={'e' + i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
                      {isImg(a) ? <img src={fileUrl(a.path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FileText size={22} style={{ color: 'var(--accent-red)' }} />}
                      <button onClick={() => setExistingFiles(p => p.filter((_, x) => x !== i))} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 99, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={12} /></button>
                    </div>
                  ))}
                  {newFiles.map((f, i) => (
                    <div key={'n' + i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 6, border: '1px dashed var(--accent-cyan)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
                      {f.type.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FileText size={22} style={{ color: 'var(--accent-red)' }} />}
                      <button onClick={() => setNewFiles(p => p.filter((_, x) => x !== i))} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 99, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={12} /></button>
                    </div>
                  ))}
                  {pickedCount < MAX_FILES && (
                    <label style={{ width: 64, height: 64, borderRadius: 6, border: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', gap: 2 }}>
                      <Paperclip size={18} /><span style={{ fontSize: 10 }}>加檔案</span>
                      <input type="file" accept="image/*,application/pdf" multiple onChange={onPickFiles} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>
              </div>

              {error && <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>{error}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 20 }}>
              <div>{editingId && <button onClick={handleDelete} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--accent-red)', background: 'none', color: 'var(--accent-red)', cursor: 'pointer' }}>刪除</button>}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
                <button onClick={handleSubmit} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '儲存中…' : '儲存'}</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
