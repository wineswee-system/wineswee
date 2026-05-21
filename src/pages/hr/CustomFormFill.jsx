import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Send, Settings, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { safeStorageName } from '../../lib/storageSanitize'

import { toast } from '../../lib/toast'

// 預設值 token 替換（${user.name} / ${user.dept_id} / ${today} ...）
// 注意：picker 類型存 ID，需要用數字 token（${user.id} / ${user.dept_id} / ${user.store_id}）
function resolveDefaultToken(raw, profile) {
  if (typeof raw !== 'string' || !raw.includes('${')) return raw
  return raw
    .replace(/\$\{user\.id\}/g, profile?.id ?? '')
    .replace(/\$\{user\.name\}/g, profile?.name || '')
    .replace(/\$\{user\.dept_id\}/g, profile?.department_id ?? '')
    .replace(/\$\{user\.dept\}/g, profile?.dept || '')
    .replace(/\$\{user\.store_id\}/g, profile?.store_id ?? '')
    .replace(/\$\{user\.store\}/g, profile?.store || '')
    .replace(/\$\{user\.position\}/g, profile?.position || '')
    .replace(/\$\{user\.email\}/g, profile?.email || '')
    .replace(/\$\{today\}/g, new Date().toISOString().slice(0, 10))
    .replace(/\$\{now\}/g, new Date().toISOString().slice(0, 16).replace('T', ' '))
}

const PICKER_TYPES = ['employee_picker', 'department_picker', 'store_picker']

function fieldVisible(field, data) {
  const si = field.show_if
  if (!si?.field) return true
  const target = data[si.field]
  switch (si.operator) {
    case 'eq':        return String(target ?? '') === String(si.value ?? '')
    case 'neq':       return String(target ?? '') !== String(si.value ?? '')
    case 'not_empty': return target !== '' && target !== null && target !== undefined && target !== false
    case 'empty':     return target === '' || target === null || target === undefined || target === false
    default:          return true
  }
}

// 員工填寫單一自訂表單。Reads template from form_templates, renders fields,
// submits to form_submissions.
export default function CustomFormFill({ templateId: propTemplateId, embedded: propEmbedded, onClose }) {
  const params = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 可由 Modal 用 prop 傳入 templateId，否則 fallback 走 route param
  const templateId = propTemplateId ?? params.templateId
  // embedded 模式：prop 或 URL ?embedded=1（卡片型，不顯示頂部 nav）
  const isEmbedded = propEmbedded ?? (searchParams.get('embedded') === '1')
  const isModal = !!onClose  // 有 onClose 表示是 Modal 內 render
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin'].includes(role?.name)
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])

  // 只在 template 有 picker 欄位才 fetch 對應資料源
  const needPicker = useMemo(() => {
    const types = (template?.fields || []).map(f => f.type)
    return {
      employee: types.includes('employee_picker'),
      department: types.includes('department_picker'),
      store: types.includes('store_picker'),
    }
  }, [template])

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId || !template) return
    const tasks = []
    if (needPicker.employee && employees.length === 0) {
      tasks.push(
        supabase.from('employees')
          .select('id, name, name_en, position, dept, store')
          .eq('organization_id', orgId)
          .eq('status', '在職')
          .order('name')
          .then(({ data }) => setEmployees(data || []))
      )
    }
    if (needPicker.department && departments.length === 0) {
      tasks.push(
        supabase.from('departments')
          .select('id, name')
          .eq('organization_id', orgId)
          .order('name')
          .then(({ data }) => setDepartments(data || []))
      )
    }
    if (needPicker.store && stores.length === 0) {
      tasks.push(
        supabase.from('stores')
          .select('id, name')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .order('name')
          .then(({ data }) => setStores(data || []))
      )
    }
    if (tasks.length) Promise.all(tasks)
  }, [template, profile?.organization_id, needPicker])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!templateId) return
    supabase.from('form_templates').select('*').eq('id', templateId).maybeSingle()
      .then(({ data }) => {
        setTemplate(data)
        if (data?.fields) {
          // 預設值 init（section 跳過；其他欄位若 default 含 ${token} 自動替換）
          const initial = {}
          for (const f of data.fields) {
            if (f.type === 'section') continue
            const raw = f.default ?? (f.type === 'checkbox' ? false : '')
            initial[f.key] = resolveDefaultToken(raw, profile)
          }
          setData(initial)
        }
      })
      .finally(() => setLoading(false))
  }, [templateId, profile])

  const setField = (key, val) => setData(d => ({ ...d, [key]: val }))

  const validate = () => {
    if (!template) return false
    for (const f of template.fields || []) {
      if (f.type === 'section') continue
      if (!fieldVisible(f, data)) continue
      if (f.required) {
        const v = data[f.key]
        const isEmpty = f.type === 'date_range'
          ? (!v?.start || !v?.end)
          : (v === '' || v === null || v === undefined || (f.type === 'checkbox' && !v) || (Array.isArray(v) && v.length === 0))
        if (isEmpty) {
          toast.error(`「${f.label}」為必填`)
          return false
        }
      }
    }
    return true
  }

  const submit = async () => {
    if (!validate()) return
    if (!profile?.id) return toast.error('未登入')
    setSubmitting(true)
    try {
      // 隱藏欄位不送入 DB
      const visibleData = {}
      for (const f of (template?.fields || [])) {
        if (f.type === 'section') continue
        if (fieldVisible(f, data)) visibleData[f.key] = data[f.key]
      }
      const { error } = await supabase.from('form_submissions').insert({
        organization_id: profile?.organization_id || 1,
        template_id: Number(templateId),
        applicant_id: profile.id,
        data: visibleData,
        status: '申請中',
      })
      if (error) throw error
      toast.success('已送出申請！')
      if (isModal) {
        onClose()  // Modal 模式由 caller 自己 reload + 關閉
      } else {
        navigate(isEmbedded ? `/hr/forms/submissions?template=${templateId}` : '/hr/forms/submissions')
      }
    } catch (err) {
      toast.error('送出失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (!template) return (
    <div className="fade-in" style={{ padding: 32 }}>
      <button className="btn btn-secondary" onClick={() => navigate('/hr/forms')}><ArrowLeft size={14} /> 返回</button>
      <div style={{ marginTop: 20, color: 'var(--accent-red)' }}>找不到此表單模板</div>
    </div>
  )

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      {/* Modal 模式（被父元件 wrap 在 Modal 內）完全不顯示 nav，由 Modal 外殼提供關閉 */}
      {isModal ? null : isEmbedded ? (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-secondary"
            onClick={() => navigate(`/hr/forms/submissions?template=${templateId}`)}
            style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}>
            <ArrowLeft size={12} /> 取消返回
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/hr/forms')} style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}>
            <ArrowLeft size={12} /> 返回 HR 表單中心
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary"
            onClick={() => navigate(`/hr/forms/submissions?template=${templateId}`)}
            style={{ width: 'auto', padding: '4px 12px', fontSize: 12, color: 'var(--accent-cyan)' }}
            title="看這張表單已提交的紀錄">
            <FileText size={12} /> 查看紀錄
          </button>
          {isAdmin && (
            <button className="btn btn-secondary"
              onClick={() => navigate(`/hr/form-builder?edit=${templateId}`)}
              style={{ width: 'auto', padding: '4px 12px', fontSize: 12, color: 'var(--accent-purple)' }}
              title="編輯欄位 / 設定簽核流程">
              <Settings size={12} /> 管理此模板
            </button>
          )}
        </div>
      )}

      <div className="page-header">
        <h2>{template.name}</h2>
        {template.description && <p>{template.description}</p>}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 14, rowGap: 14 }}>
          {(template.fields || []).map((f, idx) => {
            if (f.type === 'section') {
              const isFirst = idx === 0
              return (
                <div key={`sec_${idx}`} style={{
                  gridColumn: '1 / -1',
                  marginTop: isFirst ? 0 : 8,
                  paddingTop: isFirst ? 0 : 12,
                  borderTop: isFirst ? 'none' : '1px solid var(--border-subtle)',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-cyan)' }}>{f.label}</div>
                  {f.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{f.description}</div>}
                </div>
              )
            }
            if (!fieldVisible(f, data)) return null
            const span = f.column_span === 1 ? 1 : 2
            return (
              <div key={f.key} style={{ gridColumn: `span ${span}` }}>
                <FieldRender
                  field={f}
                  value={data[f.key]}
                  onChange={v => setField(f.key, v)}
                  pickerData={{ employees, departments, stores }}
                />
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary"
            onClick={() => {
              if (isModal) onClose()
              else navigate(isEmbedded ? `/hr/forms/submissions?template=${templateId}` : '/hr/forms')
            }}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting}>
            <Send size={14} /> {submitting ? '送出中…' : '送出申請'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldRender({ field, value, onChange, pickerData }) {
  const wrapper = { display: 'flex', flexDirection: 'column', gap: 4 }
  const label = (
    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
      {field.label}
      {field.required && <span style={{ color: 'var(--accent-red)', marginLeft: 4 }}>*</span>}
    </label>
  )

  if (field.type === 'employee_picker') {
    const opts = empOptions(pickerData?.employees || [])
    return (
      <div style={wrapper}>{label}
        <SearchableSelect
          value={value || ''}
          onChange={v => onChange(v)}
          options={opts}
          placeholder="搜尋員工…"
        />
      </div>
    )
  }
  if (field.type === 'department_picker') {
    const opts = (pickerData?.departments || []).map(d => ({ value: d.id, label: d.name }))
    return (
      <div style={wrapper}>{label}
        <SearchableSelect
          value={value || ''}
          onChange={v => onChange(v)}
          options={opts}
          placeholder="選擇部門…"
        />
      </div>
    )
  }
  if (field.type === 'store_picker') {
    const opts = (pickerData?.stores || []).map(s => ({ value: s.id, label: s.name }))
    return (
      <div style={wrapper}>{label}
        <SearchableSelect
          value={value || ''}
          onChange={v => onChange(v)}
          options={opts}
          placeholder="選擇門市…"
        />
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div style={wrapper}>{label}
        <textarea className="form-input" rows={field.rows || 4} placeholder={field.placeholder || ''} value={value || ''} onChange={e => onChange(e.target.value)} />
      </div>
    )
  }
  if (field.type === 'select') {
    const options = (field.options || '').split('\n').map(s => s.trim()).filter(Boolean)
    return (
      <div style={wrapper}>{label}
        <select className="form-input" value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">請選擇</option>
          {options.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
        </select>
      </div>
    )
  }
  if (field.type === 'checkbox') {
    return (
      <div style={wrapper}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
          {field.label}
          {field.required && <span style={{ color: 'var(--accent-red)' }}>*</span>}
        </label>
      </div>
    )
  }
  if (field.type === 'date_range') {
    const start = value?.start || ''
    const end = value?.end || ''
    const days = (start && end)
      ? Math.max(0, Math.round((new Date(end) - new Date(start)) / 86400000) + 1)
      : null
    return (
      <div style={wrapper}>{label}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="form-input" type="date" style={{ flex: 1 }} value={start}
            onChange={e => onChange({ ...value, start: e.target.value })} />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>→</span>
          <input className="form-input" type="date" style={{ flex: 1 }} value={end}
            onChange={e => onChange({ ...value, end: e.target.value })} />
          {days !== null && (
            <span style={{ fontSize: 12, color: 'var(--accent-cyan)', whiteSpace: 'nowrap' }}>共 {days} 天</span>
          )}
        </div>
      </div>
    )
  }

  if (field.type === 'file') {
    const maxFiles = field.max_files ?? 1
    const fileList = Array.isArray(value) ? value : (value ? [{ url: value, name: String(value).split('/').pop() }] : [])
    const canAdd = fileList.length < maxFiles

    const uploadFile = async (file) => {
      const path = `form-uploads/${Date.now()}_${safeStorageName(file.name)}`
      const { data: upload, error } = await supabase.storage.from('uploads').upload(path, file)
      if (error) { toast.error('上傳失敗：' + error.message); return null }
      const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(upload.path)
      return { url: publicUrl, name: file.name }
    }

    if (maxFiles === 1) {
      return (
        <div style={wrapper}>{label}
          <input className="form-input" type="file" onChange={async e => {
            const file = e.target.files?.[0]
            if (!file) return
            const result = await uploadFile(file)
            if (result) onChange(result.url)
          }} />
          {fileList[0] && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <a href={fileList[0].url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)' }}>{fileList[0].name}</a>
              <button type="button" onClick={() => onChange(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
            </div>
          )}
        </div>
      )
    }

    return (
      <div style={wrapper}>{label}
        {canAdd && (
          <input className="form-input" type="file" multiple onChange={async e => {
            const files = Array.from(e.target.files || [])
            const remaining = maxFiles - fileList.length
            const toUpload = files.slice(0, remaining)
            const results = await Promise.all(toUpload.map(uploadFile))
            onChange([...fileList, ...results.filter(Boolean)])
            e.target.value = ''
          }} />
        )}
        {fileList.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {fileList.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 8px', background: 'var(--glass-light)', borderRadius: 4 }}>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'var(--accent-cyan)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</a>
                <button type="button" onClick={() => onChange(fileList.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{fileList.length}/{maxFiles} 個</div>
      </div>
    )
  }
  return (
    <div style={wrapper}>{label}
      <input className="form-input" type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} placeholder={field.placeholder || ''} value={value || ''} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
