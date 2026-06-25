import { useState } from 'react'
import { createCoupon, updateCoupon } from '../../../lib/db'

const TYPE_OPTIONS = [
  { value: 'pct_off',   label: '百分比折扣 (% OFF)' },
  { value: 'fixed_off', label: '固定金額折抵 (NT$ OFF)' },
  { value: 'free_item', label: '免費商品兌換' },
  { value: 'bogo',      label: '買 X 送 Y' },
  { value: 'points_2x', label: '點數倍增 (Nx)' },
]

const EMPTY = {
  code: '',
  name: '',
  description: '',
  type: 'pct_off',
  value: '',
  min_purchase: '',
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: '',
  usage_limit_total: '',
  usage_limit_per_member: 1,
  combinable: false,
  status: 'draft',
}

function randomCode() {
  return 'CPN-' + Math.random().toString(36).toUpperCase().slice(2, 8)
}

function valueLabel(type) {
  if (type === 'pct_off')   return '折扣百分比 (%)'
  if (type === 'fixed_off') return '折抵金額 (NT$)'
  if (type === 'points_2x') return '點數倍率 (e.g. 2 = 雙倍)'
  return '數值'
}

export default function CouponFormModal({ orgId, initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    ...EMPTY,
    ...(initial ? {
      ...initial,
      valid_from:  initial.valid_from  ? initial.valid_from.slice(0, 10)  : EMPTY.valid_from,
      valid_until: initial.valid_until ? initial.valid_until.slice(0, 10) : '',
    } : {}),
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.code.trim() || !form.name.trim()) { setErr('代碼與名稱為必填'); return }
    setSaving(true); setErr('')
    const payload = {
      organization_id:        orgId,
      code:                   form.code.trim().toUpperCase(),
      name:                   form.name.trim(),
      description:            form.description || null,
      type:                   form.type,
      value:                  form.value !== '' ? Number(form.value) : 0,
      min_purchase:           form.min_purchase !== '' ? Number(form.min_purchase) : 0,
      valid_from:             form.valid_from  ? new Date(form.valid_from).toISOString() : null,
      valid_until:            form.valid_until ? new Date(form.valid_until + 'T23:59:59').toISOString() : null,
      usage_limit_total:      form.usage_limit_total !== '' ? Number(form.usage_limit_total) : null,
      usage_limit_per_member: form.usage_limit_per_member !== '' ? Number(form.usage_limit_per_member) : 1,
      combinable:             form.combinable,
      status:                 form.status,
    }
    const { data, error } = initial
      ? await updateCoupon(initial.id, payload)
      : await createCoupon(payload)
    if (error) { setErr(error.message); setSaving(false); return }
    onSaved(data)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: 14, padding: 28, width: 540, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
          {initial ? '編輯優惠券' : '新增優惠券'}
        </h2>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label style={S.label}>優惠碼 *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="e.g. SUMMER20" style={{ ...S.input, flex: 1, fontFamily: 'monospace' }} />
              <button type="button" onClick={() => set('code', randomCode())} style={S.ghostBtn}>隨機</button>
            </div>
          </div>

          <div>
            <label style={S.label}>名稱 *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="夏日折扣 20%" style={S.input} />
          </div>

          <div>
            <label style={S.label}>說明</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="使用說明或條款…" rows={2} style={{ ...S.input, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={S.label}>優惠類型 *</label>
              <select value={form.type} onChange={e => set('type', e.target.value)} style={S.input}>
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>{valueLabel(form.type)}</label>
              <input type="number" value={form.value} onChange={e => set('value', e.target.value)} placeholder={form.type === 'pct_off' ? '20' : '100'} min={0} style={S.input} />
            </div>
          </div>

          <div>
            <label style={S.label}>最低消費金額 (NT$) — 留空表示無限制</label>
            <input type="number" value={form.min_purchase} onChange={e => set('min_purchase', e.target.value)} placeholder="0" min={0} style={S.input} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={S.label}>開始日期</label>
              <input type="date" value={form.valid_from} onChange={e => set('valid_from', e.target.value)} style={S.input} />
            </div>
            <div>
              <label style={S.label}>截止日期 — 留空表示永久有效</label>
              <input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} style={S.input} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={S.label}>總使用上限 — 留空不限</label>
              <input type="number" value={form.usage_limit_total} onChange={e => set('usage_limit_total', e.target.value)} placeholder="不限" min={1} style={S.input} />
            </div>
            <div>
              <label style={S.label}>每人限用次數</label>
              <input type="number" value={form.usage_limit_per_member} onChange={e => set('usage_limit_per_member', e.target.value)} placeholder="1" min={1} style={S.input} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14 }}>
              <input type="checkbox" checked={form.combinable} onChange={e => set('combinable', e.target.checked)} />
              可與其他優惠疊加使用
            </label>
            <div>
              <label style={S.label}>狀態</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} style={S.input}>
                <option value="draft">草稿</option>
                <option value="active">立即啟用</option>
                <option value="paused">暫停</option>
              </select>
            </div>
          </div>

          {err && <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, ...S.ghostBtn }}>取消</button>
            <button type="submit" disabled={saving} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              {saving ? '儲存中…' : (initial ? '儲存變更' : '建立優惠券')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const S = {
  label:    { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 },
  input:    { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  ghostBtn: { padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' },
}
