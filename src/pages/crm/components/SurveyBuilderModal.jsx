import { useState, useEffect } from 'react'
import { X, Plus, Trash2, GripVertical, ChevronDown, ChevronUp } from 'lucide-react'
import { getMemberLevels, getSurveyQuestions, createSurvey, updateSurvey, createSurveyQuestion, updateSurveyQuestion, deleteSurveyQuestion } from '../../../lib/db'

const Q_TYPES = [
  { value: 'nps',           label: 'NPS（0-10 推薦分）' },
  { value: 'rating',        label: '評分（1-5 星）'      },
  { value: 'single_choice', label: '單選'               },
  { value: 'multi_choice',  label: '多選'               },
  { value: 'text',          label: '開放式文字'          },
]

const TABS = ['問卷設定', '題目編輯']

let _seq = 0
const uid = () => `q${++_seq}`
const emptyQuestion = (order) => ({
  _id: uid(), survey_id: null, sort_order: order, type: 'nps', question: '', options: [], required: true,
})

export default function SurveyBuilderModal({ survey, orgId, onClose, onSaved }) {
  const isEdit = !!survey

  const [tab, setTab]     = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [levels, setLevels] = useState([])

  // Settings tab
  const [name, setName]             = useState(survey?.name || '')
  const [desc, setDesc]             = useState(survey?.description || '')
  const [triggerType, setTrigger]   = useState(survey?.trigger_type || 'post_purchase')
  const [delayHours, setDelay]      = useState(survey?.trigger_delay_hours ?? 24)
  const [channel, setChannel]       = useState(survey?.send_channel || 'line')
  const [expireDays, setExpire]     = useState(survey?.expires_in_days ?? 7)
  const [minAmount, setMinAmount]   = useState(survey?.min_purchase_amount || '')
  const [targetLevel, setTargetLv]  = useState(survey?.target_level_id || '')

  // Questions tab
  const [questions, setQuestions]   = useState([])
  const [loadingQ, setLoadingQ]     = useState(false)

  useEffect(() => {
    if (orgId) getMemberLevels(orgId).then(({ data }) => setLevels(data || []))
  }, [orgId])

  useEffect(() => {
    if (!isEdit || tab !== 1) return
    setLoadingQ(true)
    getSurveyQuestions(survey.id).then(({ data }) => {
      if (data?.length) {
        setQuestions(data.map(q => ({ ...q, _id: uid() })))
      } else {
        setQuestions([emptyQuestion(0)])
      }
      setLoadingQ(false)
    })
  }, [isEdit, survey?.id, tab])

  function addQuestion() {
    setQuestions(prev => [...prev, emptyQuestion(prev.length)])
  }

  function removeQuestion(localId) {
    setQuestions(prev => prev.filter(q => q._id !== localId))
  }

  function updateQuestion(localId, key, value) {
    setQuestions(prev => prev.map(q => q._id !== localId ? q : { ...q, [key]: value }))
  }

  function addOption(localId) {
    setQuestions(prev => prev.map(q =>
      q._id !== localId ? q : { ...q, options: [...(q.options || []), ''] }
    ))
  }

  function updateOption(localId, idx, value) {
    setQuestions(prev => prev.map(q => {
      if (q._id !== localId) return q
      const opts = [...(q.options || [])]
      opts[idx] = value
      return { ...q, options: opts }
    }))
  }

  function removeOption(localId, idx) {
    setQuestions(prev => prev.map(q => {
      if (q._id !== localId) return q
      const opts = [...(q.options || [])]
      opts.splice(idx, 1)
      return { ...q, options: opts }
    }))
  }

  function moveQuestion(idx, dir) {
    setQuestions(prev => {
      const arr = [...prev]
      const target = idx + dir
      if (target < 0 || target >= arr.length) return prev
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return arr.map((q, i) => ({ ...q, sort_order: i }))
    })
  }

  async function handleSave() {
    if (!name.trim()) { setError('問卷名稱不可空白'); return }
    setSaving(true); setError('')

    const payload = {
      name: name.trim(),
      description: desc.trim() || null,
      trigger_type: triggerType,
      trigger_delay_hours: Number(delayHours),
      send_channel: channel,
      expires_in_days: Number(expireDays),
      min_purchase_amount: minAmount !== '' ? Number(minAmount) : null,
      target_level_id: targetLevel || null,
      organization_id: orgId,
    }

    let savedId = survey?.id
    let err

    if (isEdit) {
      const res = await updateSurvey(survey.id, payload)
      err = res.error
    } else {
      const res = await createSurvey(payload)
      err = res.error; savedId = res.data?.id
    }

    if (err) { setError(err.message); setSaving(false); return }

    // Sync questions if on the questions tab and they've been loaded
    if (savedId && tab === 1 && !loadingQ) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]
        const qData = {
          survey_id:  savedId,
          sort_order: i,
          type:       q.type,
          question:   q.question,
          options:    q.options || [],
          required:   q.required,
        }
        if (q.id) {
          await updateSurveyQuestion(q.id, qData)
        } else {
          await createSurveyQuestion(qData)
        }
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px', width: '100%', maxWidth: '680px', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '1rem', margin: 0 }}>
            {isEdit ? '編輯問卷' : '新增問卷'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)', padding: '0 1.25rem' }}>
          {TABS.map((t, i) => (
            <button
              key={i}
              onClick={() => setTab(i)}
              style={{ padding: '0.6rem 1rem', background: 'none', border: 'none', borderBottom: `2px solid ${tab === i ? 'var(--accent-cyan)' : 'transparent'}`, cursor: 'pointer', color: tab === i ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: '0.875rem', fontWeight: tab === i ? 600 : 400, marginBottom: '-1px' }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          {/* ── Tab 0: Settings ── */}
          {tab === 0 && (
            <>
              <FormRow label="問卷名稱 *">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="例：購後滿意度調查" style={inp} />
              </FormRow>
              <FormRow label="說明（選填）">
                <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="問卷用途說明" rows={2} style={{ ...inp, resize: 'vertical' }} />
              </FormRow>
              <FormRow label="觸發方式">
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[['post_purchase', '購後觸發'], ['manual', '手動發送']].map(([v, l]) => (
                    <ToggleBtn key={v} active={triggerType === v} onClick={() => setTrigger(v)}>{l}</ToggleBtn>
                  ))}
                </div>
              </FormRow>
              {triggerType === 'post_purchase' && (
                <FormRow label="發送延遲（小時）">
                  <input type="number" min={0} max={168} value={delayHours} onChange={e => setDelay(e.target.value)} style={{ ...inp, width: '120px' }} />
                </FormRow>
              )}
              <FormRow label="發送管道">
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[['line', 'LINE'], ['sms', 'SMS'], ['email', 'Email']].map(([v, l]) => (
                    <ToggleBtn key={v} active={channel === v} onClick={() => setChannel(v)}>{l}</ToggleBtn>
                  ))}
                </div>
              </FormRow>
              <FormRow label="連結有效天數">
                <input type="number" min={1} max={90} value={expireDays} onChange={e => setExpire(e.target.value)} style={{ ...inp, width: '120px' }} />
              </FormRow>
              <FormRow label="最低消費門檻（NT$，選填）">
                <input type="number" min={0} value={minAmount} onChange={e => setMinAmount(e.target.value)} placeholder="留空表示無限制" style={{ ...inp, width: '180px' }} />
              </FormRow>
              <FormRow label="目標等級（選填）">
                <select value={targetLevel} onChange={e => setTargetLv(e.target.value)} style={sel}>
                  <option value="">所有等級</option>
                  {levels.map(l => <option key={l.id} value={l.id}>{l.icon} {l.name}</option>)}
                </select>
              </FormRow>
            </>
          )}

          {/* ── Tab 1: Questions ── */}
          {tab === 1 && (
            loadingQ ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', fontSize: '0.85rem' }}>載入題目中…</div>
            ) : (
              <>
                {questions.map((q, i) => (
                  <QuestionCard
                    key={q._id}
                    q={q} idx={i} total={questions.length}
                    onChange={(k, v) => updateQuestion(q._id, k, v)}
                    onRemove={() => removeQuestion(q._id)}
                    onMove={dir => moveQuestion(i, dir)}
                    onAddOption={() => addOption(q._id)}
                    onUpdateOption={(oi, v) => updateOption(q._id, oi, v)}
                    onRemoveOption={oi => removeOption(q._id, oi)}
                  />
                ))}
                <button
                  onClick={addQuestion}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'none', border: '1px dashed var(--border-primary)', borderRadius: '8px', padding: '0.5rem 1rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', alignSelf: 'flex-start' }}
                >
                  <Plus size={14} /> 新增題目
                </button>
              </>
            )
          )}

          {error && (
            <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            {tab === 0 ? '設定完成後切換至「題目編輯」' : `共 ${questions.length} 題`}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onClose} style={{ padding: '0.45rem 1rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
              取消
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '0.45rem 1.25rem', background: saving ? 'var(--bg-tertiary)' : 'var(--accent-cyan)', color: saving ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
              {saving ? '儲存中…' : isEdit ? '更新問卷' : '建立問卷'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuestionCard({ q, idx, total, onChange, onRemove, onMove, onAddOption, onUpdateOption, onRemoveOption }) {
  const needsOptions = q.type === 'single_choice' || q.type === 'multi_choice'

  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '0.875rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <GripVertical size={16} style={{ color: 'var(--text-muted)', marginTop: '0.5rem', flexShrink: 0, cursor: 'grab' }} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, minWidth: '28px' }}>Q{idx + 1}</span>
            <select value={q.type} onChange={e => onChange('type', e.target.value)} style={{ ...sel, fontSize: '0.78rem' }}>
              {Q_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={q.required} onChange={e => onChange('required', e.target.checked)} style={{ cursor: 'pointer' }} />
              必填
            </label>
          </div>

          <input
            value={q.question}
            onChange={e => onChange('question', e.target.value)}
            placeholder="輸入題目內容…"
            style={{ ...inp, fontSize: '0.875rem' }}
          />

          {needsOptions && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingLeft: '0.5rem' }}>
              {(q.options || []).map((opt, oi) => (
                <div key={oi} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input
                    value={opt}
                    onChange={e => onUpdateOption(oi, e.target.value)}
                    placeholder={`選項 ${oi + 1}`}
                    style={{ ...inp, flex: 1, fontSize: '0.82rem' }}
                  />
                  <button onClick={() => onRemoveOption(oi)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: '2px' }}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button onClick={onAddOption} style={{ background: 'none', border: '1px dashed var(--border-primary)', borderRadius: '5px', padding: '0.2rem 0.5rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', alignSelf: 'flex-start' }}>
                + 新增選項
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flexShrink: 0 }}>
          <button onClick={() => onMove(-1)} disabled={idx === 0} style={iconBtn(idx === 0)}><ChevronUp size={13} /></button>
          <button onClick={() => onMove(1)} disabled={idx === total - 1} style={iconBtn(idx === total - 1)}><ChevronDown size={13} /></button>
          <button onClick={onRemove} disabled={total === 1} style={{ ...iconBtn(total === 1), color: total === 1 ? undefined : 'var(--accent-red)' }}><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  )
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '0.35rem 0.875rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
      border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
      background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-primary)',
      color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
      fontWeight: active ? 600 : 400,
    }}>
      {children}
    </button>
  )
}

function FormRow({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>{label}</label>
      {children}
    </div>
  )
}

const inp = { width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box' }
const sel = { background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }
const iconBtn = (disabled) => ({ background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? 'var(--bg-tertiary)' : 'var(--text-muted)', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' })
