import { useState } from 'react'
import Modal, { Field } from '../../../components/Modal'
import { Plus, X, Workflow, CheckSquare } from 'lucide-react'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'

const STATUS_KEYS = ['規劃中', '進行中', '已完成', '暫停', '已取消']
const PRIORITY_COLORS = { '高': 'var(--accent-red)', '中': 'var(--accent-yellow)', '低': 'var(--accent-green)' }

export default function ProjectFormModal({
  editingId,
  form,
  setForm,
  onClose,
  onSubmit,
  employees,
  stores,
  templates,
  // new-project workflow/task state (only used when !editingId)
  freeInstances,
  pendingWfAttach,
  setPendingWfAttach,
  pendingWfCreate,
  setPendingWfCreate,
  pendingTasks,
  setPendingTasks,
}) {
  const [errors, setErrors] = useState({})
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }))
  }

  const handleSubmit = () => {
    const errs = {}
    if (!form.name?.trim()) errs.name = '專案名稱為必填'
    if (!form.start_date) errs.start_date = '開始日期為必填'
    if (!form.end_date) errs.end_date = '預計結束日期為必填'
    if (Object.keys(errs).length > 0) { setErrors(errs); return false }
    setErrors({})
    return onSubmit()
  }

  const [inlineWfMode, setInlineWfMode] = useState(null) // null | 'attach' | 'create'
  const [inlineWfAttachId, setInlineWfAttachId] = useState('')
  const [inlineWfCreate, setInlineWfCreate] = useState({ template_name: '' })
  const [inlineTaskMode, setInlineTaskMode] = useState(false)
  const [inlineTask, setInlineTask] = useState({ title: '', assignee: '', due_date: '', planned_start: '', store: '', priority: '中', description: '' })

  return (
    <Modal
      title={editingId ? '編輯專案' : '新增專案'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editingId ? '更新' : '建立'}
    >
      {editingId && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          專案 ID：<strong style={{ color: 'var(--text-secondary)' }}>#{editingId}</strong>
        </div>
      )}
      <Field label="專案名稱" required error={!!errors.name} errorMsg={errors.name}>
        <input
          className="form-input" style={{ width: '100%' }}
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="例：南京門市裝潢翻新"
        />
      </Field>
      <Field label="說明">
        <textarea
          className="form-input"
          style={{ width: '100%', minHeight: 60, resize: 'vertical' }}
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="專案描述..."
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="開始日期" required error={!!errors.start_date} errorMsg={errors.start_date}>
          <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="預計結束日期" required error={!!errors.end_date} errorMsg={errors.end_date}>
          <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="狀態">
          <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUS_KEYS.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="優先級">
          <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
            <option>高</option><option>中</option><option>低</option>
          </select>
        </Field>
        <Field label="預算">
          <input className="form-input" type="number" style={{ width: '100%' }} value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="選填" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="負責人">
          <SearchableSelect
            value={form.owner}
            onChange={(v) => set('owner', v || '')}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="搜尋員工姓名/職稱..."
          />
        </Field>
        <Field label="部門">
          <input className="form-input" style={{ width: '100%' }} value={form.department} onChange={e => set('department', e.target.value)} placeholder="選填" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="門市">
          <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
            <option value="">不指定</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="模板">
          <select className="form-input" style={{ width: '100%' }} value={form.template_id} onChange={e => set('template_id', e.target.value)}>
            <option value="">無</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>

      {!editingId && <>
        {/* Workflows section */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Workflow size={13} /> 流程（選填）
          </div>
          {(pendingWfAttach.length > 0 || pendingWfCreate.length > 0) && (
            <div style={{ marginBottom: 8 }}>
              {pendingWfAttach.map(id => {
                const wf = freeInstances.find(w => w.id === id)
                return wf ? (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: 'var(--glass-light)', marginBottom: 4, fontSize: 12 }}>
                    <Workflow size={11} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{wf.template_name} <span style={{ color: 'var(--text-muted)' }}>（連結現有）</span></span>
                    <button onClick={() => setPendingWfAttach(p => p.filter(x => x !== id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}><X size={12} /></button>
                  </div>
                ) : null
              })}
              {pendingWfCreate.map((wf, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: 'var(--glass-light)', marginBottom: 4, fontSize: 12 }}>
                  <Plus size={11} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{wf.template_name} <span style={{ color: 'var(--text-muted)' }}>（新建）</span></span>
                  <button onClick={() => setPendingWfCreate(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {inlineWfMode === 'attach' && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', marginBottom: 8 }}>
              {freeInstances.filter(w => !pendingWfAttach.includes(w.id)).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>沒有未連結的流程實例</div>
              ) : (
                <select className="form-input" style={{ width: '100%', marginBottom: 8, fontSize: 13 }} value={inlineWfAttachId} onChange={e => setInlineWfAttachId(e.target.value)}>
                  <option value="">選擇現有流程…</option>
                  {freeInstances.filter(w => !pendingWfAttach.includes(w.id)).map(w => (
                    <option key={w.id} value={w.id}>{w.template_name} — {w.status}{w.started_by ? ` (${w.started_by})` : ''}</option>
                  ))}
                </select>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!inlineWfAttachId}
                  onClick={() => { if (inlineWfAttachId) { setPendingWfAttach(p => [...p, Number(inlineWfAttachId)]); setInlineWfAttachId(''); setInlineWfMode(null) } }}>確認</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => { setInlineWfMode(null); setInlineWfAttachId('') }}>取消</button>
              </div>
            </div>
          )}
          {inlineWfMode === 'create' && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', marginBottom: 8 }}>
              <input className="form-input" style={{ width: '100%', marginBottom: 8, fontSize: 13 }} placeholder="流程名稱 *"
                value={inlineWfCreate.template_name} onChange={e => setInlineWfCreate(f => ({ ...f, template_name: e.target.value }))} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!inlineWfCreate.template_name}
                  onClick={() => { if (inlineWfCreate.template_name) { setPendingWfCreate(p => [...p, { ...inlineWfCreate }]); setInlineWfCreate({ template_name: '' }); setInlineWfMode(null) } }}>確認</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => { setInlineWfMode(null); setInlineWfCreate({ template_name: '' }) }}>取消</button>
              </div>
            </div>
          )}
          {!inlineWfMode && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setInlineWfMode('attach')}><Workflow size={11} /> 連結現有流程</button>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setInlineWfMode('create')}><Plus size={11} /> 建立新流程</button>
            </div>
          )}
        </div>

        {/* Tasks section */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckSquare size={13} /> 任務（選填）
          </div>
          {pendingTasks.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {pendingTasks.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: 'var(--glass-light)', marginBottom: 4, fontSize: 12 }}>
                  <CheckSquare size={11} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{t.title}{t.assignee && <span style={{ color: 'var(--text-muted)' }}> · {t.assignee}</span>}{t.store && <span style={{ color: 'var(--text-muted)' }}> · {t.store}</span>}{t.due_date && <span style={{ color: 'var(--text-muted)' }}> 截止 {t.due_date}</span>}</span>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--glass-light)', color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
                  <button onClick={() => setPendingTasks(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {inlineTaskMode && (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', marginBottom: 8 }}>
              <input className="form-input" style={{ width: '100%', marginBottom: 10, fontSize: 13 }} placeholder="任務名稱 *"
                value={inlineTask.title} onChange={e => setInlineTask(f => ({ ...f, title: e.target.value }))} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <SearchableSelect
                  value={inlineTask.assignee}
                  onChange={(v) => setInlineTask(f => ({ ...f, assignee: v || '' }))}
                  options={empOptions(employees, { keyBy: 'name' })}
                  placeholder="負責人"
                />
                <select className="form-input" style={{ fontSize: 13 }} value={inlineTask.store} onChange={e => setInlineTask(f => ({ ...f, store: e.target.value }))}>
                  <option value="">— 門市 —</option>
                  {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>計畫開始</div>
                  <input className="form-input" type="date" style={{ fontSize: 13, width: '100%' }}
                    value={inlineTask.planned_start} onChange={e => setInlineTask(f => ({ ...f, planned_start: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                    截止日期 <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>*</span>
                  </div>
                  <input className="form-input" type="date" style={{ fontSize: 13, width: '100%', borderColor: !inlineTask.due_date ? 'var(--accent-red)' : undefined }}
                    value={inlineTask.due_date} onChange={e => setInlineTask(f => ({ ...f, due_date: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>優先度</div>
                  <select className="form-input" style={{ fontSize: 13, width: '100%' }} value={inlineTask.priority} onChange={e => setInlineTask(f => ({ ...f, priority: e.target.value }))}>
                    <option>高</option><option>中</option><option>低</option>
                  </select>
                </div>
              </div>
              <textarea className="form-input" style={{ width: '100%', fontSize: 13, minHeight: 52, resize: 'vertical', marginBottom: 8 }}
                placeholder="說明（選填）"
                value={inlineTask.description} onChange={e => setInlineTask(f => ({ ...f, description: e.target.value }))} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!inlineTask.title || !inlineTask.due_date}
                  onClick={() => {
                    if (inlineTask.title && inlineTask.due_date) {
                      setPendingTasks(p => [...p, { ...inlineTask }])
                      setInlineTask({ title: '', assignee: '', due_date: '', planned_start: '', store: '', priority: '中', description: '' })
                      setInlineTaskMode(false)
                    }
                  }}>確認</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => { setInlineTaskMode(false); setInlineTask({ title: '', assignee: '', due_date: '', planned_start: '', store: '', priority: '中', description: '' }) }}>取消</button>
              </div>
            </div>
          )}
          {!inlineTaskMode && (
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setInlineTaskMode(true)}><Plus size={11} /> 新增任務</button>
          )}
        </div>
      </>}
    </Modal>
  )
}
