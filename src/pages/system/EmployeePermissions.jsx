import { useState, useEffect, useMemo } from 'react'
import { Search, Shield, ShieldOff, CheckCircle2, XCircle, AlertCircle, RotateCcw, Plus, Minus } from 'lucide-react'
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

// ── 主功能配置（104 風格）──
// 每個 feature 對應 1 個查詢 perm 和/或 1 個修改 perm。
// 沒有 view = 該功能本身就是動作（如「假單核可」），只顯示「修改」
// 沒有 edit = 該功能只能查看（如「全公司薪資」），只顯示「查詢」
// 規則：點修改 ON → 自動帶上查詢 ON；點查詢 OFF → 自動帶上修改 OFF
const FEATURES = [
  // 組織架構
  { module: '組織架構', label: '員工基本資料',   view: 'org.employee.view',     edit: 'org.employee.edit' },
  { module: '組織架構', label: '員工完整個資',   view: 'org.employee.view_full', edit: null },
  { module: '組織架構', label: '刪除員工 / 離職', view: null, edit: 'org.employee.delete' },
  { module: '組織架構', label: '組織架構編輯',   view: null, edit: 'org.structure.edit' },
  // 出勤與請假
  { module: '出勤與請假', label: '打卡紀錄', view: 'attendance.view_all', edit: 'attendance.edit' },
  { module: '出勤與請假', label: '假單核可', view: null, edit: 'leave.approve' },
  { module: '出勤與請假', label: '加班核可', view: null, edit: 'ot.approve' },
  { module: '出勤與請假', label: '出差核可', view: null, edit: 'trip.approve' },
  { module: '出勤與請假', label: '假別設定', view: null, edit: 'leave_type.edit' },
  // 排班管理
  { module: '排班管理', label: '排班',            view: 'schedule.view_all', edit: 'schedule.edit' },
  { module: '排班管理', label: '排班演算法',      view: null, edit: 'schedule.algo' },
  { module: '排班管理', label: '排班規則 / 班別', view: null, edit: 'schedule.rule_edit' },
  // HR 表單
  { module: 'HR 表單', label: '審核 HR 表單', view: 'hr_form.view', edit: 'hr_form.approve' },
  { module: 'HR 表單', label: 'HR 表單範本',  view: null,           edit: 'hr_form.template_edit' },
  // 薪酬與福利
  { module: '薪酬與福利', label: '部門薪資',   view: 'salary.view_dept',     edit: null },
  { module: '薪酬與福利', label: '全公司薪資', view: 'salary.view_all',      edit: null },
  { module: '薪酬與福利', label: '薪資結構',   view: null,                   edit: 'salary.edit' },
  { module: '薪酬與福利', label: '批次計薪',   view: null,                   edit: 'salary.compute' },
  { module: '薪酬與福利', label: '薪資發放',   view: null,                   edit: 'salary.pay' },
  { module: '薪酬與福利', label: '資遣',       view: 'severance.view',       edit: 'severance.execute' },
  { module: '薪酬與福利', label: '法扣',       view: 'legal_deduction.view', edit: 'legal_deduction.edit' },
  { module: '薪酬與福利', label: '績效獎金',   view: 'bonus.view',           edit: 'bonus.compute' },
  { module: '薪酬與福利', label: '勞健保級距', view: 'insurance_rate.view',  edit: 'insurance_rate.edit' },
  // 人才發展
  { module: '人才發展', label: '招募管理',   view: 'recruit.view',   edit: 'recruit.manage' },
  { module: '人才發展', label: '教育訓練',   view: 'training.view',  edit: 'training.manage' },
  { module: '人才發展', label: '試用期評核', view: 'probation.view', edit: 'probation.evaluate' },
  // 員工體驗
  { module: '員工體驗', label: '滿意度調查結果', view: 'survey.view_result', edit: null },
  { module: '員工體驗', label: 'AI 離職預測',    view: 'ai_attrition.view',  edit: null },
  // 行政庶務
  { module: '行政庶務', label: '費用申請審核', view: 'expense.view',         edit: 'expense.approve' },
  { module: '行政庶務', label: '費用核銷',     view: 'expense.settle_view',  edit: 'expense.settle' },
  { module: '行政庶務', label: '會計科目',     view: 'expense.account_view', edit: 'expense.account_edit' },
  { module: '行政庶務', label: '文件',         view: 'doc.view',             edit: 'doc.delete' },
  // 專案流程
  { module: '專案流程', label: '專案',         view: 'project.view',         edit: 'project.manage' },
  { module: '專案流程', label: '任務指派',     view: null,                   edit: 'task.assign' },
  { module: '專案流程', label: '簽核鏈設定',   view: 'approval_chain.view',  edit: 'approval_chain.edit' },
  // 系統設定
  { module: '系統設定', label: '使用者管理',     view: 'system.user_view',       edit: 'system.user_manage' },
  { module: '系統設定', label: '員工個別權限',   view: 'system.permission_view', edit: 'system.permission_manage' },
  { module: '系統設定', label: '操作紀錄',       view: 'audit.view',             edit: null },
  { module: '系統設定', label: '系統設定編輯',   view: null,                     edit: 'system.admin' },
  { module: '系統設定', label: '租戶管理',       view: null,                     edit: 'system.tenant_manage' },
  // 財務（未交付，super_admin 才看得到）
  { module: '財務', label: '財務查看', view: 'finance.view', edit: null },
  { module: '財務', label: '財務編輯', view: null,           edit: 'finance.edit' },
  // 導航顯示（sidebar 顯示控制，單一 toggle）
  { module: '導航顯示', label: 'CRM 群組顯示',          view: null, edit: 'nav.group.crm' },
  { module: '導航顯示', label: '供應鏈群組顯示',        view: null, edit: 'nav.group.supply' },
  { module: '導航顯示', label: '分析群組顯示',          view: null, edit: 'nav.group.analytics' },
  { module: '導航顯示', label: '系統群組顯示',          view: null, edit: 'nav.group.system' },
  { module: '導航顯示', label: '超管群組顯示',          view: null, edit: 'nav.group.super_admin' },
  { module: '導航顯示', label: '組織完整管理',          view: null, edit: 'nav.org.full' },
  { module: '導航顯示', label: '組織內部資料',          view: null, edit: 'nav.org.internal' },
  { module: '導航顯示', label: '排班與假日',            view: null, edit: 'nav.schedule.basic' },
  { module: '導航顯示', label: '排班規則 / 工時設定',   view: null, edit: 'nav.schedule.config' },
  { module: '導航顯示', label: '薪資查看與發放',        view: null, edit: 'nav.salary.basic' },
  { module: '導航顯示', label: '進階薪資',              view: null, edit: 'nav.salary.advanced' },
  { module: '導航顯示', label: '法令工資設定',          view: null, edit: 'nav.salary.law' },
  { module: '導航顯示', label: '人才發展',              view: null, edit: 'nav.talent' },
  { module: '導航顯示', label: '員工體驗管理',          view: null, edit: 'nav.experience_mgr' },
  { module: '導航顯示', label: '行政庶務',              view: null, edit: 'nav.admin_office' },
  { module: '導航顯示', label: '表單建立器',            view: null, edit: 'nav.hr_form.builder' },
  { module: '導航顯示', label: '專案工作管理',          view: null, edit: 'nav.project.work' },
  { module: '導航顯示', label: '專案設定 / AI 助理',    view: null, edit: 'nav.project.admin' },
]

// 批次模式單一動作的 pill：label + 開/關兩個圓形 icon button
// 預設淡背景，hover 顯示完整顏色
function BatchActionPill({ label, accent, onOpen, onClose, disabled }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 6px 3px 10px', borderRadius: 14,
      background: 'var(--glass-light)',
      border: `1px solid ${accent}`,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
      <button onClick={onOpen} disabled={disabled}
        title={`對選中員工開啟「${label}」（grant）`}
        style={{
          width: 22, height: 22, borderRadius: '50%', padding: 0,
          border: 'none', background: 'transparent',
          color: 'var(--accent-green)', cursor: disabled ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .12s',
        }}
        onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--accent-green)'; e.currentTarget.style.color = '#fff' } }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent-green)' }}>
        <Plus size={14} strokeWidth={3} />
      </button>
      <button onClick={onClose} disabled={disabled}
        title={`對選中員工關閉「${label}」（revoke）`}
        style={{
          width: 22, height: 22, borderRadius: '50%', padding: 0,
          border: 'none', background: 'transparent',
          color: 'var(--accent-red)', cursor: disabled ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .12s',
        }}
        onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--accent-red)'; e.currentTarget.style.color = '#fff' } }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent-red)' }}>
        <Minus size={14} strokeWidth={3} />
      </button>
    </div>
  )
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

  // 批次模式：勾選多位員工一起套用同樣的開/關
  // 規則：單擊員工 row → 切換為單選編輯（清空 batch set）
  //      勾 checkbox → 加入/移出批次（不影響 selectedEmp）
  //      batchSelectedIds.size >= 2 時，右側切換成批次操作 UI
  const [batchSelectedIds, setBatchSelectedIds] = useState(new Set())
  const [batchSaving, setBatchSaving] = useState(false)

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    supabase.from('employees')
      .select('id, name, name_en, role, dept, position')
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
    // 單擊員工 row → 單選編輯，清空批次選擇
    setBatchSelectedIds(new Set())
    setSelectedEmp(emp)
    loadPermissions(emp.id)
  }

  // 勾 checkbox → 加入/移出批次選擇（不切到單選編輯）
  const handleToggleBatchSelect = (empId) => {
    setBatchSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  // 批次套用：對選中的 N 人 × M perm，用指定 mode 寫進去
  // perms: [{ permission_id, code }]
  // mode: 'grant' / 'revoke' / 'reset'
  const batchApplyPerms = async (perms, mode) => {
    if (batchSelectedIds.size === 0 || perms.length === 0) return
    if (!isSuperAdmin) {
      // admin 不能對自己 / 其他 admin / super_admin 動手
      const targetEmps = employees.filter(e => batchSelectedIds.has(e.id))
      const violators = targetEmps.filter(e =>
        e.id === profile?.id || ['super_admin', 'admin'].includes(e.role)
      )
      if (violators.length > 0) {
        toast.error(`不能修改：${violators.map(e => e.name).join('、')}（超管 / 其他管理員 / 自己）`)
        return
      }
    }

    setBatchSaving(true)
    const tasks = []
    for (const empId of batchSelectedIds) {
      for (const perm of perms) {
        tasks.push(supabase.rpc('set_employee_permission_override', {
          p_emp_id: empId,
          p_perm_id: perm.permission_id,
          p_mode: mode,
          p_reason: null,
        }))
      }
    }
    const results = await Promise.all(tasks)
    setBatchSaving(false)

    const failures = results.filter(r => r.error || r.data?.ok === false)
    if (failures.length > 0) {
      toast.error(`部分失敗：${failures.length}/${tasks.length}（${failures[0].error?.message || failures[0].data?.error || ''}）`)
    } else {
      const actionText = mode === 'grant' ? '開啟' : mode === 'revoke' ? '關閉' : '重置'
      toast.success(`已對 ${batchSelectedIds.size} 位員工 ${actionText} ${perms.length} 項權限`)
    }
  }

  // 批次：對 feature 套用「開啟查詢」「關閉查詢」「開啟修改」「關閉修改」
  // 套用連動規則：開啟修改自動帶查詢；關閉查詢自動帶修改關閉
  const handleBatchFeatureAction = async (feature, kind, action) => {
    const viewPerm = feature.view ? permByCode[feature.view] : null
    const editPerm = feature.edit ? permByCode[feature.edit] : null
    let perms = []
    if (kind === 'view') {
      if (action === 'grant') {
        // 開啟查詢 → 只動 view
        if (viewPerm) perms.push(viewPerm)
      } else {
        // 關閉查詢 → view + edit 都關（不能看不能改）
        if (viewPerm) perms.push(viewPerm)
        if (editPerm) perms.push(editPerm)
      }
    } else {
      if (action === 'grant') {
        // 開啟修改 → view + edit 都開
        if (viewPerm) perms.push(viewPerm)
        if (editPerm) perms.push(editPerm)
      } else {
        // 關閉修改 → 只動 edit
        if (editPerm) perms.push(editPerm)
      }
    }
    await batchApplyPerms(perms, action)
  }

  const handleBatchFeatureReset = async (feature) => {
    const viewPerm = feature.view ? permByCode[feature.view] : null
    const editPerm = feature.edit ? permByCode[feature.edit] : null
    const perms = [viewPerm, editPerm].filter(Boolean)
    await batchApplyPerms(perms, 'reset')
  }

  // 區塊性「全選」「全不選」：對整個 module 內所有 feature 一次套用
  // 自動用單選/批次模式（看 batchSelectedIds 是否有人）
  const handleModuleSelectAll = async (features, action) => {
    const targetIds = batchSelectedIds.size > 0
      ? Array.from(batchSelectedIds)
      : (selectedEmp ? [selectedEmp.id] : [])
    if (targetIds.length === 0) return

    // admin 防呆
    if (!isSuperAdmin) {
      const targetEmps = employees.filter(e => targetIds.includes(e.id))
      const violators = targetEmps.filter(e =>
        e.id === profile?.id || ['super_admin', 'admin'].includes(e.role)
      )
      if (violators.length > 0) {
        toast.error(`不能修改：${violators.map(e => e.name).join('、')}`)
        return
      }
    }

    // 蒐集這個 module 內所有 perm（view + edit）
    const perms = []
    for (const f of features) {
      if (f.view && permByCode[f.view]) perms.push(permByCode[f.view])
      if (f.edit && permByCode[f.edit]) perms.push(permByCode[f.edit])
    }
    if (perms.length === 0) return

    setBatchSaving(true)
    const tasks = []
    for (const empId of targetIds) {
      for (const perm of perms) {
        tasks.push(supabase.rpc('set_employee_permission_override', {
          p_emp_id: empId, p_perm_id: perm.permission_id, p_mode: action, p_reason: null,
        }))
      }
    }
    const results = await Promise.all(tasks)
    setBatchSaving(false)

    const failures = results.filter(r => r.error || r.data?.ok === false)
    if (failures.length > 0) {
      toast.error(`部分失敗：${failures.length}/${tasks.length}`)
    } else {
      const verb = action === 'grant' ? '全選' : action === 'revoke' ? '全不選' : '重置'
      toast.success(`已對 ${targetIds.length} 位員工的 ${perms.length} 項權限 ${verb}`)
    }

    // 單選模式 → 重抓選中員工狀態
    if (batchSelectedIds.size === 0 && selectedEmp) {
      const { data: refreshed } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: selectedEmp.id })
      if (refreshed) setPermissions(refreshed)
    }
  }

  const handleBatchResetAll = async () => {
    if (batchSelectedIds.size === 0) return
    if (!confirm(`確定要清除 ${batchSelectedIds.size} 位員工的所有個別權限調整，全部恢復為各自角色預設嗎？`)) return
    if (!isSuperAdmin) {
      const targetEmps = employees.filter(e => batchSelectedIds.has(e.id))
      const violators = targetEmps.filter(e =>
        e.id === profile?.id || ['super_admin', 'admin'].includes(e.role)
      )
      if (violators.length > 0) {
        toast.error(`不能修改：${violators.map(e => e.name).join('、')}`)
        return
      }
    }
    setBatchSaving(true)
    const tasks = Array.from(batchSelectedIds).map(empId =>
      supabase.rpc('reset_all_employee_permission_overrides', { p_emp_id: empId })
    )
    const results = await Promise.all(tasks)
    setBatchSaving(false)
    const totalDeleted = results.reduce((s, r) => s + (r.data?.deleted || 0), 0)
    toast.success(`已恢復 ${batchSelectedIds.size} 位員工的 ${totalDeleted} 項權限`)
  }

  // 全部恢復角色預設（清光該員工所有 override）
  const handleResetAll = async () => {
    if (!canManage || !selectedEmp) return
    if (!isSuperAdmin && selectedEmp.id === profile?.id) {
      toast.warning('您不能修改自己的權限')
      return
    }
    if (!isSuperAdmin && ['super_admin', 'admin'].includes(selectedEmp.role)) {
      toast.warning('管理員不能修改超管或其他管理員的權限')
      return
    }
    const overrideCount = permissions.filter(p => p.source === 'grant' || p.source === 'role_revoke').length
    if (overrideCount === 0) {
      toast.info('沒有任何個別權限調整可恢復')
      return
    }
    if (!confirm(`確定要清除 ${selectedEmp.name} 的所有個別權限調整（${overrideCount} 項），全部恢復為「${ROLE_LABEL[selectedEmp.role] || selectedEmp.role}」的預設嗎？`)) return

    const { data, error } = await supabase.rpc('reset_all_employee_permission_overrides', { p_emp_id: selectedEmp.id })
    if (error || data?.ok === false) {
      toast.error('恢復失敗：' + (error?.message || data?.error || '未知錯誤'))
      return
    }
    toast.success(`已恢復 ${data?.deleted ?? 0} 項權限至角色預設`)
    // 重抓
    const { data: refreshed } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: selectedEmp.id })
    if (refreshed) setPermissions(refreshed)
  }

  // 員工搜尋過濾（中文姓名 / 英文姓名 / 部門 / 職稱）
  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(e =>
      (e.name || '').toLowerCase().includes(q)
      || (e.name_en || '').toLowerCase().includes(q)
      || (e.dept || '').toLowerCase().includes(q)
      || (e.position || '').toLowerCase().includes(q)
    )
  }, [employees, search])

  // perm code → perm object（給 FEATURES lookup 用）
  const permByCode = useMemo(() => {
    const m = {}
    for (const p of permissions) m[p.code] = p
    return m
  }, [permissions])

  // 把 FEATURES 過濾掉「兩個 perm 都不存在」的（例：admin 看不到 finance.* 那兩個 feature 自動消失）
  const visibleFeatures = useMemo(() => {
    return FEATURES.filter(f => {
      const hasView = f.view && permByCode[f.view]
      const hasEdit = f.edit && permByCode[f.edit]
      return hasView || hasEdit
    })
  }, [permByCode])

  // 按 module 分組 features
  const groupedFeatures = useMemo(() => {
    const groups = {}
    for (const f of visibleFeatures) {
      if (!groups[f.module]) groups[f.module] = []
      groups[f.module].push(f)
    }
    return groups
  }, [visibleFeatures])

  // 對單一 perm 做樂觀切換（內部用，給 handleFeatureToggle 呼叫）
  const togglePermOptimistic = async (perm, targetEffective) => {
    let nextMode, optimisticSource
    if (targetEffective && !perm.effective) {
      // 要開但目前是關
      nextMode = perm.source === 'none' ? 'grant' : 'reset'
      optimisticSource = perm.source === 'none' ? 'grant' : 'role'
    } else if (!targetEffective && perm.effective) {
      // 要關但目前是開
      nextMode = perm.source === 'role' ? 'revoke' : 'reset'
      optimisticSource = perm.source === 'role' ? 'role_revoke' : 'none'
    } else {
      // 已經是目標狀態，不用動
      return { ok: true }
    }

    // 樂觀更新本地 state
    setPermissions(prev => prev.map(p =>
      p.permission_id === perm.permission_id
        ? { ...p, source: optimisticSource, effective: targetEffective }
        : p
    ))

    const { data, error } = await supabase.rpc('set_employee_permission_override', {
      p_emp_id:  selectedEmp.id,
      p_perm_id: perm.permission_id,
      p_mode:    nextMode,
      p_reason:  null,
    })
    return { ok: !error && data?.ok !== false, error, data }
  }

  // 切換 feature 的「查詢」或「修改」
  // kind: 'view' or 'edit'
  // 規則：
  //   點修改 ON → 自動帶上查詢 ON（要先看到才能改）
  //   點查詢 OFF → 自動帶上修改 OFF（不能改但能看不合理）
  const handleFeatureToggle = async (feature, kind) => {
    if (!canManage || !selectedEmp) return
    if (!isSuperAdmin && selectedEmp.id === profile?.id) {
      toast.warning('您不能修改自己的權限，請聯絡超級管理員')
      return
    }
    if (!isSuperAdmin && ['super_admin', 'admin'].includes(selectedEmp.role)) {
      toast.warning('管理員不能修改超管或其他管理員的權限')
      return
    }

    const viewPerm = feature.view ? permByCode[feature.view] : null
    const editPerm = feature.edit ? permByCode[feature.edit] : null

    // 算目標 view/edit effective 狀態
    let targetView = viewPerm?.effective ?? false
    let targetEdit = editPerm?.effective ?? false
    if (kind === 'view') {
      targetView = !targetView
      if (!targetView) targetEdit = false  // 查詢 OFF → 強制 修改 OFF
    } else {
      targetEdit = !targetEdit
      if (targetEdit) targetView = true     // 修改 ON → 強制 查詢 ON
    }

    // 標記正在 save（讓兩個 toggle 都 disable）
    const ids = []
    if (viewPerm) ids.push(viewPerm.permission_id)
    if (editPerm) ids.push(editPerm.permission_id)
    setSavingIds(s => new Set([...s, ...ids]))

    // 平行打 RPC
    const tasks = []
    if (viewPerm) tasks.push(togglePermOptimistic(viewPerm, targetView))
    if (editPerm) tasks.push(togglePermOptimistic(editPerm, targetEdit))
    const results = await Promise.all(tasks)

    setSavingIds(s => {
      const n = new Set(s)
      ids.forEach(id => n.delete(id))
      return n
    })

    const failed = results.find(r => !r.ok)
    if (failed) {
      toast.error('儲存失敗：' + (failed.error?.message || failed.data?.error || '未知錯誤'))
      // 失敗回滾 → 重抓真實狀態
      const { data: refreshed } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: selectedEmp.id })
      if (refreshed) setPermissions(refreshed)
    }
  }

  // 重置 feature（移除 view + edit 的 override）
  const handleFeatureReset = async (feature) => {
    if (!canManage || !selectedEmp) return
    const viewPerm = feature.view ? permByCode[feature.view] : null
    const editPerm = feature.edit ? permByCode[feature.edit] : null

    const tasks = []
    for (const perm of [viewPerm, editPerm]) {
      if (!perm) continue
      if (perm.source !== 'grant' && perm.source !== 'role_revoke') continue
      tasks.push(supabase.rpc('set_employee_permission_override', {
        p_emp_id: selectedEmp.id,
        p_perm_id: perm.permission_id,
        p_mode: 'reset',
        p_reason: null,
      }))
    }
    if (tasks.length === 0) return
    await Promise.all(tasks)
    // 重置完重抓一次（這個比較少用，可以接受抓）
    const { data: refreshed } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: selectedEmp.id })
    if (refreshed) setPermissions(refreshed)
  }

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
              <input className="form-input" placeholder="搜尋姓名 (中/英) / 部門 / 職稱"
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32, fontSize: 13 }} />
            </div>
          </div>
          {/* 批次模式提示 + 全部恢復 */}
          {batchSelectedIds.size > 0 && (
            <div style={{
              padding: '8px 12px', background: 'var(--accent-cyan-dim)',
              fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>已勾選 {batchSelectedIds.size} 位（批次操作）</span>
              <button onClick={() => setBatchSelectedIds(new Set())}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent-cyan)', padding: 2 }}>
                清空
              </button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredEmployees.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無員工</div>
            ) : filteredEmployees.map(e => {
              const roleLbl = ROLE_LABEL[e.role] || e.role || '—'
              const isSelected = selectedEmp?.id === e.id
              const isBatchChecked = batchSelectedIds.has(e.id)
              return (
                <div key={e.id}
                  style={{
                    padding: '10px 14px',
                    background: isBatchChecked ? 'var(--accent-cyan-dim)'
                              : isSelected ? 'var(--glass-light)' : 'transparent',
                    borderLeft: isSelected || isBatchChecked
                      ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  {/* checkbox 加入批次 */}
                  <input type="checkbox" checked={isBatchChecked}
                    onChange={() => handleToggleBatchSelect(e.id)}
                    onClick={(ev) => ev.stopPropagation()}
                    style={{ cursor: 'pointer', width: 14, height: 14 }}
                    title="勾選加入批次操作" />
                  {/* 點 row 進入單選編輯 */}
                  <button onClick={() => handleSelectEmp(e)}
                    style={{
                      flex: 1, textAlign: 'left', border: 'none', cursor: 'pointer',
                      background: 'transparent', padding: 0,
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
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 右側：權限編輯 / 批次操作（窄屏會 wrap 到下一行全寬） ── */}
        <div className="card" style={{ flex: '2 1 460px', minWidth: 0 }}>
          {batchSelectedIds.size > 0 ? (
            // ── 批次操作 UI ──
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--accent-cyan-dim)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      🔧 批次操作 · 已選 {batchSelectedIds.size} 位員工
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, maxWidth: 600 }}>
                      {employees.filter(e => batchSelectedIds.has(e.id)).map(e => e.name).join('、')}
                    </div>
                  </div>
                  <button onClick={handleBatchResetAll}
                    disabled={batchSaving}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: 'transparent', color: 'var(--accent-red)',
                      border: '1px solid var(--accent-red)',
                      cursor: batchSaving ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                    <RotateCcw size={12} /> 全部恢復角色預設
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                  · 點 <b style={{ color: 'var(--accent-green)' }}>+開</b> 一次對選中員工開啟該權限 · 點 <b style={{ color: 'var(--accent-red)' }}>−關</b> 一次關閉<br />
                  · 連動規則同單一模式：開修改自動帶查詢、關查詢自動帶關修改
                </div>
              </div>

              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Object.entries(groupedFeatures).map(([module, features]) => (
                  <div key={module}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)',
                      letterSpacing: 1, marginBottom: 8, paddingBottom: 6,
                      borderBottom: '1px dashed var(--border-medium)',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <span>{module}</span>
                      <button onClick={() => handleModuleSelectAll(features, 'grant')}
                        disabled={batchSaving}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          border: '1px solid var(--accent-green)',
                          background: 'transparent', color: 'var(--accent-green)',
                          cursor: batchSaving ? 'wait' : 'pointer',
                          letterSpacing: 'normal',
                        }}>全選</button>
                      <button onClick={() => handleModuleSelectAll(features, 'revoke')}
                        disabled={batchSaving}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          border: '1px solid var(--accent-red)',
                          background: 'transparent', color: 'var(--accent-red)',
                          cursor: batchSaving ? 'wait' : 'pointer',
                          letterSpacing: 'normal',
                        }}>全不選</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {features.map(f => (
                        <div key={(f.view || '') + (f.edit || '') + f.label} style={{
                          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                          padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
                        }}>
                          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 1 }}>
                              {[f.view, f.edit].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {f.view && (
                            <BatchActionPill label="查詢" accent="var(--accent-cyan)"
                              onOpen={() => handleBatchFeatureAction(f, 'view', 'grant')}
                              onClose={() => handleBatchFeatureAction(f, 'view', 'revoke')}
                              disabled={batchSaving} />
                          )}
                          {f.edit && (
                            <BatchActionPill label="修改" accent="var(--accent-orange)"
                              onOpen={() => handleBatchFeatureAction(f, 'edit', 'grant')}
                              onClose={() => handleBatchFeatureAction(f, 'edit', 'revoke')}
                              disabled={batchSaving} />
                          )}
                          <button onClick={() => handleBatchFeatureReset(f)} disabled={batchSaving}
                            title="重置此功能的 override（恢復角色預設）"
                            style={{
                              width: 26, height: 26, borderRadius: '50%', padding: 0,
                              background: 'transparent', border: '1px solid var(--border-medium)',
                              color: 'var(--text-muted)', cursor: batchSaving ? 'wait' : 'pointer',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : !selectedEmp ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Shield size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
              <h3>請從左側選擇員工</h3>
              <p style={{ fontSize: 13 }}>單擊員工 → 編輯該員工權限；勾 checkbox → 加入批次操作</p>
            </div>
          ) : loadingPerms ? (
            <LoadingSpinner />
          ) : (
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedEmp.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {[ROLE_LABEL[selectedEmp.role], selectedEmp.dept, selectedEmp.position].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {permissions.filter(p => p.effective).length} / {permissions.length} 項權限
                      {permissions.filter(p => p.source === 'grant' || p.source === 'role_revoke').length > 0 && (
                        <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontWeight: 600 }}>
                          ({permissions.filter(p => p.source === 'grant' || p.source === 'role_revoke').length} 項個別調整)
                        </span>
                      )}
                    </div>
                    <button onClick={handleResetAll}
                      disabled={permissions.filter(p => p.source === 'grant' || p.source === 'role_revoke').length === 0}
                      style={{
                        padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-medium)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                      title="清除所有個別權限調整，全部恢復為該角色的預設">
                      <RotateCcw size={12} /> 全部恢復角色預設
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Object.entries(groupedFeatures).map(([module, features]) => (
                  <div key={module}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)',
                      letterSpacing: 1, marginBottom: 8, paddingBottom: 6,
                      borderBottom: '1px dashed var(--border-medium)',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <span>{module}</span>
                      <button onClick={() => handleModuleSelectAll(features, 'grant')}
                        disabled={batchSaving}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          border: '1px solid var(--accent-green)',
                          background: 'transparent', color: 'var(--accent-green)',
                          cursor: batchSaving ? 'wait' : 'pointer',
                          letterSpacing: 'normal',
                        }}>全選</button>
                      <button onClick={() => handleModuleSelectAll(features, 'revoke')}
                        disabled={batchSaving}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          border: '1px solid var(--accent-red)',
                          background: 'transparent', color: 'var(--accent-red)',
                          cursor: batchSaving ? 'wait' : 'pointer',
                          letterSpacing: 'normal',
                        }}>全不選</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {features.map(f => {
                        const viewPerm = f.view ? permByCode[f.view] : null
                        const editPerm = f.edit ? permByCode[f.edit] : null
                        // 任一個 perm 是 override，整個 feature 就標 override 樣式
                        const viewIsOverride = viewPerm && (viewPerm.source === 'grant' || viewPerm.source === 'role_revoke')
                        const editIsOverride = editPerm && (editPerm.source === 'grant' || editPerm.source === 'role_revoke')
                        const isOverride = viewIsOverride || editIsOverride
                        // 整 feature 的「主 badge」優先採 edit；沒 edit 就用 view
                        const primaryPerm = editPerm || viewPerm
                        const badge = SOURCE_BADGE[primaryPerm?.source] || SOURCE_BADGE.none
                        const saving = (viewPerm && savingIds.has(viewPerm.permission_id))
                                    || (editPerm && savingIds.has(editPerm.permission_id))

                        const featureKey = (viewPerm?.permission_id || editPerm?.permission_id) + '-' + (f.label || '')

                        return (
                          <div key={featureKey} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 8,
                            background: isOverride ? badge.bg : 'transparent',
                            border: `1px solid ${isOverride ? badge.color : 'var(--border-subtle)'}`,
                          }}>
                            {/* feature label + 對應 perm code */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 1 }}>
                                {[f.view, f.edit].filter(Boolean).join(' · ')}
                              </div>
                            </div>

                            {/* 查詢 button（只有 view perm 才顯示）*/}
                            {viewPerm && (
                              <button onClick={() => handleFeatureToggle(f, 'view')} disabled={saving}
                                style={{
                                  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                  cursor: saving ? 'wait' : 'pointer',
                                  border: `1.5px solid ${viewPerm.effective ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                                  background: viewPerm.effective ? 'var(--accent-cyan)' : 'transparent',
                                  color: viewPerm.effective ? '#fff' : 'var(--text-muted)',
                                  minWidth: 56,
                                }}>
                                {viewPerm.effective ? '✓ 查詢' : '查詢'}
                              </button>
                            )}

                            {/* 修改 button（只有 edit perm 才顯示，跟查詢同色系青色）*/}
                            {editPerm && (
                              <button onClick={() => handleFeatureToggle(f, 'edit')} disabled={saving}
                                style={{
                                  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                  cursor: saving ? 'wait' : 'pointer',
                                  border: `1.5px solid ${editPerm.effective ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                                  background: editPerm.effective ? 'var(--accent-cyan)' : 'transparent',
                                  color: editPerm.effective ? '#fff' : 'var(--text-muted)',
                                  minWidth: 56,
                                }}>
                                {editPerm.effective ? '✓ 修改' : '修改'}
                              </button>
                            )}

                            {/* badge：override 顯示「日期 手動調整」；非 override 顯示「角色預設」「無」*/}
                            {(() => {
                              const overridePerm = [viewPerm, editPerm].find(p =>
                                p && (p.source === 'grant' || p.source === 'role_revoke') && p.override_at
                              )
                              if (overridePerm) {
                                const d = new Date(overridePerm.override_at)
                                const pad = n => String(n).padStart(2, '0')
                                const dateText = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
                                return (
                                  <span style={{
                                    fontSize: 10, fontWeight: 600,
                                    padding: '2px 8px', borderRadius: 4,
                                    color: badge.color, background: badge.bg,
                                    border: `1px solid ${badge.color}`,
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {dateText} 手動調整
                                  </span>
                                )
                              }
                              // 非 override：顯示「角色預設」/「無」
                              return (
                                <span style={{
                                  fontSize: 10, fontWeight: 600,
                                  padding: '2px 8px', borderRadius: 4,
                                  color: badge.color, background: badge.bg,
                                  border: `1px solid ${badge.color}`,
                                  whiteSpace: 'nowrap',
                                }}>
                                  {badge.label}
                                </span>
                              )
                            })()}

                            {/* reset button */}
                            {isOverride && (
                              <button onClick={() => handleFeatureReset(f)}
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
                · <b>查詢</b>（青色）= 看得到，不能改 · <b>修改</b>（橘色）= 看得到 + 可以改<br />
                · 點修改 ON 自動帶上查詢；點查詢 OFF 自動把修改也關掉<br />
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
