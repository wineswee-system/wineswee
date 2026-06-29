import { useState, useEffect } from 'react'
import { getDepartments, getDepartmentSections, getEmployees, getStores } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

export default function OrgChart() {
  const { profile } = useAuth()
  const [departments, setDepartments] = useState([])
  const [sections, setSections] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getDepartments(orgId),
      getDepartmentSections(orgId),
      getEmployees(orgId),
      getStores(orgId),
      // active 任職紀錄 — 用來查「某員工在某部門掛的職位」（主要 / 次要 都拿）
      supabase.from('employee_assignments')
        .select('employee_id, department_id, position, department_type, is_active')
        .eq('is_active', true),
    ])
      .then(([dRes, secRes, eRes, sRes, aRes]) => {
        setDepartments(dRes.data || [])
        setSections(secRes.data || [])
        setEmployees((eRes.data || []).filter(e => e.status === '在職'))
        setStores((sRes.data || []).filter(s => s.is_active !== false))
        setAssignments(aRes.data || [])
      })
      .finally(() => setLoading(false))
  }, [profile?.organization_id])

  // 即時反映部門改名 / 新增 / 刪除
  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) return
    const channel = supabase
      .channel(`org-depts-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
        getDepartments(orgId).then(res => setDepartments(res.data || []))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.organization_id])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>

  // 顏色順序：青 → 黃 → 綠 → 藍 → 紫（拿掉紅色，避免「部門/人名紅字」誤判成警告/異常）
  const colors = ['var(--accent-cyan)', 'var(--accent-yellow)', 'var(--accent-green)', 'var(--accent-blue)', 'var(--accent-purple)']
  const dims = ['var(--accent-cyan-dim)', 'var(--accent-yellow-dim)', 'var(--accent-green-dim)', 'var(--accent-blue-dim)', 'var(--accent-purple-dim)']

  // 頂層部門：動態從 departments 找，不寫死名稱
  const APEX_KEYWORDS = ['執行長室', '總經理室', '董事長室', 'CEO', '執行長']
  const apexDept = departments.find(d => APEX_KEYWORDS.some(k => d.name?.includes(k)))
  const apexName = apexDept?.name || '執行長室'

  // 稽核室類直屬 apex 的部門 — 從主部門 bus 移出，顯示為 apex 的直接側支
  const AUDIT_DEPT_KEYWORDS = ['稽核室', '內部稽核', '監察室']
  const auditDepts = departments.filter(d =>
    AUDIT_DEPT_KEYWORDS.some(k => d.name?.includes(k))
  )
  const auditDeptIds = new Set(auditDepts.map(d => d.id))

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

  // 找該員工在指定部門掛的職位：
  //   - 若是員工「主部門」(employees.department_id === deptId) → 直接用員工卡上填的「主職位」 (employees.position)
  //     避免 employee_assignments 內留下「部門主管」這類 default 值蓋掉真正主職位
  //   - 若是「次要部門」 → 找該部門的 assignment.position（次要任職的職稱）
  //   - 都查不到 → 空字串（不再 fallback 主職位，避免「老闆」「總經理」洩漏到次要部門）
  const positionInDept = (emp, deptId) => {
    if (!emp) return ''
    if (emp.department_id === deptId) return emp.position || ''
    const a = assignments.find(x => x.employee_id === emp.id && x.department_id === deptId)
    return a?.position || ''
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
        // 2. 正職/約聘 group before 兼職/派遣 group
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

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🌐</span> 組織架構</h2>
            <p>完整人員配置（共 {totalCompanyHeadcount} 人）</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: '32px 24px', overflowX: 'auto' }}>
          {/* Top: 執行長室真正置中 — 左 flex:1 空白 / 執行長室 / flex:1 放高管 */}
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }} />
            <div style={{
              background: 'linear-gradient(135deg, var(--accent-cyan-dim), var(--accent-blue-dim))',
              border: '2px solid var(--accent-cyan)',
              borderRadius: 12,
              padding: '14px 32px',
              textAlign: 'center',
              minWidth: 160,
              flexShrink: 0,
            }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent-cyan)' }}>{apexName}</div>
            </div>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              {execBoardMembers.length > 0 && (
                <div style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  gap: 4,
                  background: 'var(--accent-purple-dim)',
                  border: '2px solid var(--accent-purple)',
                  borderRadius: 10,
                  padding: '8px 14px',
                  minWidth: 120,
                }}>
                  {execBoardMembers.map(emp => (
                    <div key={emp.id} style={{ textAlign: 'center' }}>
                      {emp.position && (
                        <div style={{ fontSize: 10, color: 'var(--accent-purple)', fontWeight: 700, letterSpacing: 1 }}>{emp.position}</div>
                      )}
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-purple)' }}>{labelOf(emp)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Vertical line + 稽核室 direct-report branch — 同樣 3 欄確保垂直線對齊執行長室中心 */}
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {/* left: flex 1 空白 */}
            <div style={{ flex: 1 }} />
            {/* center: 垂直線，alignSelf stretch 撐到右欄高度 */}
            <div style={{ flexShrink: 0, alignSelf: 'stretch', display: 'flex', justifyContent: 'center', minHeight: 24 }}>
              <div style={{ width: 1, background: 'var(--border-strong)', minHeight: 24 }} />
            </div>
            {/* right: flex 1，稽核室從這裡橫出 */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start' }}>
              {auditDepts.map((aDept) => {
                const allVis = departments.filter(d => d.name !== apexName && !auditDeptIds.has(d.id))
                const aidx = departments.filter(d => d.name !== apexName).findIndex(d => d.id === aDept.id)
                const aColor = colors[Math.max(0, aidx) % colors.length]
                const aDim = dims[Math.max(0, aidx) % dims.length]
                const aMgr = managerOf(aDept)
                const aMembers = deptMembersExcludingStoreStaff(aDept)
                return (
                  <div key={aDept.id} style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 8, paddingBottom: 8 }}>
                    <div style={{ width: 24, height: 1, background: 'var(--border-strong)', marginTop: 15, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        background: aDim,
                        border: `1.5px solid ${aColor}`,
                        borderRadius: 10,
                        padding: '8px 14px',
                        textAlign: 'center',
                        minWidth: 90,
                      }}>
                        <div style={{ fontWeight: 700, color: aColor, fontSize: 13 }}>{aDept.name}</div>
                        {aMgr && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.35 }}>
                            {positionInDept(aMgr, aDept.id) ? `${positionInDept(aMgr, aDept.id)} ${aMgr.name}` : labelOf(aMgr)}
                          </div>
                        )}
                      </div>
                    {aMembers.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {aMembers.map(emp => (
                          <div key={emp.id} style={{
                            background: 'var(--glass-light)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 8,
                            padding: '4px 8px',
                            textAlign: 'center',
                            fontSize: 12,
                            minWidth: 80,
                          }}>
                            <div style={{ fontWeight: 500 }}>{labelOf(emp)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.position}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          </div>

          {/* Horizontal line */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '92%', height: 1, background: 'var(--border-strong)' }} />
          </div>

          {/* Departments row（總經理室是 apex，不再列入） */}
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {departments.filter(d => d.name !== apexName && !auditDeptIds.has(d.id)).map((dept, i) => {
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

                  {/* Department box — 部門名 + 主管合一 */}
                  <div style={{
                    background: dim,
                    border: `1.5px solid ${color}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    textAlign: 'center',
                    width: '100%',
                  }}>
                    <div style={{ fontWeight: 700, color, fontSize: 13, lineHeight: 1.3 }}>{dept.name}</div>
                    {[managerOf(dept), ...subs].filter(Boolean).map(m => {
                      const pos = positionInDept(m, dept.id)
                      return (
                        <div key={m.id} style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.35 }}>
                          {pos ? `${pos} ${m.name}` : labelOf(m)}
                        </div>
                      )
                    })}
                  </div>

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
            const visibleDepts = departments.filter(d => d.name !== apexName && !auditDeptIds.has(d.id))
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
            const visibleDepts = departments.filter(d => d.name !== apexName && !auditDeptIds.has(d.id))
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
                                            color: emp.employment_type === '兼職' ? 'var(--accent-orange)' : 'var(--text-secondary)',
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

