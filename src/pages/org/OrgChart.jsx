import { useState, useEffect } from 'react'
import { getDepartments, getEmployees, getStores } from '../../lib/db'

export default function OrgChart() {
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getDepartments(), getEmployees(), getStores()])
      .then(([dRes, eRes, sRes]) => {
        setDepartments(dRes.data || [])
        setEmployees((eRes.data || []).filter(e => e.status === '在職'))
        setStores((sRes.data || []).filter(s => s.is_active !== false))
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>

  const colors = ['var(--accent-cyan)', 'var(--accent-blue)', 'var(--accent-green)', 'var(--accent-pink)', 'var(--accent-yellow)', 'var(--accent-purple)']
  const dims = ['var(--accent-cyan-dim)', 'var(--accent-blue-dim)', 'var(--accent-green-dim)', 'var(--accent-pink-dim)', 'var(--accent-yellow-dim)', 'var(--accent-purple-dim)']

  // Find department manager name
  const managerName = (dept) => {
    if (dept.manager_id) {
      const mgr = employees.find(e => e.id === dept.manager_id)
      if (mgr) return mgr.name
    }
    return dept.head || '-'
  }

  // Get sub-managers (is_manager but not the dept manager_id)
  const subManagers = (dept) =>
    employees.filter(e =>
      (e.department_id === dept.id || e.dept === dept.name)
      && e.is_manager
      && e.id !== dept.manager_id
    )

  // Get regular members (non-manager)
  const members = (dept) =>
    employees.filter(e =>
      (e.department_id === dept.id || e.dept === dept.name)
      && !e.is_manager
      && e.id !== dept.manager_id
    )

  // Stores belonging to a department
  const deptStores = (dept) =>
    stores.filter(s => s.department_id === dept.id)

  // Stores not assigned to any department
  const unassignedStores = stores.filter(s => !s.department_id)

  // Find 營運部
  const opsDept = departments.find(d => d.name === '營運部')
  const opsStores = opsDept ? deptStores(opsDept) : []

  // All stores to show at bottom (營運部 stores + unassigned)
  const bottomStores = [...opsStores, ...unassignedStores.filter(s => !opsStores.some(os => os.id === s.id))]

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🌐</span> 組織架構</h2>
        <p>公司組織層級圖</p>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: '32px 24px', overflowX: 'auto' }}>
          {/* Top: 總經理室 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--accent-cyan-dim), var(--accent-blue-dim))',
              border: '2px solid var(--accent-cyan)',
              borderRadius: 12,
              padding: '14px 32px',
              textAlign: 'center',
              minWidth: 160,
            }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent-cyan)' }}>總經理室</div>
            </div>
          </div>

          {/* Vertical line */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
          </div>

          {/* Horizontal line */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '90%', height: 1, background: 'var(--border-strong)' }} />
          </div>

          {/* Departments */}
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 10, flexWrap: 'wrap' }}>
            {departments.map((dept, i) => {
              const color = colors[i % colors.length]
              const dim = dims[i % dims.length]
              const head = managerName(dept)
              const subs = subManagers(dept)
              const mems = members(dept)
              const dStores = deptStores(dept)
              const showStoresInline = dept.name !== '營運部' && dStores.length > 0

              return (
                <div key={dept.id} style={{ flex: '1 1 120px', maxWidth: 160, minWidth: 100 }}>
                  {/* vertical connector */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
                  </div>

                  {/* Department card */}
                  <div style={{
                    background: dim,
                    border: `1px solid ${color}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    textAlign: 'center',
                    marginBottom: 8,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>部門主管</div>
                    <div style={{ fontWeight: 600, color, fontSize: 13 }}>{dept.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{head}</div>
                    {subs.length > 0 && subs.map(s => (
                      <div key={s.id} style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.name}</div>
                    ))}
                  </div>

                  {/* Members */}
                  {mems.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {mems.map(emp => (
                        <div key={emp.id} style={{
                          background: 'var(--glass-light)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          padding: '5px 8px',
                          textAlign: 'center',
                          fontSize: 12,
                        }}>
                          <div style={{ fontWeight: 500 }}>{emp.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.position}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Stores section at bottom */}
          {bottomStores.length > 0 && (
            <>
              {/* Connector */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>門市 ({bottomStores.length})</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '90%', height: 1, background: 'var(--border-strong)' }} />
              </div>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
                marginTop: 12,
              }}>
                {bottomStores.map(s => (
                  <div key={s.id} style={{
                    background: 'var(--glass-light)',
                    border: '1px dashed var(--border-strong)',
                    borderRadius: 8,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 500,
                    textAlign: 'center',
                    minWidth: 80,
                  }}>
                    {s.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
