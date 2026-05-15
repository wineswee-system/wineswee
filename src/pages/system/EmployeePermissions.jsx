import { useState, useEffect, useMemo } from 'react'
import { Search, Shield, ShieldOff, CheckCircle2, XCircle, AlertCircle, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from '../../lib/toast'

const ROLE_LABEL = {
  store_staff:  '門市人員',
  office_staff: '行政人員',
  manager:      '主管',
  admin:        'HR 管理員',
  super_admin:  '超級管理員',
  employee:     '行政人員',
}
const roleColor = {
  super_admin: 'badge-danger',
  admin:       'badge-purple',
  manager:     'badge-info',
  office_staff:'badge-neutral',
  store_staff: 'badge-neutral',
  employee:    'badge-neutral',
}

// source → 顯示文字 & 顏色
const SOURCE_BADGE = {
  role:        { label: '角色預設', color: 'var(--text-muted)',    bg: 'var(--glass-light)' },
  grant:       { label: '個人加給', color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)' },
  role_revoke: { label: '個人禁用', color: 'var(--accent-red)',    bg: 'var(--accent-red-dim)' },
  none:        { label: '無',       color: 'var(--text-muted)',    bg: 'transparent' },
}

export default function EmployeePermissions() {
  const { profile, role } = useAuth()
  const orgId = profile?.organization_id
  // super_admin / admin 都可以用此頁；DB RPC 也對應放寬
  const canManage = role?.name === 'super_admin' || role?.name === 'admin'
  const isSuperAdmin = role?.name === 'super_admin'

  const [employees, setEmployees] = useState([])
  const [search, setSearch] = useState('')
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingPerms, setLoadingPerms] = useState(false)
  const [savingIds, setSavingIds] = useState(new Set())  // 哪些 permission_id 正在 save

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    supabase.from('employees')
      .select('id, name, role, dept, position')
      .eq('organization_id', orgId)
      .eq('status', '在職')
      .order('name')
      .then(({ data }) => {
        setEmployees(data || [])
        setLoading(false)
      })
  }, [orgId])

  // 選員工 → 載入該員工有效權限
  const loadPermissions = async (empId) => {
    if (!empId) return
    setLoadingPerms(true)
    const { data, error } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: empId })
    if (error) {
      // 詳細記錄到 console 方便 debug
      console.error('[EmployeePermissions] RPC error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      toast.error('載入失敗：' + (error.message || error.code || error.details || '未知錯誤'))
      setPermissions([])
    } else {
      setPermissions(data || [])
    }
    setLoadingPerms(false)
  }

  const handleSelectEmp = (emp) => {
    setSelectedEmp(emp)
    loadPermissions(emp.id)
  }

  // 切換 permission → 樂觀更新（先動 UI，失敗回滾）
  // 避開 loadPermissions 切 loading spinner 導致 scroll 跳回頂端的問題
  const handleToggle = async (perm) => {
    if (!canManage || !selectedEmp) return
    if (!isSuperAdmin && selectedEmp.id === profile?.id) {
      toast.warning('您不能修改自己的權限，請聯絡超級管理員')
      return
    }
    if (!isSuperAdmin && ['super_admin', 'admin'].includes(selectedEmp.role)) {
      toast.warning('管理員不能修改超管或其他管理員的權限')
      return
    }

    // 計算 mode + 樂觀更新後的 source/effective
    let nextMode, optimisticSource, optimisticEffective
    if (perm.effective) {
      // 目前 ON → 切 OFF
      nextMode = perm.source === 'role' ? 'revoke' : 'reset'
      optimisticSource = perm.source === 'role' ? 'role_revoke' : 'none'  // grant → reset → none
      optimisticEffective = false
    } else {
      // 目前 OFF → 切 ON
      nextMode = perm.source === 'none' ? 'grant' : 'reset'
      optimisticSource = perm.source === 'none' ? 'grant' : 'role'  // role_revoke → reset → role
      optimisticEffective = true
    }

    setSavingIds(s => new Set([...s, perm.permission_id]))
    // 樂觀更新：先動本地 state，UI 立刻反應
    setPermissions(prev => prev.map(p =>
      p.permission_id === perm.permission_id
        ? { ...p, source: optimisticSource, effective: optimisticEffective }
        : p
    ))

    const { data, error } = await supabase.rpc('set_employee_permission_override', {
      p_emp_id:  selectedEmp.id,
      p_perm_id: perm.permission_id,
      p_mode:    nextMode,
      p_reason:  null,
    })
    setSavingIds(s => { const n = new Set(s); n.delete(perm.permission_id); return n })

    if (error || data?.ok === false) {
      toast.error('儲存失敗：' + (error?.message || data?.error || '未知錯誤'))
      // 失敗 → 重抓真實狀態回滾（不切 loading spinner，避免 scroll 跳）
      const { data: refreshed } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: selectedEmp.id })
      if (refreshed) setPermissions(refreshed)
    }
    // 成功就不用重抓（樂觀更新已經對了）
  }

  // 員工搜尋過濾
  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(e =>
      (e.name || '').toLowerCase().includes(q)
      || (e.dept || '').toLowerCase().includes(q)
      || (e.position || '').toLowerCase().includes(q)
    )
  }, [employees, search])

  // 按 module 分組
  const groupedPerms = useMemo(() => {
    const groups = {}
    for (const p of permissions) {
      if (!groups[p.module]) groups[p.module] = []
      groups[p.module].push(p)
    }
    return groups
  }, [permissions])

  if (loading) return <LoadingSpinner />

  if (!canManage) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--accent-red)' }}>
        <Shield size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
        <h3>權限不足</h3>
        <p style={{ color: 'var(--text-muted)' }}>此頁面僅限管理員 / 超級管理員使用</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🔐</span> 員工個別權限</h2>
        <p>超級管理員可針對個別員工開放或關閉特定功能，覆蓋角色預設</p>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ── 左側：員工列表（寬屏固定 320px；窄屏全寬 wrap 到下一行） ── */}
        <div className="card" style={{
          padding: 0,
          flex: '1 1 280px',
          minWidth: 0,
          maxWidth: 360,
          maxHeight: 'calc(100vh - 220px)',
          overflow: 'auto',
        }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" placeholder="搜尋姓名/部門/職稱"
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32, fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredEmployees.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無員工</div>
            ) : filteredEmployees.map(e => {
              const roleLbl = ROLE_LABEL[e.role] || e.role || '—'
              const isSelected = selectedEmp?.id === e.id
              return (
                <button key={e.id} onClick={() => handleSelectEmp(e)}
                  style={{
                    textAlign: 'left', padding: '10px 14px', border: 'none', cursor: 'pointer',
                    background: isSelected ? 'var(--accent-cyan-dim)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {[e.dept, e.position].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className={`badge ${roleColor[e.role] || 'badge-neutral'}`} style={{ fontSize: 10 }}>{roleLbl}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 右側：權限編輯（窄屏會 wrap 到下一行全寬） ── */}
        <div className="card" style={{ flex: '2 1 460px', minWidth: 0 }}>
          {!selectedEmp ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Shield size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
              <h3>請從左側選擇員工</h3>
              <p style={{ fontSize: 13 }}>選擇後將顯示該員工的全部 15 項權限與覆蓋狀態</p>
            </div>
          ) : loadingPerms ? (
            <LoadingSpinner />
          ) : (
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedEmp.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {[ROLE_LABEL[selectedEmp.role], selectedEmp.dept, selectedEmp.position].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {permissions.filter(p => p.effective).length} / {permissions.length} 項權限
                  </div>
                </div>
              </div>

              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Object.entries(groupedPerms).map(([module, items]) => (
                  <div key={module}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)',
                      letterSpacing: 1, marginBottom: 8, paddingBottom: 6,
                      borderBottom: '1px dashed var(--border-medium)',
                    }}>
                      {module}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {items.map(p => {
                        const badge = SOURCE_BADGE[p.source] || SOURCE_BADGE.none
                        const saving = savingIds.has(p.permission_id)
                        const isOverride = p.source === 'grant' || p.source === 'role_revoke'
                        return (
                          <div key={p.permission_id} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '8px 12px', borderRadius: 6,
                            background: isOverride ? badge.bg : 'transparent',
                            border: `1px solid ${isOverride ? badge.color : 'transparent'}`,
                          }}>
                            <button onClick={() => handleToggle(p)} disabled={saving}
                              style={{
                                width: 20, height: 20, borderRadius: 4, cursor: saving ? 'wait' : 'pointer',
                                border: `1.5px solid ${p.effective ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                                background: p.effective ? 'var(--accent-green)' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', padding: 0, flexShrink: 0,
                              }}>
                              {p.effective && <CheckCircle2 size={14} strokeWidth={3} />}
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 1 }}>
                                {p.code}
                              </div>
                            </div>
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              padding: '2px 8px', borderRadius: 4,
                              color: badge.color, background: badge.bg,
                              border: `1px solid ${badge.color}`,
                            }}>
                              {badge.label}
                            </span>
                            {isOverride && (
                              <button onClick={() => handleToggle({ ...p, source: 'reset_target' })}
                                title="重置為角色預設"
                                style={{
                                  background: 'transparent', border: 'none', cursor: 'pointer',
                                  color: 'var(--text-muted)', padding: 2,
                                }}>
                                <RotateCcw size={12} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                padding: 14, borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)', fontSize: 11, color: 'var(--text-muted)',
                lineHeight: 1.6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <AlertCircle size={12} /> <b>說明</b>
                </div>
                · 點 checkbox 切換權限，立即生效（個人 override 寫進 employee_permissions 表）<br />
                · <span style={{ color: SOURCE_BADGE.grant.color }}>個人加給</span>：角色預設沒有，這人額外開放<br />
                · <span style={{ color: SOURCE_BADGE.role_revoke.color }}>個人禁用</span>：角色預設有，這人特別禁用<br />
                · 右側 ↻ 圖示：移除 override 回到角色預設
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
