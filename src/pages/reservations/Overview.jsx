import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getReservations, getResTables, updateReservationStatus } from '../../lib/db/reservations'
import LoadingSpinner from '../../components/LoadingSpinner'
import { ConciergeBell, Users, AlertCircle, RefreshCw } from 'lucide-react'

const STATUS_COLOR = {
  pending:   { color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', label: '待確認' },
  confirmed: { color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)',   label: '已確認' },
  seated:    { color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)',   label: '已入座' },
  completed: { color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)',  label: '已完成' },
  cancelled: { color: 'var(--text-muted)',    dim: 'var(--bg-tertiary)',       label: '已取消' },
  no_show:   { color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)',    label: '未到場' },
}

function toMins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function todayStr() { return new Date().toISOString().split('T')[0] }

const HOUR_START = 9
const HOUR_END   = 23
const RANGE_MINS = (HOUR_END - HOUR_START) * 60
function pct(mins) { return Math.max(0, Math.min(100, ((mins - HOUR_START * 60) / RANGE_MINS) * 100)) }

export default function Overview() {
  const [stores, setStores]           = useState([])
  const [storeId, setStoreId]         = useState('')
  const [reservations, setReservations] = useState([])
  const [tables, setTables]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [nowMins, setNowMins]         = useState(0)
  const today = todayStr()

  useEffect(() => {
    const update = () => { const d = new Date(); setNowMins(d.getHours() * 60 + d.getMinutes()) }
    update()
    const t = setInterval(update, 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    supabase.from('stores').select('id,name').then(({ data }) => {
      const list = data || []
      setStores(list)
      if (list.length) setStoreId(list[0].id)
    })
  }, [])

  const loadData = () => {
    if (!storeId) return
    setLoading(true)
    Promise.all([getReservations(storeId, today), getResTables(storeId)])
      .then(([r, t]) => { setReservations(r.data || []); setTables(t.data || []) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [storeId]) // eslint-disable-line

  // Real-time
  useEffect(() => {
    if (!storeId) return
    const ch = supabase.channel('res-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `store_id=eq.${storeId}` },
        () => getReservations(storeId, today).then(({ data }) => setReservations(data || [])))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [storeId, today])

  const active  = reservations.filter(r => !['cancelled','no_show'].includes(r.status))
  const pending = active.filter(r => r.status === 'pending')
  const seated  = active.filter(r => r.status === 'seated')

  const quickStatus = async (id, status) => {
    await updateReservationStatus(id, status)
    loadData()
  }

  const hourLabels = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConciergeBell size={22} color="var(--accent-cyan)" />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>今日訂位總覽</h1>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{today}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={storeId} onChange={e => setStoreId(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14 }}
          >
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={loadData} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <RefreshCw size={13} /> 刷新
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: '今日訂位', value: active.length },
          { label: '待確認',   value: pending.length },
          { label: '已入座',   value: seated.length },
          { label: '總人數',   value: active.reduce((s, r) => s + r.guest_count, 0) },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: '18px 20px', border: '1px solid var(--border-primary)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Gantt */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden', marginBottom: 28 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>時間軸</div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900, padding: '12px 16px 16px' }}>
            {/* Hour header */}
            <div style={{ display: 'flex', marginLeft: 72, marginBottom: 4 }}>
              {hourLabels.map(h => (
                <div key={h} style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)' }}>{h}:00</div>
              ))}
            </div>
            {tables.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚未設定桌位 — 請先到「桌位設定」新增桌位</div>
            )}
            {tables.map(table => {
              const tRes = active.filter(r => r.table_id === table.id)
              return (
                <div key={table.id} style={{ display: 'flex', alignItems: 'center', height: 40, marginBottom: 4 }}>
                  <div style={{ width: 68, flexShrink: 0, fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {table.table_number}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 10, display: 'block' }}>{table.capacity}人</span>
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: 28, background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                    {hourLabels.map(h => (
                      <div key={h} style={{ position: 'absolute', left: `${((h - HOUR_START) / (HOUR_END - HOUR_START)) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--border-primary)', opacity: 0.35 }} />
                    ))}
                    {nowMins >= HOUR_START * 60 && nowMins <= HOUR_END * 60 && (
                      <div style={{ position: 'absolute', left: `${pct(nowMins)}%`, top: -3, bottom: -3, width: 2, background: 'var(--accent-red)', zIndex: 5, borderRadius: 1 }} />
                    )}
                    {tRes.map(res => {
                      const s = toMins(res.slot_time)
                      const e = s + (res.duration_hours + res.extended_hours) * 60
                      const sc = STATUS_COLOR[res.status] || STATUS_COLOR.pending
                      return (
                        <div key={res.id} title={`${res.guest_name} (${res.guest_count}人)`}
                          style={{ position: 'absolute', left: `${pct(s)}%`, width: `${pct(e) - pct(s)}%`, top: 2, bottom: 2, background: sc.color, borderRadius: 4, display: 'flex', alignItems: 'center', padding: '0 5px', overflow: 'hidden' }}>
                          <span style={{ fontSize: 10, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.guest_name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bottom two-column */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Pending */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={15} color="var(--accent-orange)" /> 待確認
            {pending.length > 0 && <span style={{ background: 'var(--accent-orange)', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{pending.length}</span>}
          </div>
          {pending.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>沒有待確認訂位</div>
            : pending.map(res => (
              <div key={res.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{res.guest_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{res.slot_time.slice(0,5)} · {res.guest_count}人 · {res.guest_phone}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => quickStatus(res.id, 'confirmed')} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>確認</button>
                  <button onClick={() => quickStatus(res.id, 'cancelled')} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>取消</button>
                </div>
              </div>
            ))
          }
        </div>

        {/* Seated */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={15} color="var(--accent-green)" /> 目前入座
          </div>
          {seated.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>目前無入座客人</div>
            : seated.map(res => {
              const tableName = res.res_tables?.table_number || '未指定'
              const totalH = res.duration_hours + res.extended_hours
              const endMs = res.seated_at ? new Date(res.seated_at).getTime() + totalH * 3600000 : null
              const remMins = endMs ? Math.round((endMs - Date.now()) / 60000) : null
              return (
                <div key={res.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                      {res.guest_name}
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>桌 {tableName}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{res.guest_count}人 · {res.slot_time.slice(0,5)} 入場</div>
                    {remMins !== null && (
                      <div style={{ fontSize: 11, marginTop: 2, color: remMins < 15 ? 'var(--accent-orange)' : 'var(--text-muted)', fontWeight: remMins < 15 ? 700 : 400 }}>
                        {remMins > 0 ? `剩 ${remMins} 分鐘` : '時間已到'}
                      </div>
                    )}
                  </div>
                  <button onClick={() => quickStatus(res.id, 'completed')} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--accent-green)', background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>完成</button>
                </div>
              )
            })
          }
        </div>
      </div>
    </div>
  )
}
