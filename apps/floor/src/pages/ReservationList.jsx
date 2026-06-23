import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import {
  getReservations, getResTables, updateReservationStatus,
  checkInReservation, extendReservation, moveReservationTable,
  createReservation, updateReservation, deleteReservation, getAvailableSlots,
  getChangelogs,
} from '../lib/db'
import { useStore } from '../contexts/StoreContext'
import { useAuth } from '../contexts/AuthContext'

const STATUS_COLOR = { pending:'#f97316', confirmed:'#3b82f6', seated:'#0891b2', completed:'#22c55e', cancelled:'#374151', no_show:'#ef4444' }
const STATUS_LABEL = { pending:'待確認', confirmed:'已確認', seated:'已入座', completed:'已完成', cancelled:'已取消', no_show:'未到場' }

function genCode() { return Math.random().toString(36).slice(2, 8).toUpperCase() }

export default function ReservationList() {
  const { storeId } = useStore()
  const { employee } = useAuth()
  const [date, setDate]         = useState(() => new Date().toISOString().slice(0, 10))
  const [statusFilter, setStatus] = useState('all')
  const [search, setSearch]     = useState('')
  const [rsvs, setRsvs]         = useState([])
  const [tables, setTables]     = useState([])
  const [expanded, setExpanded]   = useState(null)
  const [showWalkin, setShowWalkin] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  const load = useCallback(async () => {
    if (!storeId) return
    const [r, t] = await Promise.all([getReservations(storeId, date), getResTables(storeId)])
    setRsvs(r.data ?? [])
    setTables(t.data ?? [])
  }, [storeId, date])

  useEffect(() => { load() }, [load])

  const filtered = rsvs.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (search && !r.guest_name?.includes(search) && !r.guest_phone?.includes(search)) return false
    return true
  })

  const eid = employee?.id

  async function act(id, action, payload) {
    if (action === 'status')  await updateReservationStatus(id, payload, eid)
    if (action === 'checkin') await checkInReservation(id, eid)
    if (action === 'extend')  await extendReservation(id, payload, eid)
    if (action === 'move')    await moveReservationTable(id, payload.newId, payload.oldId, eid)
    if (action === 'delete')  await deleteReservation(id, eid)
    load()
  }

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#e5e7eb' }}>訂位清單</h1>
        <button onClick={() => setShowWalkin(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={16} />新增訂位
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INPUT} />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }} />
          <input placeholder="搜尋姓名 / 手機" value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...INPUT, paddingLeft: 32 }} />
        </div>
        <select value={statusFilter} onChange={e => setStatus(e.target.value)} style={INPUT}>
          <option value="all">全部狀態</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ color: '#4b5563', fontSize: 14, textAlign: 'center', padding: '48px 0' }}>無符合的訂位</div>
        )}
        {filtered.map(r => (
          <RsvRow key={r.id} r={r} tables={tables}
            expanded={expanded === r.id}
            onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
            onAct={act}
            onEdit={() => setEditTarget(r)} />
        ))}
      </div>

      {showWalkin && (
        <WalkinModal storeId={storeId} date={date} tables={tables} employeeId={eid}
          onClose={() => setShowWalkin(false)}
          onCreated={() => { setShowWalkin(false); load() }} />
      )}

      {editTarget && (
        <EditModal r={editTarget} tables={tables} employeeId={eid}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load() }} />
      )}
    </div>
  )
}

const ACTION_LABEL = {
  created: '建立', updated: '編輯', status_changed: '狀態變更',
  checked_in: '入座', extended: '延長', table_moved: '移桌', deleted: '刪除',
}

function RsvRow({ r, tables, expanded, onToggle, onAct, onEdit }) {
  const [moveTarget, setMoveTarget] = useState('')
  const [logs, setLogs] = useState([])
  const suitable = tables.filter(t => t.capacity >= r.party_size)

  useEffect(() => {
    if (expanded) {
      getChangelogs(r.id).then(({ data }) => setLogs(data ?? []))
    }
  }, [expanded, r.id])

  return (
    <div style={{ background: '#1e2232', border: '1px solid #2d3148', borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', cursor: 'pointer', gap: 12 }}>
        <span style={{
          padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, flexShrink: 0,
          background: (STATUS_COLOR[r.status] ?? '#374151') + '22',
          color: STATUS_COLOR[r.status] ?? '#9ca3af',
        }}>
          {STATUS_LABEL[r.status] ?? r.status}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>{r.guest_name}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {r.reservation_time?.slice(0, 5)} · {r.party_size}人 · {r.duration_hours}h
            {r.res_tables ? ` · T${r.res_tables.table_number}` : ''}
          </div>
        </div>
        <div style={{ color: '#4b5563' }}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #1f2336' }}>
          <div style={{ paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {r.status === 'pending'   && <Btn color="#3b82f6" onClick={() => onAct(r.id, 'status', 'confirmed')}>確認</Btn>}
            {r.status === 'confirmed' && <Btn color="#0891b2" onClick={() => onAct(r.id, 'checkin')}>入座</Btn>}
            {r.status === 'seated'    && <Btn color="#f97316" onClick={() => onAct(r.id, 'extend', r.extended_hours || 0)}>延長 +1h</Btn>}
            {r.status === 'seated'    && <Btn color="#22c55e" onClick={() => onAct(r.id, 'status', 'completed')}>完成</Btn>}
            {['pending','confirmed'].includes(r.status) && <Btn color="#ef4444" onClick={() => onAct(r.id, 'status', 'no_show')}>未到</Btn>}
            {['pending','confirmed','seated'].includes(r.status) && <Btn color="#374151" onClick={() => onAct(r.id, 'status', 'cancelled')}>取消</Btn>}
            <Btn color="#374151" onClick={onEdit}><Pencil size={12} style={{ display:'inline', verticalAlign:'middle', marginRight:4 }} />編輯</Btn>
            <Btn color="#7f1d1d" onClick={() => { if (window.confirm('確定刪除此訂位？此動作無法復原。')) onAct(r.id, 'delete') }}>
              <Trash2 size={12} style={{ display:'inline', verticalAlign:'middle', marginRight:4 }} />刪除
            </Btn>
          </div>

          {r.status === 'seated' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <select value={moveTarget} onChange={e => setMoveTarget(e.target.value)} style={{ ...INPUT, flex: 1 }}>
                <option value="">移桌：選擇目標桌位</option>
                {suitable.filter(t => t.id !== r.table_id).map(t => (
                  <option key={t.id} value={t.id}>T{t.table_number} ({t.capacity}人)</option>
                ))}
              </select>
              <Btn color="#0891b2" onClick={() => {
                if (moveTarget) { onAct(r.id, 'move', { newId: moveTarget, oldId: r.table_id }); setMoveTarget('') }
              }}>移桌</Btn>
            </div>
          )}

          <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>📞 {r.guest_phone}</span>
            {r.guest_email && <span>✉ {r.guest_email}</span>}
            {r.special_requests && <span>📝 {r.special_requests}</span>}
            <span style={{ fontFamily: 'monospace' }}>#{r.confirmation_code}</span>
          </div>

          {logs.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid #1f2336', paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: '#4b5563', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>變更記錄</div>
              {logs.map(l => (
                <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#6b7280', padding: '4px 0', borderBottom: '1px solid #1a1f30' }}>
                  <span style={{ color: '#4b5563', flexShrink: 0 }}>
                    {new Date(l.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ color: '#9ca3af', flexShrink: 0 }}>{ACTION_LABEL[l.action] ?? l.action}</span>
                  {l.employees?.name && <span style={{ color: '#6b7280' }}>by {l.employees.name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WalkinModal({ storeId, date, tables, employeeId, onClose, onCreated }) {
  const [partySize, setPartySize] = useState(2)
  const [duration, setDuration]   = useState(1)
  const [slots, setSlots]         = useState([])
  const [slot, setSlot]           = useState('')
  const [tableId, setTableId]     = useState('')
  const [guestName, setGuestName] = useState('')
  const [phone, setPhone]         = useState('')
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    if (!storeId || !date) return
    setSlot('')
    getAvailableSlots(storeId, date, partySize, duration).then(({ data }) => setSlots(data ?? []))
  }, [storeId, date, partySize, duration])

  async function submit() {
    if (!guestName || !phone || !slot) return
    setLoading(true)
    await createReservation({
      store_id: storeId, reservation_date: date, reservation_time: slot,
      party_size: partySize, duration_hours: duration,
      table_id: tableId || null,
      guest_name: guestName, guest_phone: phone,
      confirmation_code: genCode(), status: 'confirmed',
      source: 'walk_in',
    }, employeeId)
    setLoading(false)
    onCreated()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#1e2232', border: '1px solid #2d3148', borderRadius: 16, padding: 28, width: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 20 }}>新增訂位</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="人數">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[1,2,3,4,5,6,7,8].map(n => (
                <button key={n} onClick={() => setPartySize(n)}
                  style={{ ...PILL, background: n === partySize ? '#0891b2' : '#141720', color: n === partySize ? '#fff' : '#9ca3af' }}>
                  {n}人
                </button>
              ))}
            </div>
          </Field>
          <Field label="用餐時間">
            <div style={{ display: 'flex', gap: 6 }}>
              {[1,2,3].map(h => (
                <button key={h} onClick={() => setDuration(h)}
                  style={{ ...PILL, background: h === duration ? '#0891b2' : '#141720', color: h === duration ? '#fff' : '#9ca3af' }}>
                  {h}小時
                </button>
              ))}
            </div>
          </Field>
          <Field label="時段">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {slots.length === 0 && <div style={{ fontSize: 13, color: '#4b5563' }}>無可用時段</div>}
              {slots.map(s => (
                <button key={s.slot_time} onClick={() => setSlot(s.slot_time)}
                  style={{ ...PILL, background: slot === s.slot_time ? '#0891b2' : '#141720', color: slot === s.slot_time ? '#fff' : '#9ca3af' }}>
                  {s.slot_time.slice(0, 5)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="桌位（選填）">
            <select value={tableId} onChange={e => setTableId(e.target.value)} style={INPUT}>
              <option value="">自動分配</option>
              {tables.filter(t => t.capacity >= partySize).map(t => (
                <option key={t.id} value={t.id}>T{t.table_number} ({t.capacity}人)</option>
              ))}
            </select>
          </Field>
          <Field label="姓名 *">
            <input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="訂位人姓名" style={INPUT} />
          </Field>
          <Field label="手機 *">
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0912-000-000" style={INPUT} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid #2d3148', borderRadius: 8, color: '#9ca3af', padding: '11px 0', fontSize: 14, cursor: 'pointer' }}>取消</button>
          <button onClick={submit} disabled={loading || !guestName || !phone || !slot}
            style={{ flex: 2, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (!guestName || !phone || !slot || loading) ? 0.5 : 1 }}>
            {loading ? '建立中…' : '建立訂位'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Btn({ color, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

function EditModal({ r, tables, employeeId, onClose, onSaved }) {
  const [form, setForm] = useState({
    guest_name:       r.guest_name ?? '',
    guest_phone:      r.guest_phone ?? '',
    guest_email:      r.guest_email ?? '',
    reservation_date: r.reservation_date ?? '',
    reservation_time: r.reservation_time?.slice(0, 5) ?? '',
    party_size:       r.party_size ?? 2,
    duration_hours:   r.duration_hours ?? 1,
    table_id:         r.table_id ?? '',
    special_requests: r.special_requests ?? '',
  })
  const [loading, setLoading] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function save() {
    setLoading(true)
    await updateReservation(r.id, {
      guest_name:       form.guest_name,
      guest_phone:      form.guest_phone,
      guest_email:      form.guest_email || null,
      reservation_date: form.reservation_date,
      reservation_time: form.reservation_time,
      party_size:       Number(form.party_size),
      duration_hours:   Number(form.duration_hours),
      table_id:         form.table_id || null,
      special_requests: form.special_requests || null,
    }, employeeId)
    setLoading(false)
    onSaved()
  }

  const suitable = tables.filter(t => t.capacity >= form.party_size)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#1e2232', border: '1px solid #2d3148', borderRadius: 16, padding: 28, width: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 20 }}>編輯訂位</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="姓名 *">
            <input value={form.guest_name} onChange={e => set('guest_name', e.target.value)} style={INPUT} />
          </Field>
          <Field label="手機 *">
            <input value={form.guest_phone} onChange={e => set('guest_phone', e.target.value)} style={INPUT} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.guest_email} onChange={e => set('guest_email', e.target.value)} style={INPUT} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="日期">
              <input type="date" value={form.reservation_date} onChange={e => set('reservation_date', e.target.value)} style={INPUT} />
            </Field>
            <Field label="時間">
              <input type="time" value={form.reservation_time} onChange={e => set('reservation_time', e.target.value)} style={INPUT} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="人數">
              <input type="number" min={1} max={20} value={form.party_size} onChange={e => set('party_size', e.target.value)} style={INPUT} />
            </Field>
            <Field label="用餐時間 (小時)">
              <input type="number" min={1} max={6} value={form.duration_hours} onChange={e => set('duration_hours', e.target.value)} style={INPUT} />
            </Field>
          </div>
          <Field label="桌位">
            <select value={form.table_id} onChange={e => set('table_id', e.target.value)} style={INPUT}>
              <option value="">未分配</option>
              {suitable.map(t => <option key={t.id} value={t.id}>T{t.table_number} ({t.capacity}人)</option>)}
            </select>
          </Field>
          <Field label="特殊需求">
            <textarea value={form.special_requests} onChange={e => set('special_requests', e.target.value)}
              rows={2} style={{ ...INPUT, resize: 'vertical' }} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid #2d3148', borderRadius: 8, color: '#9ca3af', padding: '11px 0', fontSize: 14, cursor: 'pointer' }}>取消</button>
          <button onClick={save} disabled={loading || !form.guest_name || !form.guest_phone}
            style={{ flex: 2, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (!form.guest_name || !form.guest_phone || loading) ? 0.5 : 1 }}>
            {loading ? '儲存中…' : '儲存變更'}
          </button>
        </div>
      </div>
    </div>
  )
}

const INPUT = { background: '#141720', border: '1px solid #2d3148', borderRadius: 8, color: '#e5e7eb', padding: '9px 12px', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }
const PILL  = { padding: '6px 12px', border: 'none', borderRadius: 16, fontSize: 13, cursor: 'pointer', fontWeight: 500 }
