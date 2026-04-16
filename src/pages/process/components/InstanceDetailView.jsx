import {
  Plus, Pencil, X, Users, User, ClipboardList
} from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import TaskDetailPanel from '../../../components/TaskDetailPanel'

const STATUS_LIST = ['待處理', '進行中', '已完成', '已擱置']

const STATUS_CONFIG = {
  '待處理': { color: 'var(--text-muted)', bg: 'var(--glass-light)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '已擱置': { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.1)' },
}

export default function InstanceDetailView({
  inst, instSteps, stats, employees, stores, checklists,
  // Modal states
  showNotesModal, notesStep, notesText, setNotesText, setShowNotesModal, setNotesStep,
  showAddTaskModal, taskForm, setTaskForm, setShowAddTaskModal,
  showEditModal, editForm, setEditForm, setShowEditModal,
  selectedStep, setSelectedStep,
  // Handlers
  onClose, onStatusChange, onConfirmTask, onSaveNotes, onAddTask, onEditInstance,
  onStepUpdate, onStepDelete,
}) {
  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, padding: '20px 24px', background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{inst.store || inst.template_name}</h2>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>指派</span>
            <button className="btn btn-sm btn-secondary" onClick={() => { setEditForm({ assignee: inst.assignee || '', groups: (inst.groups || []).join(', ') }); setShowEditModal(true) }}>
              <Pencil size={11} /> 編輯
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
              <User size={13} /> {inst.assignee || '未指定負責人'}
            </div>
            {(inst.groups || []).map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.2)' }}>
                <Users size={12} /> {g}
              </div>
            ))}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}><X size={22} /></button>
      </div>

      {/* Progress */}
      <div style={{ padding: '16px 24px', marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent-cyan)', minWidth: 50 }}>{stats.pct}%</div>
          <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--border-medium)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 6, width: `${stats.pct}%`, background: stats.pct === 100 ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))', transition: 'width 0.4s ease' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { icon: '⬜', count: stats.pending, color: 'var(--text-muted)' },
            { icon: '🔄', count: stats.inProgress, color: 'var(--accent-cyan)' },
            { icon: '✅', count: stats.completed, color: 'var(--accent-green)' },
            { icon: '🚫', count: stats.blocked, color: 'var(--accent-red)' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span>{s.icon}</span><span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
            </div>
          ))}
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>共 <strong>{stats.total}</strong></div>
        </div>
      </div>

      {/* Task table header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClipboardList size={16} /> 步驟任務 ({stats.total})
        </div>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => {
          setTaskForm({ title: '', assignee: '', store: inst.store || '', planned_start: '', due_date: '', due_time: '17:00' })
          setShowAddTaskModal(true)
        }}><Plus size={13} /> 新增任務</button>
      </div>

      {/* Task table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>#</th>
                <th>任務名稱</th><th style={{ width: 90 }}>負責人</th><th style={{ width: 140 }}>門市</th>
                <th style={{ width: 110 }}>計畫開始</th><th style={{ width: 130 }}>截止日期</th>
                <th style={{ width: 90 }}>狀態</th><th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {instSteps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無任務</td></tr>}
              {instSteps.map(step => {
                const sc = STATUS_CONFIG[step.status] || STATUS_CONFIG['待處理']
                return (
                  <tr key={step.id} style={{ borderLeft: `3px solid ${sc.color}`, cursor: 'pointer' }} onClick={() => setSelectedStep(step)}>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>{step.step_order}</td>
                    <td><div style={{ fontWeight: 600 }}>{step.title}</div></td>
                    <td><span style={{ fontSize: 12 }}>{step.assignee || '—'}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{step.store || inst.store || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.planned_start || <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}</td>
                    <td style={{ fontSize: 12 }}>
                      {step.due_date ? <div><div>{step.due_date}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {step.due_time || '17:00'}</div></div>
                        : <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}
                    </td>
                    <td>
                      <select value={step.status} onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); onStatusChange(step.id, e.target.value) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 6, border: `1px solid ${sc.color}`, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none' }}>
                        {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); setNotesStep(step); setNotesText(step.notes || ''); setShowNotesModal(true) }}>📝 備註</button>
                        {step.confirmation_status !== 'approved' ? (
                          <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); onConfirmTask(step.id) }}>🔐 確認任務</button>
                        ) : <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600 }}>✅ 完成</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showNotesModal && notesStep && (
        <Modal title={`📝 備註 — ${notesStep.title}`} onClose={() => setShowNotesModal(false)} onSubmit={onSaveNotes}>
          <textarea className="form-input" style={{ width: '100%', minHeight: 120, resize: 'vertical' }} placeholder="輸入備註內容..." value={notesText} onChange={e => setNotesText(e.target.value)} />
        </Modal>
      )}
      {showAddTaskModal && (
        <Modal title="新增任務" onClose={() => setShowAddTaskModal(false)} onSubmit={onAddTask}>
          <Field label="任務名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：電力申請" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人"><select className="form-input" style={{ width: '100%' }} value={taskForm.assignee} onChange={e => setTaskForm(f => ({ ...f, assignee: e.target.value }))}><option value="">請選擇</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></Field>
            <Field label="門市"><select className="form-input" style={{ width: '100%' }} value={taskForm.store} onChange={e => setTaskForm(f => ({ ...f, store: e.target.value }))}><option value="">請選擇</option>{stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="計畫開始"><input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.planned_start} onChange={e => setTaskForm(f => ({ ...f, planned_start: e.target.value }))} /></Field>
            <Field label="截止日期"><input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
            <Field label="截止時間"><input className="form-input" type="time" style={{ width: '100%' }} value={taskForm.due_time} onChange={e => setTaskForm(f => ({ ...f, due_time: e.target.value }))} /></Field>
          </div>
        </Modal>
      )}
      {showEditModal && (
        <Modal title="編輯指派" onClose={() => setShowEditModal(false)} onSubmit={onEditInstance}>
          <Field label="負責人"><select className="form-input" style={{ width: '100%' }} value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}><option value="">未指定</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></Field>
          <Field label="群組（逗號分隔）"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：Ai, 信義安和-新店建置專案群組" value={editForm.groups} onChange={e => setEditForm(f => ({ ...f, groups: e.target.value }))} /></Field>
        </Modal>
      )}
      {selectedStep && (
        <TaskDetailPanel step={selectedStep} instance={inst} allSteps={instSteps} employees={employees} stores={stores} checklists={checklists}
          onUpdate={onStepUpdate}
          onDelete={onStepDelete}
          onClose={() => setSelectedStep(null)} />
      )}
    </div>
  )
}
