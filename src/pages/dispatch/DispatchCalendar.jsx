import { useState, useEffect, useMemo } from 'react'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import {
  getDispatchSchedules,
  getDispatchRoutes,
  getCarriers,
  createDispatchSchedule,
} from '../../lib/db/dispatch'

const DAYS_ZH = ['一', '二', '三', '四', '五', '六', '日']

function getMondayOf(d) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmtMD(d) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function fmtYMD(d) {
  return `${d.getFullYear()}/${fmtMD(d)}`
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const BLANK_FORM = { date: '', carrier_id: '', pickup_from: '', pickup_to: '', dock_door: '', estimated_pieces: '' }

export default function DispatchCalendar() {
  const orgId = useOrgId()
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()))
  const [schedules, setSchedules] = useState([])
  const [routes, setRoutes] = useState([])
  const [carriers, setCarriers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    Promise.all([
      getDispatchSchedules(orgId),
      getDispatchRoutes(orgId),
      getCarriers(orgId),
    ]).then(([s, r, c]) => {
      setSchedules(s.data || [])
      setRoutes(r.data || [])
      setCarriers(c.data || [])
    }).catch(() => toast.error('資料載入失敗')).finally(() => setLoading(false))
  }, [orgId])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const weekEnd = weekDays[6]
  const weekLabel = `${fmtYMD(weekStart)} ~ ${fmtYMD(weekEnd)}`

  const handleSubmit = async () => {
    if (!form.date || !form.carrier_id) { toast.error('請填寫日期與物流商'); return false }
    const { error } = await createDispatchSchedule({ ...form, org_id: orgId })
    if (error) { toast.error('新增失敗'); return false }
    const { data } = await getDispatchSchedules(orgId)
    setSchedules(data || [])
    setShowModal(false)
    setForm(BLANK_FORM)
    toast.success('排程已新增')
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <h2><span className="header-icon">📅</span> 配送排程日曆</h2>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ 新增排程</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <button className="btn btn-secondary" onClick={() => setWeekStart(d => addDays(d, -7))}>← 上一週</button>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, flex: 1, textAlign: 'center' }}>{weekLabel}</span>
          <button className="btn btn-secondary" onClick={() => setWeekStart(d => addDays(d, 7))}>下一週 →</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {weekDays.map((day, idx) => {
          const dateStr = toDateStr(day)
          const daySchedules = schedules.filter(s => s.schedule_date === dateStr)
          const dayRoutes = routes.filter(r => r.route_date === dateStr)
          const isToday = toDateStr(new Date()) === dateStr

          return (
            <div key={dateStr} style={{
              background: 'var(--bg-elevated)', borderRadius: 8,
              border: isToday ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
              minHeight: 160, display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                padding: '6px 8px', borderBottom: '1px solid var(--border-medium)',
                background: isToday ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                borderRadius: '8px 8px 0 0',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>週{DAYS_ZH[idx]}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: isToday ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{fmtMD(day)}</div>
              </div>
              <div style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                {daySchedules.map((s, i) => {
                  const carrier = carriers.find(c => c.id === s.carrier_id)
                  return (
                    <div key={i} style={{
                      background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                      borderRadius: 4, padding: '3px 6px', fontSize: 11, fontWeight: 500,
                    }}>
                      {carrier?.name || '物流商'} {s.pickup_from}–{s.pickup_to}
                    </div>
                  )
                })}
                {dayRoutes.map((r, i) => (
                  <div key={i} style={{
                    background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)',
                    borderRadius: 4, padding: '3px 6px', fontSize: 11, fontWeight: 500,
                  }}>
                    {r.route_number} {r.driver_name}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <Modal
          title="新增攬收排程"
          onClose={() => { setShowModal(false); setForm(BLANK_FORM) }}
          onSubmit={handleSubmit}
          submitLabel="新增"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="日期" required>
              <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
            <Field label="物流商" required>
              <select className="form-input" value={form.carrier_id} onChange={e => set('carrier_id', e.target.value)}>
                <option value="">請選擇物流商</option>
                {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="攬收開始時間">
                <input className="form-input" type="time" value={form.pickup_from} onChange={e => set('pickup_from', e.target.value)} />
              </Field>
              <Field label="截止時間">
                <input className="form-input" type="time" value={form.pickup_to} onChange={e => set('pickup_to', e.target.value)} />
              </Field>
            </div>
            <Field label="出貨口">
              <input className="form-input" type="text" value={form.dock_door} onChange={e => set('dock_door', e.target.value)} placeholder="例：A1" />
            </Field>
            <Field label="預計件數">
              <input className="form-input" type="number" min="0" value={form.estimated_pieces} onChange={e => set('estimated_pieces', e.target.value)} placeholder="0" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
