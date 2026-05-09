import { useState, useEffect } from 'react'
import { Plus, Trash2, Settings } from 'lucide-react'
import { confirm } from '../../lib/confirm'
import {
  getProjectCustomFields, createProjectCustomField, updateProjectCustomField, deleteProjectCustomField,
  getTaskCustomFieldValues, upsertTaskCustomFieldValue,
} from '../../lib/db'

const FIELD_TYPES = [
  { value: 'text',         label: '文字' },
  { value: 'number',       label: '數字' },
  { value: 'date',         label: '日期' },
  { value: 'select',       label: '單選' },
  { value: 'multi_select', label: '複選' },
  { value: 'checkbox',     label: '勾選' },
  { value: 'url',          label: '連結' },
]

// Editor — renders field values for a task with labels. Task-level.
export function TaskCustomFieldsView({ taskId, projectId, employees = [] }) {  // eslint-disable-line no-unused-vars
  const [fields, setFields] = useState([])
  const [values, setValues] = useState({})

  useEffect(() => {
    if (!projectId) { setFields([]); return }
    getProjectCustomFields(projectId).then(({ data }) => setFields(data || []))
  }, [projectId])

  useEffect(() => {
    if (!taskId) return
    getTaskCustomFieldValues(taskId).then(({ data }) => {
      const m = {}
      for (const v of data || []) m[v.field_id] = v.value
      setValues(m)
    })
  }, [taskId])

  const save = async (field, raw) => {
    setValues(v => ({ ...v, [field.id]: raw }))
    await upsertTaskCustomFieldValue({ task_id: taskId, field_id: field.id, value: raw })
  }

  if (!fields.length) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 4 }}>此專案尚未設定自訂欄位</div>
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {fields.map(f => {
        const v = values[f.id]
        return (
          <div key={f.id}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 3 }}>
              {f.name}{f.required && ' *'}
            </label>
            {f.field_type === 'text' && (
              <input
                className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={v || ''} onChange={e => save(f, e.target.value)}
              />
            )}
            {f.field_type === 'number' && (
              <input
                type="number" className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={v ?? ''} onChange={e => save(f, e.target.value === '' ? null : Number(e.target.value))}
              />
            )}
            {f.field_type === 'date' && (
              <input
                type="date" className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={v || ''} onChange={e => save(f, e.target.value)}
              />
            )}
            {f.field_type === 'select' && (
              <select
                className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={v || ''} onChange={e => save(f, e.target.value)}
              >
                <option value="">-</option>
                {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.field_type === 'multi_select' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(f.options || []).map(o => {
                  const arr = Array.isArray(v) ? v : []
                  const on = arr.includes(o.value)
                  return (
                    <button
                      key={o.value} type="button"
                      onClick={() => save(f, on ? arr.filter(x => x !== o.value) : [...arr, o.value])}
                      style={{
                        padding: '3px 8px', borderRadius: 12, fontSize: 11,
                        border: `1px solid ${on ? o.color || 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                        background: on ? `color-mix(in srgb, ${o.color || 'var(--accent-cyan)'} 20%, transparent)` : 'transparent',
                        color: on ? (o.color || 'var(--accent-cyan)') : 'var(--text-muted)',
                        cursor: 'pointer', fontWeight: 600,
                      }}
                    >{o.label}</button>
                  )
                })}
              </div>
            )}
            {f.field_type === 'checkbox' && (
              <input
                type="checkbox" checked={!!v}
                onChange={e => save(f, e.target.checked)}
              />
            )}
            {f.field_type === 'url' && (
              <input
                type="url" className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={v || ''} onChange={e => save(f, e.target.value)}
                placeholder="https://..."
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// Admin — manage field schema at project level.
export function ProjectCustomFieldsAdmin({ projectId }) {
  const [fields, setFields] = useState([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', field_type: 'text', options: '', required: false })

  const load = async () => {
    const { data } = await getProjectCustomFields(projectId)
    setFields(data || [])
  }
  useEffect(() => { if (projectId) load() }, [projectId])

  const create = async () => {
    if (!draft.name) return
    const key = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${Date.now()}`
    const options = ['select', 'multi_select'].includes(draft.field_type) && draft.options
      ? draft.options.split(',').map(s => s.trim()).filter(Boolean).map(label => ({ label, value: label }))
      : []
    await createProjectCustomField({
      project_id: projectId,
      name: draft.name,
      field_key: key,
      field_type: draft.field_type,
      options,
      required: draft.required,
      sort_order: fields.length,
    })
    setDraft({ name: '', field_type: 'text', options: '', required: false })
    setAdding(false)
    load()
  }

  const remove = async (id) => {
    if (!(await confirm({ message: '刪除此自訂欄位？所有任務的值也會一起刪除。' }))) return
    await deleteProjectCustomField(id)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          <Settings size={14} /> 自訂欄位 ({fields.length})
        </div>
        {!adding && (
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAdding(true)}>
            <Plus size={12} /> 新增欄位
          </button>
        )}
      </div>

      {fields.map(f => (
        <div key={f.id} className="card" style={{ padding: '8px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}{f.required && ' *'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}
              {['select', 'multi_select'].includes(f.field_type) && f.options?.length > 0 && ` · ${f.options.map(o => o.label).join(', ')}`}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: '3px 7px', color: 'var(--accent-red)' }}
            onClick={() => remove(f.id)}
          ><Trash2 size={12} /></button>
        </div>
      ))}

      {adding && (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
            <input
              className="form-input" placeholder="欄位名稱（例：客戶聯絡人）"
              value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              autoFocus
            />
            <select
              className="form-input"
              value={draft.field_type} onChange={e => setDraft(d => ({ ...d, field_type: e.target.value }))}
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {['select', 'multi_select'].includes(draft.field_type) && (
            <input
              className="form-input" style={{ width: '100%', marginBottom: 8 }}
              placeholder="選項（用逗號分隔，例：低風險, 中風險, 高風險）"
              value={draft.options} onChange={e => setDraft(d => ({ ...d, options: e.target.value }))}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox" checked={draft.required}
                onChange={e => setDraft(d => ({ ...d, required: e.target.checked }))}
              /> 必填
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary" onClick={() => setAdding(false)}>取消</button>
              <button className="btn btn-primary" onClick={create}>建立</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
