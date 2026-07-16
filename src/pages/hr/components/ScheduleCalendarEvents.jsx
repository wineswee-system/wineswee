import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// ══════════════════════════════════════════════════════════════
//  Schedule Calendar Events (holidays + custom store events + 天災)
// ══════════════════════════════════════════════════════════════

// 活動類別 → icon + 主題色系(用 accent token，不寫死 hex)
const EVENT_CATEGORIES = {
  '公司公休': { icon: '🚫', accent: 'red' },
  '節慶活動': { icon: '🎉', accent: 'orange' },
  '包場':     { icon: '🎪', accent: 'purple' },
  '教育訓練': { icon: '📚', accent: 'blue' },
  '促銷檔期': { icon: '🏷️', accent: 'green' },
  '其他':     { icon: '📌', accent: 'cyan' },
}
// 計薪比照 → 對應加班費日別(§36/§37)。個人請假別(特休/病假…)不在此,走請假流程。
const PAY_CLASS_OPTS = {
  '': '無（不影響計薪）',
  weekly_off: '比照例假（§36 出勤最高倍率）',
  restday: '比照休息日（§36 休息日加給）',
  national_holiday: '比照國定假日（加給/加班費）',
}
// 簡短標籤(chip 用)
const PAY_CLASS_SHORT = {
  weekly_off: '💰比照例假',
  restday: '💰比照休息日',
  national_holiday: '💰比照國定',
}

export default function ScheduleCalendarEvents({ selectedMonth, monthDates, holidays, storeEvents, setStoreEvents, disasters = [], storeFilter, locations }) {
  const navigate = useNavigate()
  const [newEvent, setNewEvent] = useState({ date: '', title: '', category: '節慶活動', pay_class: '' })
  const [showForm, setShowForm] = useState(false)

  const store = locations.find(s => s.name === storeFilter)
  const dows = ['日', '一', '二', '三', '四', '五', '六']

  const handleAdd = async () => {
    if (!newEvent.date || !newEvent.title || !store) return
    const { data, error } = await supabase.from('store_events')
      .insert({
        store_id: store.id,
        date: newEvent.date,
        title: newEvent.title,
        category: newEvent.category || null,
        pay_class: newEvent.pay_class || null,
      })
      .select().single()
    if (data) setStoreEvents(prev => [...prev, data])
    if (error) toast.error('新增失敗：' + error.message)
    setNewEvent({ date: '', title: '', category: '節慶活動', pay_class: '' })
    setShowForm(false)
  }

  const handleDelete = async (id) => {
    await supabase.from('store_events').delete().eq('id', id)
    setStoreEvents(prev => prev.filter(e => e.id !== id))
  }

  const holidayDates = monthDates.filter(d => holidays.includes(d))

  // 天災宣告 → 顯示區間標籤(同月內)
  const fmtDisaster = (d) => {
    const start = (d.start_at ? d.start_at.slice(0, 10) : d.date)
    const end = (d.end_at ? d.end_at.slice(0, 10) : start)
    const sDay = parseInt(start.slice(8)), eDay = parseInt(end.slice(8))
    return start === end ? `${sDay}日` : `${sDay}~${eDay}日`
  }

  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>📅 {selectedMonth} 行事曆</span>
        {storeFilter && (
          <button onClick={() => setShowForm(!showForm)} style={{
            padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-medium)',
            background: showForm ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
            color: showForm ? 'var(--accent-cyan)' : 'var(--text-muted)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            {showForm ? '收起' : '+ 新增活動'}
          </button>
        )}
      </div>

      {/* Add event form */}
      {showForm && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)' }}>
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
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>類別</label>
            <select className="form-input" style={{ width: 110, padding: '5px 6px', fontSize: 12 }}
              value={newEvent.category} onChange={e => setNewEvent(prev => ({ ...prev, category: e.target.value }))}>
              {Object.entries(EVENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {k}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>活動名稱</label>
            <input className="form-input" type="text" placeholder="例：包場、週年慶" style={{ width: '100%', padding: '5px 8px', fontSize: 12 }}
              value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>計薪比照</label>
            <select className="form-input" style={{ width: 170, padding: '5px 6px', fontSize: 12 }}
              value={newEvent.pay_class} onChange={e => setNewEvent(prev => ({ ...prev, pay_class: e.target.value }))}>
              {Object.entries(PAY_CLASS_OPTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button onClick={handleAdd} disabled={!newEvent.date || !newEvent.title} className="btn btn-primary btn-sm" style={{ padding: '5px 12px', fontSize: 12 }}>
            新增
          </button>
        </div>
      )}
      {showForm && newEvent.pay_class && (
        <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginBottom: 8, marginLeft: 2 }}>
          💰 該門市這天「有上班的人」會依「{PAY_CLASS_OPTS[newEvent.pay_class]}」計薪（加給／加班費倍率）；沒上班的人不受影響。
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
              background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
            }}>
              🏷️ {day}({dow}) 國定假日
            </span>
          )
        })}

        {/* 天災宣告(唯讀，點擊導到天災管理) */}
        {disasters.map(d => (
          <span key={`d_${d.id}`}
            onClick={() => navigate('/hr/disaster')}
            title="點擊前往天災管理"
            style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              border: '1px dashed var(--accent-red)',
            }}>
            🌧️ {fmtDisaster(d)} {d.disaster_type}停班 ↗
          </span>
        ))}

        {/* Custom store events */}
        {storeEvents.map(ev => {
          const day = parseInt(ev.date.slice(8))
          const dow = dows[new Date(ev.date).getDay()]
          const cat = EVENT_CATEGORIES[ev.category]
          // 有類別 → 用主題色 token；舊資料(無類別) → fallback 到自訂 hex 色
          const chipStyle = cat
            ? { background: `var(--accent-${cat.accent}-dim)`, color: `var(--accent-${cat.accent})` }
            : { background: (ev.color || '#f59e0b') + '20', color: ev.color || '#f59e0b' }
          return (
            <span key={ev.id} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4, ...chipStyle,
            }}>
              {cat?.icon || '📌'} {day}({dow}) {ev.title}
              {PAY_CLASS_SHORT[ev.pay_class] && (
                <span style={{ fontSize: 10, opacity: 0.85 }}>· {PAY_CLASS_SHORT[ev.pay_class]}</span>
              )}
              <button onClick={() => handleDelete(ev.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'inherit', fontSize: 10, opacity: 0.6, lineHeight: 1,
              }}>✕</button>
            </span>
          )
        })}

        {holidayDates.length === 0 && storeEvents.length === 0 && disasters.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>本月無節慶或活動</span>
        )}
      </div>
    </div>
  )
}
