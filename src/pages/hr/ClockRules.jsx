import { useState, useEffect, useCallback } from 'react'
import { Pencil, MapPin, Wifi, Clock, Building2 } from 'lucide-react'
import { getStores, updateStore } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { geocodeAddress } from '../../lib/geocoding'
import { toast } from '../../lib/toast'

// ─── helpers ────────────────────────────────────────────────────────────────

const EMPTY_RULES = {
  clock_in_method:            'any',
  lat:                        '',
  lng:                        '',
  clock_radius:               150,
  allowed_wifi:               '',
  late_tolerance_minutes:     5,
  early_clock_minutes:        30,
  // office hours
  has_office_hours:           false,
  office_hours_start:         '09:00',
  office_hours_end:           '18:00',
  office_hours_break_minutes: 60,
}

const METHOD_LABELS = {
  any:          'GPS 或 WiFi 擇一',
  gps_required: '僅限 GPS',
  gps_or_wifi:  'GPS 或 WiFi 擇一',
}

/** "09:00:00" → "09:00" for <input type="time"> */
const toHHMM = (t) => (t ? String(t).slice(0, 5) : '')

/** "09:00" → "9:00 AM"  /  "18:00" → "6:00 PM" */
function toAmPm(hhmm) {
  if (!hhmm) return ''
  const [hStr, mStr = '00'] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${mStr} ${suffix}`
}

/** Net work minutes between two HH:MM strings, minus break */
function calcNetMinutes(start, end, breakMin) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm) - (parseInt(breakMin) || 0)
}

function configStatus(store) {
  const hasGPS  = !!(store.lat && store.lng)
  const hasWifi = !!(store.allowed_wifi?.length)
  if (hasGPS && hasWifi) return 'full'
  if (hasGPS || hasWifi) return 'partial'
  return 'none'
}

const STATUS_META = {
  full:    { label: 'GPS + WiFi', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  partial: { label: '部分設定',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  none:    { label: '未設定',     color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
}

// ─── component ───────────────────────────────────────────────────────────────

export default function ClockRules() {
  const [stores,       setStores]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [editingStore, setEditingStore] = useState(null)
  const [form,         setForm]         = useState(EMPTY_RULES)
  const [geocoding,    setGeocoding]    = useState(false)
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    getStores()
      .then(({ data }) => setStores(data || []))
      .finally(() => setLoading(false))
  }, [])

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), [])

  const openEdit = (store) => {
    setEditingStore(store)
    setForm({
      clock_in_method:            store.clock_in_method            || 'any',
      lat:                        store.lat                        ?? '',
      lng:                        store.lng                        ?? '',
      clock_radius:               store.clock_radius               ?? 150,
      allowed_wifi:               Array.isArray(store.allowed_wifi) ? store.allowed_wifi.join(', ') : '',
      late_tolerance_minutes:     store.late_tolerance_minutes     ?? 5,
      early_clock_minutes:        store.early_clock_minutes        ?? 30,
      has_office_hours:           store.has_office_hours           ?? false,
      office_hours_start:         toHHMM(store.office_hours_start)         || '09:00',
      office_hours_end:           toHHMM(store.office_hours_end)           || '18:00',
      office_hours_break_minutes: store.office_hours_break_minutes ?? 60,
    })
  }

  const handleGeocode = async () => {
    if (!editingStore?.address) return toast.error('此門市尚未設定地址，請先到「組織 → 門市」補填地址')
    setGeocoding(true)
    try {
      const { lat, lng, displayName } = await geocodeAddress(editingStore.address)
      set('lat', lat)
      set('lng', lng)
      toast.success(`已解析：${displayName.slice(0, 60)}`)
    } catch (err) {
      toast.error(err.message || '座標解析失敗')
    } finally {
      setGeocoding(false)
    }
  }

  const handleSubmit = async () => {
    setSaving(true)
    const payload = {
      clock_in_method:            form.clock_in_method,
      lat:                        form.lat !== '' ? parseFloat(form.lat) : null,
      lng:                        form.lng !== '' ? parseFloat(form.lng) : null,
      clock_radius:               parseInt(form.clock_radius)           || 150,
      allowed_wifi:               form.allowed_wifi
                                    ? form.allowed_wifi.split(',').map(s => s.trim()).filter(Boolean)
                                    : null,
      late_tolerance_minutes:     parseInt(form.late_tolerance_minutes) || 5,
      early_clock_minutes:        parseInt(form.early_clock_minutes)    || 30,
      has_office_hours:           form.has_office_hours,
      office_hours_start:         form.has_office_hours ? form.office_hours_start : null,
      office_hours_end:           form.has_office_hours ? form.office_hours_end   : null,
      office_hours_break_minutes: form.has_office_hours
                                    ? (parseInt(form.office_hours_break_minutes) || 60)
                                    : null,
    }
    try {
      const { data, error } = await updateStore(editingStore.id, payload)
      if (error) throw error
      setStores(prev => prev.map(s => s.id === editingStore.id ? { ...s, ...payload, ...(data || {}) } : s))
      setEditingStore(null)
      toast.success(`已更新「${editingStore.name}」的打卡規則`)
    } catch (err) {
      toast.error('更新失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  const counts = {
    full:        stores.filter(s => configStatus(s) === 'full').length,
    partial:     stores.filter(s => configStatus(s) === 'partial').length,
    none:        stores.filter(s => configStatus(s) === 'none').length,
    officeHours: stores.filter(s => s.has_office_hours).length,
  }

  return (
    <div className="fade-in">
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⏰</span> 打卡規則設定</h2>
            <p>集中管理各據點 GPS 範圍、WiFi 白名單、辦公時間及遲到容許等打卡驗證規則</p>
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">GPS + WiFi 均設定</div>
          <div className="stat-card-value">{counts.full}</div>
          <div className="stat-card-sub">完整雙重驗證</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">位置部分設定</div>
          <div className="stat-card-value">{counts.partial}</div>
          <div className="stat-card-sub">GPS 或 WiFi 其中一項</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">位置未設定</div>
          <div className="stat-card-value">{counts.none}</div>
          <div className="stat-card-sub">無位置限制，任意打卡</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">已啟用辦公時間</div>
          <div className="stat-card-value">{counts.officeHours}</div>
          <div className="stat-card-sub">固定上下班時段</div>
        </div>
      </div>

      {/* ── Main table ── */}
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>據點</th>
                <th>驗證方式</th>
                <th style={{ minWidth: 140 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> GPS 範圍</span>
                </th>
                <th style={{ minWidth: 140 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Wifi size={12} /> WiFi 白名單</span>
                </th>
                <th style={{ minWidth: 160 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building2 size={12} /> 辦公時間</span>
                </th>
                <th style={{ textAlign: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> 遲到容許</span>
                </th>
                <th style={{ textAlign: 'center' }}>提前打卡</th>
                <th>位置狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {stores.map(store => {
                const status  = configStatus(store)
                const meta    = STATUS_META[status]
                const hasGPS  = !!(store.lat && store.lng)
                const hasWifi = !!(store.allowed_wifi?.length)
                const startFmt = toAmPm(toHHMM(store.office_hours_start))
                const endFmt   = toAmPm(toHHMM(store.office_hours_end))

                return (
                  <tr key={store.id}>
                    {/* 據點 */}
                    <td>
                      <div style={{ fontWeight: 600 }}>{store.name}</div>
                      <span className={`badge ${store.store_type === 'headquarters' ? 'badge-purple' : 'badge-cyan'}`} style={{ fontSize: 10, marginTop: 2 }}>
                        {store.store_type === 'headquarters' ? '總部' : '門市'}
                      </span>
                    </td>

                    {/* 驗證方式 */}
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {METHOD_LABELS[store.clock_in_method] || 'GPS 或 WiFi 擇一'}
                    </td>

                    {/* GPS */}
                    <td>
                      {hasGPS ? (
                        <div>
                          <span className="badge badge-success" style={{ fontSize: 11 }}>
                            <span className="badge-dot" />{store.clock_radius || 150} m
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                            {parseFloat(store.lat).toFixed(5)}, {parseFloat(store.lng).toFixed(5)}
                          </div>
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>未設定</span>}
                    </td>

                    {/* WiFi */}
                    <td>
                      {hasWifi ? (
                        <div>
                          <span className="badge" style={{ fontSize: 11, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>
                            {store.allowed_wifi.length} 組 IP
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={store.allowed_wifi.join(', ')}>
                            {store.allowed_wifi.join(', ')}
                          </div>
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>未設定</span>}
                    </td>

                    {/* 辦公時間 */}
                    <td>
                      {store.has_office_hours ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {startFmt} – {endFmt}
                          </div>
                          {store.office_hours_break_minutes != null && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                              休息 {store.office_hours_break_minutes} 分鐘
                            </div>
                          )}
                        </div>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                    </td>

                    {/* 遲到容許 */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{store.late_tolerance_minutes ?? 5}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>分</span>
                    </td>

                    {/* 提前打卡 */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{store.early_clock_minutes ?? 30}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>分</span>
                    </td>

                    {/* 位置狀態 */}
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, background: meta.dim, color: meta.color, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {meta.label}
                      </span>
                    </td>

                    {/* 操作 */}
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(store)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Pencil size={12} /> 編輯規則
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editingStore && (
        <Modal
          title={`打卡規則 — ${editingStore.name}${editingStore.store_type === 'headquarters' ? '（總部）' : ''}`}
          onClose={() => setEditingStore(null)}
          onSubmit={handleSubmit}
          submitLabel={saving ? '儲存中…' : '儲存規則'}
        >
          {/* ── 驗證方式 ── */}
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

          {/* ── 辦公時間 ── */}
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>🏢 固定辦公時間</div>

            {/* Toggle switch */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 14 }}>
              <div
                role="switch"
                aria-checked={form.has_office_hours}
                onClick={() => set('has_office_hours', !form.has_office_hours)}
                style={{
                  width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                  transition: 'background 0.2s',
                  background: form.has_office_hours ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                  position: 'relative', flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 3,
                  left: form.has_office_hours ? 21 : 3,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                {form.has_office_hours
                  ? '已啟用固定辦公時間'
                  : '停用（依員工個人排班判斷）'}
              </span>
            </label>

            {/* Time / break inputs — only when enabled */}
            {form.has_office_hours && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="上班時間">
                    <input
                      className="form-input"
                      type="time"
                      style={{ width: '100%' }}
                      value={form.office_hours_start}
                      onChange={e => set('office_hours_start', e.target.value)}
                    />
                  </Field>
                  <Field label="下班時間">
                    <input
                      className="form-input"
                      type="time"
                      style={{ width: '100%' }}
                      value={form.office_hours_end}
                      onChange={e => set('office_hours_end', e.target.value)}
                    />
                  </Field>
                  <Field label="休息時間（分鐘）">
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      max={180}
                      style={{ width: '100%', textAlign: 'center' }}
                      placeholder="60"
                      value={form.office_hours_break_minutes}
                      onChange={e => set('office_hours_break_minutes', e.target.value)}
                    />
                  </Field>
                </div>

                {/* Live net hours preview */}
                {(() => {
                  const net = calcNetMinutes(form.office_hours_start, form.office_hours_end, form.office_hours_break_minutes)
                  const label = net > 0 ? `${Math.floor(net / 60)} 小時 ${net % 60} 分` : '—'
                  return (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-tertiary)', fontSize: 12, color: 'var(--text-secondary)' }}>
                      📋 標準班別：{toAmPm(form.office_hours_start)} – {toAmPm(form.office_hours_end)}
                      　淨工時 <strong style={{ color: 'var(--accent-cyan)' }}>{label}</strong>
                      　（扣除 {form.office_hours_break_minutes} 分鐘休息）
                      <br />
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        💡 員工無個人排班時，系統以此時間判斷遲到 / 早退
                      </span>
                    </div>
                  )
                })()}
              </>
            )}
          </div>

          {/* ── GPS ── */}
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📍 GPS 打卡範圍</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="緯度 (Lat)">
                <input className="form-input" type="number" step="any" style={{ width: '100%' }} placeholder="25.0330" value={form.lat} onChange={e => set('lat', e.target.value)} />
              </Field>
              <Field label="經度 (Lng)">
                <input className="form-input" type="number" step="any" style={{ width: '100%' }} placeholder="121.5654" value={form.lng} onChange={e => set('lng', e.target.value)} />
              </Field>
              <Field label="允許範圍（公尺）">
                <input className="form-input" type="number" min={50} max={2000} style={{ width: '100%' }} placeholder="150" value={form.clock_radius} onChange={e => set('clock_radius', e.target.value)} />
              </Field>
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleGeocode} disabled={geocoding || !editingStore.address} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} />{geocoding ? '解析中…' : '從地址解析座標'}
              </button>
              {editingStore.address
                ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{editingStore.address}</span>
                : <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>⚠ 此門市尚未設定地址</span>}
            </div>
          </div>

          {/* ── WiFi ── */}
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📶 WiFi IP 白名單</div>
            <Field label="允許的 IP 位址（逗號分隔）">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="203.69.180.0/24, 61.220.45.0/24, 192.168.1.1" value={form.allowed_wifi} onChange={e => set('allowed_wifi', e.target.value)} />
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              填入此據點對外的公共 IP 或網段（支援 CIDR，如 <code>203.69.0.0/16</code>）。員工連上此 WiFi 時 IP 符合即可打卡，與 GPS 擇一通過即可。
            </div>
          </div>

          {/* ── 遲到 / 提前 ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>⏱️ 遲到與提前打卡容許</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="遲到容許（分鐘）">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="form-input" type="number" min={0} max={60} style={{ width: 80, textAlign: 'center' }} value={form.late_tolerance_minutes} onChange={e => set('late_tolerance_minutes', e.target.value)} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>分鐘內不算遲到</span>
                </div>
              </Field>
              <Field label="提前打卡容許（分鐘）">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="form-input" type="number" min={0} max={120} style={{ width: 80, textAlign: 'center' }} value={form.early_clock_minutes} onChange={e => set('early_clock_minutes', e.target.value)} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>分鐘前可打卡</span>
                </div>
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
