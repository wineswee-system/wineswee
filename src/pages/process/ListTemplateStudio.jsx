import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'

const DEFAULT_CATEGORIES = ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服']

const STATUS_OPTIONS = [
  { value: 'published', label: '已發布', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  { value: 'draft',     label: '草稿',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  { value: 'archived',  label: '已封存', color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
]

const COLUMN_TYPES = [
  { value: 'text',   label: '文字' },
  { value: 'select', label: '選單' },
  { value: 'number', label: '數字' },
  { value: 'date',   label: '日期' },
]

const emptyColumn = () => ({
  label: '',
  type: 'text',
  required: false,
  options: '',   // comma-separated; only relevant when type === 'select'
})

const emptyState = () => ({
  name: '',
  category: 'HR',
  description: '',
  status: 'published',
  tags: [],
  columns: [],
  defaultRows: [],
})

/**
 * ListTemplateStudio — Single-panel list-template builder.
 *
 * Routes:
 *   /process/sop/list/new         — create mode
 *   /process/sop/list/:id/edit    — edit mode
 *
 * Writes to: list_templates table
 *   columns     JSONB  [{ label, type, required, options? }]
 *   default_rows JSONB [{ "<column label>": "<cell value>" }]
 */
export default function ListTemplateStudio() {
  const { id } = useParams()   // undefined = create mode
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [state, setState] = useState(emptyState())
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)

  // ── Load reference data + existing template ──────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      // Category picker: prefer DB rows, fall back to DEFAULT_CATEGORIES
      const { data: catsData } = await supabase
        .from('workflow_categories')
        .select('id, name')
        .eq('scope', 'workflow')
        .order('name')
      if (catsData?.length > 0) setCategories(catsData.map(c => c.name))

      if (id) {
        const { data, error } = await supabase
          .from('list_templates')
          .select('*')
          .eq('id', id)
          .single()
        if (error || !data) {
          toast.error('找不到此清單範本')
          navigate('/process/sop')
          return
        }
        setState({
          name: data.name || '',
          category: data.category || 'HR',
          description: data.description || '',
          status: data.status || 'published',
          tags: Array.isArray(data.tags) ? data.tags : [],
          // Normalise columns: options array → comma-separated string for the input
          columns: Array.isArray(data.columns) ? data.columns.map(col => ({
            label: col.label || '',
            type: col.type || 'text',
            required: !!col.required,
            options: Array.isArray(col.options)
              ? col.options.join(', ')
              : (col.options || ''),
          })) : [],
          // Normalise rows: keyed by label → keyed by column index (positional)
          defaultRows: Array.isArray(data.default_rows)
            ? data.default_rows.map((row, _ri) => {
                // Rows stored by label; re-index to positional keys
                const posRow = {}
                ;(data.columns || []).forEach((col, ci) => {
                  posRow[String(ci)] = row[col.label] ?? row[String(ci)] ?? ''
                })
                return posRow
              })
            : [],
        })
      }
      setLoading(false)
    }
    fetchAll()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── State helper (marks dirty) ───────────────────────────────────────────
  const update = useCallback(updater => {
    setState(updater)
    setIsDirty(true)
  }, [])

  // ── Column operations ────────────────────────────────────────────────────
  const addColumn = () => {
    update(s => ({ ...s, columns: [...s.columns, emptyColumn()] }))
  }

  const updateColumn = (idx, patch) => {
    update(s => ({
      ...s,
      columns: s.columns.map((col, i) => i === idx ? { ...col, ...patch } : col),
    }))
  }

  const removeColumn = async (idx) => {
    const col = state.columns[idx]
    const label = col.label?.trim() || `欄位 ${idx + 1}`
    const ok = await confirm({ message: `確定刪除欄位「${label}」？` })
    if (!ok) return
    update(s => {
      const newCols = s.columns.filter((_, i) => i !== idx)
      // Re-index positional keys in every default row after the deleted column
      const newRows = s.defaultRows.map(row => {
        const cleaned = {}
        s.columns.forEach((_, i) => {
          if (i === idx) return
          const newIdx = i < idx ? i : i - 1
          cleaned[String(newIdx)] = row[String(i)] ?? ''
        })
        return cleaned
      })
      return { ...s, columns: newCols, defaultRows: newRows }
    })
  }

  // ── Default-row operations ───────────────────────────────────────────────
  const addDefaultRow = () => {
    update(s => {
      const blank = {}
      s.columns.forEach((_, i) => { blank[String(i)] = '' })
      return { ...s, defaultRows: [...s.defaultRows, blank] }
    })
  }

  const updateDefaultCell = (rowIdx, colIdx, value) => {
    update(s => ({
      ...s,
      defaultRows: s.defaultRows.map((row, ri) =>
        ri === rowIdx ? { ...row, [String(colIdx)]: value } : row
      ),
    }))
  }

  const removeDefaultRow = (rowIdx) => {
    update(s => ({ ...s, defaultRows: s.defaultRows.filter((_, ri) => ri !== rowIdx) }))
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!state.name.trim()) { toast.error('請填寫範本名稱'); return }
    if (state.columns.length === 0) { toast.error('至少新增一個欄位'); return }
    const blankCol = state.columns.findIndex(c => !c.label.trim())
    if (blankCol !== -1) { toast.error(`第 ${blankCol + 1} 個欄位尚未填寫標題`); return }

    setSaving(true)
    try {
      // Serialise columns: options string → array (select type only)
      const cleanColumns = state.columns.map(col => ({
        label: col.label.trim(),
        type: col.type,
        required: !!col.required,
        ...(col.type === 'select'
          ? { options: col.options.split(',').map(o => o.trim()).filter(Boolean) }
          : {}),
      }))

      // Serialise default rows: positional index → column label as key
      const cleanRows = state.defaultRows.map(row => {
        const out = {}
        state.columns.forEach((col, i) => {
          out[col.label.trim() || String(i)] = row[String(i)] ?? ''
        })
        return out
      })

      const payload = {
        name: state.name.trim(),
        category: state.category,
        description: state.description?.trim() || null,
        status: state.status || 'published',
        tags: state.tags?.length > 0 ? state.tags : null,
        columns: cleanColumns,
        default_rows: cleanRows.length > 0 ? cleanRows : null,
        organization_id: profile?.organization_id || null,
      }

      if (id) {
        const { data, error } = await supabase
          .from('list_templates')
          .update(payload)
          .eq('id', id)
          .select()
          .single()
        if (error) throw error
        toast.success(`清單範本「${data.name}」已更新`)
      } else {
        const { data, error } = await supabase
          .from('list_templates')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        toast.success(`清單範本「${data.name}」已建立`)
        navigate(`/process/sop/list/${data.id}/edit`, { replace: true })
      }
      setIsDirty(false)
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const handleBack = async () => {
    if (isDirty) {
      const ok = await confirm({
        title: '有未儲存的變更',
        message: '離開後，未儲存的變更將遺失。',
        confirmLabel: '離開',
        cancelLabel: '繼續編輯',
        danger: true,
      })
      if (!ok) return
    }
    navigate('/process/sop')
  }

  if (loading) return <LoadingSpinner />

  const { name, category, description, status, columns, defaultRows } = state

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)' }}>

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
          <ArrowLeft size={15} /> 返回範本庫
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {id ? `編輯：${name || '（未命名）'}` : '新增清單範本'}
          </div>
          {isDirty && (
            <div style={{ fontSize: 11, color: 'var(--accent-orange)' }}>● 有未儲存的變更</div>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Save size={14} /> {saving ? '儲存中...' : '儲存範本'}
        </button>
      </div>

      {/* ── Single-panel body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: 'var(--bg-primary)' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* ── 基本資訊 ── */}
          <section style={sectionStyle}>
            <SectionHeading>基本資訊</SectionHeading>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Field label="範本名稱" required>
                <input
                  className="form-input"
                  type="text"
                  placeholder="例：庫存盤點清單"
                  value={name}
                  onChange={e => update(s => ({ ...s, name: e.target.value }))}
                />
              </Field>

              <Field label="分類">
                <select
                  className="form-input"
                  value={category}
                  onChange={e => update(s => ({ ...s, category: e.target.value }))}
                >
                  {categories.map(c => <option key={c}>{c}</option>)}
                  {category && !categories.includes(category) && (
                    <option value={category}>{category}</option>
                  )}
                </select>
              </Field>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Field label="說明">
                <input
                  className="form-input"
                  type="text"
                  placeholder="清單範本的用途說明"
                  value={description}
                  onChange={e => update(s => ({ ...s, description: e.target.value }))}
                />
              </Field>
            </div>

            {/* Status toggle */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>
                狀態
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update(s => ({ ...s, status: opt.value }))}
                    style={{
                      padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', border: '1.5px solid',
                      borderColor: status === opt.value ? opt.color : 'var(--border-subtle)',
                      background: status === opt.value ? opt.dim : 'var(--bg-card)',
                      color: status === opt.value ? opt.color : 'var(--text-muted)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ── 欄位定義 ── */}
          <section style={sectionStyle}>
            <SectionHeading extra={
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {columns.length} 個欄位
              </span>
            }>
              欄位定義
            </SectionHeading>

            {columns.length > 0 && (
              <div style={{ marginBottom: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-card)' }}>
                      {['標題', '類型', '必填', '選項（限選單類型）', ''].map((h, i) => (
                        <th
                          key={i}
                          style={{
                            textAlign: 'left', padding: '7px 10px', fontSize: 11,
                            fontWeight: 700, color: 'var(--text-muted)',
                            borderBottom: '1px solid var(--border-subtle)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((col, ci) => (
                      <tr key={ci} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {/* Label */}
                        <td style={{ padding: '6px 10px', minWidth: 140 }}>
                          <input
                            className="form-input"
                            type="text"
                            placeholder="欄位標題"
                            value={col.label}
                            onChange={e => updateColumn(ci, { label: e.target.value })}
                            style={{ fontSize: 13 }}
                          />
                        </td>

                        {/* Type */}
                        <td style={{ padding: '6px 10px', minWidth: 110 }}>
                          <select
                            className="form-input"
                            value={col.type}
                            onChange={e => updateColumn(ci, { type: e.target.value })}
                            style={{ fontSize: 13 }}
                          >
                            {COLUMN_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </td>

                        {/* Required */}
                        <td style={{ padding: '6px 10px', textAlign: 'center', minWidth: 60 }}>
                          <input
                            type="checkbox"
                            checked={!!col.required}
                            onChange={e => updateColumn(ci, { required: e.target.checked })}
                            style={{ cursor: 'pointer', width: 15, height: 15, accentColor: 'var(--accent-cyan)' }}
                          />
                        </td>

                        {/* Options — only editable when type is 'select' */}
                        <td style={{ padding: '6px 10px', minWidth: 200 }}>
                          {col.type === 'select' ? (
                            <input
                              className="form-input"
                              type="text"
                              placeholder="選項1, 選項2, 選項3"
                              value={col.options}
                              onChange={e => updateColumn(ci, { options: e.target.value })}
                              style={{ fontSize: 12 }}
                            />
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 4px' }}>—</span>
                          )}
                        </td>

                        {/* Delete column */}
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button
                            type="button"
                            title="刪除欄位"
                            onClick={() => removeColumn(ci)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--accent-red)', padding: '3px 4px',
                              borderRadius: 5, display: 'flex', alignItems: 'center',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              type="button"
              onClick={addColumn}
              style={addRowBtnStyle}
            >
              <Plus size={14} /> 新增欄位
            </button>
          </section>

          {/* ── 預設資料 ── */}
          <section style={sectionStyle}>
            <SectionHeading extra={
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {defaultRows.length} 筆預設行
              </span>
            }>
              預設資料
            </SectionHeading>

            {columns.length === 0 ? (
              <div style={{
                fontSize: 13, color: 'var(--text-muted)', padding: '14px 0',
                textAlign: 'center', fontStyle: 'italic',
              }}>
                請先在上方新增欄位，再填寫預設資料
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-card)' }}>
                        {columns.map((col, ci) => (
                          <th
                            key={ci}
                            style={{
                              textAlign: 'left', padding: '7px 10px', fontSize: 11,
                              fontWeight: 700, color: 'var(--text-secondary)',
                              borderBottom: '1px solid var(--border-subtle)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {col.label || `欄位 ${ci + 1}`}
                            {col.required && (
                              <span style={{ color: 'var(--accent-red)', marginLeft: 2 }}>*</span>
                            )}
                          </th>
                        ))}
                        {/* Delete-row column header (spacer) */}
                        <th style={{
                          padding: '7px 8px',
                          borderBottom: '1px solid var(--border-subtle)',
                          width: 36,
                        }} />
                      </tr>
                    </thead>
                    <tbody>
                      {defaultRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={columns.length + 1}
                            style={{
                              padding: '16px 10px', textAlign: 'center',
                              color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic',
                            }}
                          >
                            尚無預設行
                          </td>
                        </tr>
                      ) : (
                        defaultRows.map((row, ri) => (
                          <tr key={ri} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            {columns.map((col, ci) => (
                              <td key={ci} style={{ padding: '5px 8px', minWidth: 120 }}>
                                <input
                                  className="form-input"
                                  type="text"
                                  placeholder={col.label || '—'}
                                  value={row[String(ci)] ?? ''}
                                  onChange={e => updateDefaultCell(ri, ci, e.target.value)}
                                  style={{ fontSize: 12 }}
                                />
                              </td>
                            ))}
                            <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                              <button
                                type="button"
                                title="移除此行"
                                onClick={() => removeDefaultRow(ri)}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: 'var(--accent-red)', padding: '3px 4px',
                                  borderRadius: 5, display: 'flex', alignItems: 'center',
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={addDefaultRow}
                  style={addRowBtnStyle}
                >
                  <Plus size={14} /> 新增預設行
                </button>
              </>
            )}
          </section>

        </div>
      </div>
    </div>
  )
}

// ── Shared style objects ─────────────────────────────────────────────────────
const sectionStyle = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: '20px 24px',
}

const addRowBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8,
  border: '1.5px dashed var(--border-medium)',
  background: 'none', color: 'var(--text-muted)', fontSize: 13,
  cursor: 'pointer',
}

// ── Internal component ───────────────────────────────────────────────────────
function SectionHeading({ children, extra }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 16,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.6,
      }}>
        {children}
      </div>
      {extra}
    </div>
  )
}
