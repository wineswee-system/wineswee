import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, Trash2, Edit3, X, Search, Receipt, Paperclip, FileText, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import { confirm } from '../../lib/confirm'
import LoadingSpinner from '../../components/LoadingSpinner'

const BUCKET = 'expense-receipts'
const MAX_FILES = 10
const emptyForm = () => ({
  invoice_month: new Date().toISOString().slice(0, 7),  // 'YYYY-MM'
  vendor: '', amount: '', note: '',
})

const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }
const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }
const fileUrl = (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
const isImg = (a) => (a.mime || '').startsWith('image/')
const fmtMoney = (n) => 'NT$ ' + (Number(n) || 0).toLocaleString()

export default function MonthlyInvoices() {
  const orgId = useOrgId()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [existingFiles, setExistingFiles] = useState([])   // [{path,name,mime,size}]
  const [newFiles, setNewFiles] = useState([])             // File[]
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('monthly_invoices').select('*')
      .is('deleted_at', null).order('invoice_month', { ascending: false }).order('id', { ascending: false })
    if (error) setError(error.message); else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  const openNew = () => { setForm(emptyForm()); setExistingFiles([]); setNewFiles([]); setEditingId(null); setError(null); setShowModal(true) }
  const openEdit = (r) => {
    setForm({ invoice_month: r.invoice_month || '', vendor: r.vendor || '', amount: r.amount ?? '', note: r.note || '' })
    setExistingFiles(Array.isArray(r.attachments) ? r.attachments : [])
    setNewFiles([]); setEditingId(r.id); setError(null); setShowModal(true)
  }

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    const okType = picked.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (okType.length < picked.length) setError('只接受圖片或 PDF')
    if (existingFiles.length + newFiles.length + okType.length > MAX_FILES) {
      setError(`附件最多 ${MAX_FILES} 個`); return
    }
    setNewFiles(prev => [...prev, ...okType])
  }
  const removeExisting = (i) => setExistingFiles(prev => prev.filter((_, idx) => idx !== i))
  const removeNew = (i) => setNewFiles(prev => prev.filter((_, idx) => idx !== i))

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
    if (!form.vendor.trim()) { setError('請填廠商'); return }
    setSaving(true); setError(null)
    try {
      const uploaded = newFiles.length ? await uploadFiles(newFiles) : []
      const attachments = [...existingFiles, ...uploaded]
      const payload = {
        invoice_month: form.invoice_month,
        vendor: form.vendor.trim(),
        amount: Number(form.amount) || 0,
        note: form.note?.trim() || null,
        attachments,
      }
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

  const handleDelete = async (r) => {
    if (!(await confirm({ message: `刪除「${r.invoice_month} · ${r.vendor}」的發票登記?` }))) return
    const { error } = await supabase.from('monthly_invoices').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)
    if (error) setError(error.message); else setRows(prev => prev.filter(x => x.id !== r.id))
  }

  // 篩選 + 統計
  const months = [...new Set(rows.map(r => r.invoice_month).filter(Boolean))].sort().reverse()
  const filtered = rows.filter(r => {
    if (filterMonth && r.invoice_month !== filterMonth) return false
    if (search.trim()) { const q = search.trim().toLowerCase(); if (!(r.vendor || '').toLowerCase().includes(q) && !(r.note || '').toLowerCase().includes(q)) return false }
    return true
  })
  const totalAmount = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  // 依廠商彙總(給統計)
  const byVendor = {}
  filtered.forEach(r => { byVendor[r.vendor] = (byVendor[r.vendor] || 0) + (Number(r.amount) || 0) })
  const vendorSummary = Object.entries(byVendor).sort((a, b) => b[1] - a[1])

  const csvExport = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['月份', '廠商', '金額', '附件數', '備註'].join(',')]
    filtered.forEach(r => lines.push([r.invoice_month, r.vendor, Number(r.amount) || 0, (r.attachments || []).length, r.note || ''].map(esc).join(',')))
    lines.push(['', '合計', totalAmount, '', ''].map(esc).join(','))
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `月結發票_${filterMonth || '全部'}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (loading) return <LoadingSpinner />
  const pickedCount = existingFiles.length + newFiles.length

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Receipt size={20} /> 月結發票登記</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={csvExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>
            <Download size={16} /> 匯出CSV
          </button>
          <button onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={16} /> 登記發票
          </button>
        </div>
      </div>

      {/* 統計:張數 + 合計金額 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 110, padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-card)' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-cyan)' }}>{filtered.length}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>張發票</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 150, padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-card)' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-green)' }}>{fmtMoney(totalAmount)}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>合計金額{filterMonth ? `（${filterMonth}）` : ''}</span>
        </div>
      </div>

      {/* 篩選:月份 + 廠商搜尋 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...fieldStyle, width: 'auto', minWidth: 140 }}>
          <option value="">全部月份</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋廠商 / 備註" style={{ ...fieldStyle, paddingLeft: 32 }} />
        </div>
      </div>

      {/* 依廠商彙總(統計) */}
      {vendorSummary.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {vendorSummary.map(([v, amt]) => (
            <span key={v} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
              {v}：<strong style={{ color: 'var(--text-primary)' }}>{fmtMoney(amt)}</strong>
            </span>
          ))}
        </div>
      )}

      {error && !showModal && <div style={{ color: 'var(--accent-red)', marginBottom: 10 }}>{error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>
              <th style={{ padding: '10px 12px' }}>月份</th>
              <th style={{ padding: '10px 12px' }}>廠商</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>金額</th>
              <th style={{ padding: '10px 12px' }}>附件</th>
              <th style={{ padding: '10px 12px' }}>備註</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>尚無發票登記</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)', fontSize: 14 }}>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{r.invoice_month}</td>
                <td style={{ padding: '10px 12px' }}>{r.vendor}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</td>
                <td style={{ padding: '10px 12px' }}>
                  {(r.attachments || []).length ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(r.attachments || []).slice(0, 4).map((a, i) => (
                        <a key={i} href={fileUrl(a.path)} target="_blank" rel="noreferrer" title={a.name} style={{ display: 'inline-flex' }}>
                          {isImg(a)
                            ? <img src={fileUrl(a.path)} alt={a.name} style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                            : <span style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--accent-red)' }}><FileText size={16} /></span>}
                        </a>
                      ))}
                      {(r.attachments || []).length > 4 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>+{(r.attachments || []).length - 4}</span>}
                    </div>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '10px 12px', maxWidth: 200, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.note || '—'}</td>
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
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 20, width: 'min(540px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯發票登記' : '登記月結發票'}</h3>
              <button onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>月份 <span style={{ color: 'var(--accent-red)' }}>*</span></label><input type="month" value={form.invoice_month} onChange={e => set('invoice_month', e.target.value)} style={fieldStyle} /></div>
                <div><label style={labelStyle}>金額</label><input type="number" min={0} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0" style={fieldStyle} /></div>
              </div>
              <div><label style={labelStyle}>廠商 <span style={{ color: 'var(--accent-red)' }}>*</span></label><input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="廠商名稱" style={fieldStyle} /></div>
              <div><label style={labelStyle}>備註</label><textarea value={form.note} onChange={e => set('note', e.target.value)} rows={2} style={{ ...fieldStyle, resize: 'vertical' }} /></div>

              <div>
                <label style={labelStyle}>附件（圖片 / PDF，最多 {MAX_FILES} 個） · {pickedCount}/{MAX_FILES}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {existingFiles.map((a, i) => (
                    <div key={'e' + i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
                      {isImg(a) ? <img src={fileUrl(a.path)} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FileText size={22} style={{ color: 'var(--accent-red)' }} />}
                      <button onClick={() => removeExisting(i)} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 99, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={12} /></button>
                    </div>
                  ))}
                  {newFiles.map((f, i) => (
                    <div key={'n' + i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 6, border: '1px dashed var(--accent-cyan)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
                      {f.type.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FileText size={22} style={{ color: 'var(--accent-red)' }} />}
                      <button onClick={() => removeNew(i)} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 99, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={12} /></button>
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
