import { useState, useEffect, useRef } from 'react'
import { Save, KeyRound } from 'lucide-react'
import InputModal from './ui/InputModal'
import { supabase } from '../lib/supabase'
import { updateEmployee } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import PersonalityTab from './employee/PersonalityTab'
import DevelopmentTab from './employee/DevelopmentTab'
import ProfileTabContent from './employee/ProfileTabContent'
import HrTabContent from './employee/HrTabContent'
import ScheduleTabContent from './employee/ScheduleTabContent'
import HistoryTabContent from './employee/HistoryTabContent'
import OffboardingModal from './OffboardingModal'
import { toast } from '../lib/toast'
import { confirm } from '../lib/confirm'

const maskId = (v) => v ? v.slice(0, 3) + '****' + v.slice(-2) : ''
const maskBank = (v) => v ? '****' + v.slice(-4) : ''

const SPECIAL_CATEGORIES = ['身心障礙者', '中低收入戶', '原住民', '中高齡者 (45+)', '長期失業者', '更生人', '獨力負擔家計者', '家庭暴力被害人', '二度就業婦女']

// Hex literal needed for 8-digit alpha-suffix concat in boxShadow; mirrors --accent-purple
const AVATAR_FALLBACK = '#8b5cf6'
// LINE brand green — not a CSS token, defined by LINE's brand guidelines
const LINE_BRAND_GREEN = '#06C755'

const MAIN_TABS = [
  { key: 'profile',  label: '員工資料', icon: '👤' },
  { key: 'hr',       label: '人事',     icon: '🏢' },
  { key: 'schedule', label: '排班',     icon: '📅' },
  { key: 'growth',   label: '發展',     icon: '🌱' },
  { key: 'history',  label: '歷程',     icon: '📂' },
]

export default function EmployeeDetail({ employee, employees: allEmployees, stores, departments, onUpdate, onClose, clickY }) {
  const { hasPermission, profile } = useAuth()
  const isAdmin = hasPermission('org.employee.edit')

  // 重設此員工的 LIFF 薪資密碼（清 line_pin_hash，員工下次查薪資重新設定）
  const handleResetSalaryPin = async () => {
    if (!(await confirm({ message: `確定重設「${employee.name}」的薪資密碼？\n重設後該員工下次在 LINE 查薪資需重新設定一組新密碼。` }))) return
    const { data, error } = await supabase.rpc('reset_employee_salary_pin', { p_employee_id: employee.id })
    if (error || !data?.ok) {
      toast.error(data?.error === 'NOT_AUTHORIZED' ? '需要管理員權限' : '重設失敗，請稍後再試')
      return
    }
    toast.success(`已重設「${employee.name}」的薪資密碼`)
  }

  const SUB_TABS = {
    profile: [
      { key: 'basic',      label: '基本資料' },
      { key: 'contact',    label: '聯絡方式' },
      ...(isAdmin ? [{ key: 'background', label: '背景資歷' }] : []),
    ],
    hr: [
      { key: 'org',       label: '組織職務' },
      { key: 'salary',    label: '薪資' },
      { key: 'insurance', label: '勞健退' },
    ],
    schedule: [
      { key: 'skills',       label: '技能 & 權限' },
      { key: 'availability', label: '班表設定' },
    ],
    growth: [
      { key: 'personality', label: '性格分析' },
      { key: 'development', label: '能力發展' },
    ],
    history: [
      { key: 'workflows',   label: '流程 & 任務' },
      { key: 'assignments', label: '指派 & 異動' },
      { key: 'reviews',     label: '評估 & 眷屬' },
      ...(isAdmin ? [{ key: 'changelog', label: '變更日誌' }] : []),
    ],
  }

  const [mainTab, setMainTab] = useState('profile')
  const [subTab, setSubTab] = useState('basic')

  const switchMainTab = (key) => {
    setMainTab(key)
    const subs = SUB_TABS[key]
    if (subs?.length > 0) setSubTab(subs[0].key)
  }

  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [passbookUploading, setPassbookUploading] = useState(false)

  // Sub-data
  const [roles, setRoles] = useState([])
  const [skills, setSkills] = useState([])
  const [dependents, setDependents] = useState([])
  const [transfers, setTransfers] = useState([])
  const [insuranceEvents, setInsuranceEvents] = useState([])
  const [reviews, setReviews] = useState([])
  const [schedPrefs, setSchedPrefs] = useState([])
  const [leaveRecords, setLeaveRecords] = useState([])
  const [availability, setAvailability] = useState([])
  const [onboardingTasks, setOnboardingTasks] = useState([])
  const [assignments, setAssignments] = useState([])
  const [targetWorkflows, setTargetWorkflows] = useState([])
  const [targetWfTasks, setTargetWfTasks] = useState([])
  const [lineAccounts, setLineAccounts] = useState([])
  const [lineChannels, setLineChannels] = useState([])
  const [newLineUserId, setNewLineUserId] = useState('')
  const [newLineChannel, setNewLineChannel] = useState('')
  const [unboundLineUsers, setUnboundLineUsers] = useState([])
  const [manualLineInput, setManualLineInput] = useState(false)

  // Offboarding modal
  const [offboarding, setOffboarding] = useState(null)  // { pendingStatus, pendingResignDate, dataToSave }
  const pendingSaveRef = useRef(null)

  // InputModal state
  const [inputModal, setInputModal] = useState({ open: false, title: '', label: '', placeholder: '', required: true, onConfirm: null })
  const openInput = (title, label, onConfirm, { placeholder = '', required = true } = {}) =>
    setInputModal({ open: true, title, label, placeholder, required, onConfirm })
  const closeInput = () => setInputModal(m => ({ ...m, open: false, onConfirm: null }))

  // Inline add skill
  const [newSkill, setNewSkill] = useState('')
  const [newSkillLevel, setNewSkillLevel] = useState('基礎')

  useEffect(() => {
    if (!employee) return
    setForm({ ...employee })
    setIsDirty(false)
    Promise.all([
      supabase.from('employee_skills').select('*').eq('employee_id', employee.id).order('id'),
      supabase.from('employee_dependents').select('*').eq('employee_id', employee.id).order('id'),
      supabase.from('employee_transfers').select('*').eq('employee_id', employee.id).order('transfer_date', { ascending: false }),
      supabase.from('employee_reviews').select('*').eq('employee_id', employee.id).order('review_date', { ascending: false }),
      supabase.from('employee_schedule_prefs').select('*').eq('employee_id', employee.id).order('id'),
      supabase.from('leave_requests').select('*').eq('employee_id', employee.id).order('id', { ascending: false }).limit(10),
      supabase.from('employee_availability').select('*').eq('employee', employee.name).order('day_of_week'),
      supabase.from('tasks').select('*').eq('assignee_id', employee.id).in('status', ['未開始', '進行中', '待簽核']).order('created_at', { ascending: false }),
      supabase.from('employee_assignments').select('*, departments(name), stores(name), updated_by_emp:updated_by(name)').eq('employee_id', employee.id).order('start_date', { ascending: false }),
      // ★ salary_structures 是薪資真理源（單一表）— 員工檔案頁的薪資 tab 用這個覆蓋舊版 employees 欄位
      supabase.from('salary_structures').select('*').eq('employee_id', employee.id).maybeSingle(),
      supabase.from('employee_insurance_events').select('*').eq('employee_id', employee.id).order('effective_date', { ascending: false }),
    ]).then(([sk, dep, tr, rev, sp, lv, av, ob, asgn, ss, insEv]) => {
      setSkills(sk.data || [])
      setDependents(dep.data || [])
      setTransfers(tr.data || [])
      setInsuranceEvents(insEv.data || [])
      setReviews(rev.data || [])
      setSchedPrefs(sp.data || [])
      setLeaveRecords(lv.data || [])
      setAvailability(av.data || [])
      setOnboardingTasks(ob.data || [])
      setAssignments(asgn.data || [])
      // ★ 用 salary_structures 覆蓋 form 內薪資欄位（若存在）
      if (ss?.data) {
        setForm(f => ({
          ...f,
          salary_type:         ss.data.salary_type         ?? f.salary_type,
          base_salary:         ss.data.base_salary         ?? f.base_salary,
          meal_allowance:      ss.data.meal_allowance      ?? f.meal_allowance,
          transport_allowance: ss.data.transport_allowance ?? f.transport_allowance,
          housing_allowance:   ss.data.housing_allowance   ?? f.housing_allowance,
          supervisor_allowance: ss.data.supervisor_allowance ?? f.supervisor_allowance,
          // 新版才有的欄位也帶進來
          role_allowance:        ss.data.role_allowance        ?? 0,
          attendance_bonus:      ss.data.attendance_bonus      ?? 0,
          night_shift_allowance: ss.data.night_shift_allowance ?? 0,
          cross_store_allowance: ss.data.cross_store_allowance ?? 0,
          hourly_rate:           ss.data.hourly_rate           ?? 0,
          weekly_hours:          ss.data.weekly_hours          ?? f.weekly_hours,
          custom_allowances:     Array.isArray(ss.data.custom_allowances) ? ss.data.custom_allowances : [],
          // ★ 計件薪資相關欄位
          employment_category:   ss.data.employment_category   ?? null,
          piece_rate:            ss.data.piece_rate            ?? 0,
          current_piece_count:   ss.data.current_piece_count   ?? 0,
        }))
      }
    }).catch(() => {})

    supabase.from('workflow_instances')
      .select('*').eq('target_employee_id', employee.id).order('started_at', { ascending: false })
      .then(({ data: wfs }) => {
        setTargetWorkflows(wfs || [])
        if (wfs?.length > 0) {
          supabase.from('tasks').select('*').in('workflow_instance_id', wfs.map(w => w.id)).order('step_order')
            .then(({ data: ts }) => setTargetWfTasks(ts || []))
        } else {
          setTargetWfTasks([])
        }
      }).catch(() => {})

    supabase.from('roles').select('id, name, description, level').order('level', { ascending: false })
      .then(({ data }) => setRoles(data || []))

    Promise.all([
      supabase.from('employee_line_accounts').select('*, line_channels(id, code, name)').eq('employee_id', employee.id).order('is_primary', { ascending: false }),
      supabase.from('line_channels').select('id, code, name').eq('status', 'active').order('name'),
    ]).then(([la, ch]) => {
      setLineAccounts(la.data || [])
      setLineChannels(ch.data || [])
      if (ch.data?.[0]) setNewLineChannel(String(ch.data[0].id))
    }).catch(() => {})
  }, [employee?.id])

  useEffect(() => {
    setNewLineUserId('')
    setManualLineInput(false)
    if (!newLineChannel) { setUnboundLineUsers([]); return }
    supabase.from('line_users')
      .select('line_user_id, display_name')
      .eq('channel_id', parseInt(newLineChannel))
      .is('employee_id', null)
      .order('display_name').limit(100)
      .then(({ data }) => setUnboundLineUsers(data || []))
      .catch(() => {})
  }, [newLineChannel])

  // body overflow 不再 lock（page 模式不是 modal）

  if (!employee) return null

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setIsDirty(true) }

  const handleSave = async () => {
    setSaving(true)
    const storeChanged = form.store !== employee.store && employee.store && form.store
    const dataToSave = { ...form }
    if ('supervisor' in form) {
      const sup = (allEmployees || []).find(e => e.name === form.supervisor)
      dataToSave.supervisor_id = sup ? sup.id : null
    }
    if ('dept' in form) {
      const d = (departments || []).find(x => x.name === form.dept)
      dataToSave.department_id = d ? d.id : null
    }
    if ('store' in form) {
      const s = (stores || []).find(x => x.name === form.store)
      dataToSave.store_id = s ? s.id : null
    }

    // Intercept resign / 留職停薪 status change → show offboarding modal
    const RESIGN_STATUSES = ['離職', '留職停薪']
    if (
      RESIGN_STATUSES.includes(form.status) &&
      form.status !== employee.status
    ) {
      pendingSaveRef.current = { dataToSave, storeChanged }
      setOffboarding({
        pendingStatus:     form.status,
        pendingResignDate: form.resign_date || null,
      })
      setSaving(false)
      return
    }

    const { data, error } = await updateEmployee(employee.id, dataToSave)
    if (error) {
      if (error.message?.includes('employees_employee_number_key')) {
        toast.error('員工編號已被使用，請換一個編號')
      } else {
        // 顯示真正錯誤（RPC 會回 SQLERRM），方便診斷而不是只看到「儲存失敗」
        toast.error('儲存失敗：' + (error.message || '未知錯誤'))
      }
      setSaving(false); return
    }
    if (data) {
      onUpdate(data); setIsDirty(false)
      if (storeChanged) {
        const today = new Date().toISOString().slice(0, 10)
        await supabase.from('schedules').delete().eq('employee_id', data.id).gt('date', today)
        toast.success(`已調至${form.store}，未來排班已清除，請重新排班`)
      }
    }

    // ★ 薪資真理源 sync — employees 表 update 後同步寫 salary_structures
    //   （HrTabContent 編輯的薪資/津貼欄位，舊版 save 只 update employees 不寫真理源）
    //   只在 form 內有薪資相關欄位時才動，避免不必要的 upsert
    const hasSalaryEdit = ['salary_type', 'base_salary', 'hourly_rate', 'meal_allowance',
      'transport_allowance', 'supervisor_allowance', 'attendance_bonus',
      'night_shift_allowance', 'cross_store_allowance', 'custom_allowances',
      'employment_category', 'piece_rate', 'current_piece_count']
      .some(k => k in form)
    if (hasSalaryEdit) {
      // 查現有 record 決定 update 還是 insert
      const { data: existing } = await supabase.from('salary_structures')
        .select('id').eq('employee_id', employee.id).maybeSingle()
      const ssPayload = {
        employee_id: employee.id,
        organization_id: employee.organization_id || profile?.organization_id || null,
        salary_type: form.salary_type ?? 'monthly',
        base_salary: Number(form.base_salary) || 0,
        hourly_rate: Number(form.hourly_rate) || 0,
        meal_allowance: Number(form.meal_allowance) || 0,
        transport_allowance: Number(form.transport_allowance) || 0,
        supervisor_allowance: Number(form.supervisor_allowance) || 0,
        attendance_bonus: Number(form.attendance_bonus) || 0,
        night_shift_allowance: Number(form.night_shift_allowance) || 0,
        cross_store_allowance: Number(form.cross_store_allowance) || 0,
        custom_allowances: Array.isArray(form.custom_allowances) ? form.custom_allowances : [],
        // ★ 計件薪資 — 三個欄位都同步寫，piece 員工以外的 employment_category 也要存
        employment_category: form.employment_category || null,
        piece_rate: Number(form.piece_rate) || 0,
        current_piece_count: Number(form.current_piece_count) || 0,
      }
      const ssOp = existing
        ? supabase.from('salary_structures').update(ssPayload).eq('id', existing.id)
        : supabase.from('salary_structures').insert(ssPayload)
      const { error: ssErr } = await ssOp
      if (ssErr) {
        console.warn('salary_structures sync 失敗:', ssErr)
        toast.error('薪資結構同步失敗 — 員工資料已存，但薪資真理源未更新')
        setSaving(false)
        return
      }
    }

    if (!storeChanged) toast.success('已更新')
    setSaving(false)
  }

  const handleOffboardingSuccess = async (rpcResult) => {
    // resign_employee already updated status + resign_date; save remaining form fields
    const { dataToSave, storeChanged } = pendingSaveRef.current || {}
    pendingSaveRef.current = null
    setOffboarding(null)

    const summary = [
      rpcResult.chain_steps_count > 0 && `${rpcResult.chain_steps_count} 個簽核關卡`,
      rpcResult.snapshots_count   > 0 && `${rpcResult.snapshots_count} 筆申請快照`,
      rpcResult.stores_count      > 0 && `${rpcResult.stores_count} 個門市主管`,
      rpcResult.depts_count       > 0 && `${rpcResult.depts_count} 個部門主管`,
    ].filter(Boolean).join('、')

    toast.success(summary ? `交接完成：${summary}已轉移` : `已設為${offboarding?.pendingStatus || '離職'}`)

    // Save any remaining form fields (resign_reason etc.) that the RPC didn't handle
    if (dataToSave) {
      const { data, error } = await updateEmployee(employee.id, dataToSave)
      if (error) toast.error('其他欄位儲存失敗，請重新儲存')
      if (data) {
        onUpdate(data); setIsDirty(false)
        if (storeChanged) {
          const today = new Date().toISOString().slice(0, 10)
          await supabase.from('schedules').delete().eq('employee_id', data.id).gt('date', today)
        }
      }
    }
  }

  const handleClose = async () => {
    if (isDirty && !(await confirm({ message: '有未儲存的變更，確定離開？' }))) return
    onClose()
  }

  const handlePassbookUpload = async (file) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('圖片不可超過 5MB'); return }
    setPassbookUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
      // path 寫死 ASCII（不能用中文，Storage 會擋）
      const path = `passbooks/${employee.id}/passbook.${ext || 'jpg'}`
      const { error: upErr } = await supabase.storage.from('employee-docs').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('employee-docs').getPublicUrl(path)
      set('passbook_image_url', urlData.publicUrl)
      toast.success('存摺封面已上傳')
    } catch (e) {
      toast.error('上傳失敗，請稍後再試')
    }
    setPassbookUploading(false)
  }

  // Skills
  const addSkill = async () => {
    if (!newSkill.trim()) return
    try {
      const { data } = await supabase.from('employee_skills').insert({ employee_id: employee.id, skill_name: newSkill.trim(), level: newSkillLevel }).select().single()
      if (data) { setSkills(prev => [...prev, data]); setNewSkill('') }
    } catch (e) { toast.error('新增失敗') }
  }
  const deleteSkill = async (id) => {
    try {
      await supabase.from('employee_skills').delete().eq('id', id)
      setSkills(prev => prev.filter(s => s.id !== id))
    } catch (e) { toast.error('刪除失敗') }
  }

  // Dependents
  const [showDepForm, setShowDepForm] = useState(false)
  const [depForm, setDepForm] = useState({ name: '', relationship: '配偶', id_number: '', birth_date: '', health_ins: false })
  const addDependent = async () => {
    if (!depForm.name) return
    try {
      const { data } = await supabase.from('employee_dependents').insert({
        employee_id: employee.id, name: depForm.name, relationship: depForm.relationship,
        id_number: depForm.id_number || null, birth_date: depForm.birth_date || null, health_ins: depForm.health_ins,
      }).select().single()
      if (data) {
        setDependents(prev => [...prev, data])
        setDepForm({ name: '', relationship: '配偶', id_number: '', birth_date: '', health_ins: false })
        setShowDepForm(false)
      }
    } catch (e) { toast.error('新增失敗') }
  }
  const deleteDependent = async (id) => {
    try {
      await supabase.from('employee_dependents').delete().eq('id', id)
      setDependents(prev => prev.filter(d => d.id !== id))
    } catch (e) { toast.error('刪除失敗') }
  }

  const addReview = () => {
    openInput('新增績效評估', '評分（1-5）：', (score) => {
      openInput('新增績效評估', '評語：', async (notes) => {
        closeInput()
        try {
          const { data } = await supabase.from('employee_reviews').insert({
            employee_id: employee.id, review_date: new Date().toISOString().slice(0, 10),
            reviewer: profile?.name || '管理員', score: Number(score), notes,
          }).select().single()
          if (data) setReviews(prev => [data, ...prev])
        } catch (e) { toast.error('新增失敗') }
      }, { placeholder: '選填', required: false })
    }, { placeholder: '1–5' })
  }

  const addTransfer = () => {
    openInput('新增異動紀錄', '調到哪個門市：', (to_store) => {
      openInput('新增異動紀錄', '調動原因：', async (reason) => {
        closeInput()
        try {
          const { data } = await supabase.from('employee_transfers').insert({
            employee_id: employee.id, transfer_date: new Date().toISOString().slice(0, 10),
            from_store: employee.store, to_store, from_dept: employee.dept, from_position: employee.position, reason,
          }).select().single()
          if (data) setTransfers(prev => [data, ...prev])
        } catch (e) { toast.error('新增失敗') }
      }, { placeholder: '選填', required: false })
    }, { placeholder: '門市名稱' })
  }

  const addSchedPref = () => {
    openInput('新增排班偏好', '排班偏好說明：', async (notes) => {
      closeInput()
      try {
        const { data } = await supabase.from('employee_schedule_prefs').insert({
          employee_id: employee.id, pref_type: 'note', notes,
        }).select().single()
        if (data) setSchedPrefs(prev => [...prev, data])
      } catch (e) { toast.error('新增失敗') }
    }, { placeholder: '例如：週六不排晚班' })
  }
  const deleteSchedPref = async (id) => {
    const { error } = await supabase.from('employee_schedule_prefs').delete().eq('id', id)
    if (error) { toast.error('刪除失敗，請稍後再試'); return }
    setSchedPrefs(prev => prev.filter(p => p.id !== id))
  }

  const DAYS = ['一', '二', '三', '四', '五', '六', '日']
  const AVAIL_STATUS = ['可排班', '偏好', '偏不排', '不可']
  const AVAIL_COLORS = { '可排班': 'var(--accent-green)', '偏好': 'var(--accent-blue)', '偏不排': 'var(--accent-orange)', '不可': 'var(--accent-red)' }

  const setAvail = async (dayIdx, status) => {
    const existing = availability.find(a => a.day_of_week === dayIdx)
    if (existing) {
      const { data } = await supabase.from('employee_availability').update({ status }).eq('id', existing.id).select().single()
      if (data) setAvailability(prev => prev.map(a => a.id === data.id ? data : a))
    } else {
      const { data } = await supabase.from('employee_availability').insert({ employee_id: employee.id, day_of_week: dayIdx, status }).select().single()
      if (data) setAvailability(prev => [...prev, data])
    }
  }
  const setAvailShift = async (dayIdx, shift) => {
    const existing = availability.find(a => a.day_of_week === dayIdx)
    if (existing) {
      const { data } = await supabase.from('employee_availability').update({ preferred_shift: shift }).eq('id', existing.id).select().single()
      if (data) setAvailability(prev => prev.map(a => a.id === data.id ? data : a))
    }
  }

  const toggleSpecial = (cat) => {
    const current = form.special_categories || []
    set('special_categories', current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat])
  }

  // Style helpers
  const L = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, marginTop: 14, letterSpacing: '0.3px' }
  const SectionTitle = ({ icon, text }) => (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginTop: 22, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 15 }}>{icon}</span> {text}
    </div>
  )
  const Toggle = ({ checked, onChange }) => (
    <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer', flexShrink: 0 }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{ position: 'absolute', inset: 0, borderRadius: 12, background: checked ? 'var(--accent-cyan)' : 'var(--border-medium)', transition: '0.2s' }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
      </span>
    </label>
  )

  const EMP_TYPE_COLORS = { 正職: ['var(--accent-green)', 'var(--accent-green-dim)'], 約聘: ['var(--accent-cyan)', 'var(--accent-cyan-dim)'], 兼職: ['var(--accent-orange)', 'var(--accent-orange-dim)'], 外籍: ['var(--accent-purple)', 'var(--accent-purple-dim)'], 派遣: ['var(--accent-red)', 'var(--accent-red-dim)'] }
  const [empTypeColor, empTypeDimColor] = EMP_TYPE_COLORS[form.employment_type || '正職'] || EMP_TYPE_COLORS['正職']
  const statusColor     = (form.status || '在職') === '在職' ? 'var(--accent-green)' : form.status === '留職停薪' ? 'var(--accent-orange)' : 'var(--accent-red)'
  const statusDimColor  = (form.status || '在職') === '在職' ? 'var(--accent-green-dim)' : form.status === '留職停薪' ? 'var(--accent-orange-dim)' : 'var(--accent-red-dim)'

  const QuickInfo = ({ icon, value }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{value || '—'}</span>
    </div>
  )

  return (
    <div style={{
      width: '100%',
      maxWidth: 1200,
      margin: '0 auto',
      padding: 16,
    }}>
      {/* Panel — page content (沒 fixed overlay，自然 page 滾動) */}
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 16,
        border: '1px solid var(--border-medium)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        display: 'flex', flexDirection: 'column',
        animation: 'fadeIn 0.2s ease-out',
      }}>

        {/* ── Header ── */}
        <div style={{ flexShrink: 0, background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-primary) 100%)', borderBottom: '1px solid var(--border-subtle)' }}>
          {/* Top bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '12px 24px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isDirty && <span style={{ fontSize: 11, color: 'var(--accent-orange)', fontWeight: 600 }}>未儲存變更</span>}
              {isAdmin && (
                <button className="btn btn-secondary" onClick={handleResetSalaryPin} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8 }}>
                  <KeyRound size={12} /> 重設薪資密碼
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8 }}>
                <Save size={12} /> {saving ? '...' : '更新'}
              </button>
            </div>
          </div>

          {/* Profile row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px 0' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, background: employee.avatar || AVATAR_FALLBACK,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 800, color: '#fff',
              boxShadow: `0 4px 12px ${(employee.avatar || AVATAR_FALLBACK)}44`,
            }}>
              {employee.name?.[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{employee.name}</span>
                {employee.name_en && <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{employee.name_en}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700 }}>EMP-{String(employee.id).padStart(3, '0')}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: empTypeDimColor, color: empTypeColor, fontWeight: 700 }}>{form.employment_type || '正職'}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: statusDimColor, color: statusColor, fontWeight: 700 }}>{form.status || '在職'}</span>
              </div>
            </div>
          </div>

          {/* Quick info bar */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 24px 0', overflowX: 'auto', flexWrap: 'wrap' }}>
            <QuickInfo icon="💼" value={[employee.position, employee.position_secondary, employee.position_third].filter(Boolean).join(' / ') || '未設定'} />
            <QuickInfo icon="🏪" value={employee.store || '未指派'} />
            <QuickInfo icon="🏢" value={employee.dept || '未指派'} />
            {employee.join_date && <QuickInfo icon="📅" value={`到職 ${employee.join_date}`} />}
            {employee.phone && <QuickInfo icon="📱" value={employee.phone} />}
            {employee.email && <QuickInfo icon="✉️" value={employee.email} />}
          </div>

          {/* ── Main tab bar ── */}
          <div style={{ display: 'flex', gap: 0, padding: '10px 24px 0', overflowX: 'auto' }}>
            {MAIN_TABS.map(t => (
              <button key={t.key} onClick={() => switchMainTab(t.key)} style={{
                padding: '8px 18px', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: 'transparent', display: 'flex', alignItems: 'center', gap: 6,
                color: mainTab === t.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                borderBottom: mainTab === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s', whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {/* ── Sub tab bar ── */}
          <div style={{ display: 'flex', gap: 0, padding: '0 24px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
            {(SUB_TABS[mainTab] || []).map(t => (
              <button key={t.key} onClick={() => setSubTab(t.key)} style={{
                padding: '7px 14px', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: 'transparent',
                color: subTab === t.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                borderBottom: subTab === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s', whiteSpace: 'nowrap',
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 32px' }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>

          {/* ════ profile ════ */}
          {mainTab === 'profile' && (
            <ProfileTabContent
              form={form} set={set} isAdmin={isAdmin} subTab={subTab} employee={employee}
              passbookUploading={passbookUploading} handlePassbookUpload={handlePassbookUpload}
              lineAccounts={lineAccounts} setLineAccounts={setLineAccounts}
              lineChannels={lineChannels}
              newLineChannel={newLineChannel} setNewLineChannel={setNewLineChannel}
              newLineUserId={newLineUserId} setNewLineUserId={setNewLineUserId}
              unboundLineUsers={unboundLineUsers} setUnboundLineUsers={setUnboundLineUsers}
              manualLineInput={manualLineInput} setManualLineInput={setManualLineInput}
              Toggle={Toggle} SectionTitle={SectionTitle} L={L}
            />
          )}

          {/* ════ hr ════ */}
          {mainTab === 'hr' && (
            <HrTabContent
              form={form} set={set} isAdmin={isAdmin} subTab={subTab} employee={employee}
              roles={roles} stores={stores} departments={departments} employees={allEmployees}
              passbookUploading={passbookUploading} handlePassbookUpload={handlePassbookUpload}
              Toggle={Toggle} SectionTitle={SectionTitle} L={L}
            />
          )}

          {/* ════ schedule ════ */}
          {mainTab === 'schedule' && (
            <ScheduleTabContent
              form={form} set={set} subTab={subTab}
              skills={skills} newSkill={newSkill} setNewSkill={setNewSkill}
              newSkillLevel={newSkillLevel} setNewSkillLevel={setNewSkillLevel}
              addSkill={addSkill} deleteSkill={deleteSkill}
              availability={availability} setAvail={setAvail} setAvailShift={setAvailShift}
              schedPrefs={schedPrefs} addSchedPref={addSchedPref} deleteSchedPref={deleteSchedPref}
              leaveRecords={leaveRecords}
              SectionTitle={SectionTitle} L={L}
            />
          )}

          {/* ════ growth ════ */}
          {mainTab === 'growth' && subTab === 'personality' && <PersonalityTab employee={employee} />}
          {mainTab === 'growth' && subTab === 'development' && <DevelopmentTab employee={employee} />}

          {/* ════ history ════ */}
          {mainTab === 'history' && (
            <HistoryTabContent
              subTab={subTab} isAdmin={isAdmin} employee={employee}
              onboardingTasks={onboardingTasks}
              targetWorkflows={targetWorkflows} targetWfTasks={targetWfTasks}
              assignments={assignments} transfers={transfers} addTransfer={addTransfer}
              reviews={reviews} addReview={addReview}
              insuranceEvents={insuranceEvents}
              dependents={dependents}
              showDepForm={showDepForm} setShowDepForm={setShowDepForm}
              depForm={depForm} setDepForm={setDepForm}
              addDependent={addDependent} deleteDependent={deleteDependent}
              SectionTitle={SectionTitle}
            />
          )}

        </div>
      </div>

      <InputModal
        isOpen={inputModal.open}
        title={inputModal.title}
        label={inputModal.label}
        placeholder={inputModal.placeholder}
        required={inputModal.required}
        onConfirm={inputModal.onConfirm || (() => {})}
        onCancel={closeInput}
      />

      {offboarding && (
        <OffboardingModal
          employee={employee}
          pendingStatus={offboarding.pendingStatus}
          pendingResignDate={offboarding.pendingResignDate}
          allEmployees={allEmployees}
          currentUserEmpId={profile?.id || null}
          onSuccess={handleOffboardingSuccess}
          onCancel={() => {
            setOffboarding(null)
            pendingSaveRef.current = null
          }}
        />
      )}
    </div>
  )
}
