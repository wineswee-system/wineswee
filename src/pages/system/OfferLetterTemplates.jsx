import { useState, useEffect } from 'react'
import { Plus, Edit3, Trash2, Star, StarOff, FileText } from 'lucide-react'
import {
  getOfferLetterTemplates,
  createOfferLetterTemplate,
  updateOfferLetterTemplate,
  deleteOfferLetterTemplate,
} from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const PLACEHOLDERS = [
  { token: '{{candidate_name}}', label: '候選人姓名' },
  { token: '{{position}}',       label: '職位名稱' },
  { token: '{{dept}}',           label: '部門' },
  { token: '{{salary}}',         label: '月薪' },
  { token: '{{start_date}}',     label: '到職日' },
  { token: '{{probation_days}}', label: '試用期天數' },
  { token: '{{company_name}}',   label: '公司名稱' },
  { token: '{{signed_date}}',    label: '發函日期' },
]

const DEFAULT_BODY = `<p>親愛的 {{candidate_name}} 您好，</p>

<p>感謝您應徵本公司 <strong>{{position}}</strong> 一職。經本公司審慎評估，我們誠摯地邀請您加入 {{company_name}}。</p>

<p>以下為錄取條件：</p>
<ul>
  <li>職位：{{position}}</li>
  <li>部門：{{dept}}</li>
  <li>月薪：NT$ {{salary}}</li>
  <li>到職日：{{start_date}}</li>
  <li>試用期：{{probation_days}} 天</li>
</ul>

<p>請於收到本通知後 5 個工作日內回覆確認，逾期視同婉拒。</p>

<p>此致</p>
<p>{{company_name}}<br/>{{signed_date}}</p>`

const emptyForm = () => ({ name: '', body_html: DEFAULT_BODY, is_default: false })

export default function OfferLetterTemplates() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    getOfferLetterTemplates(orgId).then(({ data }) => {
      setTemplates(data || [])
      setLoading(false)
    })
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setEditing(null); setForm(emptyForm()); setShowModal(true) }
  const openEdit = (t) => {
    setEditing(t)
    setForm({ name: t.name, body_html: t.body_html, is_default: t.is_default })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast('請填寫範本名稱'); return }
    if (editing) {
      const { data } = await updateOfferLetterTemplate(editing.id, {
        name: form.name, body_html: form.body_html, is_default: form.is_default,
      })
      if (data) setTemplates(prev => prev.map(t => t.id === editing.id ? data : t))
    } else {
      const { data } = await createOfferLetterTemplate({ ...form, organization_id: orgId })
      if (data) setTemplates(prev => [...prev, data])
    }
    setShowModal(false)
  }

  const handleSetDefault = async (t) => {
    const current = templates.find(x => x.is_default && x.id !== t.id)
    if (current) await updateOfferLetterTemplate(current.id, { is_default: false })
    const { data } = await updateOfferLetterTemplate(t.id, { is_default: true })
    if (data) setTemplates(prev => prev.map(x => x.id === t.id ? data : { ...x, is_default: false }))
  }

  const handleDelete = async (t) => {
    const ok = await confirm(`確定刪除範本「${t.name}」？`)
    if (!ok) return
    await deleteOfferLetterTemplate(t.id)
    setTemplates(prev => prev.filter(x => x.id !== t.id))
  }

  const insertToken = (token) => set('body_html', form.body_html + token)

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={20} style={{ color: 'var(--accent-cyan)' }} />
          錄取通知書範本
        </h2>
        <button className="btn btn-primary" onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> 新增範本
        </button>
      </div>

      {templates.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 48 }}>
          尚無範本，請新增第一個錄取通知書範本
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {templates.map(t => (
            <div key={t.id} style={{
              background: 'var(--bg-secondary)',
              border: `1px solid ${t.is_default ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
              borderRadius: 8,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <FileText size={18} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</span>
                  {t.is_default && (
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10,
                      background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                    }}>預設</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  版本 {t.version}・建立於 {String(t.created_at).slice(0, 10).replace(/-/g, '/')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!t.is_default && (
                  <button className="btn btn-ghost" title="設為預設" onClick={() => handleSetDefault(t)} style={{ padding: '4px 8px' }}>
                    <StarOff size={15} />
                  </button>
                )}
                {t.is_default && (
                  <button className="btn btn-ghost" style={{ padding: '4px 8px', color: 'var(--accent-cyan)', cursor: 'default' }} disabled>
                    <Star size={15} />
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => openEdit(t)} style={{ padding: '4px 8px' }}>
                  <Edit3 size={15} />
                </button>
                <button className="btn btn-ghost" onClick={() => handleDelete(t)}
                  style={{ padding: '4px 8px', color: 'var(--accent-red)' }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? '編輯範本' : '新增範本'}
          onClose={() => setShowModal(false)}
          onSubmit={handleSave}
          submitLabel="儲存"
        >
          <Field label="範本名稱">
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="例：標準錄取通知書" />
          </Field>

          <Field label="變數標籤（點選插入）">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PLACEHOLDERS.map(p => (
                <button key={p.token} className="btn btn-ghost" type="button"
                  onClick={() => insertToken(p.token)}
                  style={{ fontSize: 11, padding: '3px 8px', fontFamily: 'monospace' }}
                  title={p.label}
                >
                  {p.token}
                </button>
              ))}
            </div>
          </Field>

          <Field label="信件內文 (HTML)">
            <textarea
              className="input"
              value={form.body_html}
              onChange={e => set('body_html', e.target.value)}
              rows={14}
              style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
            />
          </Field>

          <Field label="">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_default} onChange={e => set('is_default', e.target.checked)} />
              <span style={{ color: 'var(--text-secondary)' }}>設為預設範本</span>
            </label>
          </Field>
        </Modal>
      )}
    </div>
  )
}
