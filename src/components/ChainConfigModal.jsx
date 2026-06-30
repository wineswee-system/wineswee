/**
 * 共用簽核鏈設定 modal
 *
 * 三種模式：
 *   mode='single'         → 一張表 = 一條 chain，寫 form_chain_configs
 *                            （請假/加班/出差/補打卡/離職/異動/費用報銷/自訂表單）
 *   mode='amount_grouped' → 一張表 = 多條 chain（依金額區間分流），不碰 form_chain_configs
 *                            （申請費用 ExpenseRequests）
 *   mode='library'        → chain library 中央管理（task/workflow/HR 表單共用同一個 pool）
 *                            列出整個 org 的所有 chain，不寫 form_chain_configs
 *                            editor 允許設定 category（free text）
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   formType: 'leave' | 'overtime' | 'expense' | 'expense_request' | ...  (library 模式可省略)
 *   formLabel: 顯示用的中文 ('請假' / '申請費用' / ...)
 *               amount_grouped 模式下也是 approval_chains.category 的值
 *               library 模式下只當 modal 標題
 *   organizationId: number
 *   mode: 'single' | 'amount_grouped' | 'library' (default 'single')
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Save, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ModalOverlay } from './Modal'
import LoadingSpinner from './LoadingSpinner'
import { toast } from '../lib/toast'
import { confirm } from '../lib/confirm'
import ChainListView from './chains/ChainListView'
import ChainEditorView from './chains/ChainEditorView'

// ─── target_type 選項 ───
// applicant_supervisor 加回（行政員工 vs 門市員工 一條 chain 解兩情境，
// 各員工各自設「直屬主管」即可）
const TARGET_TYPES = [
  // 寫死
  { value: 'fixed_emp',   group: '🔒 寫死指定', label: '指定員工',           needs: 'emp'   },
  { value: 'fixed_role',  group: '🔒 寫死指定', label: '指定角色（全部人）', needs: 'role'  },
  { value: 'fixed_dept',  group: '🔒 寫死指定', label: '指定部門（全部人）', needs: 'dept'  },
  // 申請人連動（依組織圖動態解）
  { value: 'applicant_supervisor',          group: '👤 申請人連動', label: '申請人的直屬主管（依員工卡設定）', needs: null },
  { value: 'applicant_supervisor_l2',       group: '👤 申請人連動', label: '直屬主管的直屬主管（L2）',          needs: null },
  { value: 'applicant_supervisor_l3',       group: '👤 申請人連動', label: '直屬主管的直屬主管的直屬主管（L3）', needs: null },
  { value: 'applicant_dept_manager',        group: '👤 申請人連動', label: '申請人部門的主管',   needs: null },
  { value: 'applicant_store_manager',       group: '👤 申請人連動', label: '申請人門市的店長',   needs: null },
  { value: 'applicant_store_supervisor',    group: '👤 申請人連動', label: '申請人門市的督導（position=督導）', needs: null },
  { value: 'applicant_section_supervisor',  group: '👤 申請人連動', label: '申請人課別的督導（需設 section_id）',   needs: null },
  // 特定單位的主管
  { value: 'specific_dept_manager',         group: '🏢 指定單位主管', label: '特定部門的主管',   needs: 'dept'    },
  { value: 'specific_store_manager',        group: '🏢 指定單位主管', label: '特定門市的店長',   needs: 'store'   },
  { value: 'specific_section_supervisor',   group: '🏢 指定單位主管', label: '特定課別的督導',   needs: 'section' },
  // 商品調撥動態（從調撥單的 from/to_store 反查；不需 FK 預先指定）
  { value: 'transfer_in_store_manager',     group: '📦 商品調撥連動', label: '調入門市的店長（從表單 to_store_id 動態解）',     needs: null, transferOnly: true },
  { value: 'transfer_out_store_manager',    group: '📦 商品調撥連動', label: '調出門市的店長（從表單 from_store_id 動態解）',   needs: null, transferOnly: true },
  { value: 'transfer_in_store_supervisor',  group: '📦 商品調撥連動', label: '調入門市的督導（從表單 to_store_id 動態解）',     needs: null, transferOnly: true },
  { value: 'transfer_out_store_supervisor', group: '📦 商品調撥連動', label: '調出門市的督導（從表單 from_store_id 動態解）',   needs: null, transferOnly: true },
  { value: 'warehouse_supervisor',          group: '📦 商品調撥連動', label: '倉儲主管（departments.name=倉儲物流部）',         needs: null, transferOnly: true },
]

const blankStep = (idx) => ({
  _localId: Math.random(),
  step_order: idx,
  label: '',
  target_type: 'applicant_dept_manager',
  target_emp_id: null,
  target_role_id: null,
  target_dept_id: null,
  target_store_id: null,
  target_section_id: null,
  skip_if_no_approver: false,
})

export default function ChainConfigModal({ open, onClose, formType, formLabel, organizationId, mode = 'single', embedded = false, applicantType = 'all', categoryFilter = null }) {
  // categoryFilter — library mode 額外傳入，只列出該 category 的 chain
  // 新增 chain 時也預設此 category（給商品調撥申請/驗收這類分群用）
  // ── view state（amount_grouped / library 才會切 list ↔ editor） ──
  const hasListView = mode === 'amount_grouped' || mode === 'library'
  const [view, setView] = useState(hasListView ? 'list' : 'editor')
  const [chainsList, setChainsList] = useState([])
  const [libraryCategory, setLibraryCategory] = useState('')  // library editor 用

  // ── editor state ──
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [chainId, setChainId] = useState(null)
  const [chainName, setChainName] = useState('')
  const [chainDescription, setChainDescription] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [steps, setSteps] = useState([])

  // ── picker options ──
  const [employees, setEmployees] = useState([])
  const [roles, setRoles] = useState([])
  const [depts, setDepts] = useState([])
  const [stores, setStores] = useState([])
  const [sections, setSections] = useState([])

  // ── 載入下拉選項（modal 開啟時跑一次） ──
  const loadOptions = useCallback(async () => {
    if (!organizationId) return  // profile 還沒載完前不打 query（避免 .eq('organization_id', undefined) 拋錯卡死 loading）
    try {
      const [empRes, roleRes, deptRes, storeRes, sectionRes] = await Promise.all([
        supabase.from('employees')
          .select('id, name, name_en, employee_number, status, position, dept, store, departments!department_id(name), stores!store_id(name)')
          .eq('organization_id', organizationId).eq('status', '在職').order('name'),
        supabase.from('roles').select('id, name').order('name'),
        supabase.from('departments').select('id, name').eq('organization_id', organizationId).order('name'),
        supabase.from('stores').select('id, name').eq('organization_id', organizationId).order('name'),
        supabase.from('department_sections').select('id, name, department_id').eq('organization_id', organizationId).order('name'),
      ])
      setEmployees(empRes.data || [])
      setRoles(roleRes.data || [])
      setDepts(deptRes.data || [])
      setStores(storeRes.data || [])
      setSections(sectionRes.data || [])
    } catch (e) {
      console.error('[ChainConfigModal] loadOptions failed:', e)
    }
  }, [organizationId])

  // ── 載入 amount_grouped / library 列表 ──
  const loadList = useCallback(async () => {
    // amount_grouped: 只抓 category=formLabel；library: 全 org 所有 chain
    let q = supabase
      .from('approval_chains')
      .select('id, name, description, category, min_amount, max_amount, is_active, organization_id')
    if (mode === 'amount_grouped') {
      q = q.eq('category', formLabel).order('min_amount', { ascending: true, nullsFirst: true })
    } else if (mode === 'library' && categoryFilter) {
      // library + categoryFilter：只列出該 category 的 chain（給商品調撥申請/驗收這類分群用）
      q = q.eq('category', categoryFilter).order('name')
    } else {
      // library: 依 category, name 排序
      q = q.order('category', { ascending: true, nullsFirst: false }).order('name')
    }
    if (organizationId) {
      q = q.or(`organization_id.eq.${organizationId},organization_id.is.null`)
    }
    const { data: chains } = await q

    const chainIds = (chains || []).map(c => c.id)
    let stepsByChain = {}
    if (chainIds.length > 0) {
      const { data: stepRows } = await supabase
        .from('approval_chain_steps')
        .select('chain_id, step_order, label, target_type, target_emp_id, target_role_id, target_dept_id, target_store_id, target_section_id')
        .in('chain_id', chainIds)
        .order('step_order')
      for (const s of (stepRows || [])) {
        if (!stepsByChain[s.chain_id]) stepsByChain[s.chain_id] = []
        stepsByChain[s.chain_id].push(s)
      }
    }

    setChainsList((chains || []).map(c => ({
      ...c,
      steps: stepsByChain[c.id] || [],
    })))
  }, [mode, formLabel, organizationId, categoryFilter])

  // ── 載入 single 模式：form_chain_configs → chain ──
  const loadSingle = useCallback(async () => {
    const { data: cfg } = await supabase.from('form_chain_configs')
      .select('chain_id').eq('form_type', formType).eq('organization_id', organizationId)
      .eq('applicant_type', applicantType).maybeSingle()
    if (cfg?.chain_id) {
      await loadEditor(cfg.chain_id)
    } else {
      resetEditorBlank()
    }
  }, [formType, organizationId, applicantType])

  // ── 載入 editor（指定 chain id 或新建） ──
  const loadEditor = async (cid) => {
    const [chainRes, stepsRes] = await Promise.all([
      supabase.from('approval_chains').select('name, description, category, min_amount, max_amount').eq('id', cid).maybeSingle(),
      supabase.from('approval_chain_steps').select('*').eq('chain_id', cid).order('step_order'),
    ])
    setChainId(cid)
    setChainName(chainRes.data?.name || '')
    setChainDescription(chainRes.data?.description || '')
    setLibraryCategory(chainRes.data?.category || '')
    setMinAmount(chainRes.data?.min_amount != null ? String(chainRes.data.min_amount) : '')
    setMaxAmount(chainRes.data?.max_amount != null ? String(chainRes.data.max_amount) : '')
    setSteps((stepsRes.data || []).map(s => ({
      _localId: s.id,
      step_order: s.step_order,
      label: s.label || '',
      target_type: s.target_type || 'applicant_dept_manager',
      target_emp_id: s.target_emp_id || null,
      target_role_id: s.target_role_id || null,
      target_dept_id: s.target_dept_id || null,
      target_store_id: s.target_store_id || null,
      target_section_id: s.target_section_id || null,
      skip_if_no_approver: s.skip_if_no_approver || false,
    })))
  }

  const resetEditorBlank = () => {
    const typeSuffix = (mode === 'single' && applicantType && applicantType !== 'all')
      ? (applicantType === 'manager' ? '（主管）' : applicantType === 'store_staff' ? '（門市）' : '（行政）')
      : ''
    setChainId(null)
    setChainName(mode === 'library' ? '' : `${formLabel}簽核鏈${typeSuffix}`)
    setChainDescription('')
    setLibraryCategory(mode === 'library' && categoryFilter ? categoryFilter : '')
    setMinAmount('')
    setMaxAmount('')
    setSteps([blankStep(0)])
  }

  // ── 主 load orchestrator ──
  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      await loadOptions()
      if (hasListView) {
        if (view === 'list') {
          await loadList()
        }
        // editor view：等使用者點「編輯/新增」才 load 對應 chain
      } else {
        // single mode：開啟就直接進 editor
        await loadSingle()
      }
    } catch (e) {
      console.error('[ChainConfigModal] load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [open, hasListView, view, loadOptions, loadList, loadSingle])

  useEffect(() => { load() }, [load])

  // 開啟時重設 view（避免上次開的狀態殘留）
  useEffect(() => {
    if (open) {
      setView(hasListView ? 'list' : 'editor')
    }
  }, [open, hasListView])

  // ── List view: 操作 ──
  const handleNewChain = async () => {
    setLoading(true)
    resetEditorBlank()
    setLoading(false)
    setView('editor')
  }

  const handleEditChain = async (cid) => {
    setLoading(true)
    await loadEditor(cid)
    setLoading(false)
    setView('editor')
  }

  const handleDeleteChain = async (cid, name) => {
    // 防呆 1：先檢查是否有 in-flight 申請正在引用此 chain
    // expense_requests.approval_chain_id FK 沒 ON DELETE → 直接刪會 throw FK error
    if (formType === 'expense_request' || mode === 'amount_grouped') {
      const { count } = await supabase
        .from('expense_requests')
        .select('id', { count: 'exact', head: true })
        .eq('approval_chain_id', cid)
        .in('status', ['申請中', '待審'])
      if ((count || 0) > 0) {
        toast.error(`無法刪除「${name}」\n\n目前有 ${count} 筆「申請中/待審」的費用申請正在使用此鏈。\n請等這些申請走完流程後再刪除，或先把它們處理掉。`)
        return
      }
    }

    // 防呆 2 (library)：檢查是否有 form_chain_configs 仍綁定此 chain
    if (mode === 'library') {
      const { data: refs } = await supabase
        .from('form_chain_configs')
        .select('form_type')
        .eq('chain_id', cid)
        .eq('is_active', true)
      if (refs && refs.length > 0) {
        toast.error(`無法刪除「${name}」\n\n此 chain 仍被 ${refs.length} 張表單綁定：${refs.map(r => r.form_type).join('、')}\n請先到對應的表單頁改用其他 chain。`)
        return
      }
    }

    if (!(await (await confirm({ message: { message: `確認刪除「${name}」？\n\n此 chain 的所有關卡設定會一併刪除（已完成的歷史申請會保留 chain_id 但流程不再走）` } })))) return
    try {
      await supabase.from('approval_chain_steps').delete().eq('chain_id', cid)
      const { error } = await supabase.from('approval_chains').delete().eq('id', cid)
      if (error) throw error
      await loadList()
    } catch (e) {
      // FK constraint 錯誤訊息友善化
      const msg = (e.message || '').includes('foreign key')
        ? '此 chain 仍被歷史申請引用，無法刪除（請先檢查 expense_requests 表）'
        : (e.message || '未知錯誤')
      toast.error('刪除失敗：' + msg)
    }
  }

  const handleBackToList = async () => {
    setLoading(true)
    await loadList()
    setLoading(false)
    setView('list')
  }

  // ── step 操作 ──
  const updateStep = (idx, patch) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }
  const addStep = () => {
    setSteps(prev => [...prev, blankStep(prev.length)])
  }
  const removeStep = (idx) => {
    if (steps.length === 1) { toast.warning('至少要保留 1 關'); return }
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i })))
  }
  const moveStep = (idx, dir) => {
    const ni = idx + dir
    if (ni < 0 || ni >= steps.length) return
    setSteps(prev => {
      const next = [...prev]
      ;[next[idx], next[ni]] = [next[ni], next[idx]]
      return next.map((s, i) => ({ ...s, step_order: i }))
    })
  }

  const changeTargetType = (idx, newType) => {
    updateStep(idx, {
      target_type: newType,
      target_emp_id: null,
      target_role_id: null,
      target_dept_id: null,
      target_store_id: null,
      target_section_id: null,
    })
  }

  // ── 預覽該關會由誰簽 ──
  const stepPreview = (step) => {
    const meta = TARGET_TYPES.find(t => t.value === step.target_type)
    if (!meta) return { ok: false, text: '未知類型' }
    if (!meta.needs) return { ok: true, dynamic: true, text: meta.label }
    if (meta.needs === 'emp') {
      const e = employees.find(x => x.id === step.target_emp_id)
      return e ? { ok: true, text: `指定員工：${e.name}` } : { ok: false, text: '⚠️ 請選擇員工' }
    }
    if (meta.needs === 'role') {
      const r = roles.find(x => x.id === step.target_role_id)
      return r ? { ok: true, text: `角色「${r.name}」全部成員` } : { ok: false, text: '⚠️ 請選擇角色' }
    }
    if (meta.needs === 'dept') {
      const d = depts.find(x => x.id === step.target_dept_id)
      if (!d) return { ok: false, text: '⚠️ 請選擇部門' }
      if (step.target_type === 'fixed_dept') return { ok: true, text: `部門「${d.name}」全部員工` }
      return { ok: true, text: `部門「${d.name}」的主管` }
    }
    if (meta.needs === 'store') {
      const s = stores.find(x => x.id === step.target_store_id)
      return s ? { ok: true, text: `門市「${s.name}」的店長` } : { ok: false, text: '⚠️ 請選擇門市' }
    }
    if (meta.needs === 'section') {
      const s = sections.find(x => x.id === step.target_section_id)
      return s ? { ok: true, text: `課別「${s.name}」的督導` } : { ok: false, text: '⚠️ 請選擇課別' }
    }
    return { ok: false, text: '未設定' }
  }

  // ── 簡短描述每關（list view 用） ──
  const shortStepDesc = (step) => {
    const meta = TARGET_TYPES.find(t => t.value === step.target_type)
    if (!meta) return step.label || '?'
    if (!meta.needs) return meta.label
    if (meta.needs === 'emp') {
      const e = employees.find(x => x.id === step.target_emp_id)
      return e ? e.name : '（未設定員工）'
    }
    if (meta.needs === 'role') {
      const r = roles.find(x => x.id === step.target_role_id)
      return r ? r.name : '（未設角色）'
    }
    if (meta.needs === 'dept') {
      const d = depts.find(x => x.id === step.target_dept_id)
      const prefix = step.target_type === 'fixed_dept' ? '' : '主管@'
      return d ? `${prefix}${d.name}` : '（未設部門）'
    }
    if (meta.needs === 'store') {
      const s = stores.find(x => x.id === step.target_store_id)
      return s ? `店長@${s.name}` : '（未設門市）'
    }
    if (meta.needs === 'section') {
      const s = sections.find(x => x.id === step.target_section_id)
      return s ? `督導@${s.name}` : '（未設課別）'
    }
    return step.label || '?'
  }

  // ── 儲存 ──
  const handleSave = async () => {
    const missing = []
    if (!chainName?.trim()) missing.push('簽核鏈名稱不能空白')
    steps.forEach((s, i) => {
      if (!s.label?.trim()) missing.push(`第 ${i+1} 關沒填標籤`)
      const preview = stepPreview(s)
      if (!preview.ok) missing.push(`第 ${i+1} 關：${preview.text}`)
    })
    if (mode === 'amount_grouped') {
      const minN = minAmount === '' ? 0 : Number(minAmount)
      const maxN = maxAmount === '' ? null : Number(maxAmount)
      if (Number.isNaN(minN)) missing.push('最低金額格式錯誤')
      if (maxN !== null && Number.isNaN(maxN)) missing.push('最高金額格式錯誤')
      if (maxN !== null && minN > maxN) missing.push('最低金額不可大於最高金額')
    }
    if (missing.length > 0) {
      toast.error('有以下問題：\n\n' + missing.join('\n'))
      return
    }

    // ── 防呆：編輯時若 chain 有 in-flight 申請、且步數變少 → 警告 ──
    if (mode === 'amount_grouped' && chainId && formType === 'expense_request') {
      const { count } = await supabase
        .from('expense_requests')
        .select('id', { count: 'exact', head: true })
        .eq('approval_chain_id', chainId)
        .in('status', ['申請中', '待審'])
      if ((count || 0) > 0) {
        const { count: oldStepCount } = await supabase
          .from('approval_chain_steps')
          .select('id', { count: 'exact', head: true })
          .eq('chain_id', chainId)
        if (steps.length < (oldStepCount || 0)) {
          if (!(await (await confirm({ message: { message: `⚠️ 警告\n\n目前有 ${count} 筆「申請中/待審」費用申請正在使用此鏈，舊版有 ${oldStepCount} 關，新版只剩 ${steps.length} 關。\n\n如果某筆申請目前 current_step >= ${steps.length}，會卡在「找不到 chain step」的狀態。\n\n仍要繼續儲存嗎？` } })))) {
            return
          }
        }
      }
    }

    setSaving(true)
    try {
      let cid = chainId

      // ── chain 主表 insert/update ──
      // 防呆：既有 chain（org_id=NULL 全域 seed）編輯時不覆寫 organization_id，避免把
      // 全域 chain 偷偷變成 org A 專屬，影響其他 org（trigger 不 filter org）。
      const chainPayload = {
        name: chainName.trim() || (mode === 'library' ? '未命名簽核鏈' : `${formLabel}簽核鏈`),
        category: mode === 'library' ? (libraryCategory.trim() || null) : formLabel,
      }
      if (!cid) {
        // 新建才寫 organization_id
        chainPayload.organization_id = organizationId
      }
      if (mode === 'amount_grouped') {
        chainPayload.description = chainDescription || null
        chainPayload.min_amount = minAmount === '' ? 0 : Number(minAmount)
        chainPayload.max_amount = maxAmount === '' ? null : Number(maxAmount)
        chainPayload.is_active = true
      }
      if (mode === 'library') {
        chainPayload.description = chainDescription || null
        chainPayload.is_active = true
      }

      if (!cid) {
        // 先找同名鏈（避免 unique constraint 衝突）
        const { data: existing } = await supabase
          .from('approval_chains')
          .select('id')
          .eq('name', chainPayload.name)
          .eq('organization_id', chainPayload.organization_id)
          .maybeSingle()
        if (existing?.id) {
          cid = existing.id
          await supabase.from('approval_chains').update(chainPayload).eq('id', cid)
        } else {
          const { data: newChain, error: chainErr } = await supabase
            .from('approval_chains').insert(chainPayload).select().single()
          if (chainErr) throw chainErr
          cid = newChain.id
        }
      } else {
        const { error: upErr } = await supabase.from('approval_chains').update(chainPayload).eq('id', cid)
        if (upErr) throw upErr
      }

      // ── 砍舊 steps + 寫新 ──
      // ⚠️ DELETE 要 check error：DB 端 _guard_chain_steps_in_flight 會擋有在飛單的 chain，
      // 沒檢查的話舊 steps 沒砍掉，下面 INSERT 會撞 duplicate key (chain_id, step_order)
      // 把使用者搞到一頭霧水
      const { error: delErr } = await supabase.from('approval_chain_steps').delete().eq('chain_id', cid)
      if (delErr) throw delErr
      const stepRows = steps.map((s, i) => ({
        chain_id: cid,
        step_order: i,
        label: s.label.trim(),
        role_name: s.label.trim(),
        target_type: s.target_type,
        target_emp_id: s.target_emp_id || null,
        target_role_id: s.target_role_id || null,
        target_dept_id: s.target_dept_id || null,
        target_store_id: s.target_store_id || null,
        target_section_id: s.target_section_id || null,
        skip_if_no_approver: s.skip_if_no_approver || false,
        organization_id: organizationId,
      }))
      const { error: stepsErr } = await supabase.from('approval_chain_steps').insert(stepRows)
      if (stepsErr) throw stepsErr

      // ── single 模式：upsert form_chain_configs ──
      if (mode === 'single') {
        const { error: cfgErr } = await supabase.from('form_chain_configs').upsert({
          form_type: formType,
          organization_id: organizationId,
          applicant_type: applicantType,
          chain_id: cid,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'form_type,organization_id,applicant_type' })
        if (cfgErr) throw cfgErr

        // 自訂表單 (form_type = 'custom:<id>') 額外把 chain_id 寫回 form_templates
        // 讓 FormBuilder 列表「簽核鏈」欄位也能讀到（兩邊資料源對齊）
        if (formType?.startsWith('custom:')) {
          const tmplId = Number(formType.split(':')[1])
          if (tmplId) {
            await supabase.from('form_templates')
              .update({ approval_chain_id: cid })
              .eq('id', tmplId)
          }
        }

        toast.success(`「${formLabel}」簽核鏈已儲存（${steps.length} 關）`)
        onClose()
      } else {
        // amount_grouped / library：存完回列表
        toast.success(`「${chainPayload.name}」已儲存（${steps.length} 關）`)
        await handleBackToList()
      }
    } catch (err) {
      console.error('save chain failed:', err)
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  const headerNode = (
    <div style={{
      padding: embedded ? '0 0 16px 0' : '16px 22px',
      borderBottom: embedded ? 'none' : '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0, background: embedded ? 'transparent' : 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {hasListView && view === 'editor' && (
          <button onClick={handleBackToList} title="返回列表"
            style={{ background: 'transparent', border: '1px solid var(--border-medium)', borderRadius: 6, padding: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <ArrowLeft size={16} />
          </button>
        )}
        <div>
          <h3 style={{ margin: 0, fontSize: embedded ? 22 : 18, fontWeight: 700 }}>
            ⚙️ {mode === 'library' ? '簽核鏈設定' : `簽核設定 — ${formLabel}`}
            {mode === 'amount_grouped' && view === 'list' && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>（依金額分組）</span>}
            {hasListView && view === 'editor' && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>{chainId ? (mode === 'library' ? '編輯' : '編輯區間') : (mode === 'library' ? '新增' : '新增區間')}</span>}
          </h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {mode === 'amount_grouped'
              ? '依申請金額自動套用對應簽核鏈，可設定多組金額區間'
              : mode === 'library'
              ? '簽核鏈中央管理 — 流程、任務、HR 表單共用同一個池子'
              : '設定這張表的簽核流程，可串多關 + 動態目標（套牢組織圖）'}
          </div>
        </div>
      </div>
      {!embedded && (
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
          <X size={22} />
        </button>
      )}
    </div>
  )

  const bodyNode = (
    <div style={{
      padding: embedded ? 0 : '0 22px',
    }}>
      {loading ? <LoadingSpinner /> : view === 'list' ? (
        <ChainListView
          mode={mode}
          chainsList={chainsList}
          shortStepDesc={shortStepDesc}
          onNew={handleNewChain}
          onEdit={handleEditChain}
          onDelete={handleDeleteChain}
        />
      ) : (
        <ChainEditorView
          mode={mode}
          categoryFilter={categoryFilter}
          chainName={chainName} setChainName={setChainName}
          chainDescription={chainDescription} setChainDescription={setChainDescription}
          libraryCategory={libraryCategory} setLibraryCategory={setLibraryCategory}
          minAmount={minAmount} setMinAmount={setMinAmount}
          maxAmount={maxAmount} setMaxAmount={setMaxAmount}
          steps={steps}
          updateStep={updateStep}
          addStep={addStep}
          removeStep={removeStep}
          moveStep={moveStep}
          changeTargetType={changeTargetType}
          employees={employees}
          roles={roles}
          depts={depts}
          stores={stores}
          sections={sections}
          formLabel={formLabel}
        />
      )}
    </div>
  )

  // editor 模式才需要 footer save 按鈕；list 模式由 ListView 內部的「新增簽核鏈」處理新增
  const footerNode = view === 'editor' ? (
    <div style={{
      padding: embedded ? '16px 0 0 0' : '14px 22px',
      borderTop: '1px solid var(--border-subtle)',
      marginTop: embedded ? 20 : 0,
      display: 'flex', justifyContent: 'flex-end', gap: 8,
      flexShrink: 0, background: embedded ? 'transparent' : 'var(--bg-card)',
    }}>
      {!embedded && <button className="btn btn-secondary" onClick={onClose}>取消</button>}
      <button className="btn btn-primary" onClick={handleSave} disabled={loading || saving}>
        <Save size={14} /> {saving ? '儲存中...' : '儲存簽核鏈'}
      </button>
    </div>
  ) : null

  // ── Embedded：直接 inline render，不包 ModalOverlay ──
  if (embedded) {
    return (
      <div>
        {headerNode}
        {bodyNode}
        {footerNode}
      </div>
    )
  }

  // ── Modal：position: sticky 釘 header / footer 在外層 scroll container 內 ──
  return (
    <ModalOverlay onClose={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 12, width: 'min(820px, 96vw)',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto', overflowX: 'hidden',
        border: '1px solid var(--border-medium)',
        position: 'relative',
      }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-card)' }}>
          {headerNode}
        </div>
        {bodyNode}
        {footerNode && (
          <div style={{ position: 'sticky', bottom: 0, zIndex: 2, background: 'var(--bg-card)' }}>
            {footerNode}
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}

