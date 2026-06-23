import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import {
  getReservations, getResTables,
  checkInReservation, extendReservation, updateReservationStatus, moveReservationTable,
} from '../../lib/db/reservations'
import LoadingSpinner from '../../components/LoadingSpinner'
import { RefreshCw, X, ArrowRight } from 'lucide-react'

const TILE_STYLE = {
  available: { bg: 'var(--accent-green-dim)',  border: 'var(--accent-green)',  text: 'var(--accent-green)',  label: '空桌' },
  booked:    { bg: 'var(--accent-blue-dim)',   border: 'var(--accent-blue)',   text: 'var(--accent-blue)',   label: '已訂位' },
  seated:    { bg: 'var(--accent-cyan-dim)',   border: 'var(--accent-cyan)',   text: 'var(--accent-cyan)',   label: '用餐中' },
  expiring:  { bg: 'var(--accent-orange-dim)', border: 'var(--accent-orange)', text: 'var(--accent-orange)', label: '即將結束' },
}

function todayStr() { return new Date().toISOString().split('T')[0] }

function tileStatus(table, activeRes) {
  const seated = activeRes.find(r => r.table_id === table.id && r.status === 'seated')
  if (seated) {
    const endMs = seated.seated_at
      ? new Date(seated.seated_at).getTime() + (seated.duration_hours + seated.extended_hours) * 3600000
      : null
    return endMs && (endMs - Date.now()) / 60000 < 15 ? 'expiring' : 'seated'
  }
  if (activeRes.find(r => r.table_id === table.id && r.status === 'confirmed')) return 'booked'
  return 'available'
}

function remainLabel(res) {
  if (!res.seated_at) return null
  const mins = Math.round((new Date(res.seated_at).getTime() + (res.duration_hours + res.extended_hours) * 3600000 - Date.now()) / 60000)
  return mins <= 0 ? '時間已到' : `剩 ${mins} 分`
}

export default function SeatingMap() {
  const [stores, setStores]             = useState([])
  const [storeId, setStoreId]           = useState('')
  const [date, setDate]                 = useState(todayStr())
  const [tables, setTables]             = useState([])
  const [reservations, setReservations] = useState([])
  const [loading, setLoading]           = useState(true)
  const [selected, setSelected]         = useState(null)
  const [moveMode, setMoveMode]         = useState(false)

  useEffect(() => {
    supabase.from('stores').select('id,name').then(({ data }) => {
      const list = data || []
      setStores(list)
      if (list.length) setStoreId(list[0].id)
    })
  }, [])

  const loadData = useCallback(() => {
    if (!storeId) return
    setLoading(true)
    Promise.all([getResTables(storeId), getReservations(storeId, date)])
      .then(([t, r]) => { setTables(t.data || []); setReservations(r.data || []) })
      .finally(() => setLoading(false))
  }, [storeId, date])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!storeId) return
    const ch = supabase.channel('seating-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `store_id=eq.${storeId}` },
        () => getReservations(storeId, date).then(({ data }) => setReservations(data || [])))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [storeId, date])

  // Re-render countdown every 30s
  useEffect(() => {
    const t = setInterval(() => setReservations(r => [...r]), 30000)
    return () => clearInterval(t)
  }, [])

  const activeRes = reservations.filter(r => !['cancelled','no_show','completed'].includes(r.status))
  const tableRes  = {}
  activeRes.forEach(r => { if (r.table_id) tableRes[r.table_id] = r })

  const maxX = Math.max(9, ...tables.map(t => t.x_pos))
  const maxY = Math.max(6, ...tables.map(t => t.y_pos))

  const selTable = tables.find(t => t.id === selected)
  const selRes   = selTable ? tableRes[selTable.id] : null

  const doAction = async (action, payload = {}) => {
    if (action === 'checkin')  await checkInReservation(payload.resId)
    if (action === 'extend')   await extendReservation(payload.resId, payload.ext)
    if (action === 'complete') await updateReservationStatus(payload.resId, 'completed')
    if (action === 'noshow')   await updateReservationStatus(payload.resId, 'no_show')
    if (action === 'move') {
      await moveReservationTable(payload.resId, payload.newTable, payload.oldTable)
      setMoveMode(false); setSelected(null)
    }
    loadData()
  }

  const handleTile = (table) => {
    if (moveMode && selRes) {
      if (table.id !== selected && table.capacity >= selRes.guest_count) {
        doAction('move', { resId: selRes.id, newTable: table.id, oldTable: selected })
      }
      return
    }
    setSelected(prev => prev === table.id ? null : table.id)
    setMoveMode(false)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>座位地圖</h1>
        <select value={storeId} onChange={e => { setStoreId(e.target.value); setSelected(null) }}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14 }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setSelected(null) }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14 }} />
        <button onClick={loadData} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <RefreshCw size={13} /> 刷新
        </button>
        {moveMode && (
          <span style={{ padding: '5px 12px', borderRadius: 8, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', fontWeight: 600, fontSize: 13 }}>
            點擊目標桌位以移動 ·&nbsp;
            <button onClick={() => setMoveMode(false)} style={{ border: 'none', background: 'none', color: 'var(--accent-orange)', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 700 }}>取消</button>
          </span>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(TILE_STYLE).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: v.bg, border: `2px solid ${v.border}` }} />
            <span style={{ color: 'var(--text-muted)' }}>{v.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

        {/* Map grid */}
        <div style={{ flex: 1, overflowX: 'auto' }}>
          {tables.length === 0
            ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>尚未設定桌位 — 請前往「桌位設定」新增桌位</div>
            : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${maxX + 1}, 116px)`,
                gridTemplateRows: `repeat(${maxY + 1}, 96px)`,
                gap: 8,
                minWidth: (maxX + 1) * 124,
              }}>
                {tables.map(table => {
                  const status = tileStatus(table, activeRes)
                  const ts = TILE_STYLE[status]
                  const res = tableRes[table.id]
                  const isSel = selected === table.id
                  const isMoveTarget = moveMode && table.id !== selected && selRes && table.capacity >= selRes.guest_count
                  return (
                    <div key={table.id} onClick={() => handleTile(table)} style={{
                      gridColumn: table.x_pos + 1,
                      gridRow: table.y_pos + 1,
                      background: ts.bg,
                      border: `2px solid ${isSel ? 'var(--accent-purple)' : isMoveTarget ? 'var(--accent-cyan)' : ts.border}`,
                      borderRadius: table.shape === 'round' ? '50%' : table.shape === 'booth' ? '4px 4px 14px 14px' : 10,
                      cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      padding: 8, transition: 'all 0.15s', userSelect: 'none',
                      boxShadow: isSel ? '0 0 0 3px var(--accent-purple-dim)' : isMoveTarget ? '0 0 0 3px var(--accent-cyan-dim)' : 'none',
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: ts.text }}>{table.table_number}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{table.capacity}人</div>
                      {res && (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 600, color: ts.text, marginTop: 3, maxWidth: 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {res.guest_name}
                          </div>
                          {(status === 'seated' || status === 'expiring') ? (
                            <div style={{ fontSize: 10, color: status === 'expiring' ? 'var(--accent-orange)' : 'var(--text-muted)', fontWeight: status === 'expiring' ? 700 : 400 }}>
                              {remainLabel(res)}
                            </div>
                          ) : (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{res.slot_time.slice(0,5)}</div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>

        {/* Action panel */}
        {selTable && (
          <div style={{ width: 272, background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', flexShrink: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>桌 {selTable.table_number}</span>
              <button onClick={() => { setSelected(null); setMoveMode(false) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={15}/></button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>容納 {selTable.capacity} 人</div>
              {selRes ? (
                <>
                  <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{selRes.guest_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{selRes.guest_count} 人 · {selRes.guest_phone}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selRes.slot_time.slice(0,5)} · {selRes.duration_hours + selRes.extended_hours}h</div>
                    {selRes.special_requests && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>{selRes.special_requests}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selRes.status === 'confirmed' && (
                      <button onClick={() => doAction('checkin', { resId: selRes.id })}
                        style={{ padding: 8, borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                        辦理入座 (Check In)
                      </button>
                    )}
                    {selRes.status === 'seated' && <>
                      <button onClick={() => doAction('extend', { resId: selRes.id, ext: selRes.extended_hours })}
                        style={{ padding: 8, borderRadius: 8, border: '1px solid var(--accent-purple)', background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                        延長 1 小時
                      </button>
                      <button onClick={() => doAction('complete', { resId: selRes.id })}
                        style={{ padding: 8, borderRadius: 8, border: 'none', background: 'var(--accent-green)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                        完成用餐
                      </button>
                    </>}
                    <button onClick={() => setMoveMode(true)}
                      style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                      <ArrowRight size={13} /> 移桌
                    </button>
                    {selRes.status !== 'completed' && (
                      <button onClick={() => doAction('noshow', { resId: selRes.id })}
                        style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>
                        未到場
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>此桌目前空桌</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
