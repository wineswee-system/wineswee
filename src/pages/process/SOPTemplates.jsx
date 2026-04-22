import { useState, useEffect } from 'react'
import { Plus, Rocket, Copy, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { createTask, createChecklist } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const DEFAULT_TEMPLATES = [
  {
    name: '新人到職 SOP',
    category: 'HR',
    description: '新進員工到職標準流程，從報到到獨立上線（8 步）',
    steps: [
      { title: '人事資料建檔', role: '人資部', priority: '高', description: '身分證影本、存摺影本、勞保加保、薪轉帳戶設定、員工編號建立' },
      { title: '設備與帳號開通', role: '管理部', priority: '高', description: 'Email、SME OPS 系統帳號、POS 權限、LINE 群組加入、打卡設定' },
      { title: '工作環境介紹', role: '店長', priority: '中', description: '門市環境導覽、設備使用說明、安全逃生路線、倉庫位置' },
      { title: '公司制度說明', role: '人資部', priority: '中', description: '出勤規則、請假流程、薪資結構、福利制度、獎懲辦法' },
      { title: '門市營運 SOP 教學', role: '店長', priority: '高', description: '開店/關店流程、收銀操作、酒類商品知識、客服應對話術' },
      { title: 'POS 系統實操訓練', role: '管理部', priority: '高', description: '結帳、退貨、庫存查詢、會員積點、電子發票操作練習' },
      { title: '實習跟班（3天）', role: '店長', priority: '中', description: '跟隨資深門市人員實習，熟悉日常作業流程與商品陳列' },
      { title: '獨立上線確認', role: '督導', priority: '高', description: '督導確認可獨立作業、門市考核通過、正式排班' },
    ],
  },
  {
    name: '每月盤點 SOP',
    category: '倉管',
    description: '每月庫存盤點標準流程（8 步），確保帳實相符',
    steps: [
      { title: '盤點日期通知', role: '督導', priority: '中', description: '提前 3 天通知各門市盤點時間，協調暫停大量進出貨' },
      { title: '列印盤點表', role: '倉儲物流部', priority: '中', description: '從 SME OPS 系統匯出目前庫存清單，列印盤點用表格' },
      { title: '酒類商品清點', role: '店長', priority: '高', description: '逐項清點酒類庫存數量，注意批號與效期，記錄在盤點表上' },
      { title: '差異比對', role: '倉儲物流部', priority: '高', description: '系統帳面數量與實際數量比對，標記差異項目' },
      { title: '差異原因調查', role: '督導', priority: '高', description: '調查差異原因：損耗、破損、失竊、系統錯誤、進出貨未登記' },
      { title: '庫存調整', role: '倉儲物流部', priority: '中', description: '依調查結果在系統中進行庫存調整，填寫異動原因' },
      { title: '盤點報告產出', role: '倉儲物流部', priority: '中', description: '彙整盤點結果，產出差異報告，計算盤差率' },
      { title: '營運主管審核', role: '營運部', priority: '高', description: '營運主管審閱盤點報告，確認調整合理，簽核歸檔' },
    ],
  },
  {
    name: '客訴處理 SOP',
    category: '營運',
    description: '顧客投訴處理標準流程（7 步），確保客訴有效解決',
    steps: [
      { title: '接收客訴', role: '門市人員', priority: '高', description: '記錄客訴內容、客戶資訊、發生時間地點、訴求（酒類品質/服務態度/環境）' },
      { title: '初步安撫', role: '門市人員', priority: '高', description: '向客戶致歉、表達重視、告知處理時程，必要時提供折扣或補償品' },
      { title: '事件調查', role: '店長', priority: '高', description: '了解事件經過、調閱監視器、訪談當事人、確認商品批號' },
      { title: '擬定解決方案', role: '督導', priority: '中', description: '依客訴性質擬定退換貨/賠償方案，重大客訴呈報營運部' },
      { title: '回覆客戶', role: '店長', priority: '高', description: '致電或 LINE 通知客戶處理結果，執行補救方案' },
      { title: '內部檢討改善', role: '營運部', priority: '中', description: '召開檢討會議，找出根本原因，制定預防措施，更新門市 SOP' },
      { title: '結案歸檔', role: '管理部', priority: '低', description: '更新客訴紀錄狀態為已結案，歸檔備查' },
    ],
  },
  {
    name: '採購申請 SOP',
    category: '採購',
    description: '酒類商品與門市物料採購標準流程（8 步），從需求到驗收',
    steps: [
      { title: '需求提出', role: '店長', priority: '中', description: '填寫採購需求：品項、數量、規格、預算、期望交期（酒類需含產區/年份）' },
      { title: '採購審核', role: '採購部', priority: '中', description: '確認需求合理性、預算額度、現有庫存量、是否有替代品' },
      { title: '供應商詢價', role: '採購部', priority: '中', description: '向 2-3 家酒商詢價，取得報價單比較，確認進口合規文件' },
      { title: '比價與議價', role: '採購部', priority: '中', description: '比較價格、品質、交期、付款條件，選定供應商' },
      { title: '執行長核准', role: '總經理室', priority: '高', description: '大額採購或新品牌引進需執行長核准' },
      { title: '到貨驗收', role: '倉儲物流部', priority: '高', description: '核對品項、數量、品質、酒標完整性，填寫驗收單' },
      { title: '入庫建檔', role: '倉儲物流部', priority: '中', description: '系統入庫、建立商品主檔、設定安全庫存、分配門市配額' },
      { title: '請款付款', role: '管理部', priority: '中', description: '核對發票與驗收單，安排付款' },
    ],
  },
  {
    name: '新店開幕 SOP',
    category: '展店',
    description: '開設新門市完整標準作業流程（15 步），涵蓋選址到開幕',
    steps: [
      { title: '場地評估與選址', role: '加盟展店事業部', priority: '高', description: '商圈分析、人流評估、租金比較、競品調查，產出選址報告' },
      { title: '租約簽訂', role: '總經理室', priority: '高', description: '與房東議價、審閱合約條款、確認租期與押金、簽約用印' },
      { title: '營業登記與許可證', role: '管理部', priority: '高', description: '辦理營業登記、菸酒零售許可、消防安檢、衛生許可證' },
      { title: '裝潢設計圖確認', role: '品牌行銷部', priority: '高', description: '與設計師確認平面圖、施工圖、品牌視覺規範、酒架陳列規劃' },
      { title: '裝潢工程發包施工', role: '管理部', priority: '高', description: '廠商比價、發包簽約、施工進度追蹤、每週工程會議' },
      { title: 'POS/監視器/設備採購', role: '管理部', priority: '高', description: 'POS 系統安裝測試、監視器佈線、冷藏設備、酒架、桌椅燈具' },
      { title: '水電工程驗收', role: '管理部', priority: '中', description: '水電管線測試、消防設備檢查、空調試運轉、缺失改善' },
      { title: '張貼職缺/面試', role: '人資部', priority: '中', description: '依編制人數開缺、發布 104/LINE 招募、安排面試、錄取通知' },
      { title: '新人教育訓練', role: '營運部', priority: '中', description: '門市 SOP 教學、POS 操作訓練、酒類知識培訓、服務禮儀演練' },
      { title: '供應商簽約', role: '採購部', priority: '中', description: '酒商供應合約、配送頻率確認、首批進貨清單、付款條件' },
      { title: '首批進貨/庫存建置', role: '倉儲物流部', priority: '中', description: '依開店清單備貨、驗收入庫、系統建檔、設定門市安全庫存' },
      { title: '陳列上架', role: '營運部', priority: '中', description: '酒類陳列規劃、貨架標價、POP 佈置、動線確認、取酒機設定' },
      { title: '行銷活動規劃', role: '品牌行銷部', priority: '中', description: '開幕優惠方案、社群宣傳、LINE 推播、傳單/布條製作' },
      { title: '內部試營運（3天）', role: '營運部', priority: '高', description: '邀請內部人員模擬消費、測試結帳流程、記錄問題並修正' },
      { title: '正式開幕', role: '營運部', priority: '高', description: '開幕活動執行、首日營運數據追蹤、開幕檢討會議' },
    ],
  },
]

export default function SOPTemplates() {
  const { profile } = useAuth()
  const currentUser = profile?.name || '管理員'
  const [templates, setTemplates] = useState([])
  const [locations, setLocations] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTemplate, setDeployTemplate] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [deployForm, setDeployForm] = useState({ location: '', assignees: {} })
  const [newTemplate, setNewTemplate] = useState({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '' }] })

  useEffect(() => {
    Promise.all([
      supabase.from('sop_templates').select('*').order('id'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('employees').select('id, name, department_id, position, departments(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(async ([t, l, e, d]) => {
      let tpls = t.data || []
      // If no templates in DB, seed defaults
      if (tpls.length === 0) {
        for (const tpl of DEFAULT_TEMPLATES) {
          const { data } = await supabase.from('sop_templates').insert({
            name: tpl.name,
            category: tpl.category,
            description: tpl.description,
            steps: tpl.steps,
          }).select().single()
          if (data) tpls.push(data)
        }
      }
      setTemplates(tpls)
      setLocations(l.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  // ── Deploy SOP ──
  const handleDeploy = async () => {
    if (!deployTemplate || !deployForm.location) return
    setDeploying(true)
    try {
      const steps = deployTemplate.steps || []
      const loc = deployForm.location

      // Create workflow instance
      const { data: instance, error: instErr } = await supabase.from('workflow_instances').insert({
        template_name: deployTemplate.name,
        store: loc,
        status: '進行中',
        started_by: currentUser,
      }).select().single()
      if (instErr) throw instErr

      // Create tasks (執行面，workflow_instance_id 連結回實例)
      const results = []
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const assignee = deployForm.assignees[i] || ''
        const { data, error } = await createTask({
          title: `【${loc}】${step.title}`,
          description: step.description || null,
          workflow: deployTemplate.name,
          workflow_instance_id: instance.id,
          step_order: i + 1,
          step_type: 'workflow_step',
          role: step.role || null,
          assignee,
          priority: step.priority || '中',
          status: '未開始',
          due_date: '',
        })
        if (error) throw error
        if (data) results.push(data)
      }

      // Also create a checklist
      await createChecklist({
        name: `${loc} — ${deployTemplate.name}`,
        category: deployTemplate.category || '展店',
        assignee: deployForm.assignees[0] || '',
        items: steps.length,
        completed: 0,
      })

      setDeployResult({ location: loc, count: results.length })
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  const openDeploy = (tpl) => {
    setDeployTemplate(tpl)
    setDeployForm({ location: '', assignees: {} })
    setDeployResult(null)
    setShowDeployModal(true)
  }

  // ── Create Template ──
  const handleCreateTemplate = async () => {
    if (!newTemplate.name || !newTemplate.steps.some(s => s.title)) return
    try {
      const validSteps = newTemplate.steps.filter(s => s.title)
      const { data, error } = await supabase.from('sop_templates').insert({
        name: newTemplate.name,
        category: newTemplate.category,
        description: newTemplate.description,
        steps: validSteps,
      }).select().single()
      if (error) throw error
      if (data) {
        setTemplates(prev => [...prev, data])
        setShowCreateModal(false)
        setNewTemplate({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '' }] })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const addStep = () => setNewTemplate(t => ({ ...t, steps: [...t.steps, { title: '', role: '', priority: '中', description: '' }] }))
  const updateStep = (i, k, v) => setNewTemplate(t => ({ ...t, steps: t.steps.map((s, j) => j === i ? { ...s, [k]: v } : s) }))
  const removeStep = (i) => setNewTemplate(t => ({ ...t, steps: t.steps.filter((_, j) => j !== i) }))

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此範本？')) return
    try {
      const { error } = await supabase.from('sop_templates').delete().eq('id', id)
      if (error) throw error
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const deptBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📑</span> SOP 範本</h2>
            <p>標準作業流程範本，一鍵部署到新分店</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}><Plus size={14} /> 新增範本</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">範本數</div>
          <div className="stat-card-value">{templates.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總步驟數</div>
          <div className="stat-card-value">{templates.reduce((s, t) => s + (t.steps?.length || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">分店數</div>
          <div className="stat-card-value">{locations.length}</div>
        </div>
      </div>

      {/* Template List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {templates.map(tpl => {
          const isExpanded = expanded === tpl.id
          const steps = tpl.steps || []
          return (
            <div key={tpl.id} className="card" style={{ padding: 0 }}>
              <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onClick={() => setExpanded(isExpanded ? null : tpl.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      <span className="badge badge-cyan" style={{ marginRight: 8 }}>{tpl.category}</span>
                      {steps.length} 個步驟 · {tpl.description || ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm btn-primary" style={{ width: 'auto', padding: '6px 14px' }} onClick={() => openDeploy(tpl)}>
                    <Rocket size={13} /> 部署
                  </button>
                  <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '6px 10px', color: 'var(--accent-red)' }} onClick={() => handleDelete(tpl.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 20px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12 }}>步驟清單</div>
                  {steps.map((step, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                      background: 'var(--glass-light)', borderRadius: 10, marginBottom: 8,
                      border: '1px solid var(--border-subtle)',
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'var(--accent-cyan)',
                      }}>{i + 1}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{step.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{step.description}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <span className="badge badge-purple">{step.role || '未指定'}</span>
                          <span className={`badge ${step.priority === '高' ? 'badge-danger' : step.priority === '中' ? 'badge-warning' : 'badge-info'}`}>
                            {step.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Deploy Modal */}
      {showDeployModal && deployTemplate && (
        <Modal
          title={`🚀 部署「${deployTemplate.name}」`}
          onClose={() => { setShowDeployModal(false); setDeployResult(null) }}
          onSubmit={deployResult ? () => { setShowDeployModal(false); setDeployResult(null) } : handleDeploy}
          submitText={deployResult ? '完成' : deploying ? '部署中...' : '確認部署'}
        >
          {deployResult ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                已為 <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{deployResult.location}</span> 建立
                <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}> {deployResult.count} </span>
                個任務 + 1 個查核清單
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                員工可在 LINE 傳「任務」查看指派項目
              </div>
            </div>
          ) : (
            <>
              <Field label="部署到哪個分店 *">
                <select className="form-input" style={{ width: '100%' }} value={deployForm.location} onChange={e => setDeployForm(f => ({ ...f, location: e.target.value }))}>
                  <option value="">請選擇分店</option>
                  {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>

              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>指派負責人</div>
              {(deployTemplate.steps || []).map((step, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)',
                  marginBottom: 6, border: '1px solid var(--border-subtle)',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}：{step.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>預設角色：{step.role || '-'}</div>
                  </div>
                  <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                    value={deployForm.assignees[i] || ''}
                    onChange={e => setDeployForm(f => ({ ...f, assignees: { ...f.assignees, [i]: e.target.value } }))}>
                    <option value="">請選擇</option>
                    {departments.map(d => (
                      <optgroup key={d.id} label={d.name}>
                        {employees.filter(e => e.dept === d.name).map(e => (
                          <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <Modal title="新增 SOP 範本" onClose={() => setShowCreateModal(false)} onSubmit={handleCreateTemplate} submitText="建立範本">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Field label="範本名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：新店開幕 SOP"
                value={newTemplate.name} onChange={e => setNewTemplate(t => ({ ...t, name: e.target.value }))} />
            </Field>
            <Field label="分類">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="展店"
                value={newTemplate.category} onChange={e => setNewTemplate(t => ({ ...t, category: e.target.value }))} />
            </Field>
          </div>
          <Field label="說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="範本說明"
              value={newTemplate.description} onChange={e => setNewTemplate(t => ({ ...t, description: e.target.value }))} />
          </Field>

          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '12px 0 8px' }}>步驟</div>
          {newTemplate.steps.map((step, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'end',
              marginBottom: 8, padding: '10px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
            }}>
              <Field label={`Step ${i + 1} 名稱`}>
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="步驟名稱"
                  value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} />
              </Field>
              <Field label="角色">
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主管"
                  value={step.role} onChange={e => updateStep(i, 'role', e.target.value)} />
              </Field>
              <Field label="優先度">
                <select className="form-input" style={{ width: '100%' }} value={step.priority} onChange={e => updateStep(i, 'priority', e.target.value)}>
                  <option>高</option><option>中</option><option>低</option>
                </select>
              </Field>
              <button onClick={() => removeStep(i)} style={{
                background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '8px',
              }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={addStep} style={{
            width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--border-medium)',
            background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          }}><Plus size={12} /> 新增步驟</button>
        </Modal>
      )}
    </div>
  )
}
