import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Copy, Check, Eye, Code, Settings, ChevronUp, ChevronDown, FileText, BarChart3, ClipboardList } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getCRMForms, createCRMForm, updateCRMForm, deleteCRMForm, getCRMFormSubmissions, createCRMFormSubmission } from '../../lib/db'
import { getEventBus } from '../../lib/events/index.js'
import { FORM_FIELD_TYPES, createFormDefinition, DEFAULT_PIPELINES } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const STATUS_BADGE = {
  draft: 'badge-neutral',
  active: 'badge-success',
  archived: 'badge-neutral',
}
const STATUS_LABEL = { draft: '草稿', active: '啟用中', archived: '已封存' }

const SALES_REPS = ['王經理', '李業務', '陳主任', '張專員', '林業務']

function generateId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function generateCode() {
  return 'FORM-' + Date.now().toString(36).toUpperCase().slice(-6)
}

export default function FormBuilder() {
  const [tab, setTab] = useState('list')
  const [forms, setForms] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Builder state
  const [editingForm, setEditingForm] = useState(null)
  const [editingId, setEditingId] = useState(null) // null = new, number = existing
  const [showSettings, setShowSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [showEmbedModal, setShowEmbedModal] = useState(false)
  const [embedFormId, setEmbedFormId] = useState(null)
  const [copiedEmbed, setCopiedEmbed] = useState(false)

  // Submissions filter
  const [subFormFilter, setSubFormFilter] = useState('')

  // Load data
  useEffect(() => {
    Promise.all([
      getCRMForms(),
      getCRMFormSubmissions(),
    ])
      .then(([f, s]) => {
        setForms(f.data || [])
        setSubmissions(s.data || [])
      })
      .catch(err => {
        console.error('Failed to load forms:', err)
        setError('資料載入失敗，請重新整理頁面')
      })
      .finally(() => setLoading(false))
  }, [])

  // New field defaults
  const newField = () => ({ id: generateId(), type: 'text', label: '', required: false, placeholder: '', options: [] })

  // Start building a new form
  const startNewForm = () => {
    const f = createFormDefinition({ name: '', description: '' })
    setEditingForm(f)
    setEditingId(null)
    setShowSettings(false)
    setTab('builder')
  }

  // Edit existing
  const editForm = (form) => {
    setEditingForm({
      name: form.name,
      description: form.description || '',
      fields: form.fields || [],
      settings: form.settings || {},
      style: form.style || {},
      status: form.status,
      submissions: form.submissions_count || 0,
    })
    setEditingId(form.id)
    setShowSettings(false)
    setTab('builder')
  }

  // Save form
  const saveForm = async () => {
    if (!editingForm.name || saving) return
    setSaving(true)
    try {
      const payload = {
        name: editingForm.name,
        description: editingForm.description,
        fields: editingForm.fields,
        settings: editingForm.settings,
        style: editingForm.style || {},
        status: editingForm.status || 'draft',
      }

      if (editingId) {
        // Update existing
        const { data, error: err } = await updateCRMForm(editingId, payload)
        if (err) throw err
        setForms(prev => prev.map(f => f.id === editingId ? data : f))
      } else {
        // Create new
        payload.code = generateCode()
        const { data, error: err } = await createCRMForm(payload)
        if (err) throw err
        setForms(prev => [data, ...prev])
      }
      setTab('list')
      setEditingForm(null)
      setEditingId(null)
    } catch (err) {
      console.error('Save form failed:', err)
      alert('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  // Delete form
  const deleteForm = async (id) => {
    if (!confirm('確定要刪除此表單？相關提交紀錄也會一併刪除。')) return
    const { error: err } = await deleteCRMForm(id)
    if (err) { alert('刪除失敗'); return }
    setForms(prev => prev.filter(f => f.id !== id))
    setSubmissions(prev => prev.filter(s => s.form_id !== id))
  }

  // Toggle form status
  const toggleStatus = async (id, newStatus) => {
    const { data, error: err } = await updateCRMForm(id, { status: newStatus })
    if (err) { alert('狀態更新失敗'); return }
    setForms(prev => prev.map(f => f.id === id ? data : f))
  }

  // Field operations on editingForm
  const updateField = (fieldId, key, value) => {
    setEditingForm(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, [key]: value } : f),
    }))
  }

  const addField = () => {
    setEditingForm(prev => ({ ...prev, fields: [...prev.fields, newField()] }))
  }

  const removeField = (fieldId) => {
    setEditingForm(prev => ({ ...prev, fields: prev.fields.filter(f => f.id !== fieldId) }))
  }

  const moveField = (index, direction) => {
    setEditingForm(prev => {
      const fields = [...prev.fields]
      const target = index + direction
      if (target < 0 || target >= fields.length) return prev
      ;[fields[index], fields[target]] = [fields[target], fields[index]]
      return { ...prev, fields }
    })
  }

  const updateSettings = (key, value) => {
    setEditingForm(prev => ({ ...prev, settings: { ...prev.settings, [key]: value } }))
  }

  // Embed code
  const getEmbedCode = (formId) => {
    return `<!-- SME-OPS Lead Capture Form -->
<div id="smeops-form-${formId}"></div>
<script src="https://cdn.smeops.local/forms/embed.js"></script>
<script>
  SMEOps.renderForm('${formId}', {
    container: '#smeops-form-${formId}',
    theme: 'default'
  });
</script>`
  }

  const copyEmbed = (formId) => {
    navigator.clipboard.writeText(getEmbedCode(formId)).then(() => {
      setCopiedEmbed(true)
      setTimeout(() => setCopiedEmbed(false), 2000)
    })
  }

  // Filtered submissions
  const filteredSubs = subFormFilter
    ? submissions.filter(s => s.form_id === Number(subFormFilter))
    : submissions

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--accent-red)' }}>{error}</div>

  const tabs = [
    { key: 'list', label: '📋 表單列表' },
    { key: 'builder', label: '✏️ 建立表單' },
    { key: 'submissions', label: '📊 提交紀錄' },
  ]

  // Stats
  const totalForms = forms.length
  const activeForms = forms.filter(f => f.status === 'active').length
  const totalSubmissions = forms.reduce((s, f) => s + (f.submissions_count || 0), 0)
  const avgSubmissions = activeForms > 0 ? Math.round(totalSubmissions / activeForms) : 0

  return (
    <div>
      <div className="page-header">
        <h1>📝 表單建立器</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>建立潛在客戶擷取表單，嵌入網站自動收集名單</p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">全部表單</div>
          <div className="stat-value">{totalForms}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">啟用中</div>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{activeForms}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">總提交數</div>
          <div className="stat-value" style={{ color: 'var(--accent-cyan)' }}>{totalSubmissions}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均提交/表單</div>
          <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>{avgSubmissions}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border-primary)', paddingBottom: 8 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { if (t.key === 'builder' && !editingForm) startNewForm(); else setTab(t.key) }}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: tab === t.key ? 'var(--accent-cyan)' : 'transparent',
              color: tab === t.key ? '#000' : 'var(--text-secondary)',
              fontWeight: tab === t.key ? 600 : 400,
              fontSize: 14,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB: Form List */}
      {tab === 'list' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>表單列表</h3>
            <button className="btn btn-primary" onClick={startNewForm} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} /> 新增表單
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>表單名稱</th>
                <th>說明</th>
                <th>狀態</th>
                <th>欄位數</th>
                <th>提交數</th>
                <th>建立日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {forms.map(f => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td style={{ color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description || '-'}</td>
                  <td><span className={`badge ${STATUS_BADGE[f.status]}`}>{STATUS_LABEL[f.status]}</span></td>
                  <td>{(f.fields || []).length}</td>
                  <td style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{f.submissions_count || 0}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{new Date(f.created_at).toLocaleDateString('zh-TW')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => editForm(f)} title="編輯">
                        <Settings size={14} />
                      </button>
                      {f.status === 'draft' && (
                        <button className="btn btn-sm" onClick={() => toggleStatus(f.id, 'active')} title="啟用" style={{ color: 'var(--accent-green)' }}>
                          <Check size={14} />
                        </button>
                      )}
                      {f.status === 'active' && (
                        <button className="btn btn-sm" onClick={() => toggleStatus(f.id, 'archived')} title="封存" style={{ color: 'var(--accent-orange)' }}>
                          <FileText size={14} />
                        </button>
                      )}
                      {f.status === 'archived' && (
                        <button className="btn btn-sm" onClick={() => toggleStatus(f.id, 'active')} title="重新啟用" style={{ color: 'var(--accent-green)' }}>
                          <Check size={14} />
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => { setEmbedFormId(f.id); setShowEmbedModal(true) }} title="取得嵌入碼" style={{ color: 'var(--accent-purple)' }}>
                        <Code size={14} />
                      </button>
                      <button className="btn btn-sm" onClick={() => deleteForm(f.id)} title="刪除" style={{ color: 'var(--accent-red)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {forms.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無表單，點擊「新增表單」開始建立</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB: Builder */}
      {tab === 'builder' && editingForm && (
        <div style={{ display: 'grid', gridTemplateColumns: showPreview ? '1fr 1fr' : '1fr', gap: 24 }}>
          {/* Left: Editor */}
          <div>
            {/* Form Meta */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><h3>表單資訊</h3></div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>表單名稱 *</label>
                  <input className="form-input" value={editingForm.name} onChange={e => setEditingForm(p => ({ ...p, name: e.target.value }))} placeholder="例：官網聯繫表單" />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>說明</label>
                  <input className="form-input" value={editingForm.description} onChange={e => setEditingForm(p => ({ ...p, description: e.target.value }))} placeholder="表單用途說明" />
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>表單欄位 ({editingForm.fields.length})</h3>
                <button className="btn btn-primary btn-sm" onClick={addField} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} /> 新增欄位
                </button>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {editingForm.fields.map((field, idx) => (
                  <div key={field.id} style={{ border: '1px solid var(--border-primary)', borderRadius: 8, padding: 12, background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <GripVertical size={16} style={{ color: 'var(--text-tertiary)', cursor: 'grab' }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>欄位 {idx + 1}</span>
                        <span className="badge badge-info" style={{ fontSize: 11 }}>
                          {FORM_FIELD_TYPES.find(t => t.value === field.type)?.label || field.type}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm" onClick={() => moveField(idx, -1)} disabled={idx === 0} title="上移"><ChevronUp size={14} /></button>
                        <button className="btn btn-sm" onClick={() => moveField(idx, 1)} disabled={idx === editingForm.fields.length - 1} title="下移"><ChevronDown size={14} /></button>
                        <button className="btn btn-sm" onClick={() => removeField(field.id)} title="刪除" style={{ color: 'var(--accent-red)' }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: 2, fontSize: 12, color: 'var(--text-secondary)' }}>類型</label>
                        <select className="form-input" value={field.type} onChange={e => updateField(field.id, 'type', e.target.value)}>
                          {FORM_FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: 2, fontSize: 12, color: 'var(--text-secondary)' }}>標籤 *</label>
                        <input className="form-input" value={field.label} onChange={e => updateField(field.id, 'label', e.target.value)} placeholder="欄位名稱" />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: 2, fontSize: 12, color: 'var(--text-secondary)' }}>Placeholder</label>
                        <input className="form-input" value={field.placeholder || ''} onChange={e => updateField(field.id, 'placeholder', e.target.value)} placeholder="提示文字" />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 2 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={field.required} onChange={e => updateField(field.id, 'required', e.target.checked)} />
                          必填
                        </label>
                      </div>
                    </div>
                    {/* Options for select/radio/checkbox */}
                    {['select', 'radio', 'checkbox'].includes(field.type) && (
                      <div style={{ marginTop: 8 }}>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>選項（每行一個）</label>
                        <textarea
                          className="form-input"
                          rows={3}
                          value={(field.options || []).join('\n')}
                          onChange={e => updateField(field.id, 'options', e.target.value.split('\n').filter(Boolean))}
                          placeholder="選項 A&#10;選項 B&#10;選項 C"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {editingForm.fields.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>尚無欄位，點擊「新增欄位」開始</div>
                )}
              </div>
            </div>

            {/* Settings */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setShowSettings(!showSettings)}>
                <h3>表單設定</h3>
                {showSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              {showSettings && (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>送出按鈕文字</label>
                    <input className="form-input" value={editingForm.settings.submitButtonText || ''} onChange={e => updateSettings('submitButtonText', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>成功訊息</label>
                    <textarea className="form-input" rows={2} value={editingForm.settings.successMessage || ''} onChange={e => updateSettings('successMessage', e.target.value)} style={{ resize: 'vertical' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>自動指派業務</label>
                    <select className="form-input" value={editingForm.settings.assignTo || ''} onChange={e => updateSettings('assignTo', e.target.value)}>
                      <option value="">不指派</option>
                      {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={editingForm.settings.createDeal || false} onChange={e => updateSettings('createDeal', e.target.checked)} />
                      自動建立商機
                    </label>
                  </div>
                  {editingForm.settings.createDeal && (
                    <div>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>商機漏斗</label>
                      <select className="form-input" value={editingForm.settings.dealPipeline || ''} onChange={e => updateSettings('dealPipeline', e.target.value)}>
                        {DEFAULT_PIPELINES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>通知 Email</label>
                    <input className="form-input" type="email" value={editingForm.settings.notifyEmail || ''} onChange={e => updateSettings('notifyEmail', e.target.value)} placeholder="填寫後每次提交會寄通知" />
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-primary" onClick={saveForm} disabled={!editingForm.name || saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={16} /> {saving ? '儲存中...' : '儲存表單'}
              </button>
              <button className="btn" onClick={() => setShowPreview(!showPreview)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={16} /> {showPreview ? '隱藏預覽' : '顯示預覽'}
              </button>
              <button className="btn" onClick={() => { setTab('list'); setEditingForm(null); setEditingId(null) }}>
                取消
              </button>
            </div>
          </div>

          {/* Right: Live Preview */}
          {showPreview && (
            <div>
              <div className="card" style={{ position: 'sticky', top: 16 }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3>即時預覽</h3>
                  <span className="badge badge-info">Widget 樣式</span>
                </div>
                <div style={{ padding: 24, background: 'var(--bg-primary)', borderRadius: '0 0 12px 12px' }}>
                  {/* Widget Preview */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: 12,
                    padding: 24,
                    maxWidth: 420,
                    margin: '0 auto',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
                    border: '1px solid #e5e7eb',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                    color: '#1f2937',
                  }}>
                    {editingForm.name && (
                      <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#111827' }}>{editingForm.name}</h3>
                    )}
                    {editingForm.description && (
                      <p style={{ margin: '0 0 16px 0', fontSize: 13, color: '#6b7280' }}>{editingForm.description}</p>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {editingForm.fields.filter(f => f.type !== 'hidden').map(field => (
                        <div key={field.id}>
                          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#374151' }}>
                            {field.label || '（未命名）'}
                            {field.required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                          </label>
                          {field.type === 'textarea' ? (
                            <textarea
                              readOnly
                              placeholder={field.placeholder}
                              rows={3}
                              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, background: '#f9fafb', resize: 'none', color: '#9ca3af', boxSizing: 'border-box' }}
                            />
                          ) : field.type === 'select' ? (
                            <select disabled style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, background: '#f9fafb', color: '#9ca3af', boxSizing: 'border-box' }}>
                              <option>{field.placeholder || '請選擇'}</option>
                              {(field.options || []).map((opt, i) => <option key={i}>{opt}</option>)}
                            </select>
                          ) : field.type === 'radio' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {(field.options || []).length > 0
                                ? field.options.map((opt, i) => (
                                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151' }}>
                                      <input type="radio" name={`preview-${field.id}`} disabled /> {opt}
                                    </label>
                                  ))
                                : <span style={{ fontSize: 13, color: '#9ca3af' }}>（請設定選項）</span>
                              }
                            </div>
                          ) : field.type === 'checkbox' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {(field.options || []).length > 0
                                ? field.options.map((opt, i) => (
                                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151' }}>
                                      <input type="checkbox" disabled /> {opt}
                                    </label>
                                  ))
                                : <span style={{ fontSize: 13, color: '#9ca3af' }}>（請設定選項）</span>
                              }
                            </div>
                          ) : (
                            <input
                              readOnly
                              type={field.type === 'date' ? 'date' : 'text'}
                              placeholder={field.placeholder}
                              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, background: '#f9fafb', color: '#9ca3af', boxSizing: 'border-box' }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <button style={{
                      marginTop: 18,
                      width: '100%',
                      padding: '10px 0',
                      borderRadius: 8,
                      border: 'none',
                      background: editingForm.style?.primaryColor || '#22d3ee',
                      color: '#000',
                      fontWeight: 600,
                      fontSize: 15,
                      cursor: 'pointer',
                    }}>
                      {editingForm.settings.submitButtonText || '送出'}
                    </button>
                    <p style={{ textAlign: 'center', margin: '10px 0 0 0', fontSize: 11, color: '#9ca3af' }}>
                      Powered by SME-OPS
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Submissions */}
      {tab === 'submissions' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3>提交紀錄</h3>
            <select className="form-input" style={{ width: 'auto', minWidth: 200 }} value={subFormFilter} onChange={e => setSubFormFilter(e.target.value)}>
              <option value="">全部表單</option>
              {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {filteredSubs.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>表單</th>
                    {/* Gather all unique field keys */}
                    {[...new Set(filteredSubs.flatMap(s => Object.keys(s.data || {})))].map(key => (
                      <th key={key}>{key}</th>
                    ))}
                    <th>提交時間</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubs.map((sub, idx) => {
                    const allKeys = [...new Set(filteredSubs.flatMap(s => Object.keys(s.data || {})))]
                    const formName = forms.find(f => f.id === sub.form_id)?.name || sub.form_id
                    return (
                      <tr key={sub.id}>
                        <td style={{ color: 'var(--text-secondary)' }}>{idx + 1}</td>
                        <td><span className="badge badge-info">{formName}</span></td>
                        {allKeys.map(key => (
                          <td key={key} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(sub.data || {})[key] || '-'}
                          </td>
                        ))}
                        <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {new Date(sub.submitted_at).toLocaleString('zh-TW')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <ClipboardList size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p>尚無提交紀錄</p>
            </div>
          )}
        </div>
      )}

      {/* Embed Code Modal */}
      {showEmbedModal && (
        <Modal title="嵌入程式碼" onClose={() => { setShowEmbedModal(false); setCopiedEmbed(false) }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              將以下程式碼貼入您的網站 HTML 中，即可顯示此表單。
            </p>
            <pre style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 8,
              padding: 16,
              fontSize: 12,
              lineHeight: 1.6,
              overflow: 'auto',
              maxHeight: 240,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: 'var(--text-primary)',
            }}>
              {getEmbedCode(embedFormId)}
            </pre>
            <button
              className="btn btn-primary"
              onClick={() => copyEmbed(embedFormId)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              {copiedEmbed ? <><Check size={16} /> 已複製！</> : <><Copy size={16} /> 複製程式碼</>}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
