import { useState, useEffect, useCallback } from 'react'
import { Pencil, MapPin, Wifi, Clock, Building2, User, Users, Briefcase, Hash, Save } from 'lucide-react'
import { getStores, updateStore } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import Time24 from '../../components/Time24'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { geocodeAddress } from '../../lib/geocoding'
import { toast } from '../../lib/toast'

// ── 員工身分工時規則(全公司一組;引擎依 salary_structures.employment_category 讀) ──
const CATS = [
  { key: 'admin',    label: '行政', icon: User,      color: 'var(--accent-cyan)',   desc: '固定辦公時間 + 彈性(可前後浮動)', hasHours: true },
  { key: 'regular',  label: '正職', icon: Users,     color: 'var(--accent-blue)',   desc: '依個人班表;可設遲到早退寬限',    hasHours: false },
  { key: 'parttime', label: '兼職', icon: Briefcase, color: 'var(--accent-orange)', desc: '依個人班表;可設遲到早退寬限',    hasHours: false },
  { key: 'piece',    label: '計件', icon: Hash,      color: 'var(--accent-purple)', desc: '按件計酬,不計遲到早退',          hasHours: false, readonly: true },
]

const EMPTY_RULES = {
  clock_in_method: 'any', lat: '', lng: '', clock_radius: 150, allowed_wifi: '', early_clock_minutes: 30,
}
const METHOD_LABELS = { any: 'GPS 或 WiFi 擇一', gps_required: '僅限 GPS', gps_or_wifi: 'GPS 或 WiFi 擇一' }
const toHHMM = (t) => (t ? String(t).slice(0, 5) : '')

function configStatus(store) {
  const hasGPS = !!(store.lat && store.lng), hasWifi = !!(store.allowed_wifi?.length)
  if (hasGPS && hasWifi) return 'full'
  if (hasGPS || hasWifi) return 'partial'
  return 'none'
}
const STATUS_META = {
  full:    { label: 'GPS + WiFi', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  partial: { label: '部分設定',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  none:    { label: '未設定',     color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
}

export default function ClockRules() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? getTenantOrgId()
  const [stores, setStores] = useState([])
  const [catRules, setCatRules] = useState({})   // category -> {work_start, work_end, grace_minutes}
  const [savingCat, setSavingCat] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingStore, setEditingStore] = useState(null)
  const [form, setForm] = useState(EMPTY_RULES)
  const [geocoding, setGeocoding] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadCatRules = useCallback(() => {
    let q = supabase.from('employment_category_work_rules').select('*')
    if (orgId) q = q.eq('organization_id', orgId)
    return q.then(({ data }) => {
      const map = {}
      ;(data || []).forEach(r => { map[r.category] = { work_start: toHHMM(r.work_start) || '09:00', work_end: toHHMM(r.work_end) || '18:00', grace_minutes: r.grace_minutes ?? 0 } })
      CATS.forEach(c => { if (!map[c.key]) map[c.key] = { work_start: '09:00', work_end: '18:00', grace_minutes: c.key === 'admin' ? 30 : 0 } })
      setCatRules(map)
    })
  }, [orgId])

  useEffect(() => {
    Promise.all([getStores(orgId).then(({ data }) => setStores(data || [])), loadCatRules()])
      .finally(() => setLoading(false))
  }, [orgId, loadCatRules])

  const setCat = (cat, k, v) => setCatRules(m => ({ ...m, [cat]: { ...m[cat], [k]: v } }))

  const saveCat = async (cat) => {
    setSavingCat(cat)
    const r = catRules[cat]
    const isAdmin = cat === 'admin'
    const payload = {
      organization_id: orgId, category: cat,
      work_start: isAdmin ? r.work_start : null,
      work_end:   isAdmin ? r.work_end   : null,
      grace_minutes: Number.isNaN(parseInt(r.grace_minutes, 10)) ? 0 : parseInt(r.grace_minutes, 10),
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('employment_category_work_rules').upsert(payload, { onConflict: 'organization_id,category' })
    setSavingCat('')
    if (error) { toast.error('儲存失敗：' + error.message); return }
    toast.success(`已更新「${CATS.find(c => c.key === cat)?.label}」工時規則`)
    loadCatRules()
  }

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), [])
  const openEdit = (store) => {
    setEditingStore(store)
    setForm({
      clock_in_method: store.clock_in_method || 'any',
      lat: store.lat ?? '', lng: store.lng ?? '',
      clock_radius: store.clock_radius ?? 150,
      allowed_wifi: Array.isArray(store.allowed_wifi) ? store.allowed_wifi.join(', ') : '',
      early_clock_minutes: store.early_clock_minutes ?? 30,
    })
  }

  const handleGeocode = async () => {
    if (!editingStore?.address) return toast.error('此門市尚未設定地址，請先到「組織 → 門市」補填地址')
    setGeocoding(true)
    try {
      const { lat, lng, displayName } = await geocodeAddress(editingStore.address)
      set('lat', lat); set('lng', lng)
      toast.success(`已解析：${displayName.slice(0, 60)}`)
    } catch (err) { toast.error(err.message || '座標解析失敗') } finally { setGeocoding(false) }
  }

  const handleSubmit = async () => {
    const latVal = form.lat !== '' ? parseFloat(form.lat) : null
    const lngVal = form.lng !== '' ? parseFloat(form.lng) : null
    if (latVal !== null && (isNaN(latVal) || latVal < -90 || latVal > 90)) return toast.error('緯度須介於 -90 ~ 90')
    if (lngVal !== null && (isNaN(lngVal) || lngVal < -180 || lngVal > 180)) return toast.error('經度須介於 -180 ~ 180')
    if ((latVal !== null) !== (lngVal !== null)) return toast.error('緯度與經度必須同時填寫或同時留空')
    setSaving(true)
    const payload = {
      clock_in_method: form.clock_in_method,
      lat: latVal, lng: lngVal,
      clock_radius: parseInt(form.clock_radius) || 150,
      allowed_wifi: form.allowed_wifi ? form.allowed_wifi.split(',').map(s => s.trim()).filter(Boolean) : null,
      early_clock_minutes: Number.isNaN(parseInt(form.early_clock_minutes, 10)) ? 30 : parseInt(form.early_clock_minutes, 10),
    }
    try {
      const { data, error } = await updateStore(editingStore.id, payload)
      if (error) throw error
      setStores(prev => prev.map(s => s.id === editingStore.id ? { ...s, ...payload, ...(data || {}) } : s))
      setEditingStore(null)
      toast.success(`已更新「${editingStore.name}」的定位規則`)
    } catch (err) { toast.error('更新失敗：' + (err.message || '未知錯誤')) } finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⏰</span> 打卡規則設定</h2>
            <p>員工身分工時規則(全公司一組)＋各據點 GPS / WiFi 定位驗證</p>
          </div>
        </div>
      </div>

      {/* ── 身分工時規則 ── */}
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Building2 size={16} /> 員工身分工時規則
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          依員工身分套用(全公司一組)。<b>行政</b>用固定辦公時間＋彈性;<b>正職/兼職</b>走個人班表、可設遲到早退寬限;<b>計件</b>不計遲到早退。
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {CATS.map(c => {
            const Icon = c.icon
            const r = catRules[c.key] || {}
            return (
              <div key={c.key} className="card" style={{ padding: 16, borderTop: `3px solid ${c.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Icon size={16} style={{ color: c.color }} />
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{c.label}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, minHeight: 28 }}>{c.desc}</div>

                {c.readonly ? (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '10px 0' }}>按件計酬,不計遲到早退。</div>
                ) : (
                  <>
                    {c.hasHours && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <Field label="上班時間"><Time24 value={r.work_start || '09:00'} onChange={v => setCat(c.key, 'work_start', v)} /></Field>
                        <Field label="下班時間"><Time24 value={r.work_end || '18:00'} onChange={v => setCat(c.key, 'work_end', v)} /></Field>
                      </div>
                    )}
                    <Field label={c.hasHours ? '彈性(±分鐘,前後可浮動)' : '遲到早退寬限(分鐘)'}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input className="form-input" type="number" min={0} max={120} style={{ width: 90, textAlign: 'center' }}
                          value={r.grace_minutes ?? 0} onChange={e => setCat(c.key, 'grace_minutes', e.target.value)} />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>分{c.hasHours ? '(±)' : ''}</span>
                      </div>
                    </Field>
                    <button className="btn btn-sm btn-primary" onClick={() => saveCat(c.key)} disabled={savingCat === c.key}
                      style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Save size={12} /> {savingCat === c.key ? '儲存中…' : '儲存'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 各據點定位規則 ── */}
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <MapPin size={16} /> 各據點定位驗證
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>各門市 GPS 範圍 / WiFi 白名單 / 提前打卡容許(跟「地點」有關的驗證)。</div>
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>據點</th>
                <th>驗證方式</th>
                <th style={{ minWidth: 140 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> GPS 範圍</span></th>
                <th style={{ minWidth: 140 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Wifi size={12} /> WiFi 白名單</span></th>
                <th style={{ textAlign: 'center' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> 提前打卡</span></th>
                <th>位置狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {stores.map(store => {
                const status = configStatus(store), meta = STATUS_META[status]
                const hasGPS = !!(store.lat && store.lng), hasWifi = !!(store.allowed_wifi?.length)
                return (
                  <tr key={store.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{store.name}</div>
                      <span className={`badge ${store.store_type === 'headquarters' ? 'badge-purple' : 'badge-cyan'}`} style={{ fontSize: 10, marginTop: 2 }}>
                        {store.store_type === 'headquarters' ? '總部' : '門市'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{METHOD_LABELS[store.clock_in_method] || 'GPS 或 WiFi 擇一'}</td>
                    <td>
                      {hasGPS ? (
                        <div>
                          <span className="badge badge-success" style={{ fontSize: 11 }}><span className="badge-dot" />{store.clock_radius || 150} m</span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{parseFloat(store.lat).toFixed(5)}, {parseFloat(store.lng).toFixed(5)}</div>
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>未設定</span>}
                    </td>
                    <td>
                      {hasWifi ? (
                        <div>
                          <span className="badge" style={{ fontSize: 11, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>{store.allowed_wifi.length} 組 IP</span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={store.allowed_wifi.join(', ')}>{store.allowed_wifi.join(', ')}</div>
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>未設定</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{store.early_clock_minutes ?? 30}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>分</span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, background: meta.dim, color: meta.color, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.label}</span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(store)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pencil size={12} /> 編輯</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editingStore && (
        <Modal title={`定位規則 — ${editingStore.name}${editingStore.store_type === 'headquarters' ? '（總部）' : ''}`}
          onClose={() => setEditingStore(null)} onSubmit={handleSubmit} submitLabel={saving ? '儲存中…' : '儲存規則'}>
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>🔐 打卡驗證方式</div>
            <Field label="驗證模式">
              <select className="form-input" style={{ width: '100%' }} value={form.clock_in_method} onChange={e => set('clock_in_method', e.target.value)}>
                <option value="any">任一通過（GPS 或 WiFi）</option>
                <option value="gps_required">僅限 GPS</option>
                <option value="gps_or_wifi">GPS 或 WiFi 擇一</option>
              </select>
            </Field>
          </div>
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📍 GPS 打卡範圍</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="緯度 (Lat)"><input className="form-input" type="number" step="any" min={-90} max={90} style={{ width: '100%' }} placeholder="25.0330" value={form.lat} onChange={e => set('lat', e.target.value)} /></Field>
              <Field label="經度 (Lng)"><input className="form-input" type="number" step="any" min={-180} max={180} style={{ width: '100%' }} placeholder="121.5654" value={form.lng} onChange={e => set('lng', e.target.value)} /></Field>
              <Field label="允許範圍（公尺）"><input className="form-input" type="number" min={50} max={2000} style={{ width: '100%' }} placeholder="150" value={form.clock_radius} onChange={e => set('clock_radius', e.target.value)} /></Field>
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleGeocode} disabled={geocoding || !editingStore.address} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} />{geocoding ? '解析中…' : '從地址解析座標'}
              </button>
              {editingStore.address ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{editingStore.address}</span> : <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>⚠ 此門市尚未設定地址</span>}
            </div>
          </div>
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📶 WiFi IP 白名單</div>
            <Field label="允許的 IP 位址（逗號分隔）"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="203.69.180.0/24, 61.220.45.0/24" value={form.allowed_wifi} onChange={e => set('allowed_wifi', e.target.value)} /></Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>填此據點對外公共 IP 或網段(支援 CIDR)。連上此 WiFi 且 IP 符合即可打卡,與 GPS 擇一通過。</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>⏱️ 提前打卡容許</div>
            <Field label="提前打卡容許（分鐘）">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="form-input" type="number" min={0} max={120} style={{ width: 80, textAlign: 'center' }} value={form.early_clock_minutes} onChange={e => set('early_clock_minutes', e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>分鐘前可打卡</span>
              </div>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>💡 遲到早退/辦公時間規則已移到上方「員工身分工時規則」,依身分套用。</div>
          </div>
        </Modal>
      )}
    </div>
  )
}
