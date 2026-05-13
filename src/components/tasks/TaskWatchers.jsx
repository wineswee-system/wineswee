import { useState, useEffect } from 'react'
import { Eye, UserPlus, X } from 'lucide-react'
import { getTaskWatchers, addTaskWatcher, removeTaskWatcher } from '../../lib/db'
import { empLabel } from '../../lib/empLabel'
import SearchableSelect, { empOptions } from '../SearchableSelect'

export default function TaskWatchers({ taskId, employees = [], currentUser, onChange }) {
  const [watchers, setWatchers] = useState([])
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')

  const load = async () => {
    const { data } = await getTaskWatchers(taskId)
    setWatchers(data || [])
  }

  useEffect(() => { if (taskId) load() }, [taskId])

  const isWatching = currentUser && watchers.some(w => w.employees?.id === currentUser.id || w.employee_name === currentUser.name)

  const add = async (employeeId, employeeName) => {
    if (!employeeId && !employeeName) return
    if (watchers.some(w => w.employees?.id === employeeId)) return
    await addTaskWatcher({
      task_id: taskId,
      employee_id: employeeId || null,
      employee_name: employeeName,
      role: 'watcher',
      added_by: currentUser?.name || '系統',
    })
    await load()
    setPick(''); setAdding(false)
    onChange?.()
  }

  const remove = async (id) => {
    await removeTaskWatcher(id)
    await load()
    onChange?.()
  }

  const toggleSelf = async () => {
    if (!currentUser) return
    const mine = watchers.find(w => w.employees?.id === currentUser.id || w.employee_name === currentUser.name)
    if (mine) await remove(mine.id)
    else await add(currentUser.id, currentUser.name)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Eye size={14} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
          關注者 ({watchers.length})
        </span>
        {currentUser && (
          <button
            onClick={toggleSelf}
            className="btn btn-secondary"
            style={{ padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }}
          >
            {isWatching ? '取消關注' : '關注此任務'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {watchers.map(w => (
          <div key={w.id} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 12,
            background: 'var(--glass-light)', fontSize: 11, fontWeight: 600,
          }}>
            <span>{w.employees?.name || w.employee_name}</span>
            {w.role === 'collaborator' && (
              <span style={{ fontSize: 9, color: 'var(--accent-purple)' }}>協作</span>
            )}
            <button
              onClick={() => remove(w.id)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        {adding ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <div style={{ width: 220 }}>
              <SearchableSelect
                value={pick || null}
                onChange={(v) => setPick(v || '')}
                options={empOptions(
                  employees.filter(e => !watchers.some(w => w.employees?.id === e.id)),
                  { keyBy: 'id' }
                )}
                placeholder="搜尋員工..."
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => {
                const emp = employees.find(e => String(e.id) === String(pick))
                if (emp) add(emp.id, emp.name)
              }}
            >加入</button>
            <button
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => { setAdding(false); setPick('') }}
            >取消</button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 12,
              border: '1px dashed var(--border-medium)', background: 'transparent',
              cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11,
            }}
          >
            <UserPlus size={11} /> 新增關注者
          </button>
        )}
      </div>
    </div>
  )
}
