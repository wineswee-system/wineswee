import { useEffect, useState, useCallback, useMemo } from 'react'
import { Hammer, Plus, X, Trash2, Pencil, Store, Phone, User, Building } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { toast } from '../../lib/toast'
import LoadingSpinner from '../../components/LoadingSpinner'

// 裝潢報價紀錄 — 純記錄、不走簽核。門市/廠商 + 工程費(含監工%/稅金%)=總價 + 可自訂付款分期。
const fmt = (n) => `NT$ ${Number(n || 0).toLocaleString()}`
const round0 = (n) => Math.round(Number(n) || 0)
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const emptyForm = () => ({
  store_name: '', address: '', vendor: '', contact_name: '', contact_phone: '',
  construction_fee: '', mgmt_fee_pct: 8, tax_pct: 5, quote_date: todayStr(), note: '',
  payments: [{ label: '簽約金', pct: 40, due_date: '', amount: '' }],
})

export default function RenovationQuotes() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? getTenantOrgId()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('renovation_quotes').select('*').order('created_at', { ascending: false })
    if (orgId) q = q.eq('organization_id', orgId)
    const { data: quotes, error } = await q
    if (error) { toast.error('載入失敗：' + error.message); setRows([]); setLoading(false); return }
    const ids = (quotes || []).map(r => r.id)
    let payMap = {}
    if (ids.length) {
      const { data: pays } = await supabase.from('renovation_quote_payments').select('*').in('quote_id', ids).order('phase_no')
      for (const p of (pays || [])) (payMap[p.quote_id] ||= []).push(p)
    }
    setRows((quotes || []).map(r => ({ ...r, payments: payMap[r.id] || [] })))
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  // 金額連動：監工管理費 = 工程費 × %;稅金 = (工程費 + 監工) × %;總價 = 三者相加(對齊報價單)
  const calc = useMemo(() => {
    const cf = Number(form.construction_fee) || 0
    const mgmt = round0(cf * (Number(form.mgmt_fee_pct) || 0) / 100)
    const tax = round0((cf + mgmt) * (Number(form.tax_pct) || 0) / 100)
    return { mgmt, tax, total: cf + mgmt + tax }
  }, [form.construction_fee, form.mgmt_fee_pct, form.tax_pct])

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setShowForm(true) }
  const openEdit = (r) => {
    setEditingId(r.id)
    setForm({
      store_name: r.store_name || '', address: r.address || '', vendor: r.vendor || '',
      contact_name: r.contact_name || '', contact_phone: r.contact_phone || '',
      construction_fee: r.construction_fee ?? '', mgmt_fee_pct: r.mgmt_fee_pct ?? 8, tax_pct: r.tax_pct ?? 5,
      quote_date: r.quote_date || todayStr(), note: r.note || '',
      payments: (r.payments || []).length
        ? r.payments.map(p => ({ label: p.label || '', pct: p.pct ?? '', due_date: p.due_date || '', amount: p.amount ?? '' }))
        : [{ label: '', pct: '', due_date: '', amount: '' }],
    })
    setShowForm(true)
  }

  const setPay = (i, k, v) => setForm(f => ({ ...f, payments: f.payments.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))
  const addPay = () => setForm(f => ({ ...f, payments: [...f.payments, { label: '', pct: '', due_date: '', amount: '' }] }))
  const delPay = (i) => setForm(f => ({ ...f, payments: f.payments.filter((_, idx) => idx !== i) }))
  // 依總價 + % 自動帶金額(可再手改)
  const fillPayAmt = (i) => setForm(f => ({ ...f, payments: f.payments.map((p, idx) => idx === i ? { ...p, amount: round0(calc.total * (Number(p.pct) || 0) / 100) } : p) }))

  const save = async () => {
    if (!form.store_name.trim()) { toast.error('請填門市'); return }
    if (!orgId) { toast.error('找不到組織'); return }
    setSaving(true)
    const header = {
      organization_id: orgId, store_name: form.store_name.trim(), address: form.address.trim() || null,
      vendor: form.vendor.trim() || null, contact_name: form.contact_name.trim() || null, contact_phone: form.contact_phone.trim() || null,
      construction_fee: Number(form.construction_fee) || 0, mgmt_fee_pct: Number(form.mgmt_fee_pct) || 0, mgmt_fee: calc.mgmt,
      tax_pct: Number(form.tax_pct) || 0, tax: calc.tax, total_amount: calc.total,
      quote_date: form.quote_date || null, note: form.note.trim() || null, created_by: profile?.name || null,
    }
    let quoteId = editingId
    if (editingId) {
      const { error } = await supabase.from('renovation_quotes').update({ ...header, updated_at: new Date().toISOString() }).eq('id', editingId)
      if (error) { toast.error('儲存失敗：' + error.message); setSaving(false); return }
      await supabase.from('renovation_quote_payments').delete().eq('quote_id', editingId)  // 重寫分期
    } else {
      const { data, error } = await supabase.from('renovation_quotes').insert(header).select('id').single()
      if (error) { toast.error('儲存失敗：' + error.message); setSaving(false); return }
      quoteId = data.id
    }
    const pays = form.payments
      .filter(p => p.label || p.pct || p.amount || p.due_date)
      .map((p, idx) => ({
        organization_id: orgId, quote_id: quoteId, phase_no: idx + 1,
        label: p.label?.trim() || null, pct: p.pct === '' ? null : Number(p.pct),
        due_date: p.due_date || null, amount: p.amount === '' ? null : Number(p.amount), note: null,
      }))
    if (pays.length) {
      const { error } = await supabase.from('renovation_quote_payments').insert(pays)
      if (error) { toast.error('分期儲存失敗：' + error.message); setSaving(false); return }
    }
    toast.success(editingId ? '已更新' : '已新增')
    setSaving(false); setShowForm(false); load()
  }

  const remove = async (r) => {
    if (!confirm(`確定刪除「${r.store_name}」這筆裝潢報價?(含付款分期,無法復原)`)) return
    const { error } = await supabase.from('renovation_quotes').delete().eq('id', r.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除'); load()
  }

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14 }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hammer size={20} style={{ color: 'var(--accent-orange)' }} /> 裝潢報價紀錄
          </h2>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>門市裝潢工程報價記錄（純記錄，含付款分期）</div>
        </div>
        <button className="btn btn-primary" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> 新增報價
        </button>
      </div>

      {loading ? <LoadingSpinner /> : rows.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>還沒有裝潢報價紀錄,點右上角「新增報價」開始</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(r => (
            <div key={r.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Store size={15} style={{ color: 'var(--accent-cyan)' }} /> {r.store_name}
                    {r.quote_date && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>{r.quote_date}</span>}
                  </div>
                  {r.address && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>{r.address}</div>}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {r.vendor && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building size={13} /> {r.vendor}</span>}
                    {r.contact_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={13} /> {r.contact_name}</span>}
                    {r.contact_phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={13} /> {r.contact_phone}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-red)' }}>{fmt(r.total_amount)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>總價</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? '收合' : '明細'}</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(r)}><Pencil size={12} /></button>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12, color: 'var(--accent-red)' }} onClick={() => remove(r)}><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
              {expanded === r.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, marginBottom: 10 }}>
                    <span>工程費 <b>{fmt(r.construction_fee)}</b></span>
                    <span>監工管理費 {r.mgmt_fee_pct}% <b>{fmt(r.mgmt_fee)}</b></span>
                    <span>稅金 {r.tax_pct}% <b>{fmt(r.tax)}</b></span>
                  </div>
                  {r.payments.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                        <thead><tr><th>期別</th><th>名目</th><th>%</th><th>日期</th><th style={{ textAlign: 'right' }}>金額</th></tr></thead>
                        <tbody>
                          {r.payments.map((p, i) => (
                            <tr key={p.id}><td>第{p.phase_no}期</td><td>{p.label || '-'}</td><td>{p.pct != null ? p.pct + '%' : '-'}</td><td>{p.due_date || '-'}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{p.amount != null ? fmt(p.amount) : '-'}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {r.note && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>備註：{r.note}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 20, overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} className="card" style={{ width: 'min(720px, 100%)', padding: 24, marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingId ? '編輯' : '新增'}裝潢報價</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>門市 *</label><input style={inputStyle} value={form.store_name} onChange={e => setForm(f => ({ ...f, store_name: e.target.value }))} placeholder="門市名稱（新店可直接填）" /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>地址</label><input style={inputStyle} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div><label style={labelStyle}>廠商</label><input style={inputStyle} value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
              <div><label style={labelStyle}>報價日期</label><input type="date" style={inputStyle} value={form.quote_date} onChange={e => setForm(f => ({ ...f, quote_date: e.target.value }))} /></div>
              <div><label style={labelStyle}>負責人</label><input style={inputStyle} value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
              <div><label style={labelStyle}>電話</label><input style={inputStyle} value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} /></div>
            </div>

            {/* 金額 */}
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div><label style={labelStyle}>工程費小計</label><input type="number" style={inputStyle} value={form.construction_fee} onChange={e => setForm(f => ({ ...f, construction_fee: e.target.value }))} /></div>
                <div><label style={labelStyle}>監工管理費 %</label><input type="number" style={inputStyle} value={form.mgmt_fee_pct} onChange={e => setForm(f => ({ ...f, mgmt_fee_pct: e.target.value }))} /></div>
                <div><label style={labelStyle}>稅金 %</label><input type="number" style={inputStyle} value={form.tax_pct} onChange={e => setForm(f => ({ ...f, tax_pct: e.target.value }))} /></div>
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
                <span>監工管理費：<b>{fmt(calc.mgmt)}</b></span>
                <span>稅金：<b>{fmt(calc.tax)}</b></span>
                <span style={{ marginLeft: 'auto', fontSize: 15 }}>總價：<b style={{ color: 'var(--accent-red)' }}>{fmt(calc.total)}</b></span>
              </div>
            </div>

            {/* 付款分期 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>付款分期</label>
                <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={addPay}><Plus size={12} /> 加一期</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {form.payments.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 130px 1fr 28px', gap: 6, alignItems: 'center' }}>
                    <input style={{ ...inputStyle, padding: '6px 8px' }} placeholder={`第${i + 1}期名目`} value={p.label} onChange={e => setPay(i, 'label', e.target.value)} />
                    <input type="number" style={{ ...inputStyle, padding: '6px 8px' }} placeholder="%" value={p.pct} onChange={e => setPay(i, 'pct', e.target.value)} onBlur={() => p.pct && !p.amount && fillPayAmt(i)} />
                    <input type="date" style={{ ...inputStyle, padding: '6px 8px' }} value={p.due_date} onChange={e => setPay(i, 'due_date', e.target.value)} />
                    <input type="number" style={{ ...inputStyle, padding: '6px 8px' }} placeholder="金額" value={p.amount} onChange={e => setPay(i, 'amount', e.target.value)} />
                    <button onClick={() => delPay(i)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>填 % 後跳出欄位會依總價自動帶金額,可再手改。</div>
            </div>

            <div><label style={labelStyle}>備註</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
