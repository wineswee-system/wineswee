import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Check, X, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getApprovalChains, createApprovalChain, updateApprovalChain, deleteApprovalChain } from '../../lib/db'
import { notifyApproval } from '../../lib/lineNotify'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

export default function ApprovalChains() {
  const { profile } = useAuth()
  const currentUser = profile?.name || '管理員'
  const [tab, setTab] = useState('forms')
  const [chains, setChains] = useState([])
  const [forms, setForms] = useState([])
  const [formSteps, setFormSteps] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [showChainModal, setShowChainModal] = useState(false)
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingChain, setEditingChain] = useState(null)
  const [chainForm, setChainForm] = useState({ name: '', description: '', category: 'HR', min_amount: '', max_amount: '', is_active: true, steps: [{ role: '', label: '' }] })
  const [applyForm, setApplyForm] = useState({ chain_id: '', title: '', store: '', notes: '' })

  useEffect(() => {
    Promise.all([
      getApprovalChains(),
      supabase.from('approval_forms').select('*').order('created_at', { ascending: false }),
      supabase.from('approval_form_steps').select('*').order('form_id,step_order'),
      supabase.from('employees').select('id, name, dept, department_id, position, role, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
    ]).then(([c, f, fs, e, s]) => {
      setChains(c.data || [])
      setForms(f.data || [])
      setFormSteps(fs.data || [])
      setEmployees(e.data || [])
      setStores(s.data || [])
    }).finally(() => setLoading(false))
  }, [])

  const openEditChain = (c) => {
    setEditingChain(c)
    setChainForm({ name: c.name, description: c.description || '', category: c.category || 'HR', min_amount: c.min_amount ?? '', max_amount: c.max_amount ?? '', is_active: c.is_active !== false, steps: c.steps || [{ role: '', label: '' }] })
    setShowChainModal(true)
  }

  const handleChainSubmit = async () => {
    if (!chainForm.name) return
    const payload = {
      name: chainForm.name, description: chainForm.description, category: chainForm.category,
      min_amount: chainForm.min_amount !== '' ? Number(chainForm.min_amount) : 0,
      max_amount: chainForm.max_amount !== '' ? Number(chainForm.max_amount) : null,
      is_active: chainForm.is_active,
      steps: chainForm.steps.filter(s => s.role || s.label),
    }
    if (editingChain) {
      const { data, error } = await updateApprovalChain(editingChain.id, payload)
      if (error) { alert('失敗：' + error.message); return }
      if (data) setChains(prev => prev.map(c => c.id === data.id ? { ...c, ...data, steps: data.steps || c.steps } : c))
    } else {
      const { data, error } = await createApprovalChain(payload)
      if (error) { alert('失敗：' + error.message); return }
      if (data) setChains(prev => [...prev, data])
    }
    setShowChainModal(false); setEditingChain(null)
    setChainForm({ name: '', description: '', category: 'HR', min_amount: '', max_amount: '', is_active: true, steps: [{ role: '', label: '' }] })
  }

  const handleApplySubmit = async () => {
    if (!applyForm.chain_id || !applyForm.title) return
    const chain = chains.find(c => c.id === Number(applyForm.chain_id))
    if (!chain) return
    const { data: form, error } = await supabase.from('approval_forms').insert({
      chain_id: chain.id, title: applyForm.title, category: chain.category,
      applicant: currentUser, store: applyForm.store,
      form_data: { notes: applyForm.notes }, current_step: 0,
      status: chain.steps.length === 0 ? '已通過' : '簽核中',
    }).select().single()
    if (error) { alert('失敗：' + error.message); return }
    if (chain.steps.length > 0 && form) {
      const rows = chain.steps.map((s, i) => ({ form_id: form.id, step_order: i + 1, role: s.role, status: i === 0 ? '待簽' : '等待中' }))
      const { data: ns } = await supabase.from('approval_form_steps').insert(rows).select()
      if (ns) setFormSteps(prev => [...prev, ...ns])
      const first = chain.steps[0]
      if (first?.role) notifyApproval(first.role, applyForm.title, `第 1 關：${first.label || first.role}`)
    }
    if (form) setForms(prev => [form, ...prev])
    setShowFormModal(false); setApplyForm({ chain_id: '', title: '', store: '', notes: '' })
  }

  const handleApprove = async (stepId, formId, action) => {
    let comment = ''
    if (action === '退回') { comment = prompt('退回原因：'); if (!comment?.trim()) return }
    const { data: step } = await supabase.from('approval_form_steps').update({
      status: action === '核准' ? '已核准' : '已退回', approver: currentUser,
      comment: comment || null, acted_at: new Date().toISOString(),
    }).eq('id', stepId).select().single()
    if (!step) return
    setFormSteps(prev => prev.map(s => s.id === stepId ? step : s))
    if (action === '核准') {
      const all = formSteps.map(s => s.id === stepId ? step : s).filter(s => s.form_id === formId)
      const next = all.find(s => s.status === '等待中')
      if (next) {
        const { data: ns } = await supabase.from('approval_form_steps').update({ status: '待簽' }).eq('id', next.id).select().single()
        if (ns) setFormSteps(prev => prev.map(s => s.id === ns.id ? ns : s))
        await supabase.from('approval_forms').update({ current_step: next.step_order }).eq('id', formId)
        const form = forms.find(x => x.id === formId)
        const chain = chains.find(c => c.id === form?.chain_id)
        const stepDef = chain?.steps?.[next.step_order - 1]
        if (next.role) notifyApproval(next.role, form?.title || '簽核', `第 ${next.step_order} 關：${stepDef?.label || next.role}`)
      } else {
        const { data: f } = await supabase.from('approval_forms').update({ status: '已通過', completed_at: new Date().toISOString() }).eq('id', formId).select().single()
        if (f) setForms(prev => prev.map(x => x.id === formId ? f : x))
      }
    } else {
      const { data: f } = await supabase.from('approval_forms').update({ status: '已退回', completed_at: new Date().toISOString() }).eq('id', formId).select().single()
      if (f) setForms(prev => prev.map(x => x.id === formId ? f : x))
    }
  }

  const getFS = (id) => formSteps.filter(s => s.form_id === id).sort((a, b) => a.step_order - b.step_order)
  const stColor = (s) => s === '已通過' || s === '已核准' ? 'badge-success' : s === '已退回' ? 'badge-danger' : s === '待簽' ? 'badge-warning' : 'badge-info'

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🛡️</span> 簽核鏈設定</h2>
            <p>定義多步驟審批流程（如：主管→HR→財務），可手動提交簽核表單</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { setEditingChain(null); setChainForm({ name: '', description: '', category: 'HR', steps: [{ role: '', label: '' }] }); setShowChainModal(true) }}><Plus size={14} /> 新增簽核鏈</button>
            <button className="btn btn-primary" onClick={() => setShowFormModal(true)}><Plus size={14} /> 提交簽核</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}><div className="stat-card-label">簽核鏈</div><div className="stat-card-value">{chains.length}</div></div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}><div className="stat-card-label">簽核中</div><div className="stat-card-value">{forms.filter(f => f.status === '簽核中').length}</div></div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}><div className="stat-card-label">已通過</div><div className="stat-card-value">{forms.filter(f => f.status === '已通過').length}</div></div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}><div className="stat-card-label">已退回</div><div className="stat-card-value">{forms.filter(f => f.status === '已退回').length}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        {[{ key: 'forms', label: `簽核表單 (${forms.length})` }, { key: 'chains', label: `簽核鏈定義 (${chains.length})` }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ flex: 1, padding: '10px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)', color: tab === t.key ? '#fff' : 'var(--text-muted)' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'forms' && (
        <div>
          {forms.length === 0 ? <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無簽核表單。點「提交簽核」開始。</div> : forms.map(f => {
            const fSteps = getFS(f.id); const chain = chains.find(c => c.id === f.chain_id); const isExp = expanded === f.id
            return (
              <div key={f.id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : f.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{f.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.applicant} · {chain?.name || '—'} · {f.store || '—'} · {f.created_at?.slice(0, 10)}</div>
                    </div>
                  </div>
                  <span className={`badge ${stColor(f.status)}`}><span className="badge-dot"></span>{f.status}</span>
                </div>
                {isExp && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 600 }}>申請人: {f.applicant}</span>
                      {fSteps.map((s, i) => (
                        <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ArrowRight size={12} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600, background: s.status === '已核准' ? 'var(--accent-green-dim)' : s.status === '已退回' ? 'var(--accent-red-dim)' : s.status === '待簽' ? 'var(--accent-orange-dim)' : 'var(--glass-light)', color: s.status === '已核准' ? 'var(--accent-green)' : s.status === '已退回' ? 'var(--accent-red)' : s.status === '待簽' ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                            {chain?.steps?.[s.step_order - 1]?.label || s.role}{s.approver ? `: ${s.approver}` : ''}
                          </span>
                        </span>
                      ))}
                    </div>
                    {fSteps.map((s, i) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, marginBottom: 4, background: s.status === '已核准' ? 'var(--accent-green-dim)' : s.status === '已退回' ? 'var(--accent-red-dim)' : s.status === '待簽' ? 'var(--accent-orange-dim)' : 'var(--glass-light)', border: `1px solid ${s.status === '待簽' ? 'rgba(251,146,60,0.3)' : 'var(--border-subtle)'}` }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: s.status === '已核准' ? 'var(--accent-green)' : s.status === '已退回' ? 'var(--accent-red)' : 'var(--border-medium)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                          {s.status === '已核准' ? <Check size={14} /> : s.status === '已退回' ? <X size={14} /> : i + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{chain?.steps?.[s.step_order - 1]?.label || `第 ${s.step_order} 關`}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>角色：{s.role}{s.approver ? ` · 簽核人：${s.approver}` : ''}{s.acted_at ? ` · ${s.acted_at.slice(0, 10)}` : ''}</div>
                          {s.comment && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 2 }}>退回原因：{s.comment}</div>}
                        </div>
                        {s.status === '待簽' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleApprove(s.id, f.id, '核准')}>核准</button>
                            <button className="btn btn-sm btn-secondary" style={{ padding: '4px 10px', color: 'var(--accent-red)' }} onClick={() => handleApprove(s.id, f.id, '退回')}>退回</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {f.form_data?.notes && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--glass-light)', borderRadius: 8 }}>備註：{f.form_data.notes}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'chains' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>簽核鏈</th><th>分類</th><th>金額範圍</th><th>步驟</th><th>流程</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {chains.map(c => (
                  <tr key={c.id}>
                    <td><div style={{ fontWeight: 600 }}>{c.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.description}</div></td>
                    <td><span className="badge badge-cyan">{c.category}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {c.min_amount != null ? `$${Number(c.min_amount).toLocaleString()}` : '$0'}
                      {' ~ '}
                      {c.max_amount != null ? `$${Number(c.max_amount).toLocaleString()}` : '無上限'}
                    </td>
                    <td>{c.steps?.length || 0} 關</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>申請人</span>
                        {(c.steps || []).map((s, i) => (<span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}><ArrowRight size={10} style={{ color: 'var(--text-muted)' }} /><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--glass-light)' }}>{s.label || s.role}</span></span>))}
                        <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} /><span style={{ fontSize: 11, color: 'var(--accent-green)' }}>✓</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.is_active !== false ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)', color: c.is_active !== false ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {c.is_active !== false ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEditChain(c)}><Pencil size={12} /></button>
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }} onClick={async () => { if (!confirm(`刪除「${c.name}」？`)) return; await deleteApprovalChain(c.id); setChains(prev => prev.filter(x => x.id !== c.id)) }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showChainModal && (
        <Modal title={editingChain ? `編輯 — ${editingChain.name}` : '新增簽核鏈'} onClose={() => { setShowChainModal(false); setEditingChain(null) }} onSubmit={handleChainSubmit} submitLabel={editingChain ? '儲存' : '新增'}>
          <Field label="名稱 *"><input className="form-input" style={{ width: '100%' }} value={chainForm.name} onChange={e => setChainForm(f => ({ ...f, name: e.target.value }))} placeholder="例：員工請假簽核" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類"><select className="form-input" style={{ width: '100%' }} value={chainForm.category} onChange={e => setChainForm(f => ({ ...f, category: e.target.value }))}>{['HR', '營運', '採購', '管理', '財務', '費用申請'].map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="說明"><input className="form-input" style={{ width: '100%' }} value={chainForm.description} onChange={e => setChainForm(f => ({ ...f, description: e.target.value }))} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="最低金額">
              <input className="form-input" type="number" style={{ width: '100%' }} value={chainForm.min_amount} onChange={e => setChainForm(f => ({ ...f, min_amount: e.target.value }))} placeholder="0（無下限）" />
            </Field>
            <Field label="最高金額">
              <input className="form-input" type="number" style={{ width: '100%' }} value={chainForm.max_amount} onChange={e => setChainForm(f => ({ ...f, max_amount: e.target.value }))} placeholder="不填=無上限" />
            </Field>
            <Field label="狀態">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', height: 36 }}>
                <input type="checkbox" checked={chainForm.is_active} onChange={e => setChainForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13 }}>{chainForm.is_active ? '啟用' : '停用'}</span>
              </label>
            </Field>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 8 }}>簽核步驟（申請人 → ...）</div>
          {chainForm.steps.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
              <select className="form-input" value={s.role} onChange={e => { const n = [...chainForm.steps]; n[i] = { ...n[i], role: e.target.value }; setChainForm(f => ({ ...f, steps: n })) }}>
                <option value="">選擇簽核人</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.name}>
                    {empLabel(emp)}（{emp.position || emp.dept || '—'}）
                  </option>
                ))}
              </select>
              <input className="form-input" placeholder="步驟標籤（例：主管審核）" value={s.label} onChange={e => { const n = [...chainForm.steps]; n[i] = { ...n[i], label: e.target.value }; setChainForm(f => ({ ...f, steps: n })) }} />
              <button style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer' }} onClick={() => setChainForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={() => setChainForm(f => ({ ...f, steps: [...f.steps, { role: '', label: '' }] }))}><Plus size={12} /> 新增步驟</button>
        </Modal>
      )}

      {showFormModal && (
        <Modal title="提交簽核表單" onClose={() => setShowFormModal(false)} onSubmit={handleApplySubmit}>
          <Field label="簽核鏈 *"><select className="form-input" style={{ width: '100%' }} value={applyForm.chain_id} onChange={e => setApplyForm(f => ({ ...f, chain_id: e.target.value }))}><option value="">請選擇</option>{chains.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>)}</select></Field>
          <Field label="標題 *"><input className="form-input" style={{ width: '100%' }} value={applyForm.title} onChange={e => setApplyForm(f => ({ ...f, title: e.target.value }))} placeholder="例：4月請假申請" /></Field>
          <Field label="門市"><select className="form-input" style={{ width: '100%' }} value={applyForm.store} onChange={e => setApplyForm(f => ({ ...f, store: e.target.value }))}><option value="">—</option>{stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
          <Field label="備註"><textarea className="form-input" style={{ width: '100%' }} rows={3} value={applyForm.notes} onChange={e => setApplyForm(f => ({ ...f, notes: e.target.value }))} /></Field>
          {applyForm.chain_id && (() => { const ch = chains.find(c => c.id === Number(applyForm.chain_id)); return ch ? (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>簽核流程：</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--accent-cyan)' }}>申請人</span>
                {(ch.steps || []).map((s, i) => (<span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}><ArrowRight size={10} /><span>{s.label || s.role}</span></span>))}
                <ArrowRight size={10} /><span style={{ color: 'var(--accent-green)' }}>✓ 完成</span>
              </div>
            </div>
          ) : null })()}
        </Modal>
      )}
    </div>
  )
}
