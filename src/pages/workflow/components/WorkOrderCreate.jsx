import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { toast } from '../../../lib/toast'

// 任務綁定「跨部門工單」的 inline 填寫彈窗（原生，不開新分頁；欄位與一般開單一致）
export default function WorkOrderCreate({ bindingId, onClose, onDone }) {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [form, setForm] = useState({ target_department_id: '', assignee_id: '', title: '', description: '', priority: 'medium', expected_due_date: '', store_id: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!orgId) return
    Promise.all([
      supabase.from('departments').select('id, name').eq('organization_id', orgId).order('name'),
      supabase.from('employees').select('id, name, department_id, position').eq('organization_id', orgId).eq('status', '在職').order('name'),
      supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
    ]).then(([d, e, s]) => { setDepartments(d.data || []); setEmployees(e.data || []); setStores(s.data || []) })
  }, [orgId])

  const submit = async () => {
    if (!form.target_department_id) { toast.warning('請選目標部門'); return false }
    if (!form.title.trim()) { toast.warning('請填主旨'); return false }
    if (!form.expected_due_date) { toast.warning('請選期望完成日'); return false }
    const { data, error } = await supabase.rpc('create_work_order_for_binding', {
      p_binding_id: Number(bindingId),
      p_target_department_id: Number(form.target_department_id),
      p_title: form.title.trim(),
      p_description: form.description.trim(),
      p_priority: form.priority,
      p_expected_due_date: form.expected_due_date,
      p_store_id: form.store_id ? Number(form.store_id) : null,
      p_assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
    })
    if (error) { toast.error('開工單失敗：' + error.message); return false }
    if (!data?.ok) { toast.error('開工單失敗：' + (data?.error === 'ALREADY_FILLED' ? '此綁定已開過工單' : data?.error || '')); return false }
    toast.success('已開工單並綁定任務')
    onDone?.()
  }

  return (
    <Modal title="🏢 開跨部門工單" onClose={onClose} onSubmit={submit} submitLabel="開工單" successMessage="工單已送出，等待目標部門受理">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="目標部門" required>
          <select className="form-input" style={{ width: '100%' }} value={form.target_department_id} onChange={e => set('target_department_id', e.target.value)}>
            <option value="">請選擇…</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="指定承辦人（選填）">
          <SearchableSelect value={form.assignee_id ? String(form.assignee_id) : ''} onChange={v => set('assignee_id', v || '')}
            options={empOptions(employees.filter(e => !form.target_department_id || e.department_id === Number(form.target_department_id)), { keyBy: 'id' })}
            placeholder="不填 = 交目標部門分派" />
        </Field>
      </div>
      <Field label="主旨" required>
        <input className="form-input" style={{ width: '100%' }} placeholder="例：中秋檔期門市海報設計" value={form.title} onChange={e => set('title', e.target.value)} />
      </Field>
      <Field label="詳細說明">
        <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }} placeholder="具體需求、規格、數量、用途…" value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="優先級" required>
          <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
            <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
          </select>
        </Field>
        <Field label="期望完成日" required>
          <input type="date" className="form-input" style={{ width: '100%' }} value={form.expected_due_date} onChange={e => set('expected_due_date', e.target.value)} />
        </Field>
        <Field label="關聯門市（選填）">
          <select className="form-input" style={{ width: '100%' }} value={form.store_id} onChange={e => set('store_id', e.target.value)}>
            <option value="">無</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}
