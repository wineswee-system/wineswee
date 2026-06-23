import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  getReservations, getResTables, getAvailableSlots,
  createReservation, updateReservationStatus, assignTable, extendReservation,
} from '../../lib/db/reservations'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Plus, Search, X, ChevronDown, ChevronUp } from 'lucide-react'

const STATUSES = ['pending','confirmed','seated','completed','cancelled','no_show']
const STATUS_META = {
  pending:   { label: '待確認', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  confirmed: { label: '已確認', color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  seated:    { label: '已入座', color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)' },
  completed: { label: '已完成', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  cancelled: { label: '已取消', color: 'var(--text-muted)',    dim: 'var(--bg-tertiary)' },
  no_show:   { label: '未到場', color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
}
const SOURCE_LABEL = { web: '線上', walk_in: '現場', phone: '電話', pos: 'POS' }

function genCode() { return Math.random().toString(36).slice(2,8).toUpperCase() }
function todayStr() { return new Date().toISOString().split('T')[0] }

export default function ReservationList() {
  const [stores, setStores]           = useState([])
  const [storeId, setStoreId]         = useState('')
  const [date, setDate]               = useState(todayStr())
  const [statusFilter, setStatus]     = useState('all')
  const [search, setSearch]           = useState('')
  const [reservations, setReservations] = useState([])
  const [tables, setTables]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [showModal, setShowModal]     = useState(false)
  const [slots, setSlots]             = useState([])
  const [form, setForm]               = useState({
    guest_name: '', guest_phone: '', guest_email: '', guest_count: 2,
    reserved_date: todayStr(), slot_time: '', duration_hours: 1,
    table_id: '', notes: '', special_requests: '', source: 'walk_in',
  })
  const [saving, setSaving]           = useState(false)

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
    Promise.all([getReservations(storeId, date), getResTables(storeId)])
      .then(([r, t]) => { setReservations(r.data || []); setTables(t.data || []) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadData() }, [storeId, date]) // eslint-disable-line

  useEffect(() => {
    if (!storeId || !form.reserved_date || !form.guest_count || !form.duration_hours) return
    getAvailableSlots(storeId, form.reserved_date, form.guest_count, form.duration_hours)
      .then(({ data }) => setSlots(data || []))
  }, [storeId, form.reserved_date, form.guest_count, form.duration_hours])

  const filtered = reservations.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return r.guest_name.toLowerCase().includes(q) || r.guest_phone.includes(q)
    }
    return true
  })

  const doStatus = async (id, status) => { await updateReservationStatus(id, status); loadData() }
  const doExtend = async (res) => { await extendReservation(res.id, res.extended_hours); loadData() }
  const doAssign = async (resId, tableId) => { await assignTable(resId, tableId || null); loadData() }

  const doCreate = async () => {
    if (!form.guest_name || !form.guest_phone || !form.slot_time) return
    setSaving(true)
    const { data: st } = await supabase.from('stores').select('organization_id').eq('id', storeId).single()
    await createReservation({
      ...form,
      store_id: storeId,
      organization_id: st?.organization_id,
      guest_count: Number(form.guest_count),
      duration_hours: Number(form.duration_hours),
      table_id: form.table_id || null,
      confirmation_code: genCode(),
      status: 'confirmed',
    })
    setSaving(false)
    setShowModal(false)
    setForm({ guest_name: '', guest_phone: '', guest_email: '', guest_count: 2, reserved_date: todayStr(), slot_time: '', duration_hours: 1, table_id: '', notes: '', special_requests: '', source: 'walk_in' })
    loadData()
  }

  const inp = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const lbl = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, marginRight: 8 }}>訂位清單</h1>
        <select value={storeId} onChange={e => setStoreId(e.target.value)} style={{ ...inp, width: 'auto' }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: 140 }} />
        <select value={statusFilter} onChange={e => setStatus(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="all">所有狀態</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 140 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋姓名或電話" style={{ ...inp, paddingLeft: 26 }} />
        </div>
        <button onClick={() => setShowModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
          <Plus size={14} /> 新增訂位
        </button>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUSES.map(s => {
          const count = reservations.filter(r => r.status === s).length
          if (!count) return null
          const m = STATUS_META[s]
          return (
            <span key={s} onClick={() => setStatus(statusFilter === s ? 'all' : s)}
              style={{ padding: '3px 10px', borderRadius: 20, background: m.dim, color: m.color, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${statusFilter === s ? m.color : 'transparent'}` }}>
              {m.label} {count}
            </span>
          )
        })}
      </div>

      {/* Reservation rows */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 52px 108px 72px 64px 110px 36px', padding: '10px 16px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, gap: 8 }}>
          <span>時間</span><span>客人</span><span>人數</span><span>電話</span><span>桌號</span><span>來源</span><span>狀態</span><span></span>
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>沒有符合的訂位</div>
        )}

        {filtered.map(res => {
          const m = STATUS_META[res.status] || STATUS_META.pending
          const isOpen = expanded === res.id
          return (
            <div key={res.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 52px 108px 72px 64px 110px 36px', padding: '11px 16px', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : res.id)}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{res.slot_time.slice(0,5)}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{res.guest_name}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{res.guest_count}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{res.guest_phone}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{res.res_tables?.table_number || '-'}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{SOURCE_LABEL[res.source] || res.source}</span>
                <span style={{ background: m.dim, color: m.color, padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, textAlign: 'center' }}>{m.label}</span>
                <span style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'center' }}>{isOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</span>
              </div>

              {isOpen && (
                <div style={{ padding: '0 16px 14px', background: 'var(--bg-tertiary)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12, paddingTop: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>確認碼</div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 1 }}>{res.confirmation_code}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>時段</div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                        {res.slot_time.slice(0,5)} · {res.duration_hours + res.extended_hours}h
                        {res.extended_hours > 0 && <span style={{ color: 'var(--accent-purple)', marginLeft: 4, fontSize: 11 }}>+{res.extended_hours}h 延長</span>}
                      </div>
                    </div>
                    {res.guest_email && <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Email</div><div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{res.guest_email}</div></div>}
                    {res.special_requests && <div style={{ gridColumn: '1/-1' }}><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>特殊需求</div><div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{res.special_requests}</div></div>}
                    {res.notes && <div style={{ gridColumn: '1/-1' }}><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>備註</div><div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{res.notes}</div></div>}
                  </div>

                  {/* Table assign */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>桌位：</span>
                    <select value={res.table_id || ''} onChange={e => doAssign(res.id, e.target.value)}
                      style={{ ...inp, width: 'auto', fontSize: 13 }}>
                      <option value="">未指定</option>
                      {tables.filter(t => t.capacity >= res.guest_count).map(t => (
                        <option key={t.id} value={t.id}>{t.table_number} ({t.capacity}人)</option>
                      ))}
                    </select>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {res.status === 'pending' && <button onClick={() => doStatus(res.id,'confirmed')} style={{ padding:'5px 12px', borderRadius:6, border:'none', background:'var(--accent-cyan)', color:'#fff', fontSize:12, cursor:'pointer', fontWeight:600 }}>確認訂位</button>}
                    {res.status === 'confirmed' && <button onClick={() => doStatus(res.id,'seated')} style={{ padding:'5px 12px', borderRadius:6, border:'none', background:'var(--accent-green)', color:'#fff', fontSize:12, cursor:'pointer', fontWeight:600 }}>辦理入座</button>}
                    {res.status === 'seated' && <>
                      <button onClick={() => doStatus(res.id,'completed')} style={{ padding:'5px 12px', borderRadius:6, border:'none', background:'var(--accent-green)', color:'#fff', fontSize:12, cursor:'pointer', fontWeight:600 }}>完成用餐</button>
                      <button onClick={() => doExtend(res)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid var(--accent-purple)', background:'var(--accent-purple-dim)', color:'var(--accent-purple)', fontSize:12, cursor:'pointer', fontWeight:600 }}>延長 1 小時</button>
                    </>}
                    {!['cancelled','no_show','completed'].includes(res.status) && <button onClick={() => doStatus(res.id,'no_show')} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid var(--border-primary)', background:'transparent', color:'var(--text-muted)', fontSize:12, cursor:'pointer' }}>未到場</button>}
                    {!['cancelled','completed'].includes(res.status) && <button onClick={() => doStatus(res.id,'cancelled')} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid var(--accent-red)', background:'var(--accent-red-dim)', color:'var(--accent-red)', fontSize:12, cursor:'pointer' }}>取消</button>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'var(--bg-secondary)', borderRadius:16, width:520, maxHeight:'90vh', overflow:'auto', padding:24, boxShadow:'0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>新增訂位</h2>
              <button onClick={() => setShowModal(false)} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text-muted)' }}><X size={18}/></button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={lbl}>來源</label>
                <select value={form.source} onChange={e => setForm(f => ({ ...f, source:e.target.value }))} style={inp}>
                  <option value="walk_in">現場</option>
                  <option value="phone">電話</option>
                </select>
              </div>
              <div><label style={lbl}>客人姓名 *</label><input value={form.guest_name} onChange={e => setForm(f => ({ ...f, guest_name:e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>電話 *</label><input value={form.guest_phone} onChange={e => setForm(f => ({ ...f, guest_phone:e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Email</label><input value={form.guest_email} onChange={e => setForm(f => ({ ...f, guest_email:e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>人數</label><input type="number" min="1" max="20" value={form.guest_count} onChange={e => setForm(f => ({ ...f, guest_count:Number(e.target.value) }))} style={inp} /></div>
              <div><label style={lbl}>日期</label><input type="date" value={form.reserved_date} onChange={e => setForm(f => ({ ...f, reserved_date:e.target.value, slot_time:'' }))} style={inp} /></div>
              <div><label style={lbl}>用餐時長</label>
                <select value={form.duration_hours} onChange={e => setForm(f => ({ ...f, duration_hours:Number(e.target.value), slot_time:'' }))} style={inp}>
                  {[1,2,3,4].map(h => <option key={h} value={h}>{h} 小時</option>)}
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}><label style={lbl}>時間 *</label>
                <select value={form.slot_time} onChange={e => setForm(f => ({ ...f, slot_time:e.target.value }))} style={inp}>
                  <option value="">選擇時間</option>
                  {slots.map(s => <option key={s.slot_time} value={s.slot_time}>{s.slot_time.slice(0,5)} (可用 {s.available_table_count} 桌)</option>)}
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}><label style={lbl}>指定桌位 (選填)</label>
                <select value={form.table_id} onChange={e => setForm(f => ({ ...f, table_id:e.target.value }))} style={inp}>
                  <option value="">自動分配</option>
                  {tables.filter(t => t.capacity >= form.guest_count).map(t => <option key={t.id} value={t.id}>{t.table_number} ({t.capacity}人)</option>)}
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}><label style={lbl}>特殊需求</label><input value={form.special_requests} onChange={e => setForm(f => ({ ...f, special_requests:e.target.value }))} placeholder="過敏、高腳椅…" style={inp} /></div>
              <div style={{ gridColumn:'1/-1' }}><label style={lbl}>備註</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes:e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border-primary)', background:'transparent', color:'var(--text-secondary)', cursor:'pointer' }}>取消</button>
              <button onClick={doCreate} disabled={saving || !form.guest_name || !form.guest_phone || !form.slot_time}
                style={{ padding:'8px 20px', borderRadius:8, border:'none', background:'var(--accent-cyan)', color:'#fff', fontWeight:700, cursor:'pointer', opacity:saving ? 0.6 : 1 }}>
                {saving ? '儲存中…' : '確認新增'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
