import { useState, useEffect } from 'react'
import { LayoutGrid, GitBranch } from 'lucide-react'
import { Tree, TreeNode } from 'react-organizational-chart'
import { getDepartments, getDepartmentSections, getEmployees, getStores } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'

const VIEW_KEY = 'sme_orgchart_view_mode'

export default function OrgChart() {
  const { profile } = useAuth()
  const [departments, setDepartments] = useState([])
  const [sections, setSections] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_KEY) || 'detail')

  const switchMode = (m) => {
    setViewMode(m)
    localStorage.setItem(VIEW_KEY, m)
  }

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([getDepartments(), getDepartmentSections(), getEmployees(), getStores()])
      .then(([dRes, secRes, eRes, sRes]) => {
        // 多租戶過濾：只顯示自己組織的資料（避免幽靈員工）
        const inOrg = (x) => orgId == null || x.organization_id == null || x.organization_id === orgId
        setDepartments((dRes.data || []).filter(inOrg))
        setSections((secRes.data || []).filter(inOrg))
        setEmployees((eRes.data || []).filter(e => e.status === '在職' && inOrg(e)))
        setStores((sRes.data || []).filter(s => s.is_active !== false && inOrg(s)))
      })
      .finally(() => setLoading(false))
  }, [profile?.organization_id])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>

  // 顏色順序：紅 → 黃 → 綠 → 藍 → 紫，5 色循環
  const colors = ['var(--accent-red)', 'var(--accent-yellow)', 'var(--accent-green)', 'var(--accent-blue)', 'var(--accent-purple)']
  const dims = ['var(--accent-red-dim)', 'var(--accent-yellow-dim)', 'var(--accent-green-dim)', 'var(--accent-blue-dim)', 'var(--accent-purple-dim)']

  // 兼總經理室：讀 employees.is_executive_board 旗標 (DB 端標記)
  // 之前硬寫 [48, 52] 員工 id，老闆換人就壞 → 改用旗標
  const execBoardMembers = employees.filter(e => e.is_executive_board)

  // 顯示用：「中文 EN」如有英文名
  const labelOf = (emp) => emp ? `${emp.name}${emp.name_en ? ` ${emp.name_en}` : ''}` : '-'

  // Find department manager (returns the employee object so caller can use labelOf)
  const managerOf = (dept) => {
    if (dept.manager_id) return employees.find(e => e.id === dept.manager_id) || null
    return null
  }
  const managerName = (dept) => {
    const mgr = managerOf(dept)
    return mgr ? labelOf(mgr) : (dept.head || '-')
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

  // Employees assigned to a store, with 店長 first
  const isStoreLead = (e) => (e.position || '').includes('店長') && !(e.position || '').includes('副店長')
  const storeEmployees = (store) =>
    employees
      .filter(e => e.store_id === store.id)
      .sort((a, b) => {
        // 1. 店長 first
        const aLead = isStoreLead(a) ? 0 : 1
        const bLead = isStoreLead(b) ? 0 : 1
        if (aLead !== bLead) return aLead - bLead
        // 2. 全職 group before 兼職 group
        const aPart = a.employment_type === '兼職' ? 1 : 0
        const bPart = b.employment_type === '兼職' ? 1 : 0
        if (aPart !== bPart) return aPart - bPart
        // 3. then by name (zh-Hant collation)
        return (a.name || '').localeCompare(b.name || '', 'zh-Hant')
      })

  // Dept members excluding those already shown under a store in that dept
  const deptMembersExcludingStoreStaff = (dept) => {
    const deptStoreIds = new Set(stores.filter(s => s.department_id === dept.id).map(s => s.id))
    return members(dept).filter(e => !e.store_id || !deptStoreIds.has(e.store_id))
  }

  // Stores belonging to a department
  const deptStores = (dept) =>
    stores.filter(s => s.department_id === dept.id)

  // Stores not assigned to any department
  const unassignedStores = stores.filter(s => !s.department_id)

  // Sections (課) belonging to a department
  const deptSections = (dept) => sections.filter(sec => sec.department_id === dept.id)
  const sectionStores = (sec) => stores.filter(s => s.section_id === sec.id)
  const supervisorOf = (sec) => sec.supervisor_id ? employees.find(e => e.id === sec.supervisor_id) : null
  const storeManagerOf = (s) => s.manager_id ? employees.find(e => e.id === s.manager_id) : null

  // Staff under a store excluding the store manager (manager rendered separately)
  const storeStaffExcludingManager = (s) =>
    storeEmployees(s).filter(e => e.id !== s.manager_id)

  // Separate depts with many stores (fan-out tree) vs few (inline)
  // 但 sections-bearing dept (例如營運部) 走 section-tree，不走 fan-out
  const BIG_STORE_THRESHOLD = 3
  const bigStoreDepts = departments.filter(d =>
    deptStores(d).length > BIG_STORE_THRESHOLD && deptSections(d).length === 0
  )
  const sectionedDepts = departments.filter(d => deptSections(d).length > 0)

  // 部門總人數：含主管 + 副主管 + 部門員工 + 部門 / 課別下所有門市員工（去重）
  // 含「掛名主管」— 即使該主管的主部門不是這個部門，只要 dept.manager_id 指向他就算
  const headcountOf = (dept) => {
    const ids = new Set()
    employees.forEach(e => {
      if (e.department_id === dept.id || e.dept === dept.name) ids.add(e.id)
    })
    if (dept.manager_id) ids.add(dept.manager_id)
    deptStores(dept).forEach(s => storeEmployees(s).forEach(e => ids.add(e.id)))
    deptSections(dept).forEach(sec => sectionStores(sec).forEach(s =>
      storeEmployees(s).forEach(e => ids.add(e.id))
    ))
    return ids.size
  }
  const sectionHeadcount = (sec) => {
    const ids = new Set()
    sectionStores(sec).forEach(s => storeEmployees(s).forEach(e => ids.add(e.id)))
    if (sec.supervisor_id) ids.add(sec.supervisor_id)
    return ids.size
  }
  const totalCompanyHeadcount = employees.length

  // ─── 模式切換按鈕 ───
  const ModeToggle = () => (
    <div style={{ display: 'inline-flex', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: 3 }}>
      {[
        { key: 'detail', label: '詳細', icon: LayoutGrid, hint: '完整人員配置' },
        { key: 'compact', label: '精簡', icon: GitBranch, hint: '僅部門結構' },
      ].map(m => {
        const Icon = m.icon
        const active = viewMode === m.key
        return (
          <button key={m.key} onClick={() => switchMode(m.key)} title={m.hint} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: active ? 'var(--accent-cyan)' : 'transparent',
            color: active ? '#fff' : 'var(--text-muted)',
          }}>
            <Icon size={13} /> {m.label}
          </button>
        )
      })}
    </div>
  )

  if (viewMode === 'compact') {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-header-row">
            <div>
              <h2><span className="header-icon">🌐</span> 組織架構</h2>
              <p>精簡模式 — 部門結構樹（共 {totalCompanyHeadcount} 人）</p>
            </div>
            <ModeToggle />
          </div>
        </div>
        <CompactTreeView
          departments={departments}
          sections={sections}
          employees={employees}
          stores={stores}
          headcountOf={headcountOf}
          sectionHeadcount={sectionHeadcount}
          managerName={managerName}
          deptStores={deptStores}
          deptSections={deptSections}
          sectionStores={sectionStores}
          storeManagerOf={storeManagerOf}
          storeEmployees={storeEmployees}
          totalCompanyHeadcount={totalCompanyHeadcount}
          execBoardMembers={execBoardMembers}
          labelOf={labelOf}
        />
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🌐</span> 組織架構</h2>
            <p>詳細模式 — 完整人員配置（共 {totalCompanyHeadcount} 人）</p>
          </div>
          <ModeToggle />
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: '32px 24px', overflowX: 'auto' }}>
          {/* Top: 總經理室 + 兼任高管 */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 16, marginBottom: 0 }}>
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
            {execBoardMembers.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                background: 'var(--accent-red-dim)',
                border: '2px solid var(--accent-red)',
                borderRadius: 10,
                padding: '8px 14px',
                minWidth: 120,
              }}>
                <div style={{ fontSize: 10, color: 'var(--accent-red)', fontWeight: 700, textAlign: 'center', letterSpacing: 1 }}>兼任高管</div>
                {execBoardMembers.map(emp => (
                  <div key={emp.id} style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-red)', textAlign: 'center' }}>
                    {labelOf(emp)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vertical line */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
          </div>

          {/* Horizontal line */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '92%', height: 1, background: 'var(--border-strong)' }} />
          </div>

          {/* Departments row（總經理室是 apex，不再列入） */}
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {departments.filter(d => d.name !== '總經理室').map((dept, i) => {
              const color = colors[i % colors.length]
              const dim = dims[i % dims.length]
              const head = managerName(dept)
              // sectioned dept (例如 營運部)：subManagers 會在課別 tree 顯示，不放在 dept 主管框
              const hasSecs = deptSections(dept).length > 0
              const subs = hasSecs ? [] : subManagers(dept)
              const mems = deptMembersExcludingStoreStaff(dept)
              const dStores = deptStores(dept)
              const hasMgr = head !== '-' || subs.length > 0
              // sectioned dept 不顯示 inline store，等下面的 section tree 處理
              const isBigStoreDept = dStores.length > BIG_STORE_THRESHOLD || hasSecs

              return (
                <div key={dept.id} style={{ flex: '1 1 110px', maxWidth: 160, minWidth: 100, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* vertical connector from top bus */}
                  <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />

                  {/* Department solid box */}
                  <div style={{
                    background: dim,
                    border: `1.5px solid ${color}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    textAlign: 'center',
                    width: '100%',
                  }}>
                    <div style={{ fontWeight: 700, color, fontSize: 13, lineHeight: 1.3 }}>{dept.name}</div>
                    <div style={{ fontSize: 10, color, opacity: 0.85, marginTop: 3, fontWeight: 600 }}>
                      共 {headcountOf(dept)} 人
                    </div>
                  </div>

                  {/* Dashed manager box under dept */}
                  {hasMgr && (
                    <>
                      <div style={{ width: 1, height: 14, background: 'var(--border-strong)' }} />
                      <div style={{
                        border: `1px dashed ${color}`,
                        borderRadius: 8,
                        padding: '6px 10px',
                        textAlign: 'center',
                        background: 'var(--glass-light)',
                        minWidth: 80,
                      }}>
                        {head !== '-' && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{head}</div>
                        )}
                        {subs.map(s => (
                          <div key={s.id} style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{labelOf(s)}</div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Members (inline, small count) */}
                  {mems.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, width: '100%' }}>
                      {mems.map(emp => (
                        <div key={emp.id} style={{
                          background: 'var(--glass-light)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          padding: '5px 8px',
                          textAlign: 'center',
                          fontSize: 12,
                        }}>
                          <div style={{ fontWeight: 500 }}>{labelOf(emp)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.position}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline stores (small groups) */}
                  {dStores.length > 0 && !isBigStoreDept && (
                    <>
                      <div style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                        {dStores.map(s => {
                          const staff = storeEmployees(s)
                          return (
                            <div key={s.id} style={{
                              background: 'var(--glass-light)',
                              border: '1.5px solid var(--border-strong)',
                              borderRadius: 8,
                              padding: '6px 8px',
                              textAlign: 'center',
                            }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{s.name}</div>
                              {staff.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                                  {staff.map(emp => (
                                    <div key={emp.id} style={{
                                      fontSize: 11,
                                      color: isStoreLead(emp) ? color : 'var(--text-secondary)',
                                      fontWeight: isStoreLead(emp) ? 600 : 400,
                                    }}>
                                      {labelOf(emp)}
                                      {emp.position && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {emp.position}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Fan-out tree for depts with many stores (e.g. 營運部) */}
          {bigStoreDepts.map((dept, i) => {
            const visibleDepts = departments.filter(d => d.name !== '總經理室')
            const color = colors[visibleDepts.indexOf(dept) % colors.length]
            const dStores = deptStores(dept)
            return (
              <div key={dept.id} style={{ marginTop: 20 }}>
                {/* connector down from that dept column would be ideal, but stores span wider — show labeled tree */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                  <div style={{
                    fontSize: 12,
                    color,
                    fontWeight: 600,
                    border: `1px dashed ${color}`,
                    borderRadius: 6,
                    padding: '3px 10px',
                    background: 'var(--glass-light)',
                  }}>
                    {dept.name}門市 ({dStores.length})
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '92%', height: 1, background: 'var(--border-strong)' }} />
                </div>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center',
                  marginTop: 12,
                }}>
                  {dStores.map(s => {
                    const staff = storeEmployees(s)
                    return (
                      <div key={s.id} style={{
                        background: 'var(--glass-light)',
                        border: '1.5px solid var(--border-strong)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        textAlign: 'center',
                        minWidth: 110,
                        maxWidth: 160,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
                        {staff.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px dashed var(--border-subtle)', paddingTop: 6 }}>
                            {staff.map(emp => (
                              <div key={emp.id} style={{
                                fontSize: 11,
                                color: isStoreLead(emp) ? color : 'var(--text-secondary)',
                                fontWeight: isStoreLead(emp) ? 700 : 500,
                                lineHeight: 1.3,
                              }}>
                                {labelOf(emp)}
                                {emp.position && (
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                                    {emp.position}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Section tree for sectioned depts (e.g. 營運部 → 4 課) */}
          {sectionedDepts.map((dept) => {
            const visibleDepts = departments.filter(d => d.name !== '總經理室')
            const color = colors[visibleDepts.indexOf(dept) % colors.length]
            const dim = dims[visibleDepts.indexOf(dept) % dims.length]
            const secs = deptSections(dept)
            return (
              <div key={`sec-${dept.id}`} style={{ marginTop: 24 }}>
                {/* connector */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <div style={{
                    fontSize: 12,
                    color,
                    fontWeight: 700,
                    border: `1px dashed ${color}`,
                    borderRadius: 6,
                    padding: '4px 14px',
                    background: 'var(--glass-light)',
                  }}>
                    {dept.name} 課別 ({secs.length})
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '92%', height: 1, background: 'var(--border-strong)' }} />
                </div>

                {/* 4 課並排，每課內部「橫向」展開門市，再縱向疊員工 */}
                <div style={{
                  display: 'flex',
                  gap: 24,
                  marginTop: 12,
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start',
                  paddingBottom: 8,
                }}>
                  {secs.map((sec) => {
                    const supe = supervisorOf(sec)
                    const secStores = sectionStores(sec)
                    return (
                      <div key={sec.id} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0,
                      }}>
                        {/* connector to bus */}
                        <div style={{ width: 1, height: 14, background: 'var(--border-strong)' }} />
                        {/* Section header (課別 + 督導 + 人數) */}
                        <div style={{
                          background: dim,
                          border: `1.5px solid ${color}`,
                          borderRadius: 8,
                          padding: '8px 16px',
                          textAlign: 'center',
                          minWidth: 160,
                        }}>
                          <div style={{ fontWeight: 700, color, fontSize: 13 }}>
                            {sec.name}
                            <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85, marginLeft: 6 }}>· {sectionHeadcount(sec)} 人</span>
                          </div>
                          {supe && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                              {supe.position || '督導'} · {labelOf(supe)}
                            </div>
                          )}
                        </div>

                        {/* connector + horizontal store row */}
                        {secStores.length > 0 && (
                          <>
                            <div style={{ width: 1, height: 14, background: 'var(--border-strong)' }} />
                            {/* horizontal bus line spanning all stores */}
                            {secStores.length > 1 && (
                              <div style={{
                                width: `calc(100% - ${100 / secStores.length}%)`,
                                height: 1,
                                background: 'var(--border-strong)',
                              }} />
                            )}
                            <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                              {secStores.map((s) => {
                                const mgr = storeManagerOf(s)
                                const staff = storeStaffExcludingManager(s)
                                return (
                                  <div key={s.id} style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                  }}>
                                    {/* connector down to this store */}
                                    {secStores.length > 1 && (
                                      <div style={{ width: 1, height: 10, background: 'var(--border-strong)' }} />
                                    )}
                                    {/* Store header box (just name) */}
                                    <div style={{
                                      background: 'var(--glass-light)',
                                      border: '1.5px solid var(--border-strong)',
                                      borderRadius: 6,
                                      padding: '6px 10px',
                                      minWidth: 90,
                                      maxWidth: 90,
                                      textAlign: 'center',
                                    }}>
                                      <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{s.name}</div>
                                    </div>
                                    {/* Manager box */}
                                    {mgr && (
                                      <>
                                        <div style={{ width: 1, height: 8, background: 'var(--border-subtle)' }} />
                                        <div style={{
                                          background: 'var(--glass-light)',
                                          border: `1px dashed ${color}`,
                                          borderRadius: 6,
                                          padding: '4px 8px',
                                          fontSize: 11,
                                          color,
                                          fontWeight: 600,
                                          minWidth: 80,
                                          textAlign: 'center',
                                        }}>
                                          店長 {labelOf(mgr)}
                                        </div>
                                      </>
                                    )}
                                    {/* Staff list (vertical) */}
                                    {staff.length > 0 && (
                                      <div style={{
                                        display: 'flex', flexDirection: 'column', gap: 2,
                                        marginTop: 4,
                                        minWidth: 80,
                                      }}>
                                        {staff.map(emp => (
                                          <div key={emp.id} style={{
                                            fontSize: 11,
                                            background: 'var(--glass-light)',
                                            border: '1px solid var(--border-subtle)',
                                            borderRadius: 5,
                                            padding: '3px 8px',
                                            textAlign: 'center',
                                            color: emp.employment_type === '兼職' ? 'var(--accent-red)' : 'var(--text-secondary)',
                                            fontWeight: 500,
                                          }}>
                                            {labelOf(emp)}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Unassigned stores */}
          {unassignedStores.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>未分配門市 ({unassignedStores.length})</div>
              </div>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
              }}>
                {unassignedStores.map(s => (
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  精簡模式 — 104 風樹狀圖
//  每個 node 只顯示「部門名 + 主管 + 人數」，靠細線連接
// ═══════════════════════════════════════════════════════════════
const TREE_COLORS = ['#0ea5e9', '#14b8a6', '#f59e0b', '#a855f7', '#ec4899', '#10b981', '#ef4444']

function NodeBox({ color = '#14b8a6', title, subtitle, footnote, big = false }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #d1d5db',
      borderRadius: 4,
      width: big ? 180 : 138,
      textAlign: 'center',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      flexShrink: 0,
    }}>
      <div style={{
        background: color, color: '#fff',
        fontSize: 9, fontWeight: 600,
        padding: '3px 6px', letterSpacing: 2,
      }}>　</div>
      <div style={{ padding: '8px 6px' }}>
        <div style={{ fontSize: big ? 14 : 12, fontWeight: 700, color: '#111', lineHeight: 1.3 }}>
          {title || '—'}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', marginTop: 4, lineHeight: 1.3 }}>
            {subtitle}
          </div>
        )}
        {footnote && (
          <div style={{ fontSize: 9.5, color: '#6b7280', marginTop: 3 }}>
            {footnote}
          </div>
        )}
      </div>
    </div>
  )
}

function CompactTreeView({
  departments, sections, employees, stores,
  headcountOf, sectionHeadcount, managerName,
  deptStores, deptSections, sectionStores,
  storeManagerOf, storeEmployees,
  totalCompanyHeadcount, execBoardMembers, labelOf,
}) {
  const visibleDepts = departments.filter(d => d.name !== '總經理室')
  const apex = departments.find(d => d.name === '總經理室')
  const apexMgr = apex ? managerName(apex) : ''

  // ── 渲染 helpers（用 react-organizational-chart 的 Tree/TreeNode 自動畫線、自動對齊）──
  const renderStore = (store, color) => {
    const sMgr = storeManagerOf(store)
    return (
      <TreeNode key={store.id} label={
        <NodeBox color={color}
          title={store.name}
          subtitle={sMgr ? `店長 ${sMgr.name}` : ''}
          footnote={`部門人數：${storeEmployees(store).length}`} />
      } />
    )
  }

  const renderSection = (sec, color) => {
    const secMgr = sec.supervisor_id
      ? employees.find(e => e.id === sec.supervisor_id)?.name || ''
      : ''
    const secStores = sectionStores(sec)
    return (
      <TreeNode key={sec.id} label={
        <NodeBox color={color}
          title={sec.name}
          subtitle={secMgr}
          footnote={`部門人數：${sectionHeadcount(sec)}`} />
      }>
        {secStores.map(s => renderStore(s, color))}
      </TreeNode>
    )
  }

  const renderDept = (dept, i) => {
    const color = TREE_COLORS[i % TREE_COLORS.length]
    const mgr = managerName(dept)
    const cnt = headcountOf(dept)
    const secs = deptSections(dept)
    const dStores = deptStores(dept).filter(s => !s.section_id)
    return (
      <TreeNode key={dept.id} label={
        <NodeBox color={color}
          title={dept.name}
          subtitle={mgr !== '-' ? mgr : ''}
          footnote={`部門人數：${cnt}`} />
      }>
        {secs.map(sec => renderSection(sec, color))}
        {dStores.map(s => renderStore(s, color))}
      </TreeNode>
    )
  }

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 24, overflowX: 'auto', background: '#fafafa' }}>
        <div style={{ minWidth: 'fit-content' }}>
          <Tree
            lineWidth="1.5px"
            lineColor="#9ca3af"
            lineBorderRadius="6px"
            label={
              <NodeBox color="#0e7490"
                title={apex?.name || '公司'}
                subtitle={apexMgr || ''}
                footnote={`共 ${totalCompanyHeadcount} 人`}
                big />
            }
          >
            {visibleDepts.map(renderDept)}
          </Tree>
        </div>

        {/* 兼任高管 */}
        {execBoardMembers.length > 0 && (
          <div style={{ marginTop: 16, textAlign: 'center', fontSize: 11, color: '#6b7280' }}>
            兼任高管：{execBoardMembers.map(e => e.name).join('、')}
          </div>
        )}

        {/* 未分配門市 */}
        {(() => {
          const unassigned = stores.filter(s => !s.department_id && !s.section_id && s.is_active !== false)
          if (unassigned.length === 0) return null
          return (
            <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px dashed #d1d5db' }}>
              <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
                未分配門市（{unassigned.length}）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {unassigned.map(s => (
                  <NodeBox key={s.id} color="#9ca3af" title={s.name} footnote={`${storeEmployees(s).length} 人`} />
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
