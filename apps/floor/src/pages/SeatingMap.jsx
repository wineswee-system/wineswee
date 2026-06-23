import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  getReservations, getResTables,
  checkInReservation, extendReservation, moveReservationTable, updateReservationStatus,
} from '../lib/db'
import { useStore } from '../contexts/StoreContext'
import { useAuth } from '../contexts/AuthContext'

const TILE_BG     = { available:'#f0fdf4', pending:'#fff7ed', confirmed:'#eff6ff', seated:'#ecfeff', expiring:'#fff7ed' }
const TILE_BORDER = { available:'#22c55e', pending:'#f97316', confirmed:'#3b82f6', seated:'#0891b2', expiring:'#f97316' }
const TILE_TEXT   = { available:'#22c55e', pending:'#f97316', confirmed:'#60a5fa', seated:'#38bdf8', expiring:'#fb923c' }

function tileStatus(tbl, rsvs, now) {
  const r = rsvs.find(r => r.table_id === tbl.id && ['confirmed','seated','pending'].includes(r.status))
  if (!r) return 'available'
  if (r.status === 'seated') {
    const endMs = new Date(r.seated_at).getTime() + (r.duration_hours + (r.extended_hours || 0)) * 3600000
    return (endMs - now) < 15 * 60000 ? 'expiring' : 'seated'
  }
  return r.status
}

export default function SeatingMap() {
  const { storeId } = useStore()
  const { employee } = useAuth()
  const [date, setDate]       = useState(() => new Date().toISOString().slice(0, 10))
  const [rsvs, setRsvs]       = useState([])
  const [tables, setTables]   = useState([])
  const [selected, setSelected] = useState(null)
  const [moveMode, setMoveMode] = useState(false)
  const [now, setNow]         = useState(Date.now())

  const load = useCallback(async () => {
    if (!storeId) return
    const [r, t] = await Promise.all([getReservations(storeId, date), getResTables(storeId)])
    setRsvs(r.data ?? [])
    setTables(t.data ?? [])
  }, [storeId, date])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!storeId) return
    const ch = supabase
      .channel('floor-seating')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `store_id=eq.${storeId}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [storeId, load])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const maxX = tables.reduce((m, t) => Math.max(m, t.x_pos ?? 0), 0)
  const maxY = tables.reduce((m, t) => Math.max(m, t.y_pos ?? 0), 0)

  const selRsv = selected
    ? rsvs.find(r => r.table_id === selected.id && ['confirmed','seated','pending'].includes(r.status))
    : null

  async function handleTileClick(tbl) {
    if (moveMode && selected && tbl.id !== selected.id && selRsv) {
      await moveReservationTable(selRsv.id, tbl.id, selected.id, employee?.id)
      load()
      setMoveMode(false)
      setSelected(tbl)
      return
    }
    setSelected(tbl)
    setMoveMode(false)
  }

  async function doAction(action) {
    if (!selRsv) return
    if (action === 'checkin')  await checkInReservation(selRsv.id, employee?.id)
    if (action === 'extend')   await extendReservation(selRsv.id, selRsv.extended_hours || 0, employee?.id)
    if (action === 'complete') await updateReservationStatus(selRsv.id, 'completed', employee?.id)
    if (action === 'noshow')   await updateReservationStatus(selRsv.id, 'no_show', employee?.id)
    if (action === 'move')     { setMoveMode(true); return }
    load()
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Floor plan */}
      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>
            座位地圖
            {moveMode && <span style={{ fontSize: 13, color: '#f97316', fontWeight: 400, marginLeft: 10 }}>— 點選目標桌位完成移桌</span>}
          </h1>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#111827', padding: '8px 12px', fontSize: 14, outline: 'none' }} />
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {[['available','空桌'],['pending','待確認'],['confirmed','已訂位'],['seated','入座中'],['expiring','即將到時']].map(([s, l]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: TILE_BORDER[s] }} />
              {l}
            </div>
          ))}
        </div>

        {tables.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14, textAlign: 'center', paddingTop: 60 }}>尚無桌位資料，請先在設定中新增桌位</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${maxX + 1}, 110px)`,
            gridTemplateRows: `repeat(${maxY + 1}, 90px)`,
            gap: 8,
          }}>
            {tables.map(tbl => {
              const status     = tileStatus(tbl, rsvs, now)
              const rsv        = rsvs.find(r => r.table_id === tbl.id && ['confirmed','seated','pending'].includes(r.status))
              const isSelected = selected?.id === tbl.id
              const endMs      = rsv?.seated_at ? new Date(rsv.seated_at).getTime() + (rsv.duration_hours + (rsv.extended_hours||0)) * 3600000 : 0
              const remMin     = endMs ? Math.round((endMs - now) / 60000) : null

              return (
                <div key={tbl.id} onClick={() => handleTileClick(tbl)} style={{
                  gridColumn: (tbl.x_pos ?? 0) + 1,
                  gridRow: (tbl.y_pos ?? 0) + 1,
                  background: TILE_BG[status],
                  border: `2px solid ${isSelected ? '#fff' : TILE_BORDER[status]}`,
                  borderRadius: tbl.shape === 'round' ? '50%' : tbl.shape === 'booth' ? '4px 4px 14px 14px' : 10,
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, padding: 6,
                  boxShadow: isSelected ? '0 0 0 3px rgba(255,255,255,0.2)' : moveMode ? '0 0 0 2px rgba(249,115,22,0.3)' : 'none',
                  transition: 'box-shadow 0.15s',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: TILE_TEXT[status] }}>T{tbl.table_number}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{tbl.capacity}人</div>
                  {rsv && (
                    <div style={{ fontSize: 11, color: TILE_TEXT[status], overflow: 'hidden', maxWidth: '90%', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {rsv.guest_name}
                    </div>
                  )}
                  {remMin !== null && (
                    <div style={{ fontSize: 10, color: remMin <= 15 ? '#f97316' : '#6b7280' }}>
                      {remMin > 0 ? `${remMin}分` : '已超時'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Action panel */}
      <div style={{ width: 256, flexShrink: 0, background: '#ffffff', borderLeft: '1px solid #e9ecf1', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        {!selected && (
          <div style={{ color: '#6b7280', fontSize: 13, marginTop: 48, textAlign: 'center' }}>點選桌位查看詳情</div>
        )}

        {selected && (
          <>
            <div style={{ paddingBottom: 12, borderBottom: '1px solid #e9ecf1' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>T{selected.table_number}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>容量 {selected.capacity} 人</div>
            </div>

            {!selRsv && (
              <div style={{ fontSize: 13, color: '#22c55e', background: 'rgba(34,197,94,0.08)', borderRadius: 8, padding: '10px 12px' }}>
                空桌，可接受入座
              </div>
            )}

            {selRsv && (
              <div style={{ background: '#f0f4f8', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{selRsv.guest_name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{selRsv.reservation_time?.slice(0,5)} · {selRsv.party_size}人</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {selRsv.duration_hours + (selRsv.extended_hours || 0)}h 用餐
                  {(selRsv.extended_hours || 0) > 0 && ` (延長 ${selRsv.extended_hours}h)`}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>📞 {selRsv.guest_phone}</div>
                {selRsv.special_requests && <div style={{ fontSize: 12, color: '#6b7280' }}>📝 {selRsv.special_requests}</div>}
              </div>
            )}

            {selRsv && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selRsv.status === 'confirmed' && (
                  <ABtn color="#0891b2" onClick={() => doAction('checkin')}>入座</ABtn>
                )}
                {selRsv.status === 'seated' && (<>
                  <ABtn color="#f97316" onClick={() => doAction('extend')}>延長 +1 小時</ABtn>
                  <ABtn color="#22c55e" onClick={() => doAction('complete')}>完成用餐</ABtn>
                  <ABtn color="#8b5cf6" onClick={() => doAction('move')}>
                    {moveMode ? '⬆ 請點選目標桌位' : '移桌'}
                  </ABtn>
                </>)}
                {['pending','confirmed'].includes(selRsv.status) && (
                  <ABtn color="#ef4444" onClick={() => doAction('noshow')}>未到場</ABtn>
                )}
              </div>
            )}

            <button onClick={() => { setSelected(null); setMoveMode(false) }}
              style={{ marginTop: 'auto', background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 8, color: '#6b7280', padding: '9px', fontSize: 13, cursor: 'pointer' }}>
              取消選取
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function ABtn({ color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: color, color: '#fff', border: 'none', borderRadius: 8,
      padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%',
    }}>
      {children}
    </button>
  )
}
