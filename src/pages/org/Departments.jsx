import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, History, Layers, X } from 'lucide-react'
import { getDepartments, createDepartment, updateDepartment, deleteDepartment, getEmployees, getDeptManagerHistory } from '../../lib/db'
import { getDepartmentSectionsAll, createDepartmentSection, updateDepartmentSection, deleteDepartmentSection } from '../../lib/db/org'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const LEVELS = [
  { value: '董事長', label: '董事長室' },
  { value: '部', label: '部' },
  { value: '組', label: '組' },
  { value: '課', label: '課' },
]

export default function Departments() {
  const { profile, hasPermission } = useAuth()
  const canEditStructure = hasPermission('org.structure.edit')
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [form, setForm] = useState({ name: '', manager_id: '', description: '', level: '部', parent_department_id: '' })
  const [historyDept, setHistoryDept] = useState(null)
  const [mgrHistory, setMgrHistory] = useState([])
  // 課別管理
  const [sectionsDept, setSectionsDept] = useState(null)  // 點哪個部門開課別管理
  const [editingSection, setEditingSection] = useState(null)
  const [secForm, setSecForm] = useState({ name: '', supervisor_id: '', sort_order: 0 })

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([getDepartments(), getEmployees(), getDepartmentSectionsAll(orgId)]).then(([d, e, s]) => {
      setDepartments(d.data || [])
      setEmployees(e.data || [])
      setSections(s.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [profile?.organization_id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingDept(null)
    setForm({ name: '', manager_id: '', description: '', level: '部', parent_department_id: '' })
    setShowModal(true)
  }

  const openEdit = (d) => {
    setEditingDept(d)
    setForm({
      name: d.name || '',
      manager_id: d.manager_id || '',
      description: d.description || '',
      level: d.level || '部',
      parent_department_id: d.parent_department_id || '',
    })
    setShowModal(true)
  }

  const handleDelete = async (d) => {
    if (!(await confirm({ message: `確定要刪除「${d.name}」嗎？` }))) return
    try {
      await deleteDepartment(d.id)
      setDepartments(prev => prev.filter(x => x.id !== d.id))
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const payload = {
      name: form.name,
      manager_id: form.manager_id ? parseInt(form.manager_id) : null,
      description: form.description,
      level: form.level,
      parent_department_id: form.parent_department_id ? parseInt(form.parent_department_id) : null,
    }
    // 新增時自動帶 organization_id（避免新部門被多租戶 filter 擋掉）
    if (!editingDept && profile?.organization_id) {
      payload.organization_id = profile.organization_id
    }
    try {
      if (editingDept) {
        const { data, error } = await updateDepartment(editingDept.id, payload)
        if (error) throw error
        if (data) setDepartments(prev => prev.map(d => d.id === data.id ? data : d))
      } else {
        const { data, error } = await createDepartment(payload)
        if (error) throw error
        if (data) setDepartments(prev => [...prev, data])
      }
      setShowModal(false)
      setEditingDept(null)
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // ─── 課別管理 ───
  const openSectionsModal = (dept) => {
    setSectionsDept(dept)
    setEditingSection(null)
    setSecForm({ name: '', supervisor_id: '', sort_order: (sections.filter(s => s.department_id === dept.id).length) * 10 })
  }
  const closeSectionsModal = () => {
    setSectionsDept(null)
    setEditingSection(null)
    setSecForm({ name: '', supervisor_id: '', sort_order: 0 })
  }
  const setSec = (k, v) => setSecForm(f => ({ ...f, [k]: v }))

  const editSection = (sec) => {
    setEditingSection(sec)
    setSecForm({
      name: sec.name || '',
      supervisor_id: sec.supervisor_id || '',
      sort_order: sec.sort_order || 0,
    })
  }

  const handleSubmitSection = async () => {
    if (!secForm.name || !sectionsDept) return
    const payload = {
      name: secForm.name,
      supervisor_id: secForm.supervisor_id ? parseInt(secForm.supervisor_id) : null,
      sort_order: parseInt(secForm.sort_order) || 0,
      department_id: sectionsDept.id,
      organization_id: profile?.organization_id || 1,
      is_active: true,
    }
    try {
      if (editingSection) {
        const { data, error } = await updateDepartmentSection(editingSection.id, payload)
        if (error) throw error
        if (data) setSections(prev => prev.map(s => s.id === data.id ? data : s))
      } else {
        const { data, error } = await createDepartmentSection(payload)
        if (error) throw error
        if (data) setSections(prev => [...prev, data])
      }
      setEditingSection(null)
      setSecForm({ name: '', supervisor_id: '', sort_order: (sections.filter(s => s.department_id === sectionsDept.id).length + 1) * 10 })
    } catch (err) {
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleDeleteSection = async (sec) => {
    if (!(await confirm({ message: `確定要刪除課別「${sec.name}」？\n（如果該課別下有門市，門市的 section_id 會變 NULL）` }))) return
    try {
      const { error } = await deleteDepartmentSection(sec.id)
      if (error) throw error
      setSections(prev => prev.filter(s => s.id !== sec.id))
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const sectionsOf = (deptId) => sections.filter(s => s.department_id === deptId)

  const deptCount = (dept) => employees.filter(e => (e.department_id === dept.id || e.dept === dept.name) && e.status === '在職').length
  const totalMembers = departments.reduce((s, d) => s + deptCount(d), 0)

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🗂️</span> 部門</h2>
            <p>公司部門設定與管理</p>
          </div>
          {canEditStructure && <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增部門</button>}
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">部門數</div>
          <div className="stat-card-value">{departments.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總人數</div>
          <div className="stat-card-value">{totalMembers}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">平均人數</div>
          <div className="stat-card-value">
            {departments.length ? Math.round(totalMembers / departments.length) : 0}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>部門名稱</th><th>層級</th><th>上級部門</th><th>部門主管</th><th>人數</th><th>課別</th><th>描述</th><th>操作</th></tr>
            </thead>
            <tbody>
              {departments.map(d => {
                const manager = employees.find(e => e.id === d.manager_id)
                const parent = departments.find(p => p.id === d.parent_department_id)
                const secs = sectionsOf(d.id)
                return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td><span className="badge badge-cyan">{d.level || '部'}</span></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{parent?.name || '-'}</td>
                  <td>{manager?.name || d.head || '-'}</td>
                  <td>{deptCount(d)}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => openSectionsModal(d)}>
                      <Layers size={11} /> {secs.length > 0 ? `${secs.length} 個課別` : '管理'}
                    </button>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{d.description}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {canEditStructure && <button className="btn btn-sm btn-secondary" onClick={() => openEdit(d)}><Pencil size={12} /></button>}
                      <button className="btn btn-sm btn-secondary" onClick={async () => {
                        setHistoryDept(d)
                        const { data } = await getDeptManagerHistory(d.id)
                        setMgrHistory(data || [])
                      }}><History size={12} /></button>
                      {canEditStructure && <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(d)} style={{ color: 'var(--accent-red)' }}><Trash2 size={12} /></button>}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingDept ? `編輯部門 — ${editingDept.name}` : '新增部門'} onClose={() => { setShowModal(false); setEditingDept(null) }} onSubmit={handleSubmit} submitLabel={editingDept ? '儲存變更' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門名稱" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：研發部" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="層級">
              <select className="form-input" style={{ width: '100%' }} value={form.level} onChange={e => set('level', e.target.value)}>
                {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上級部門">
              <select className="form-input" style={{ width: '100%' }} value={form.parent_department_id} onChange={e => set('parent_department_id', e.target.value)}>
                <option value="">無（頂層部門）</option>
                {departments.filter(d => d.id !== editingDept?.id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="部門主管">
              <SearchableSelect
                value={form.manager_id || null}
                onChange={(v) => set('manager_id', v || '')}
                options={empOptions(employees.filter(e => e.status === '在職'), { keyBy: 'id' })}
                placeholder="搜尋員工..."
              />
            </Field>
          </div>
          <Field label="部門描述">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} placeholder="部門職責說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
        </Modal>
      )}

      {sectionsDept && (
        <Modal title={`${sectionsDept.name} — 課別管理`} onClose={closeSectionsModal} onSubmit={closeSectionsModal} submitLabel="關閉" maxWidth={680}>
          {/* 現有課別清單 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>現有課別（{sectionsOf(sectionsDept.id).length}）</div>
            {sectionsOf(sectionsDept.id).length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-secondary)', borderRadius: 6 }}>尚無課別</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sectionsOf(sectionsDept.id).map(sec => {
                  const supe = employees.find(e => e.id === sec.supervisor_id)
                  return (
                    <div key={sec.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', background: 'var(--bg-secondary)',
                      borderRadius: 6, border: '1px solid var(--border-subtle)',
                    }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{sec.name}</span>
                      {supe && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>督導：{supe.name}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>排序 {sec.sort_order}</span>
                      <button className="btn btn-sm btn-secondary" style={{ padding: '3px 8px' }} onClick={() => editSection(sec)}><Pencil size={11} /></button>
                      <button className="btn btn-sm btn-secondary" style={{ padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDeleteSection(sec)}><Trash2 size={11} /></button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 新增 / 編輯表單 */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
              {editingSection ? `編輯：${editingSection.name}` : '新增課別'}
              {editingSection && (
                <button className="btn btn-sm btn-secondary" style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px' }} onClick={() => { setEditingSection(null); setSecForm({ name: '', supervisor_id: '', sort_order: 0 }) }}>
                  <X size={10} /> 取消編輯
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 10 }}>
              <Field label="課別名稱" required>
                <input className="form-input" type="text" placeholder="例：營運四課" value={secForm.name} onChange={e => setSec('name', e.target.value)} style={{ width: '100%' }} />
              </Field>
              <Field label="督導">
                <SearchableSelect
                  value={secForm.supervisor_id || null}
                  onChange={(v) => setSec('supervisor_id', v || '')}
                  options={empOptions(employees.filter(e => e.status === '在職'), { keyBy: 'id' })}
                  placeholder="搜尋員工..."
                />
              </Field>
              <Field label="排序">
                <input className="form-input" type="number" value={secForm.sort_order} onChange={e => setSec('sort_order', e.target.value)} style={{ width: '100%' }} />
              </Field>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={handleSubmitSection}>
              <Plus size={12} /> {editingSection ? '儲存變更' : '新增課別'}
            </button>
          </div>
        </Modal>
      )}

      {historyDept && (
        <Modal title={`${historyDept.name} — 主管異動紀錄`} onClose={() => setHistoryDept(null)} onSubmit={() => setHistoryDept(null)} submitLabel="關閉">
          {mgrHistory.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>尚無異動紀錄</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mgrHistory.map(h => (
                <div key={h.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{h.manager_name}</span>
                      {h.manager_employee_number && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{h.manager_employee_number}</span>}
                    </div>
                    <span style={{ fontSize: 11, color: h.end_date ? 'var(--text-muted)' : 'var(--accent-green)', fontWeight: 600 }}>
                      {h.end_date ? '已卸任' : '現任'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {h.effective_date}{h.end_date ? ` ~ ${h.end_date}` : ' ~ 至今'}
                    {h.notes && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>({h.notes})</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
