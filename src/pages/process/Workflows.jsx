import { useState, useEffect } from 'react'
import {
  Plus, Pencil, Trash2, ChevronRight, CheckCircle,
  X, Users, User, Play, Pause, Rocket, Archive,
  ClipboardList, Square, RotateCcw, Ban, ChevronDown
} from 'lucide-react'
import {
  getWorkflows, createWorkflow, updateWorkflow,
  getWorkflowInstances, updateWorkflowInstance,
  getWorkflowSteps, createWorkflowStep, updateWorkflowStep
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { notifyTaskAssignee } from '../../lib/lineNotify'
import { GoogleGenerativeAI } from '@google/generative-ai'

const STATUS_LIST = ['待處理', '進行中', '已完成', '已擱置']

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY

const AI_EXAMPLES = [
  '我需要一個新員工入職訓練流程',
  '設計一個每月庫存盤點的工作流程',
  '建立一個客戶活動企劃執行流程',
  '建立一個新店開幕準備流程',
]

const STATUS_CONFIG = {
  '待處理': { color: 'var(--text-muted)', bg: 'var(--glass-light)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '已擱置': { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.1)' },
}

export default function Workflows() {
  const [tab, setTab] = useState('active')
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [checklists, setChecklists] = useState([])
  const [templates, setTemplates] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [filterStore, setFilterStore] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')

  // Detail view
  const [selectedInstance, setSelectedInstance] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)

  // Modals
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [notesStep, setNotesStep] = useState(null)
  const [notesText, setNotesText] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ assignee: '', groups: '' })

  // Create SOP template
  const [showCreateTplModal, setShowCreateTplModal] = useState(false)
  const [newTpl, setNewTpl] = useState({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '' }] })

  // AI assistant
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiMessages, setAiMessages] = useState([])

  // SOP deploy
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTemplate, setDeployTemplate] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [deployForm, setDeployForm] = useState({ location: '', assignees: {} })

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances(),
      getWorkflowSteps(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('checklists').select('*').order('id'),
      supabase.from('sop_templates').select('*').order('id'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([w, inst, st, emp, loc, cl, tpl, dept]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setEmployees(emp.data || [])
      setStores(loc.data || [])
      setChecklists(cl.data || [])
      setTemplates(tpl.data || [])
      setDepartments(dept.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  // ── Helpers ──
  const getInstanceSteps = (instId) => steps.filter(s => s.instance_id === instId).sort((a, b) => a.step_order - b.step_order)
  const getStats = (instId) => {
    const s = getInstanceSteps(instId)
    const total = s.length
    const pending = s.filter(x => x.status === '待處理').length
    const inProgress = s.filter(x => x.status === '進行中').length
    const completed = s.filter(x => x.status === '已完成').length
    const blocked = s.filter(x => x.status === '已擱置').length
    const pct = total > 0 ? Math.round(completed / total * 100) : 0
    return { total, pending, inProgress, completed, blocked, pct }
  }

  // ── Handlers ──
  const handleStatusChange = async (stepId, newStatus) => {
    const completedAt = newStatus === '已完成' ? new Date().toISOString() : null
    const { data } = await updateWorkflowStep(stepId, { status: newStatus, completed_at: completedAt })
    if (data) {
      setSteps(prev => prev.map(s => s.id === stepId ? data : s))
      const instId = data.instance_id
      const instSteps = steps.map(s => s.id === stepId ? data : s).filter(s => s.instance_id === instId)
      if (instSteps.length > 0 && instSteps.every(s => s.status === '已完成')) {
        const { data: inst } = await updateWorkflowInstance(instId, { status: '已完成', completed_at: new Date().toISOString() })
        if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
      }
    }
  }

  const handleConfirmTask = async (stepId) => {
    const { data } = await updateWorkflowStep(stepId, { confirmed: true, confirmed_at: new Date().toISOString() })
    if (data) setSteps(prev => prev.map(s => s.id === stepId ? data : s))
  }

  const handleSaveNotes = async () => {
    if (!notesStep) return
    const { data } = await updateWorkflowStep(notesStep.id, { notes: notesText })
    if (data) setSteps(prev => prev.map(s => s.id === notesStep.id ? data : s))
    setShowNotesModal(false)
  }

  const handleAddTask = async () => {
    if (!taskForm.title || !selectedInstance) return
    const instSteps = getInstanceSteps(selectedInstance.id)
    const maxOrder = instSteps.length > 0 ? Math.max(...instSteps.map(s => s.step_order)) : 0
    const { data } = await createWorkflowStep({
      instance_id: selectedInstance.id, step_order: maxOrder + 1,
      title: taskForm.title, assignee: taskForm.assignee,
      store: taskForm.store || selectedInstance.store,
      planned_start: taskForm.planned_start || null,
      due_date: taskForm.due_date || null, due_time: taskForm.due_time || '17:00',
      status: '待處理',
    })
    if (data) {
      setSteps(prev => [...prev, data])
      setShowAddTaskModal(false)
      setTaskForm({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
      if (taskForm.assignee) notifyTaskAssignee(taskForm.assignee, taskForm.title, selectedInstance.store || selectedInstance.template_name, data.id)
    }
  }

  const handleEditInstance = async () => {
    if (!selectedInstance) return
    const groups = editForm.groups ? editForm.groups.split(',').map(g => g.trim()).filter(Boolean) : []
    const { data } = await updateWorkflowInstance(selectedInstance.id, {
      assignee: editForm.assignee || null,
      groups: groups.length > 0 ? groups : null,
    })
    if (data) {
      setInstances(prev => prev.map(i => i.id === selectedInstance.id ? data : i))
      setSelectedInstance(data)
      setShowEditModal(false)
    }
  }

  // ── AI Assistant ──
  const handleAiGenerate = async (prompt) => {
    if (!prompt?.trim()) return
    const userMsg = prompt.trim()
    setAiPrompt('')
    setAiMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setAiLoading(true)
    setAiResult(null)

    // Simulate thinking delay
    await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

    try {
      let json
      const useRealAi = GEMINI_KEY && GEMINI_KEY !== 'your_gemini_api_key_here'

      if (useRealAi) {
        // Real AI mode
        const genAI = new GoogleGenerativeAI(GEMINI_KEY)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
        const result = await model.generateContent(`你是流程設計專家。根據以下需求，設計一個標準作業流程（SOP）。
需求：${userMsg}
請以 JSON 格式回覆（不要 markdown code block）：
{"name":"流程名稱","category":"分類","description":"流程說明","steps":[{"title":"步驟名稱","role":"負責角色","priority":"高/中/低","description":"步驟說明"}]}`)
        const text = result.response.text()
        json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      } else {
        // Smart rule-based fallback
        json = generateFlowByRules(userMsg)
      }

      setAiResult(json)
      setAiMessages(prev => [...prev, { role: 'ai', text: `已生成「${json.name}」，共 ${json.steps?.length || 0} 個步驟`, data: json }])
    } catch (err) {
      setAiMessages(prev => [...prev, { role: 'ai', text: `❌ ${err.message}`, error: true }])
    }
    setAiLoading(false)
  }

  // ── Rule-based flow generator (fake AI) ──
  function generateFlowByRules(prompt) {
    const p = prompt.toLowerCase()
    const TEMPLATES = {
      onboard: {
        match: ['新人', '到職', '入職', '報到', 'onboard', '新員工'],
        name: '新人到職 SOP', category: 'HR',
        description: '新進員工到職標準流程，從報到到獨立上線',
        steps: [
          { title: '人事資料建檔', role: '人資部', priority: '高', description: '身分證影本、存摺影本、勞保加保' },
          { title: '設備與帳號開通', role: '管理部', priority: '高', description: 'Email、系統帳號、POS 權限、LINE 群組' },
          { title: '工作環境介紹', role: '店長', priority: '中', description: '門市導覽、設備使用、安全逃生路線' },
          { title: '公司制度說明', role: '人資部', priority: '中', description: '出勤規則、請假流程、薪資結構、福利制度' },
          { title: '營運 SOP 教學', role: '店長', priority: '高', description: '開關店流程、收銀、商品知識、客服話術' },
          { title: 'POS 系統實操訓練', role: '管理部', priority: '高', description: '結帳、退貨、庫存查詢、電子發票' },
          { title: '實習跟班（3天）', role: '店長', priority: '中', description: '跟隨資深人員實習，熟悉日常流程' },
          { title: '獨立上線確認', role: '督導', priority: '高', description: '考核通過、正式排班' },
        ],
      },
      inventory: {
        match: ['盤點', '庫存', 'inventory', '倉庫'],
        name: '每月盤點 SOP', category: '倉管',
        description: '每月庫存盤點標準流程，確保帳實相符',
        steps: [
          { title: '盤點日期通知', role: '督導', priority: '中', description: '提前 3 天通知各門市' },
          { title: '列印盤點表', role: '倉儲物流部', priority: '中', description: '匯出庫存清單' },
          { title: '實體商品清點', role: '店長', priority: '高', description: '逐項清點數量，記錄在盤點表' },
          { title: '差異比對', role: '倉儲物流部', priority: '高', description: '系統帳面 vs 實際數量' },
          { title: '差異原因調查', role: '督導', priority: '高', description: '損耗、破損、失竊、系統錯誤' },
          { title: '庫存調整', role: '倉儲物流部', priority: '中', description: '系統調整，填寫異動原因' },
          { title: '盤點報告', role: '倉儲物流部', priority: '中', description: '彙整結果、計算盤差率' },
          { title: '主管審核', role: '營運部', priority: '高', description: '審閱報告、簽核歸檔' },
        ],
      },
      store: {
        match: ['開店', '新店', '展店', '開幕', '門市'],
        name: '新店開幕 SOP', category: '展店',
        description: '開設新門市完整標準作業流程',
        steps: [
          { title: '場地評估與選址', role: '展店事業部', priority: '高', description: '商圈分析、人流、租金比較' },
          { title: '租約簽訂', role: '總經理室', priority: '高', description: '議價、合約審閱、簽約' },
          { title: '營業登記與許可', role: '管理部', priority: '高', description: '營業登記、許可證辦理' },
          { title: '裝潢設計確認', role: '品牌行銷部', priority: '高', description: '平面圖、施工圖、品牌規範' },
          { title: '裝潢施工', role: '管理部', priority: '高', description: '發包、進度追蹤、工程會議' },
          { title: '設備採購安裝', role: '管理部', priority: '高', description: 'POS、監視器、冷藏設備' },
          { title: '人員招募', role: '人資部', priority: '中', description: '開缺、面試、錄取' },
          { title: '教育訓練', role: '營運部', priority: '中', description: 'SOP 教學、POS 訓練' },
          { title: '首批進貨', role: '倉儲物流部', priority: '中', description: '備貨、驗收入庫、系統建檔' },
          { title: '陳列上架', role: '營運部', priority: '中', description: '商品陳列、標價、動線確認' },
          { title: '行銷規劃', role: '品牌行銷部', priority: '中', description: '開幕優惠、社群宣傳' },
          { title: '試營運', role: '營運部', priority: '高', description: '模擬消費、測試流程、修正' },
          { title: '正式開幕', role: '營運部', priority: '高', description: '開幕活動、首日數據追蹤' },
        ],
      },
      complaint: {
        match: ['客訴', '投訴', '客戶抱怨', '客服'],
        name: '客訴處理 SOP', category: '營運',
        description: '顧客投訴處理標準流程',
        steps: [
          { title: '接收客訴', role: '門市人員', priority: '高', description: '記錄內容、客戶資訊、訴求' },
          { title: '初步安撫', role: '門市人員', priority: '高', description: '致歉、表達重視、告知處理時程' },
          { title: '事件調查', role: '店長', priority: '高', description: '了解經過、調閱監視器' },
          { title: '擬定方案', role: '督導', priority: '中', description: '退換貨/賠償方案' },
          { title: '回覆客戶', role: '店長', priority: '高', description: '通知處理結果、執行補救' },
          { title: '內部檢討', role: '營運部', priority: '中', description: '檢討會議、制定預防措施' },
          { title: '結案歸檔', role: '管理部', priority: '低', description: '更新紀錄、歸檔' },
        ],
      },
      purchase: {
        match: ['採購', '進貨', '購買', '供應商'],
        name: '採購申請 SOP', category: '採購',
        description: '設備與原物料採購標準流程',
        steps: [
          { title: '需求提出', role: '店長', priority: '中', description: '填寫品項、數量、規格、預算' },
          { title: '採購審核', role: '採購部', priority: '中', description: '確認需求合理性、預算' },
          { title: '供應商詢價', role: '採購部', priority: '中', description: '向 2-3 家詢價比較' },
          { title: '比價與議價', role: '採購部', priority: '中', description: '選定供應商' },
          { title: '主管核准', role: '總經理室', priority: '高', description: '大額採購需核准' },
          { title: '到貨驗收', role: '倉儲物流部', priority: '高', description: '核對品項、數量、品質' },
          { title: '入庫建檔', role: '倉儲物流部', priority: '中', description: '系統入庫、設定庫存' },
          { title: '請款付款', role: '管理部', priority: '中', description: '核對發票、安排付款' },
        ],
      },
      marketing: {
        match: ['行銷', '活動', '促銷', '企劃', '宣傳'],
        name: '行銷活動企劃 SOP', category: '行銷',
        description: '行銷活動從企劃到執行的完整流程',
        steps: [
          { title: '活動目標設定', role: '行銷部', priority: '高', description: '確認目標（營收/會員/曝光）、KPI' },
          { title: '企劃案撰寫', role: '行銷部', priority: '高', description: '活動內容、預算、時程表' },
          { title: '主管審核', role: '營運部', priority: '中', description: '審核企劃、預算核准' },
          { title: '素材設計', role: '設計部', priority: '中', description: '視覺設計、文案、印刷物' },
          { title: '通路準備', role: '行銷部', priority: '中', description: '社群排程、EDM、門市佈置' },
          { title: '活動執行', role: '門市/行銷部', priority: '高', description: '上線執行、即時監控' },
          { title: '數據追蹤', role: '行銷部', priority: '中', description: '追蹤 KPI、每日回報' },
          { title: '結案報告', role: '行銷部', priority: '中', description: '成效分析、ROI 計算、檢討' },
        ],
      },
      finance: {
        match: ['報帳', '報銷', '核銷', '費用', '財務'],
        name: '費用報銷 SOP', category: '財務',
        description: '員工費用報銷申請流程',
        steps: [
          { title: '填寫報銷單', role: '申請人', priority: '中', description: '金額、用途、附上收據' },
          { title: '主管審核', role: '部門主管', priority: '中', description: '確認費用合理性' },
          { title: '財務覆核', role: '財務部', priority: '高', description: '核對金額、收據、科目' },
          { title: '款項撥付', role: '財務部', priority: '中', description: '匯款或現金發放' },
          { title: '記帳歸檔', role: '財務部', priority: '低', description: '入帳、收據歸檔' },
        ],
      },
      training: {
        match: ['訓練', '培訓', '教育', '課程'],
        name: '員工培訓 SOP', category: 'HR',
        description: '員工教育訓練規劃與執行流程',
        steps: [
          { title: '需求評估', role: '人資部', priority: '中', description: '蒐集各部門訓練需求' },
          { title: '課程規劃', role: '人資部', priority: '中', description: '排定課程、講師、場地' },
          { title: '通知與報名', role: '人資部', priority: '中', description: '發布公告、確認出席' },
          { title: '教材準備', role: '講師', priority: '中', description: '準備教材、測驗題目' },
          { title: '課程執行', role: '講師', priority: '高', description: '授課、實作演練' },
          { title: '測驗評核', role: '人資部', priority: '中', description: '考試或實作評核' },
          { title: '成果紀錄', role: '人資部', priority: '低', description: '登錄時數、成績歸檔' },
        ],
      },
    }

    // Match keywords
    for (const tpl of Object.values(TEMPLATES)) {
      if (tpl.match.some(kw => p.includes(kw))) {
        return { name: tpl.name, category: tpl.category, description: tpl.description, steps: tpl.steps }
      }
    }

    // Generic fallback: extract keywords and build a generic flow
    const name = prompt.length > 20 ? prompt.slice(0, 20) + '...' : prompt
    return {
      name: `${name} SOP`,
      category: '營運',
      description: `根據「${prompt}」自動生成的流程`,
      steps: [
        { title: '需求確認', role: '負責人', priority: '高', description: '確認目標、範圍、時程' },
        { title: '方案規劃', role: '負責人', priority: '高', description: '擬定執行計畫' },
        { title: '資源準備', role: '負責人', priority: '中', description: '人力、物料、預算確認' },
        { title: '主管核准', role: '主管', priority: '中', description: '審核計畫、核准執行' },
        { title: '任務執行', role: '執行團隊', priority: '高', description: '依計畫執行' },
        { title: '進度追蹤', role: '負責人', priority: '中', description: '定期回報進度' },
        { title: '成果驗收', role: '主管', priority: '高', description: '確認完成、品質檢查' },
        { title: '結案歸檔', role: '負責人', priority: '低', description: '文件整理、經驗記錄' },
      ],
    }
  }

  const handleSaveAiResult = async () => {
    if (!aiResult) return
    const { data } = await supabase.from('sop_templates').insert({
      name: aiResult.name, category: aiResult.category || '營運',
      description: aiResult.description, steps: aiResult.steps || [],
    }).select().single()
    if (data) {
      setTemplates(prev => [...prev, data])
      setAiResult(null)
      setAiMessages(prev => [...prev, { role: 'ai', text: `✅「${data.name}」已儲存到流程範本！` }])
    }
  }

  // ── Create SOP Template ──
  const handleCreateTpl = async () => {
    if (!newTpl.name || !newTpl.steps.some(s => s.title)) return
    const validSteps = newTpl.steps.filter(s => s.title)
    const { data } = await supabase.from('sop_templates').insert({
      name: newTpl.name, category: newTpl.category,
      description: newTpl.description, steps: validSteps,
    }).select().single()
    if (data) {
      setTemplates(prev => [...prev, data])
      setShowCreateTplModal(false)
      setNewTpl({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '' }] })
    }
  }

  const addTplStep = () => setNewTpl(t => ({ ...t, steps: [...t.steps, { title: '', role: '', priority: '中', description: '' }] }))
  const updateTplStep = (i, k, v) => setNewTpl(t => ({ ...t, steps: t.steps.map((s, j) => j === i ? { ...s, [k]: v } : s) }))
  const removeTplStep = (i) => setNewTpl(t => ({ ...t, steps: t.steps.filter((_, j) => j !== i) }))

  // ── SOP Deploy ──
  const handleDeploy = async () => {
    if (!deployTemplate || !deployForm.location) return
    setDeploying(true)
    try {
      const tplSteps = deployTemplate.steps || []
      const loc = deployForm.location
      const { data: instance } = await supabase.from('workflow_instances').insert({
        template_name: deployTemplate.name, store: loc,
        status: '進行中', started_by: employees[0]?.name || '系統',
      }).select().single()
      if (instance) {
        const stepRows = tplSteps.map((step, i) => ({
          instance_id: instance.id, step_order: i + 1,
          title: step.title, description: step.description,
          role: step.role, assignee: deployForm.assignees[i] || '',
          store: loc, status: '待處理',
        }))
        await supabase.from('workflow_steps').insert(stepRows)
        setInstances(prev => [instance, ...prev])
        setDeployResult({ location: loc, count: tplSteps.length })
      }
    } catch (err) {
      alert('部署失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  // ── Filtered instances ──
  const filteredInstances = instances.filter(i => {
    if (filterStore && i.store !== filterStore) return false
    if (filterAssignee && i.assignee !== filterAssignee) return false
    return true
  })
  const activeInstances = filteredInstances.filter(i => i.status === '進行中')
  const archivedInstances = filteredInstances.filter(i => i.status === '已完成')

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // ════════════════════════════════════════════════════════════
  // ══ Instance Detail View ════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  if (selectedInstance) {
    const inst = instances.find(i => i.id === selectedInstance.id) || selectedInstance
    const instSteps = getInstanceSteps(inst.id)
    const stats = getStats(inst.id)

    return (
      <div className="fade-in">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, padding: '20px 24px', background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{inst.store || inst.template_name}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>指派</span>
              <button className="btn btn-sm btn-secondary" onClick={() => { setEditForm({ assignee: inst.assignee || '', groups: (inst.groups || []).join(', ') }); setShowEditModal(true) }}>
                <Pencil size={11} /> 編輯
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                <User size={13} /> {inst.assignee || '未指定負責人'}
              </div>
              {(inst.groups || []).map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.2)' }}>
                  <Users size={12} /> {g}
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setSelectedInstance(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}><X size={22} /></button>
        </div>

        {/* Progress */}
        <div style={{ padding: '16px 24px', marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent-cyan)', minWidth: 50 }}>{stats.pct}%</div>
            <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--border-medium)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 6, width: `${stats.pct}%`, background: stats.pct === 100 ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))', transition: 'width 0.4s ease' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { icon: '⬜', count: stats.pending, color: 'var(--text-muted)' },
              { icon: '🔄', count: stats.inProgress, color: 'var(--accent-cyan)' },
              { icon: '✅', count: stats.completed, color: 'var(--accent-green)' },
              { icon: '🚫', count: stats.blocked, color: 'var(--accent-red)' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span>{s.icon}</span><span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
              </div>
            ))}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>共 <strong>{stats.total}</strong></div>
          </div>
        </div>

        {/* Task table header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} /> 步驟任務 ({stats.total})
          </div>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => {
            setTaskForm({ title: '', assignee: '', store: inst.store || '', planned_start: '', due_date: '', due_time: '17:00' })
            setShowAddTaskModal(true)
          }}><Plus size={13} /> 新增任務</button>
        </div>

        {/* Task table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th>任務名稱</th><th style={{ width: 90 }}>負責人</th><th style={{ width: 140 }}>門市</th>
                  <th style={{ width: 110 }}>計畫開始</th><th style={{ width: 130 }}>截止日期</th>
                  <th style={{ width: 90 }}>狀態</th><th style={{ width: 140 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {instSteps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無任務</td></tr>}
                {instSteps.map(step => {
                  const sc = STATUS_CONFIG[step.status] || STATUS_CONFIG['待處理']
                  return (
                    <tr key={step.id} style={{ borderLeft: `3px solid ${sc.color}`, cursor: 'pointer' }} onClick={() => setSelectedStep(step)}>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>{step.step_order}</td>
                      <td><div style={{ fontWeight: 600 }}>{step.title}</div></td>
                      <td><span style={{ fontSize: 12 }}>{step.assignee || '—'}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{step.store || inst.store || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.planned_start || <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}</td>
                      <td style={{ fontSize: 12 }}>
                        {step.due_date ? <div><div>{step.due_date}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {step.due_time || '17:00'}</div></div>
                          : <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}
                      </td>
                      <td>
                        <select value={step.status} onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); handleStatusChange(step.id, e.target.value) }}
                          style={{ fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 6, border: `1px solid ${sc.color}`, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none' }}>
                          {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); setNotesStep(step); setNotesText(step.notes || ''); setShowNotesModal(true) }}>📝 備註</button>
                          {!step.confirmed ? (
                            <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={e => { e.stopPropagation(); handleConfirmTask(step.id) }}>🔐 確認任務</button>
                          ) : <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600 }}>✅ 完成</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modals */}
        {showNotesModal && notesStep && (
          <Modal title={`📝 備註 — ${notesStep.title}`} onClose={() => setShowNotesModal(false)} onSubmit={handleSaveNotes}>
            <textarea className="form-input" style={{ width: '100%', minHeight: 120, resize: 'vertical' }} placeholder="輸入備註內容..." value={notesText} onChange={e => setNotesText(e.target.value)} />
          </Modal>
        )}
        {showAddTaskModal && (
          <Modal title="新增任務" onClose={() => setShowAddTaskModal(false)} onSubmit={handleAddTask}>
            <Field label="任務名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：電力申請" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="負責人"><select className="form-input" style={{ width: '100%' }} value={taskForm.assignee} onChange={e => setTaskForm(f => ({ ...f, assignee: e.target.value }))}><option value="">請選擇</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></Field>
              <Field label="門市"><select className="form-input" style={{ width: '100%' }} value={taskForm.store} onChange={e => setTaskForm(f => ({ ...f, store: e.target.value }))}><option value="">請選擇</option>{stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="計畫開始"><input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.planned_start} onChange={e => setTaskForm(f => ({ ...f, planned_start: e.target.value }))} /></Field>
              <Field label="截止日期"><input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
              <Field label="截止時間"><input className="form-input" type="time" style={{ width: '100%' }} value={taskForm.due_time} onChange={e => setTaskForm(f => ({ ...f, due_time: e.target.value }))} /></Field>
            </div>
          </Modal>
        )}
        {showEditModal && (
          <Modal title="編輯指派" onClose={() => setShowEditModal(false)} onSubmit={handleEditInstance}>
            <Field label="負責人"><select className="form-input" style={{ width: '100%' }} value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}><option value="">未指定</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></Field>
            <Field label="群組（逗號分隔）"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：Ai, 信義安和-新店建置專案群組" value={editForm.groups} onChange={e => setEditForm(f => ({ ...f, groups: e.target.value }))} /></Field>
          </Modal>
        )}
        {selectedStep && (
          <TaskDetailPanel step={selectedStep} instance={inst} allSteps={instSteps} employees={employees} stores={stores} checklists={checklists}
            onUpdate={d => { setSteps(prev => prev.map(s => s.id === d.id ? d : s)); setSelectedStep(d) }}
            onDelete={id => { setSteps(prev => prev.filter(s => s.id !== id)); setSelectedStep(null) }}
            onClose={() => setSelectedStep(null)} />
        )}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════
  // ══ Main List View ═════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 流程管理</h2>
            <p>管理流程範本及進行中的工作流程</p>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 20, padding: '14px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>👤 負責人</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="">全部人員</option>
            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
          </select>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        {[
          { key: 'active', label: `🟢 進行中流程 (${activeInstances.length})` },
          { key: 'templates', label: `📁 流程範本 (${templates.length})` },
          { key: 'ai', label: '🤖 AI 助手' },
          { key: 'archived', label: `📦 封存流程 (${archivedInstances.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ Active Instances ══ */}
      {tab === 'active' && (
        <div>
          {activeInstances.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>目前沒有進行中的流程。從「流程範本」部署即可建立。</div>
          ) : activeInstances.map(inst => {
            const stats = getStats(inst.id)
            return (
              <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', transition: 'border-color 0.2s' }}
                onClick={() => setSelectedInstance(inst)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                      <span>⬜ {stats.pending}</span>
                      <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                      <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-cyan)' }}>{stats.pct}%</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                      </div>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{stats.pct}%</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Templates (SOP) ══ */}
      {tab === 'templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button className="btn btn-primary" onClick={() => setShowCreateTplModal(true)}><Plus size={13} /> 新增流程範本</button>
          </div>
          {templates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無流程範本</div>
          ) : templates.map(tpl => {
            const tplSteps = tpl.steps || []
            return (
              <div key={tpl.id} className="card" style={{ padding: 0 }}>
                <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      <span className="badge badge-cyan" style={{ marginRight: 8 }}>{tpl.category}</span>
                      {tplSteps.length} 個步驟 · {tpl.description || ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" style={{ padding: '6px 14px' }} onClick={() => {
                    setDeployTemplate(tpl); setDeployForm({ location: '', assignees: {} }); setDeployResult(null); setShowDeployModal(true)
                  }}><Rocket size={13} /> 部署</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ AI Assistant ══ */}
      {tab === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 500 }}>
          {/* Header card */}
          <div style={{
            padding: '20px 24px', marginBottom: 16, borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(6,182,212,0.05), rgba(139,92,246,0.05))',
            border: '1px solid var(--border-medium)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 24 }}>🤖</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>AI 流程助手</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>用自然語言描述你需要的流程，AI 會幫你設計</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, marginBottom: 16 }}>
            {aiMessages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🧑‍💼</div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 24 }}>告訴我你想建立什麼流程，例如：</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400, margin: '0 auto' }}>
                  {AI_EXAMPLES.map((ex, i) => (
                    <button key={i} onClick={() => handleAiGenerate(ex)} style={{
                      padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border-medium)',
                      background: 'var(--bg-card)', color: 'var(--text-secondary)',
                      cursor: 'pointer', fontSize: 13, textAlign: 'left',
                    }}>
                      💡 「{ex}」
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aiMessages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 12,
              }}>
                <div style={{
                  maxWidth: '80%', padding: '12px 16px', borderRadius: 14,
                  background: msg.role === 'user' ? 'var(--accent-cyan)' : msg.error ? 'rgba(239,68,68,0.1)' : 'var(--bg-card)',
                  color: msg.role === 'user' ? '#fff' : msg.error ? 'var(--accent-red)' : 'var(--text-primary)',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--border-medium)',
                  fontSize: 14,
                }}>
                  {msg.text}

                  {/* Show generated steps preview */}
                  {msg.data && (
                    <div style={{ marginTop: 12, padding: '12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{msg.data.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                        <span className="badge badge-cyan">{msg.data.category}</span> {msg.data.description}
                      </div>
                      {(msg.data.steps || []).map((s, j) => (
                        <div key={j} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8 }}>
                          <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, minWidth: 20 }}>{j + 1}.</span>
                          <span style={{ fontWeight: 600 }}>{s.title}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{s.role}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {aiLoading && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', padding: '12px 0' }}>
                <div className="spinner" style={{ width: 16, height: 16 }} /> AI 正在設計流程...
              </div>
            )}

            {/* Save button when result is ready */}
            {aiResult && !aiLoading && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={handleSaveAiResult}>
                  💾 儲存到流程範本
                </button>
                <button className="btn btn-secondary" onClick={() => setAiResult(null)}>
                  略過
                </button>
              </div>
            )}
          </div>

          {/* Input bar (sticky bottom) */}
          <div style={{
            display: 'flex', gap: 10, padding: '14px 0',
            borderTop: '1px solid var(--border-subtle)',
            position: 'sticky', bottom: 0, background: 'var(--bg-primary)',
          }}>
            <input
              className="form-input"
              type="text"
              style={{ flex: 1, fontSize: 14, padding: '12px 16px', borderRadius: 12 }}
              placeholder="描述你需要的流程..."
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !aiLoading && handleAiGenerate(aiPrompt)}
              disabled={aiLoading}
            />
            <button
              className="btn btn-primary"
              style={{ borderRadius: 12, padding: '12px 16px' }}
              onClick={() => handleAiGenerate(aiPrompt)}
              disabled={aiLoading || !aiPrompt.trim()}
            >
              🚀
            </button>
          </div>
        </div>
      )}

      {/* ══ Archived ══ */}
      {tab === 'archived' && (
        <div>
          {archivedInstances.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無封存流程</div>
          ) : archivedInstances.map(inst => {
            const stats = getStats(inst.id)
            return (
              <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', opacity: 0.7 }} onClick={() => setSelectedInstance(inst)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · 完成：{inst.completed_at?.slice(0, 10)}</div>
                  </div>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}>✅ 已完成 ({stats.total} 步)</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Deploy Modal ══ */}
      {showDeployModal && deployTemplate && (
        <Modal title={`🚀 部署「${deployTemplate.name}」`} onClose={() => { setShowDeployModal(false); setDeployResult(null) }}
          onSubmit={deployResult ? () => { setShowDeployModal(false); setDeployResult(null) } : handleDeploy}
          submitLabel={deployResult ? '完成' : deploying ? '部署中...' : '確認部署'}>
          {deployResult ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                已為 <strong>{deployResult.location}</strong> 建立 <strong>{deployResult.count}</strong> 個任務
              </div>
            </div>
          ) : (
            <>
              <Field label="部署到哪個分店 *">
                <select className="form-input" style={{ width: '100%' }} value={deployForm.location} onChange={e => setDeployForm(f => ({ ...f, location: e.target.value }))}>
                  <option value="">請選擇分店</option>
                  {stores.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>指派負責人</div>
              {(deployTemplate.steps || []).map((step, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}：{step.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>角色：{step.role || '-'}</div>
                  </div>
                  <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={deployForm.assignees[i] || ''}
                    onChange={e => setDeployForm(f => ({ ...f, assignees: { ...f.assignees, [i]: e.target.value } }))}>
                    <option value="">請選擇</option>
                    {departments.map(d => (
                      <optgroup key={d.id} label={d.name}>
                        {employees.filter(e => e.dept === d.name).map(e => <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}

      {/* ══ Create Template Modal ══ */}
      {showCreateTplModal && (
        <Modal title="新增流程範本" onClose={() => setShowCreateTplModal(false)} onSubmit={handleCreateTpl} submitLabel="建立範本">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Field label="範本名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：新店開幕 SOP"
                value={newTpl.name} onChange={e => setNewTpl(t => ({ ...t, name: e.target.value }))} />
            </Field>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={newTpl.category} onChange={e => setNewTpl(t => ({ ...t, category: e.target.value }))}>
                {['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服'].map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="範本說明"
              value={newTpl.description} onChange={e => setNewTpl(t => ({ ...t, description: e.target.value }))} />
          </Field>

          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '12px 0 8px' }}>步驟</div>
          {newTpl.steps.map((step, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'end',
              marginBottom: 8, padding: '10px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
            }}>
              <Field label={`Step ${i + 1} 名稱`}>
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="步驟名稱"
                  value={step.title} onChange={e => updateTplStep(i, 'title', e.target.value)} />
              </Field>
              <Field label="角色">
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主管"
                  value={step.role} onChange={e => updateTplStep(i, 'role', e.target.value)} />
              </Field>
              <Field label="優先度">
                <select className="form-input" style={{ width: '100%' }} value={step.priority} onChange={e => updateTplStep(i, 'priority', e.target.value)}>
                  <option>高</option><option>中</option><option>低</option>
                </select>
              </Field>
              <button onClick={() => removeTplStep(i)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '8px' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={addTplStep} style={{
            width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--border-medium)',
            background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          }}><Plus size={12} /> 新增步驟</button>
        </Modal>
      )}
    </div>
  )
}
