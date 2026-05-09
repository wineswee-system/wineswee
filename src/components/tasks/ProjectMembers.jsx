import { useState, useEffect } from 'react'
import { UserPlus, X, Users } from 'lucide-react'
import { getProjectMembers, addProjectMember, updateProjectMember, removeProjectMember } from '../../lib/db'
import { empLabel } from '../../lib/empLabel'

import { confirm } from '../../lib/confirm'
const ROLE_OPTIONS = [
  { value: 'owner',  label: '擁有者',  color: '#f43f5e' },
  { value: 'admin',  label: '管理員',  color: '#8b5cf6' },
  { value: 'member', label: '成員',    color: '#06b6d4' },
  { value: 'viewer', label: '檢視者',  color: '#64748b' },
]

export default function ProjectMembers({ projectId, employees = [], currentUser, autoMemberIds = [] }) {
  const [members, setMembers] = useState([])
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')
  const [role, setRole] = useState('member')

  const load = async () => {
    const { data } = await getProjectMembers(projectId)
    const current = data || []

    const existing = new Set(current.map(m => m.employee_id).filter(Boolean))
    const missing = autoMemberIds.filter(id => id && !existing.has(id))
    console.log('[ProjectMembers]', { projectId, autoMemberIds, currentCount: current.length, missing })
    if (missing.length === 0) { setMembers(current); return }

    const results = await Promise.all(missing.map(id => {
      const emp = employees.find(e => e.id === id)
      return addProjectMember({
        project_id: projectId,
        employee_id: id,
        employee_name: emp?.name || null,
        role: 'member',
        added_by: '自動同步',
      })
    }))
    results.forEach(r => { if (r?.error) console.error('[ProjectMembers] insert error', r.error) })
    const { data: updated } = await getProjectMembers(projectId)
    setMembers(updated || [])
  }

  const autoKey = autoMemberIds.join(',')
  useEffect(() => { if (projectId) load() }, [projectId, autoKey])

  const add = async () => {
    const emp = employees.find(e => String(e.id) === String(pick))
    if (!emp) return
    if (members.some(m => m.employee_id === emp.id)) return
    await addProjectMember({
      project_id: projectId,
      employee_id: emp.id,
      employee_name: emp.name,
      role,
      added_by: currentUser?.name || '系統',
    })
    setPick(''); setRole('member'); setAdding(false)
    load()
  }

  const remove = async (id) => {
    if (!(await confirm({ message: '將此成員移出專案？' }))) return
    await removeProjectMember(id)
    load()
  }

  const changeRole = async (id, newRole) => {
    await updateProjectMember(id, { role: newRole })
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          <Users size={14} /> 專案成員 ({members.length})
        </div>
        {!adding && (
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAdding(true)}>
            <UserPlus size={12} /> 加入成員
          </button>
        )}
      </div>

      {adding && (
        <div className="card" style={{ padding: 10, marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={pick} onChange={e => setPick(e.target.value)} className="form-input" style={{ flex: 1, fontSize: 12 }} autoFocus>
            <option value="">選擇員工...</option>
            {employees.filter(e => !members.some(m => m.employee_id === e.id)).map(e => (
              <option key={e.id} value={e.id}>{empLabel(e)}{e.dept ? `（${e.dept}）` : ''}</option>
            ))}
          </select>
          <select value={role} onChange={e => setRole(e.target.value)} className="form-input" style={{ fontSize: 12 }}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={add}>加入</button>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => { setAdding(false); setPick('') }}>取消</button>
        </div>
      )}

      {members.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
          此專案尚未邀請成員。負責人預設可編輯。
        </div>
      ) : members.map(m => {
        const cfg = ROLE_OPTIONS.find(r => r.value === m.role) || ROLE_OPTIONS[2]
        return (
          <div key={m.id} className="card" style={{ padding: '8px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: `color-mix(in srgb, ${cfg.color} 25%, transparent)`,
              color: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>
              {(m.employee_full_name || m.employee_name || '?').slice(0, 1)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{m.employee_full_name || m.employee_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {m.employee_dept || ''} {m.employee_email ? `· ${m.employee_email}` : ''}
              </div>
            </div>
            <select
              value={m.role}
              onChange={e => changeRole(m.id, e.target.value)}
              style={{
                padding: '2px 6px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: `1px solid ${cfg.color}`, color: cfg.color, background: 'transparent',
              }}
            >
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button
              onClick={() => remove(m.id)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent-red)', padding: 4, display: 'flex' }}
              title="移除"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
