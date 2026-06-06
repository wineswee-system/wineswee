import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Edit3, Trash2, Play, ArrowLeft, Save } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import { getMonthDates } from '../../../lib/scheduleUtils'

const DOW_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const ABSENCE_OPTS = ['', '休', '補休', '特休', '會議']

function normalizeShift(raw) {
  if (!raw) return null
  if (ABSENCE_OPTS.includes(raw)) return { shift: raw }
  const txt = raw.replace(/[-～－—]/g, '~')
  const m = txt.match(/^(\d{1,2}):?(\d{0,2})~(\d{1,2}):?(\d{0,2})$/)
  if (!m) return null
  const sh = String(m[1]).padStart(2, '0')
  const sm = (m[2] || '00').padStart(2, '0')
  const eh = String(m[3]).padStart(2, '0')
  const em = (m[4] || '00').padStart(2, '0')
  return {
    shift: `${m[1]}~${m[3]}`,
    start: `${sh}:${sm}`,
    end: `${eh}:${em}`,
  }
}

const emptyPattern = () => ({ 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null })

export default function EmployeeSchedulePatternsModal({
  open, onClose, employees, stores, orgId, currentMonth, onApplied,
}) {
  const [view, setView] = useState('list')  // list | edit | apply
  const [patterns, setPatterns] = useState([])
  const [editing, setEditing] = useState(null)
  const [applying, setApplying] = useState(null)
  const [loading, setLoading] = useState(false)

  // Load patterns when open
  useEffect(() => {
    if (!open) return
    setLoading(true)
    supabase.from('employee_schedule_patterns')
      .select('*').eq('organization_id', orgId)
      .order('name')
      .then(({ data }) => {
        setPatterns(data || [])
        setLoading(false)
      })
  }, [open, orgId])

  const handleNew = () => {
    setEditing({ name: '', description: '', pattern: emptyPattern() })
    setView('edit')
  }

  const handleEdit = (p) => {
    setEditing({ ...p, pattern: { ...emptyPattern(), ...(p.pattern || {}) } })
    setView('edit')
  }

  const handleApply = (p) => {
    setApplying(p)
    setView('apply')
  }

  const handleDelete = async (p) => {
    if (!confirm(`確定刪除模板「${p.name}」？`)) return
    const { error } = await supabase.from('employee_schedule_patterns').delete().eq('id', p.id)
    if (error) return toast.error('刪除失敗：' + error.message)
    setPatterns(prev => prev.filter(x => x.id !== p.id))
    toast.success('已刪除')
  }

  const handleSave = async () => {
    if (!editing.name.trim()) return toast.error('請填模板名稱')
    const payload = {
      organization_id: orgId,
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      pattern: editing.pattern,
      updated_at: new Date().toISOString(),
    }
    if (editing.id) {
      const { data, error } = await supabase.from('employee_schedule_patterns')
        .update(payload).eq('id', editing.id).select().single()
      if (error) return toast.error('儲存失敗：' + error.message)
      setPatterns(prev => prev.map(x => x.id === editing.id ? data : x))
    } else {
      const { data, error } = await supabase.from('employee_schedule_patterns')
        .insert(payload).select().single()
      if (error) return toast.error('儲存失敗：' + error.message)
      setPatterns(prev => [...prev, data])
    }
    toast.success('已儲存')
    setView('list')
    setEditing(null)
  }

  if (!open) return null

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '4vh 20px 20px', overflow: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', borderRadius: 12,
        border: '1px solid var(--border-medium)', boxShadow: 'var(--shadow-xl)',
        width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            {view !== 'list' && (
              <button onClick={() => { setView('list'); setEditing(null); setApplying(null) }}
                className="btn btn-secondary" style={{ padding: '3px 8px' }}>
                <ArrowLeft size={14} />
              </button>
            )}
            🗂️ 員工排班模板{view === 'edit' ? '：' + (editing.id ? '編輯' : '新增') : view === 'apply' ? '：套用' : ''}
          </h3>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {view === 'list' && (
            <ListView
              patterns={patterns} loading={loading}
              onNew={handleNew} onEdit={handleEdit} onApply={handleApply} onDelete={handleDelete}
            />
          )}
          {view === 'edit' && editing && (
            <EditView
              editing={editing} setEditing={setEditing}
              stores={stores} onSave={handleSave}
            />
          )}
          {view === 'apply' && applying && (
            <ApplyView
              pattern={applying} employees={employees} stores={stores}
              orgId={orgId} currentMonth={currentMonth}
              onDone={() => { setView('list'); setApplying(null); onApplied?.() }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ────────────────────────────── List View ──────────────────────────────
function ListView({ patterns, loading, onNew, onEdit, onApply, onDelete }) {
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={onNew}>
          <Plus size={14} /> 新增模板
        </button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>載入中...</div>
      ) : patterns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          尚未建立任何模板。點「新增模板」開始。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {patterns.map(p => (
            <div key={p.id} style={{
              padding: 12, borderRadius: 8, background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                {p.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.description}</div>
                )}
                <PatternPreview pattern={p.pattern} />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-primary" onClick={() => onApply(p)} title="套用到員工×整月">
                  <Play size={12} /> 套用
                </button>
                <button className="btn btn-secondary" onClick={() => onEdit(p)}>
                  <Edit3 size={12} />
                </button>
                <button className="btn btn-secondary" onClick={() => onDelete(p)} style={{ color: 'var(--accent-red)' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function PatternPreview({ pattern }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
      {DOW_LABELS.map((label, i) => {
        const cell = pattern?.[String(i)]
        const shift = cell?.shift || ''
        const isRest = ['休', '補休', '特休'].includes(shift)
        return (
          <div key={i} style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: shift ? (isRest ? 'var(--glass-medium)' : 'rgba(34,211,238,0.15)') : 'var(--bg-secondary)',
            color: shift ? (isRest ? 'var(--text-muted)' : 'var(--accent-cyan)') : 'var(--text-muted)',
            minWidth: 50, textAlign: 'center',
          }}>
            {label} {shift || '·'}
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────── Edit View ──────────────────────────────
function EditView({ editing, setEditing, stores, onSave }) {
  const updateDay = (dow, field, value) => {
    const cell = editing.pattern[String(dow)] || {}
    const updated = { ...cell, [field]: value }
    setEditing(prev => ({ ...prev, pattern: { ...prev.pattern, [String(dow)]: updated } }))
  }

  const setDayShift = (dow, raw) => {
    if (!raw) {
      setEditing(prev => ({ ...prev, pattern: { ...prev.pattern, [String(dow)]: null } }))
      return
    }
    const norm = normalizeShift(raw)
    if (!norm) {
      updateDay(dow, 'shift', raw)  // 先存原始字串等使用者改
      return
    }
    setEditing(prev => ({ ...prev, pattern: { ...prev.pattern, [String(dow)]: norm } }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          模板名稱 <span style={{ color: 'var(--accent-red)' }}>*</span>
        </label>
        <input className="form-input" type="text" value={editing.name}
          onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
          placeholder="例：店長週模板 / 早班 PT / 主管模式"
          style={{ width: '100%', padding: '8px 12px' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>說明（選填）</label>
        <input className="form-input" type="text" value={editing.description || ''}
          onChange={e => setEditing(prev => ({ ...prev, description: e.target.value }))}
          placeholder="例：固定週一二三早班，週四五晚班，週六日休"
          style={{ width: '100%', padding: '8px 12px' }} />
      </div>

      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>每週 pattern</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DOW_LABELS.map((label, i) => {
            const cell = editing.pattern[String(i)] || {}
            return (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', background: 'var(--bg-card)', borderRadius: 6 }}>
                <div style={{ minWidth: 24, textAlign: 'center', fontWeight: 700, color: i === 0 || i === 6 ? 'var(--accent-purple)' : 'var(--text-primary)' }}>
                  {label}
                </div>
                <input className="form-input" type="text"
                  value={cell?.shift || ''}
                  onChange={e => setDayShift(i, e.target.value)}
                  placeholder="11~20 或 休 或留空"
                  style={{ flex: 1, padding: '6px 10px', fontSize: 13 }} />
                <select className="form-input" value={cell?.source_store || ''}
                  onChange={e => updateDay(i, 'source_store', e.target.value || null)}
                  style={{ width: 140, padding: '6px 10px', fontSize: 12 }}>
                  <option value="">(預設店)</option>
                  {(stores || []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8, background: 'var(--bg-card)', borderRadius: 6 }}>
        💡 班別格式：時段 <code>11~20</code> / <code>11:00~20:00</code> 或 假別 <code>休 / 補休 / 特休</code>。留空 = 那天不套用（保留原排班）
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={onSave}>
          <Save size={14} /> 儲存
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────── Apply View ──────────────────────────────
function ApplyView({ pattern, employees, stores, orgId, currentMonth, onDone }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [month, setMonth] = useState(currentMonth || new Date().toISOString().slice(0, 7))
  const [skipFilled, setSkipFilled] = useState(true)
  const [applying, setApplying] = useState(false)
  const [search, setSearch] = useState('')

  const toggleEmp = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = (employees || []).filter(e => !search || e.name.includes(search) || e.employee_number?.includes(search))

  const handleApply = async () => {
    if (selectedIds.size === 0) return toast.error('請至少選一個員工')
    setApplying(true)

    const [y, m] = month.split('-').map(Number)
    const monthDates = getMonthDates(y, m)
    const selected = (employees || []).filter(e => selectedIds.has(e.id))

    let inserted = 0
    let updated = 0
    let skipped = 0

    for (const emp of selected) {
      // 拿這員工本月已有排班
      const { data: existing } = await supabase.from('schedules')
        .select('id, date, shift')
        .eq('employee', emp.name)
        .gte('date', monthDates[0]).lte('date', monthDates[monthDates.length - 1])
      const existingMap = {}
      for (const s of (existing || [])) existingMap[s.date] = s

      for (const date of monthDates) {
        const dow = new Date(date).getDay()
        const cell = pattern.pattern?.[String(dow)]
        if (!cell || !cell.shift) continue  // 該星期幾沒設定，跳過

        const exi = existingMap[date]
        if (skipFilled && exi?.shift) { skipped++; continue }

        const record = {
          employee: emp.name,
          date,
          shift: cell.shift,
          actual_start: cell.start || null,
          actual_end: cell.end || null,
          source_store: cell.source_store || emp.store || null,
          organization_id: orgId || null,
        }

        if (exi) {
          const { error } = await supabase.from('schedules').update(record).eq('id', exi.id)
          if (!error) updated++
        } else {
          const { error } = await supabase.from('schedules').insert(record)
          if (!error) inserted++
        }
      }
    }

    setApplying(false)
    toast.success(`套用完成：新增 ${inserted}、更新 ${updated}、略過 ${skipped}`)
    onDone()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 6, fontSize: 12 }}>
        <strong>模板：</strong>{pattern.name}
        <PatternPreview pattern={pattern.pattern} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>套用月份</label>
        <input className="form-input" type="month" value={month}
          onChange={e => setMonth(e.target.value)}
          style={{ width: 200, padding: '8px 12px' }} />
      </div>

      <div>
        <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={skipFilled}
            onChange={e => setSkipFilled(e.target.checked)} />
          略過已排班的日期（推薦：避免覆蓋已調整的天）
        </label>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            選員工（已選 {selectedIds.size} 人）
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setSelectedIds(new Set(filtered.map(e => e.id)))}>全選</button>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setSelectedIds(new Set())}>清空</button>
          </div>
        </div>
        <input className="form-input" type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋姓名 / 員編"
          style={{ width: '100%', padding: '6px 10px', fontSize: 13, marginBottom: 6 }} />
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
          {filtered.map(emp => (
            <label key={emp.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
              cursor: 'pointer',
              background: selectedIds.has(emp.id) ? 'rgba(34,211,238,0.08)' : 'transparent',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 13,
            }}>
              <input type="checkbox" checked={selectedIds.has(emp.id)}
                onChange={() => toggleEmp(emp.id)} />
              <span style={{ fontWeight: 600 }}>{emp.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {emp.employee_number || ''} {emp.store ? `· ${emp.store}` : ''}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleApply}
          disabled={applying || selectedIds.size === 0}>
          <Play size={14} /> {applying ? '套用中...' : `套用到 ${selectedIds.size} 人`}
        </button>
      </div>
    </div>
  )
}
