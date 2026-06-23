import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Save, Trash2, ArrowLeft, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import LoadingSpinner from '../../components/LoadingSpinner'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['HR', '營運', '採購', '財務', '行銷', '客服', '倉管', '其他']

const FIELD_TYPES = [
  { value: 'text',     label: '單行文字' },
  { value: 'textarea', label: '多行文字' },
  { value: 'number',   label: '數字' },
  { value: 'date',     label: '日期' },
  { value: 'select',   label: '下拉選單' },
  { value: 'file',     label: '檔案上傳' },
]

const STATUS_OPTIONS = [
  { value: 'published', label: '已發布', color: 'var(--accent-green)' },
  { value: 'draft',     label: '草稿',   color: 'var(--accent-orange)' },
  { value: 'archived',  label: '已封存', color: 'var(--text-muted)' },
]

const AFTER_SUBMIT_OPTIONS = [
  { value: 'none',     label: '無動作' },
  { value: 'approval', label: '建立簽核申請' },
  { value: 'notify',   label: '發送通知' },
]

// Colour map for type badges — uses accent-X family from design tokens
const TYPE_BADGE_COLORS = {
  text:     { color: 'var(--accent-cyan)',   bg: 'var(--accent-cyan-dim)' },
  textarea: { color: 'var(--accent-blue)',   bg: 'var(--accent-blue-dim)' },
  number:   { color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
  date:     { color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
  select:   { color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)' },
  file:     { color: 'var(--accent-yellow)', bg: 'var(--accent-yellow-dim)' },
}

const emptyField = () => ({
  // key uses timestamp so it is unique within the session; replaced with a stable key on save if needed
  key:         `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  label:       '',
  type:        'text',
  required:    false,
  placeholder: '',
  options:     '',  // comma-separated string in the editor; serialised to array on save
})

const emptyTpl = () => ({
  name:         '',
  category:     'HR',
  description:  '',
  status:       'draft',
  fields:       [],
  after_submit: 'none',
})

// ── Shared label style ────────────────────────────────────────────────────────

const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text-muted)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

// ── TypeBadge ─────────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  const theme = TYPE_BADGE_COLORS[type] || { color: 'var(--text-muted)', bg: 'var(--glass-medium)' }
  const label = FIELD_TYPES.find(t => t.value === type)?.label || type
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      color: theme.color,
      background: theme.bg,
      padding: '1px 6px', borderRadius: 4,
      display: 'inline-block', marginTop: 2,
    }}>
      {label}
    </span>
  )
}

// ── FieldPreview — read-only render of one form field ─────────────────────────

function FieldPreview({ field }) {
  const baseInput = {
    width: '100%',
    padding: '7px 10px',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-medium)',
    borderRadius: 6,
    color: 'var(--text-secondary)',
    fontSize: 13,
    outline: 'none',
    cursor: 'not-allowed',
    opacity: 0.7,
    boxSizing: 'border-box',
  }

  const renderControl = () => {
    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            readOnly disabled
            style={{ ...baseInput, minHeight: 72, resize: 'none' }}
            placeholder={field.placeholder || ''}
          />
        )
      case 'number':
        return (
          <input
            type="number" readOnly disabled
            style={baseInput}
            placeholder={field.placeholder || '0'}
          />
        )
      case 'date':
        return <input type="date" readOnly disabled style={baseInput} />
      case 'select': {
        const opts = (field.options || '').split(',').map(o => o.trim()).filter(Boolean)
        return (
          <select disabled style={baseInput}>
            <option value="">{field.placeholder || '請選擇…'}</option>
            {opts.map(o => <option key={o}>{o}</option>)}
          </select>
        )
      }
      case 'file':
        return (
          <div style={{ ...baseInput, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              選擇檔案（預覽不支援上傳）
            </span>
          </div>
        )
      default:
        return (
          <input
            type="text" readOnly disabled
            style={baseInput}
            placeholder={field.placeholder || ''}
          />
        )
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
        {field.label
          ? field.label
          : <em style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>（未命名欄位）</em>
        }
        {field.required && <span style={{ color: 'var(--accent-red)', marginLeft: 3 }}>*</span>}
      </label>
      {renderControl()}
    </div>
  )
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: 0.7,
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
//
// Routes:
//   /process/sop/form/new        — create mode (id param absent)
//   /process/sop/form/:id/edit   — edit mode
//
// Layout:
//   TopBar  [← 返回] [title / dirty indicator] [field count] [儲存]
//   Left (260px) — metadata (name, category, status, description) + draggable field list
//   Right — Top half: field editor for selected field + after-submit radio
//           Bottom half: live preview (read-only form render)

export default function FormTemplateStudio() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading]     = useState(isEdit)
  const [saving, setSaving]       = useState(false)
  const [isDirty, setIsDirty]     = useState(false)
  const [tpl, setTpl]             = useState(emptyTpl)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [dragIdx, setDragIdx]     = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const dragSrcRef = useRef(null)

  // ── Load existing template (edit mode) ──────────────────────────────────────

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    supabase.from('form_templates').select('*').eq('id', id).single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          toast.error('找不到此表單範本')
          navigate('/process/sop')
          return
        }
        const rawFields = Array.isArray(data.fields) ? data.fields : []
        const fields = rawFields.map(f => ({
          ...emptyField(),
          key:         f.key || emptyField().key,
          label:       f.label || '',
          type:        f.type || 'text',
          required:    Boolean(f.required),
          placeholder: f.placeholder || '',
          // DB stores options as string array; convert to comma-string for the editor
          options: Array.isArray(f.options)
            ? f.options.join(', ')
            : (typeof f.options === 'string' ? f.options : ''),
        }))
        setTpl({
          name:         data.name || '',
          category:     data.category || 'HR',
          description:  data.description || '',
          status:       data.status || 'draft',
          fields,
          after_submit: data.after_submit || 'none',
        })
        if (fields.length > 0) setSelectedIdx(0)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, isEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── State helpers ───────────────────────────────────────────────────────────

  const updateTpl = useCallback(updater => {
    setTpl(updater)
    setIsDirty(true)
  }, [])

  const selectedField = (selectedIdx !== null && tpl.fields[selectedIdx]) || null

  const updateSelectedField = useCallback(patch => {
    if (selectedIdx === null) return
    updateTpl(t => ({
      ...t,
      fields: t.fields.map((f, i) => i === selectedIdx ? { ...f, ...patch } : f),
    }))
  }, [selectedIdx, updateTpl])

  // ── Field operations ────────────────────────────────────────────────────────

  const handleAddField = () => {
    const newIdx = tpl.fields.length
    const f = emptyField()
    setTpl(prev => ({ ...prev, fields: [...prev.fields, f] }))
    setIsDirty(true)
    setSelectedIdx(newIdx)
  }

  const handleDeleteField = async (idx, e) => {
    e.stopPropagation()
    const f = tpl.fields[idx]
    const ok = await confirm({ message: `確定刪除欄位「${f.label || '（未命名）'}」？` })
    if (!ok) return
    setTpl(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) }))
    setIsDirty(true)
    setSelectedIdx(prev => {
      if (prev === null) return null
      if (prev === idx) return tpl.fields.length > 1 ? Math.max(0, idx - 1) : null
      return prev > idx ? prev - 1 : prev
    })
  }

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────

  const handleDragStart = (e, idx) => {
    dragSrcRef.current = idx
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdx !== idx) setDragOverIdx(idx)
  }

  const handleDrop = (e, idx) => {
    e.preventDefault()
    const from = dragSrcRef.current
    setDragIdx(null)
    setDragOverIdx(null)
    if (from === null || from === idx) return
    setTpl(prev => {
      const fields = [...prev.fields]
      const [moved] = fields.splice(from, 1)
      fields.splice(idx, 0, moved)
      return { ...prev, fields }
    })
    setIsDirty(true)
    setSelectedIdx(prev => {
      if (prev === from) return idx
      if (from < idx) {
        if (prev > from && prev <= idx) return prev - 1
      } else {
        if (prev >= idx && prev < from) return prev + 1
      }
      return prev
    })
  }

  const handleDragEnd = () => {
    setDragIdx(null)
    setDragOverIdx(null)
    dragSrcRef.current = null
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!tpl.name.trim()) { toast.error('請填寫表單名稱'); return }
    setSaving(true)
    try {
      // Serialise fields: options comma-string → string array
      const serialisedFields = tpl.fields.map((f, i) => ({
        key:         f.key || `field_${i}`,
        label:       f.label,
        type:        f.type,
        required:    Boolean(f.required),
        placeholder: f.placeholder || '',
        ...(f.type === 'select'
          ? { options: f.options.split(',').map(o => o.trim()).filter(Boolean) }
          : {}),
      }))

      const payload = {
        name:         tpl.name.trim(),
        category:     tpl.category,
        description:  tpl.description.trim(),
        status:       tpl.status,
        fields:       serialisedFields,
        after_submit: tpl.after_submit,
        updated_at:   new Date().toISOString(),
      }

      if (isEdit) {
        const { error } = await supabase.from('form_templates').update(payload).eq('id', id)
        if (error) throw error
        toast.success(`表單「${tpl.name}」已更新`)
        setIsDirty(false)
      } else {
        const { data, error } = await supabase
          .from('form_templates').insert(payload).select().single()
        if (error) throw error
        toast.success(`表單「${data.name}」已建立`)
        setIsDirty(false)
        navigate(`/process/sop/form/${data.id}/edit`, { replace: true })
      }
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  // ── Back navigation ─────────────────────────────────────────────────────────

  const handleBack = async () => {
    if (isDirty) {
      const ok = await confirm({
        title:        '有未儲存的變更',
        message:      '離開後，未儲存的變更將遺失。',
        confirmLabel: '離開',
        cancelLabel:  '繼續編輯',
        danger:       true,
      })
      if (!ok) return
    }
    navigate('/process/sop')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />

  const { fields } = tpl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)', flexShrink: 0,
      }}>
        <button
          onClick={handleBack}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13,
            padding: '5px 8px', borderRadius: 6,
          }}
        >
          <ArrowLeft size={15} /> 返回
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {isEdit ? `編輯表單：${tpl.name || '（未命名）'}` : '新增表單範本'}
          </div>
          {isDirty && (
            <div style={{ fontSize: 11, color: 'var(--accent-orange)' }}>● 有未儲存的變更</div>
          )}
        </div>

        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {fields.length} 個欄位
        </span>

        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Save size={14} />
          {saving ? '儲存中…' : '儲存範本'}
        </button>
      </div>

      {/* ── Two-panel body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ══════════════════════════════════════════════════
            LEFT PANEL — metadata + draggable field list
            260px fixed, scrollable internally
            ══════════════════════════════════════════════════ */}
        <div style={{
          width: 260, flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {/* — Metadata section — */}
          <div style={{ padding: '14px 14px 0', flexShrink: 0 }}>
            <SectionLabel style={{ marginBottom: 10 }}>基本資訊</SectionLabel>

            {/* Name */}
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>
                表單名稱 <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <input
                className="form-input"
                type="text"
                style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }}
                placeholder="例：差旅費用申請"
                value={tpl.name}
                onChange={e => updateTpl(t => ({ ...t, name: e.target.value }))}
              />
            </div>

            {/* Category + Status */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={labelStyle}>分類</label>
                <select
                  className="form-input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={tpl.category}
                  onChange={e => updateTpl(t => ({ ...t, category: e.target.value }))}
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>狀態</label>
                <select
                  className="form-input"
                  style={{
                    width: '100%', fontSize: 12,
                    color: STATUS_OPTIONS.find(s => s.value === tpl.status)?.color,
                  }}
                  value={tpl.status}
                  onChange={e => updateTpl(t => ({ ...t, status: e.target.value }))}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>說明</label>
              <textarea
                className="form-input"
                style={{ width: '100%', fontSize: 12, minHeight: 52, resize: 'none', boxSizing: 'border-box' }}
                placeholder="表單用途說明（選填）"
                value={tpl.description}
                onChange={e => updateTpl(t => ({ ...t, description: e.target.value }))}
              />
            </div>
          </div>

          {/* — Divider — */}
          <div style={{ height: 1, background: 'var(--border-subtle)', flexShrink: 0 }} />

          {/* — Field list header — */}
          <div style={{
            padding: '10px 14px 6px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <SectionLabel>表單欄位</SectionLabel>
            <button
              type="button"
              onClick={handleAddField}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 600,
                color: 'var(--accent-cyan)',
                background: 'var(--accent-cyan-dim)',
                border: '1px solid var(--border-accent)',
                borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
              }}
            >
              <Plus size={11} /> 新增欄位
            </button>
          </div>

          {/* — Scrollable field list — */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
            {fields.length === 0 ? (
              <div style={{
                textAlign: 'center', color: 'var(--text-muted)',
                fontSize: 12, padding: '24px 8px',
              }}>
                尚無欄位<br />點選「新增欄位」開始
              </div>
            ) : (
              fields.map((f, idx) => {
                const isSelected  = selectedIdx === idx
                const isDragging  = dragIdx === idx
                const isDragOver  = dragOverIdx === idx && dragIdx !== idx
                return (
                  <div
                    key={f.key}
                    draggable
                    onDragStart={e => handleDragStart(e, idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={e => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setSelectedIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 8px', borderRadius: 7, marginBottom: 3,
                      cursor: 'pointer',
                      background: isSelected
                        ? 'var(--accent-cyan-dim)'
                        : isDragOver
                          ? 'var(--glass-medium)'
                          : 'transparent',
                      border: isSelected
                        ? '1px solid var(--border-accent)'
                        : '1px solid transparent',
                      opacity: isDragging ? 0.35 : 1,
                      transition: 'background var(--transition-fast), border-color var(--transition-fast)',
                      userSelect: 'none',
                    }}
                  >
                    {/* Drag handle */}
                    <span style={{ color: 'var(--text-muted)', cursor: 'grab', fontSize: 14, lineHeight: 1 }}>
                      ⠿
                    </span>

                    {/* Label + type badge */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 500,
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {f.label || (
                          <em style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>（未命名）</em>
                        )}
                      </div>
                      <TypeBadge type={f.type} />
                    </div>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={e => handleDeleteField(idx, e)}
                      title="刪除欄位"
                      style={{
                        background: 'none', border: 'none', padding: 3,
                        cursor: 'pointer', color: 'var(--text-muted)',
                        borderRadius: 4, display: 'flex', alignItems: 'center',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-red)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            RIGHT PANEL — field editor (top) + live preview (bottom)
            ══════════════════════════════════════════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* —— TOP HALF: Field editor —— */}
          <div style={{
            flexShrink: 0,
            maxHeight: '50%',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-primary)',
            overflowY: 'auto',
            padding: '16px 20px',
          }}>
            <SectionLabel style={{ marginBottom: 12 }}>欄位設定</SectionLabel>

            {selectedField === null ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 8,
                height: 100, color: 'var(--text-muted)', fontSize: 13,
              }}>
                <Eye size={20} style={{ opacity: 0.35 }} />
                <span>從左側選取欄位以編輯，或點「新增欄位」</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 680 }}>

                {/* Label — full width */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>
                    欄位標籤 <span style={{ color: 'var(--accent-red)' }}>*</span>
                  </label>
                  <input
                    className="form-input"
                    type="text"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder="例：出差目的地"
                    value={selectedField.label}
                    onChange={e => updateSelectedField({ label: e.target.value })}
                    autoFocus
                  />
                </div>

                {/* Type select */}
                <div>
                  <label style={labelStyle}>欄位類型</label>
                  <select
                    className="form-input"
                    style={{ width: '100%' }}
                    value={selectedField.type}
                    onChange={e => updateSelectedField({ type: e.target.value })}
                  >
                    {FIELD_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Required toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <label style={labelStyle}>必填</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 2 }}>
                    <button
                      type="button"
                      onClick={() => updateSelectedField({ required: !selectedField.required })}
                      aria-pressed={selectedField.required}
                      style={{
                        width: 36, height: 20, borderRadius: 10, border: 'none',
                        background: selectedField.required ? 'var(--accent-cyan)' : 'var(--border-strong)',
                        cursor: 'pointer', position: 'relative', flexShrink: 0,
                        transition: 'background var(--transition-fast)',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 2,
                        left: selectedField.required ? 18 : 2,
                        width: 16, height: 16, borderRadius: '50%',
                        background: '#fff', /* #fff allowed on accent backgrounds */
                        transition: 'left var(--transition-fast)',
                        boxShadow: 'var(--shadow-sm)',
                      }} />
                    </button>
                    <span style={{
                      fontSize: 12,
                      color: selectedField.required ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    }}>
                      {selectedField.required ? '必填' : '選填'}
                    </span>
                  </div>
                </div>

                {/* Select options — only for type=select */}
                {selectedField.type === 'select' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>選項（逗號分隔）</label>
                    <input
                      className="form-input"
                      type="text"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      placeholder="例：北部, 中部, 南部, 東部"
                      value={selectedField.options}
                      onChange={e => updateSelectedField({ options: e.target.value })}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      以逗號（,）分隔各選項
                    </div>
                  </div>
                )}

                {/* Placeholder — not applicable to file type */}
                {selectedField.type !== 'file' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>提示文字（Placeholder）</label>
                    <input
                      className="form-input"
                      type="text"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      placeholder="輸入提示文字（選填）"
                      value={selectedField.placeholder}
                      onChange={e => updateSelectedField({ placeholder: e.target.value })}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* —— After-submit action bar (always visible below field editor) —— */}
          <div style={{
            flexShrink: 0,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            padding: '10px 20px',
            display: 'flex', alignItems: 'center', gap: 6,
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginRight: 8,
            }}>
              提交後動作
            </span>
            {AFTER_SUBMIT_OPTIONS.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)',
                  padding: '4px 10px', borderRadius: 5,
                  background: tpl.after_submit === opt.value ? 'var(--accent-cyan-dim)' : 'transparent',
                  border: tpl.after_submit === opt.value ? '1px solid var(--border-accent)' : '1px solid transparent',
                  transition: 'background var(--transition-fast)',
                }}
              >
                <input
                  type="radio"
                  name="after_submit"
                  value={opt.value}
                  checked={tpl.after_submit === opt.value}
                  onChange={() => updateTpl(t => ({ ...t, after_submit: opt.value }))}
                  style={{ accentColor: 'var(--accent-cyan)', margin: 0 }}
                />
                {opt.label}
              </label>
            ))}
          </div>

          {/* —— BOTTOM HALF: Live preview —— */}
          <div style={{
            flex: 1, overflowY: 'auto',
            background: 'var(--bg-tertiary)',
            padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <Eye size={13} style={{ color: 'var(--text-muted)' }} />
              <SectionLabel>表單預覽（唯讀）</SectionLabel>
            </div>

            {fields.length === 0 ? (
              <div style={{
                textAlign: 'center', color: 'var(--text-muted)',
                fontSize: 12, padding: '32px 0',
              }}>
                新增欄位後，預覽將在此顯示
              </div>
            ) : (
              <div style={{
                maxWidth: 520,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '20px 24px',
                boxShadow: 'var(--shadow-md)',
              }}>
                {/* Form header */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>
                    {tpl.name || '（未命名表單）'}
                  </div>
                  {tpl.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {tpl.description}
                    </div>
                  )}
                </div>

                <div style={{ height: 1, background: 'var(--border-subtle)', marginBottom: 16 }} />

                {/* Fields */}
                {fields.map((f, idx) => (
                  <FieldPreview key={f.key || idx} field={f} />
                ))}

                {/* Submit button (decorative) */}
                <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    disabled
                    style={{
                      background: 'var(--accent-cyan)', color: '#fff', /* #fff on accent bg */
                      border: 'none', borderRadius: 7, padding: '9px 20px',
                      fontSize: 13, fontWeight: 600, cursor: 'not-allowed', opacity: 0.7,
                    }}
                  >
                    提交申請
                  </button>
                  {tpl.after_submit !== 'none' && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      提交後：{AFTER_SUBMIT_OPTIONS.find(o => o.value === tpl.after_submit)?.label}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
