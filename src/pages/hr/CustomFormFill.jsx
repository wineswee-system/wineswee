import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

import { toast } from '../../lib/toast'
// 員工填寫單一自訂表單。Reads template from form_templates, renders fields,
// submits to form_submissions.
export default function CustomFormFill() {
  const { templateId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!templateId) return
    supabase.from('form_templates').select('*').eq('id', templateId).maybeSingle()
      .then(({ data }) => {
        setTemplate(data)
        if (data?.fields) {
          // 預設值 init
          const initial = {}
          for (const f of data.fields) {
            initial[f.key] = f.default ?? (f.type === 'checkbox' ? false : '')
          }
          setData(initial)
        }
      })
      .finally(() => setLoading(false))
  }, [templateId])

  const setField = (key, val) => setData(d => ({ ...d, [key]: val }))

  const validate = () => {
    if (!template) return false
    for (const f of template.fields || []) {
      if (f.required) {
        const v = data[f.key]
        if (v === '' || v === null || v === undefined || (f.type === 'checkbox' && !v)) {
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
      const { error } = await supabase.from('form_submissions').insert({
        organization_id: profile?.organization_id || 1,
        template_id: Number(templateId),
        applicant_id: profile.id,
        data,
        status: '申請中',
      })
      if (error) throw error
      toast.success('已送出申請！')
      navigate('/hr/forms/submissions')
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
      <div style={{ marginBottom: 14 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/hr/forms')} style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}>
          <ArrowLeft size={12} /> 返回 HR 表單中心
        </button>
      </div>

      <div className="page-header">
        <h2>{template.name}</h2>
        {template.description && <p>{template.description}</p>}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(template.fields || []).map(f => (
            <FieldRender key={f.key} field={f} value={data[f.key]} onChange={v => setField(f.key, v)} />
          ))}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => navigate('/hr/forms')}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting}>
            <Send size={14} /> {submitting ? '送出中…' : '送出申請'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldRender({ field, value, onChange }) {
  const wrapper = { display: 'flex', flexDirection: 'column', gap: 4 }
  const label = (
    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
      {field.label}
      {field.required && <span style={{ color: 'var(--accent-red)', marginLeft: 4 }}>*</span>}
    </label>
  )

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
  if (field.type === 'file') {
    return (
      <div style={wrapper}>{label}
        <input className="form-input" type="file" onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          // 上傳到 Supabase Storage
          const path = `form-uploads/${Date.now()}_${file.name}`
          const { data: upload, error } = await supabase.storage.from('uploads').upload(path, file)
          if (error) return toast.error('上傳失敗：' + error.message)
          const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(upload.path)
          onChange(publicUrl)
        }} />
        {value && <a href={value} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>已上傳：{value.split('/').pop()}</a>}
      </div>
    )
  }
  return (
    <div style={wrapper}>{label}
      <input className="form-input" type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} placeholder={field.placeholder || ''} value={value || ''} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
