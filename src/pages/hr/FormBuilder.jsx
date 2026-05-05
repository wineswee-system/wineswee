import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, FileText, ToggleLeft, ToggleRight, GripVertical, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = [
  { value: 'attendance', label: '📅 假勤申請' },
  { value: 'personnel',  label: '🏃 人事異動' },
  { value: 'expense',    label: '💰 費用 / 出差' },
  { value: 'other',      label: '📋 其他' },
]

const FIELD_TYPES = [
  { value: 'text',     label: '單行文字' },
  { value: 'textarea', label: '多行文字' },
  { value: 'number',   label: '數字' },
  { value: 'date',     label: '日期' },
  { value: 'select',   label: '下拉選單' },
  { value: 'checkbox', label: '勾選框' },
  { value: 'file',     label: '檔案上傳' },
]

const COLORS = ['cyan', 'blue', 'green', 'orange', 'red', 'purple', 'yellow']

export default function FormBuilder() {
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin'].includes(role?.name || profile?.role)
  const [templates, setTemplates] = useState([])
  const [chains, setChains] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = closed, {} = new, {...} = edit existing

  const load = async () => {
    setLoading(true)
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from('form_templates').select('*, creator:employees!created_by(id,name)').order('sort_order').order('id', { ascending: false }),
      supabase.from('approval_chains').select('id, name, category').eq('is_active', true).order('id'),
    ])
    setTemplates(t || [])
    setChains(c || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openNew = () => setEditing({
    name: '', category: 'other', description: '',
    icon: 'FileText', color: 'cyan',
    approval_chain_id: null, fields: [], is_active: true, sort_order: 0,
  })

  const openEdit = (t) => setEditing({ ...t, fields: Array.isArray(t.fields) ? t.fields : [] })

  const handleDelete = async (t) => {
    if (!confirm(`確定刪除模板「${t.name}」？已提交的申請不受影響。`)) return
    await supabase.from('form_templates').delete().eq('id', t.id)
    load()
  }

  const handleToggleActive = async (t) => {
    await supabase.from('form_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    load()
  }

  if (loading) return <LoadingSpinner />
  if (!isAdmin) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>需要 admin 權限</div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>表單建立器</h2>
            <p>建立 / 維護自訂表單模板，員工會在 HR 表單中心看到</p>
          </div>
          <button className="btn btn-primary" onClick={openNew}><Plus size={14} /> 新增模板</button>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>分類</th>
                <th>欄位數</th>
                <th>簽核鏈</th>
                <th>狀態</th>
                <th>建立者</th>
                <th>建立日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無模板，按「新增模板」開始</td></tr>
              )}
              {templates.map(t => {
                const chain = chains.find(c => c.id === t.approval_chain_id)
                const cat = CATEGORIES.find(c => c.value === t.category)
                return (
                  <tr key={t.id}>
                    <td><b>{t.name}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.description || ''}</div></td>
                    <td><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--glass-light)' }}>{cat?.label || t.category}</span></td>
                    <td style={{ textAlign: 'center' }}>{(t.fields || []).length}</td>
                    <td style={{ fontSize: 12 }}>{chain?.name || <span style={{ color: 'var(--text-muted)' }}>無</span>}</td>
                    <td>
                      <button onClick={() => handleToggleActive(t)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        {t.is_active
                          ? <ToggleRight size={20} style={{ color: 'var(--accent-green)' }} />
                          : <ToggleLeft size={20} style={{ color: 'var(--text-muted)' }} />}
                      </button>
                    </td>
                    <td style={{ fontSize: 12 }}>{t.creator?.name || '—'}</td>
                    <td style={{ fontSize: 12 }}>{t.created_at?.slice(0, 10)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openEdit(t)}>
                          <Pencil size={11} /> 編輯
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(t)}>
                          <Trash2 size={11} /> 刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <TemplateEditor
          template={editing}
          chains={chains}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          createdBy={profile?.id}
          orgId={profile?.organization_id || 1}
        />
      )}
    </div>
  )
}

function TemplateEditor({ template, chains, onClose, onSaved, createdBy, orgId }) {
  const [form, setForm] = useState({ ...template })
  const [saving, setSaving] = useState(false)

  const setF = (k, v) => setForm(s => ({ ...s, [k]: v }))

  const addField = () => setF('fields', [
    ...(form.fields || []),
    { key: `field_${Date.now()}`, label: '', type: 'text', required: false },
  ])

  const updateField = (idx, patch) => {
    const next = [...(form.fields || [])]
    next[idx] = { ...next[idx], ...patch }
    setF('fields', next)
  }

  const removeField = (idx) => {
    const next = [...(form.fields || [])]
    next.splice(idx, 1)
    setF('fields', next)
  }

  const moveField = (idx, dir) => {
    const next = [...(form.fields || [])]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    [next[idx], next[j]] = [next[j], next[idx]]
    setF('fields', next)
  }

  const save = async () => {
    if (!form.name?.trim()) return alert('請填模板名稱')
    if (!(form.fields || []).length) return alert('至少要 1 個欄位')
    for (const f of form.fields) {
      if (!f.key || !f.label) return alert(`欄位「${f.label || f.key}」缺 key 或 label`)
      if (f.type === 'select' && !(f.options || '').trim()) return alert(`下拉選單「${f.label}」需要設選項`)
    }
    setSaving(true)
    try {
      const payload = {
        organization_id: form.organization_id ?? orgId,
        name: form.name.trim(),
        category: form.category || 'other',
        description: form.description || null,
        icon: form.icon || 'FileText',
        color: form.color || 'cyan',
        approval_chain_id: form.approval_chain_id ? Number(form.approval_chain_id) : null,
        fields: form.fields,
        is_active: form.is_active !== false,
        sort_order: form.sort_order || 0,
      }
      if (form.id) {
        await supabase.from('form_templates').update(payload).eq('id', form.id)
      } else {
        await supabase.from('form_templates').insert({ ...payload, created_by: createdBy })
      }
      onSaved()
    } catch (err) {
      alert('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={form.id ? `編輯模板 — ${form.name}` : '新增表單模板'} onClose={onClose} onSubmit={save} submitLabel={saving ? '儲存中…' : '儲存'} maxWidth={900}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="表單名稱"><input className="form-input" value={form.name || ''} onChange={e => setF('name', e.target.value)} /></Field>
        <Field label="分類">
          <select className="form-input" value={form.category} onChange={e => setF('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="描述（員工會看到）">
        <input className="form-input" value={form.description || ''} onChange={e => setF('description', e.target.value)} placeholder="例：員工申請外部訓練課程..." />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="顏色標籤">
          <select className="form-input" value={form.color} onChange={e => setF('color', e.target.value)}>
            {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="簽核鏈（可空）">
          <select className="form-input" value={form.approval_chain_id || ''} onChange={e => setF('approval_chain_id', e.target.value || null)}>
            <option value="">不需簽核（直接通過）</option>
            {chains.map(c => <option key={c.id} value={c.id}>{c.name}（{c.category}）</option>)}
          </select>
        </Field>
      </div>

      <div style={{ marginTop: 16, padding: 14, background: 'var(--glass-light)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700 }}>📝 表單欄位（{(form.fields || []).length}）</div>
          <button className="btn btn-secondary" type="button" onClick={addField} style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}>
            <Plus size={12} /> 新增欄位
          </button>
        </div>
        {(form.fields || []).length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>尚未加任何欄位</div>
        )}
        {(form.fields || []).map((field, idx) => (
          <div key={idx} style={{ border: '1px solid var(--border-medium)', borderRadius: 8, padding: 10, marginBottom: 8, background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" onClick={() => moveField(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
                <button type="button" onClick={() => moveField(idx, 1)} disabled={idx === form.fields.length - 1} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: idx === form.fields.length - 1 ? 0.3 : 1 }}>▼</button>
              </div>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>欄位 #{idx + 1}</div>
              <button type="button" onClick={() => removeField(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><X size={16} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 8 }}>
              <Field label="顯示名稱"><input className="form-input" style={{ fontSize: 12 }} value={field.label} onChange={e => updateField(idx, { label: e.target.value })} /></Field>
              <Field label="變數名 (英文)"><input className="form-input" style={{ fontSize: 12 }} value={field.key} onChange={e => updateField(idx, { key: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} /></Field>
              <Field label="類型">
                <select className="form-input" style={{ fontSize: 12 }} value={field.type} onChange={e => updateField(idx, { type: e.target.value })}>
                  {FIELD_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
                </select>
              </Field>
            </div>
            {(field.type === 'select') && (
              <Field label="選項（每行一個）">
                <textarea className="form-input" rows={3} style={{ fontSize: 12 }} value={field.options || ''} onChange={e => updateField(idx, { options: e.target.value })} placeholder="選項一&#10;選項二&#10;選項三" />
              </Field>
            )}
            {(field.type === 'text' || field.type === 'textarea' || field.type === 'number') && (
              <Field label="提示文字（placeholder）">
                <input className="form-input" style={{ fontSize: 12 }} value={field.placeholder || ''} onChange={e => updateField(idx, { placeholder: e.target.value })} />
              </Field>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 6 }}>
              <input type="checkbox" checked={!!field.required} onChange={e => updateField(idx, { required: e.target.checked })} />
              必填
            </label>
          </div>
        ))}
      </div>
    </Modal>
  )
}
