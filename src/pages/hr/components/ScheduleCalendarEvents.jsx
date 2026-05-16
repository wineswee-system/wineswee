import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// ══════════════════════════════════════════════════════════════
//  Schedule Calendar Events (holidays + custom store events)
// ══════════════════════════════════════════════════════════════
export default function ScheduleCalendarEvents({ selectedMonth, monthDates, holidays, storeEvents, setStoreEvents, storeFilter, locations }) {
  const [newEvent, setNewEvent] = useState({ date: '', title: '', color: '#f59e0b' })
  const [showForm, setShowForm] = useState(false)

  const store = locations.find(s => s.name === storeFilter)
  const dows = ['日', '一', '二', '三', '四', '五', '六']

  const handleAdd = async () => {
    if (!newEvent.date || !newEvent.title || !store) return
    const { data, error } = await supabase.from('store_events')
      .insert({ store_id: store.id, date: newEvent.date, title: newEvent.title, color: newEvent.color })
      .select().single()
    if (data) setStoreEvents(prev => [...prev, data])
    if (error) toast.error('新增失敗：' + error.message)
    setNewEvent({ date: '', title: '', color: '#f59e0b' })
    setShowForm(false)
  }

  const handleDelete = async (id) => {
    await supabase.from('store_events').delete().eq('id', id)
    setStoreEvents(prev => prev.filter(e => e.id !== id))
  }

  const holidayDates = monthDates.filter(d => holidays.includes(d))

  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>📅 {selectedMonth} 行事曆</span>
        {storeFilter && (
          <button onClick={() => setShowForm(!showForm)} style={{
            padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-medium)',
            background: showForm ? 'rgba(34,211,238,0.1)' : 'var(--bg-card)',
            color: showForm ? 'var(--accent-cyan)' : 'var(--text-muted)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            {showForm ? '收起' : '+ 新增活動'}
          </button>
        )}
      </div>

      {/* Add event form */}
      {showForm && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)' }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>日期</label>
            <select className="form-input" style={{ width: 100, padding: '5px 6px', fontSize: 12 }}
              value={newEvent.date} onChange={e => setNewEvent(prev => ({ ...prev, date: e.target.value }))}>
              <option value="">選日期</option>
              {monthDates.map(d => {
                const day = parseInt(d.slice(8))
                const dow = dows[new Date(d).getDay()]
                return <option key={d} value={d}>{day}({dow})</option>
              })}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>活動名稱</label>
            <input className="form-input" type="text" placeholder="例：包場、週年慶" style={{ width: '100%', padding: '5px 8px', fontSize: 12 }}
              value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>顏色</label>
            <input type="color" value={newEvent.color} onChange={e => setNewEvent(prev => ({ ...prev, color: e.target.value }))}
              style={{ width: 32, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
          </div>
          <button onClick={handleAdd} disabled={!newEvent.date || !newEvent.title} className="btn btn-primary btn-sm" style={{ padding: '5px 12px', fontSize: 12 }}>
            新增
          </button>
        </div>
      )}

      {/* Event list */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* National holidays */}
        {holidayDates.map(d => {
          const day = parseInt(d.slice(8))
          const dow = dows[new Date(d).getDay()]
          return (
            <span key={`h_${d}`} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'rgba(239,68,68,0.1)', color: 'var(--accent-red)',
            }}>
              🏷️ {day}({dow}) 國定假日
            </span>
          )
        })}

        {/* Custom store events */}
        {storeEvents.map(ev => {
          const day = parseInt(ev.date.slice(8))
          const dow = dows[new Date(ev.date).getDay()]
          return (
            <span key={ev.id} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: (ev.color || '#f59e0b') + '20', color: ev.color || '#f59e0b',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              📌 {day}({dow}) {ev.title}
              <button onClick={() => handleDelete(ev.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'inherit', fontSize: 10, opacity: 0.6, lineHeight: 1,
              }}>✕</button>
            </span>
          )
        })}

        {holidayDates.length === 0 && storeEvents.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>本月無節慶或活動</span>
        )}
      </div>
    </div>
  )
}
