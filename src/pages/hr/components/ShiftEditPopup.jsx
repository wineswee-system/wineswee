import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../../components/Modal'
import Time24 from '../../../components/Time24'

export default function ShiftEditPopup({ emp, date, shift, storeSettings, schedules, currentSchedule, handleSetShift, handleDeleteShift, onClose }) {
  const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const oh = storeSettings?.operating_hours?.[dayNames[new Date(date).getDay()]]
  const storeOpen = oh?.open || '11:00'
  const storeClose = oh?.close || '00:00'

  const lastPresetKey = `lastShiftPreset_${emp.store || 'default'}`
  const lastPreset = (() => {
    try { return JSON.parse(localStorage.getItem(lastPresetKey) || 'null') } catch { return null }
  })()

  const [startTime, setStartTime] = useState(lastPreset?.start || storeOpen)
  const [endTime, setEndTime] = useState(lastPreset?.end || storeClose)

  const storeOptions = [
    emp.store,
    ...(Array.isArray(emp.additional_stores) ? emp.additional_stores : []),
  ].filter(Boolean)
  const [sourceStore, setSourceStore] = useState(currentSchedule?.source_store || emp.store || '')

  const prevDateStr = (() => {
    const d = new Date(date); d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const prevSchedule = schedules?.find(s => s.employee === emp.name && s.date === prevDateStr)
  const hasPrev = !!prevSchedule?.shift

  const handleCopyPrev = () => {
    if (!prevSchedule) return
    handleSetShift(emp.name, date, prevSchedule.shift, prevSchedule.actual_start, prevSchedule.actual_end, prevSchedule.source_store || emp.store)
    onClose()
  }

  const openH = parseInt(storeOpen) || 11
  const closeH = parseInt(storeClose) || 0
  const effectiveClose = closeH <= openH ? closeH + 24 : closeH
  const midH = openH + Math.floor((effectiveClose - openH) / 2)
  const fmt = (h) => `${String(h % 24).padStart(2, '0')}:00`

  const presets = [
    { label: `${openH}~${effectiveClose % 24 || 24}`, start: fmt(openH), end: fmt(effectiveClose) },
    { label: `${openH}~${midH}`, start: fmt(openH), end: fmt(midH) },
    { label: `${midH}~${effectiveClose % 24 || 24}`, start: fmt(midH), end: fmt(effectiveClose) },
    { label: `${openH}~${openH + 9}`, start: fmt(openH), end: fmt(openH + 9) },
    { label: `${openH + 4}~${effectiveClose % 24 || 24}`, start: fmt(openH + 4), end: fmt(effectiveClose) },
  ].filter((p, i, arr) => arr.findIndex(x => x.label === p.label) === i)

  const handleConfirm = () => {
    if (!startTime || !endTime) return
    const s = startTime.replace(':00', '').replace(/^0/, '')
    const e = endTime.replace(':00', '').replace(/^0/, '')
    try { localStorage.setItem(lastPresetKey, JSON.stringify({ start: startTime, end: endTime })) } catch {}
    handleSetShift(emp.name, date, `${s}~${e}`, startTime, endTime, sourceStore || null)
    onClose()
  }

  const setAbsence = (label) => {
    handleSetShift(emp.name, date, label, null, null, sourceStore || null)
    onClose()
  }

  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (shift && handleDeleteShift) { e.preventDefault(); handleDeleteShift(emp.name, date); onClose() }
        return
      }
      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= presets.length) {
        e.preventDefault()
        const p = presets[num - 1]
        setStartTime(p.start); setEndTime(p.end)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'e') { e.preventDefault(); setAbsence('例假') }
      else if (k === 'r') { e.preventDefault(); setAbsence('休息') }
      else if (k === 's') { e.preventDefault(); setAbsence('特休') }
      else if (k === 'b') { e.preventDefault(); setAbsence('病') }
      else if (k === 'm') { e.preventDefault(); setAbsence('會議') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime, sourceStore, shift])

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
        borderRadius: 14, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        minWidth: 220,
      }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', marginBottom: 10 }}>
          {emp.name} · {date.slice(5)}（{dow}）
        </div>

        {storeOptions.length > 1 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>當天在哪間店</div>
            <select className="form-input" value={sourceStore} onChange={e => setSourceStore(e.target.value)}
              style={{ width: '100%', padding: '7px', fontSize: 13, fontWeight: 600 }}>
              {storeOptions.map(s => (
                <option key={s} value={s}>{s}{s === emp.store ? ' (主店)' : ''}</option>
              ))}
            </select>
          </div>
        )}

        {hasPrev && (
          <button onClick={handleCopyPrev} style={{
            width: '100%', padding: '7px', borderRadius: 8, border: '1px dashed var(--accent-cyan)',
            background: 'rgba(34,211,238,0.06)', color: 'var(--accent-cyan)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8,
          }}>
            ↑ 複製前一日（{prevSchedule.shift}{prevSchedule.source_store && prevSchedule.source_store !== emp.store ? ` · ${prevSchedule.source_store}` : ''}）
          </button>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <Time24 value={startTime} onChange={setStartTime} style={{ flex: 1 }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>~</span>
          <Time24 value={endTime} onChange={setEndTime} style={{ flex: 1 }} />
        </div>

        <button onClick={handleConfirm} style={{
          width: '100%', padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--accent-cyan)', color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 8,
        }}>確認排班</button>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
          {presets.map(p => (
            <button key={p.label} onClick={() => { setStartTime(p.start); setEndTime(p.end) }}
              style={{
                padding: '6px 2px', borderRadius: 6, border: '1px solid var(--border-medium)',
                background: startTime === p.start && endTime === p.end ? 'rgba(34,211,238,0.15)' : 'var(--bg-card)',
                color: startTime === p.start && endTime === p.end ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 6 }}>
          {[
            { label: '🛑 例假', key: '例假', bg: 'rgba(220,38,38,0.10)', color: '#dc2626' },
            { label: '🌙 休息', key: '休息', bg: 'var(--glass-medium)', color: 'var(--text-muted)' },
            { label: '🔄 補休', key: '補休', bg: 'rgba(59,130,246,0.1)', color: '#3b82f6' },
            { label: '🌴 特休', key: '特休', bg: 'rgba(16,185,129,0.08)', color: '#10b981' },
            { label: '🏥 病假', key: '病', bg: 'rgba(239,68,68,0.08)', color: '#ef4444' },
            { label: '📋 會議', key: '會議', bg: 'rgba(139,92,246,0.08)', color: '#8b5cf6' },
            { label: '👶 產假', key: '產', bg: 'rgba(245,158,11,0.08)', color: '#f59e0b' },
          ].map(a => (
            <button key={a.key} onClick={() => setAbsence(a.key)} style={{
              padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: a.bg, color: a.color, fontSize: 12, fontWeight: 600,
            }}>{a.label}</button>
          ))}
        </div>

        <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 4 }}>
          ⌨ 1-5=班別 / E=例 R=休 S=特休 B=病 / Enter=確認 / Del=刪除 / Esc=關
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {shift && handleDeleteShift && (
            <button onClick={() => { handleDeleteShift(emp.name, date); onClose() }} style={{
              flex: 1, padding: '6px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.3)',
              background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>刪除</button>
          )}
          <button onClick={onClose} style={{
            flex: 1, padding: '6px', borderRadius: 8, border: '1px solid var(--border-medium)',
            background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          }}>取消</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
