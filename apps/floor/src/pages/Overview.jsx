import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getReservations, getResTables, updateReservationStatus } from '../lib/db'
import { useStore } from '../contexts/StoreContext'
import { useAuth } from '../contexts/AuthContext'

const HOUR_START = 9
const HOUR_END   = 23
const RANGE_MINS = (HOUR_END - HOUR_START) * 60
const pct = mins => ((mins - HOUR_START * 60) / RANGE_MINS) * 100

const STATUS_COLOR = {
  pending:   '#f97316',
  confirmed: '#3b82f6',
  seated:    '#0891b2',
  completed: '#22c55e',
  cancelled: '#64748b',
  no_show:   '#ef4444',
}

function toMins(timeStr) {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export default function Overview() {
  const { storeId } = useStore()
  const { employee } = useAuth()
  const [date, setDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [rsvs, setRsvs]     = useState([])
  const [tables, setTables] = useState([])
  const [now, setNow]       = useState(Date.now())

  const load = useCallback(async () => {
    if (!storeId) return
    const [r, t] = await Promise.all([
      getReservations(storeId, date),
      getResTables(storeId),
    ])
    setRsvs(r.data ?? [])
    setTables(t.data ?? [])
  }, [storeId, date])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!storeId) return
    const ch = supabase
      .channel('floor-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `store_id=eq.${storeId}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [storeId, load])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const pending   = rsvs.filter(r => r.status === 'pending')
  const confirmed = rsvs.filter(r => r.status === 'confirmed')
  const seated    = rsvs.filter(r => r.status === 'seated')
  const active    = rsvs.filter(r => !['cancelled', 'no_show', 'completed'].includes(r.status))

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes()
  const nowPct  = pct(nowMins)

  async function act(id, status) {
    await updateReservationStatus(id, status, employee?.id)
    load()
  }

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>今日總覽</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#111827', padding: '8px 12px', fontSize: 14, outline: 'none' }} />
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: '待確認',  value: pending.length,   color: '#f97316' },
          { label: '已確認',  value: confirmed.length, color: '#3b82f6' },
          { label: '已入座',  value: seated.length,    color: '#0891b2' },
          { label: '今日總計', value: rsvs.length,     color: '#22c55e' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Gantt */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 12 }}>時段表</div>
        <div style={{ display: 'flex', marginLeft: 80, marginBottom: 4 }}>
          {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => (
            <div key={i} style={{ flex: 1, fontSize: 11, color: '#6b7280' }}>{HOUR_START + i}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tables.map(tbl => {
            const tblRsvs = active.filter(r => r.table_id === tbl.id)
            return (
              <div key={tbl.id} style={{ display: 'flex', alignItems: 'center', height: 30 }}>
                <div style={{ width: 72, flexShrink: 0, fontSize: 12, color: '#374151', fontWeight: 600 }}>T{tbl.table_number}</div>
                <div style={{ flex: 1, position: 'relative', height: '100%', background: '#f0f4f8', borderRadius: 4 }}>
                  {nowPct >= 0 && nowPct <= 100 && (
                    <div style={{ position: 'absolute', left: `${nowPct}%`, top: 0, bottom: 0, width: 1.5, background: '#ef4444', zIndex: 3 }} />
                  )}
                  {tblRsvs.map(r => {
                    const s = toMins(r.reservation_time)
                    const e = s + (r.duration_hours + (r.extended_hours || 0)) * 60
                    const l = Math.max(0, pct(s))
                    const w = Math.min(100 - l, pct(e) - l)
                    if (w <= 0) return null
                    return (
                      <div key={r.id} title={`${r.guest_name} (${r.party_size}人)`}
                        style={{
                          position: 'absolute', left: `${l}%`, width: `${w}%`,
                          top: 2, bottom: 2, borderRadius: 3,
                          background: STATUS_COLOR[r.status] ?? '#64748b',
                          display: 'flex', alignItems: 'center', paddingLeft: 4,
                          fontSize: 10, color: '#fff', overflow: 'hidden', whiteSpace: 'nowrap',
                        }}>
                        {r.guest_name}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {tables.length === 0 && (
            <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>尚無桌位資料</div>
          )}
        </div>
      </div>

      {/* Bottom panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Pending */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f97316', marginBottom: 14 }}>待確認 ({pending.length})</div>
          {pending.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>無待確認訂位</div>}
          {pending.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e9ecf1' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{r.guest_name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{r.reservation_time?.slice(0, 5)} · {r.party_size}人</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn color="#3b82f6" onClick={() => act(r.id, 'confirmed')}>確認</Btn>
                <Btn color="#64748b" onClick={() => act(r.id, 'cancelled')}>取消</Btn>
              </div>
            </div>
          ))}
        </div>

        {/* Seated */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0891b2', marginBottom: 14 }}>已入座 ({seated.length})</div>
          {seated.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>無入座中訂位</div>}
          {seated.map(r => {
            const endMs  = new Date(r.seated_at).getTime() + (r.duration_hours + (r.extended_hours || 0)) * 3600000
            const remMin = Math.round((endMs - now) / 60000)
            const urgent = remMin <= 15
            return (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e9ecf1' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{r.guest_name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>T{r.res_tables?.table_number} · {r.party_size}人</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: urgent ? '#f97316' : '#0891b2' }}>
                  {remMin > 0 ? `剩 ${remMin} 分` : '已超時'}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Btn({ color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: color, color: '#fff', border: 'none',
      borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    }}>
      {children}
    </button>
  )
}
