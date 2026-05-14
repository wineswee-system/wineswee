import { useState, useEffect } from 'react'
import { Plus, Settings, Gift } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { getEffectiveBenefits, calculateBonus, getStoreIdByName, BONUS_TYPE_LABELS } from '../../lib/benefitPolicy'
import { empLabel } from '../../lib/empLabel'

import { toast } from '../../lib/toast'
const ROLE_TYPES = ['業務', '倉管', '內勤採購', '跨部門']

export default function Bonus() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('業務')
  const [records, setRecords] = useState([])
  const [settings, setSettings] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [tickets, setTickets] = useState([])
  const [contacts, setContacts] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [outboundOrders, setOutboundOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [showSettingModal, setShowSettingModal] = useState(false)
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const [employees, setEmployees] = useState([])
  const [policyBonus, setPolicyBonus] = useState(0) // 從福利政策自動計算的獎金
  const [perfReview, setPerfReview] = useState(null)

  const [recordForm, setRecordForm] = useState({ employee_name: '', role_type: '業務', period: new Date().toISOString().slice(0, 7), base_bonus: '', data_bonus: '', notes: '' })
  const [settingForm, setSettingForm] = useState({ role_type: '業務', metric_name: '', target_value: '', weight: '1', reward_amount: '', period: '月' })

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      supabase.from('bonus_records').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('bonus_settings').select('*').eq('organization_id', orgId).order('role_type'),
      supabase.from('opportunities').select('*').eq('organization_id', orgId),
      supabase.from('service_tickets').select('*').eq('organization_id', orgId),
      supabase.from('customer_contacts').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('inventory_adjustments').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('outbound_orders').select('*').eq('organization_id', orgId),
      supabase.from('employees').select('id, name, name_en, position, dept, department_id, store, store_id, departments!department_id(name), stores!store_id(name)').eq('organization_id', orgId).order('name'),
    ]).then(([r, s, o, t, ct, adj, ob, emp]) => {
      setRecords(r.data || [])
      setSettings(s.data || [])
      setOpportunities(o.data || [])
      setTickets(t.data || [])
      setContacts(ct.data || [])
      setAdjustments(adj.data || [])
      setOutboundOrders(ob.data || [])
      setEmployees(emp.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  // 選員工時自動查詢福利政策獎金 + 績效評等
  const handleEmployeeSelect = async (name) => {
    setRecordForm(f => ({ ...f, employee_name: name }))
    setPolicyBonus(0)
    setPerfReview(null)
    const emp = employees.find(e => e.name === name)
    if (!emp) return
    try {
      const [storeId, perfRes] = await Promise.all([
        getStoreIdByName(emp.store),
        supabase.from('performance_reviews')
          .select('overall_score, rating, period')
          .eq('employee', name)
          .eq('status', '已完成')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      const pr = perfRes.data || null
      setPerfReview(pr)
      // Auto-suggest data_bonus from performance rating
      if (pr?.rating) {
        const PERF_BONUS = { 'S': 1500, 'A+': 1200, 'A': 1000, 'B+': 800, 'B': 500, 'C': 0 }
        const suggested = PERF_BONUS[pr.rating] ?? 0
        if (suggested > 0) setRecordForm(f => ({ ...f, data_bonus: String(suggested) }))
      }
      const bonusBenefits = await getEffectiveBenefits(emp.id, storeId, 'bonus')
      let total = 0
      const labels = []
      for (const [code, config] of Object.entries(bonusBenefits)) {
        const amount = calculateBonus(config, { sales: 0, attendance_rate: 1 })
        if (amount > 0) {
          total += amount
          labels.push(`${code}: $${amount.toLocaleString()}`)
        }
      }
      setPolicyBonus(total)
      if (total > 0) {
        setRecordForm(f => ({ ...f, base_bonus: String(total), notes: `福利政策自動帶入：${labels.join('、')}` }))
      }
    } catch (err) {
      console.error('Failed to fetch benefit policies:', err)
    }
  }

  const setR = (k, v) => setRecordForm(f => ({ ...f, [k]: v }))
  const setS = (k, v) => setSettingForm(f => ({ ...f, [k]: v }))

  const handleAddRecord = async () => {
    if (!recordForm.employee_name) return
    try {
      const total = (Number(recordForm.base_bonus) || 0) + (Number(recordForm.data_bonus) || 0)
      if (!profile?.organization_id) { toast.error('身份未載入，請重新登入'); return }
      const { data, error } = await supabase.from('bonus_records').insert({ ...recordForm, base_bonus: Number(recordForm.base_bonus) || 0, data_bonus: Number(recordForm.data_bonus) || 0, total_bonus: total, organization_id: profile.organization_id }).select().single()
      if (error) throw error
      if (data) { setRecords(prev => [data, ...prev]); setShowRecordModal(false); setRecordForm({ employee_name: '', role_type: '業務', period: new Date().toISOString().slice(0, 7), base_bonus: '', data_bonus: '', notes: '' }) }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleAddSetting = async () => {
    if (!settingForm.metric_name) return
    try {
      const { data, error } = await supabase.from('bonus_settings').insert({ ...settingForm, target_value: Number(settingForm.target_value) || 0, weight: Number(settingForm.weight) || 1, reward_amount: Number(settingForm.reward_amount) || 0 }).select().single()
      if (error) throw error
      if (data) { setSettings(prev => [...prev, data]); setShowSettingModal(false); setSettingForm({ role_type: '業務', metric_name: '', target_value: '', weight: '1', reward_amount: '', period: '月' }) }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const toggleSetting = async (id, is_active) => {
    const { data, error } = await supabase.from('bonus_settings').update({ is_active: !is_active }).eq('id', id).select().single()
    if (error) { console.error('Toggle setting failed:', error); toast.error('更新失敗：' + (error.message || '未知錯誤')); return }
    if (data) setSettings(prev => prev.map(s => s.id === id ? data : s))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const periodRecords = records.filter(r => r.period === period)
  const totalPayout = periodRecords.reduce((s, r) => s + (r.total_bonus || 0), 0)

  // CRM 數據（業務獎金自動計算來源）
  const wonOpps = opportunities.filter(o => o.stage === '贏單')
  const openOpps = opportunities.filter(o => !['贏單', '輸單'].includes(o.stage))
  const wonAmount = wonOpps.reduce((s, o) => s + (o.amount || 0), 0)
  const forecastAmount = openOpps.reduce((s, o) => s + (o.amount || 0) * ((o.probability || 0) / 100), 0)
  const thisMonthContacts = contacts.filter(c => c.created_at?.slice(0, 7) === period)
  const ticketResolved = tickets.filter(t => t.status === '已解決').length
  const ticketRate = tickets.length > 0 ? ((ticketResolved / tickets.length) * 100).toFixed(1) : '0'

  // WMS 數據（倉管獎金自動計算來源）
  const thisMonthAdj = adjustments.filter(a => a.created_at?.slice(0, 7) === period)
  const negAdj = thisMonthAdj.filter(a => (a.quantity || 0) < 0)
  const totalShipped = outboundOrders.filter(o => o.status === '已出貨' && o.created_at?.slice(0, 7) === period).length
  const errorRate = totalShipped > 0 ? ((negAdj.length / totalShipped) * 100).toFixed(2) : '0.00'
  const errorRatePass = Number(errorRate) < 0.05

  const CROSS_TARGETS = [
    { label: '業績目標達成', icon: '💰', metric: `贏單 ${wonOpps.length} 筆`, status: wonOpps.length >= 5 ? 'pass' : 'fail', threshold: '≥ 5 筆贏單' },
    { label: '客訴率低於標準', icon: '🎫', metric: `客訴解決率 ${ticketRate}%`, status: Number(ticketRate) >= 80 ? 'pass' : 'fail', threshold: '解決率 ≥ 80%' },
    { label: '庫存損耗率達標', icon: '📦', metric: '待串接 WMS 數據', status: 'pending', threshold: '損耗 ≤ 0.5%' },
  ]
  const crossPass = CROSS_TARGETS.filter(t => t.status === 'pass').length
  const crossEligible = crossPass === CROSS_TARGETS.filter(t => t.status !== 'pending').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">💰</span> 績效獎金管理</h2><p>CRM × WMS × ERP 三系統驅動的獎金計算</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="month" className="form-input" value={period} onChange={e => setPeriod(e.target.value)} style={{ fontSize: 13 }} />
            <button className="btn btn-secondary" onClick={() => setShowSettingModal(true)}><Settings size={14} /> 指標設定</button>
            <button className="btn btn-primary" onClick={() => setShowRecordModal(true)}><Plus size={14} /> 發放獎金</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">本月獎金總額</div><div className="stat-card-value">$ {totalPayout.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">發放人數</div><div className="stat-card-value">{periodRecords.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">啟用指標數</div><div className="stat-card-value">{settings.filter(s => s.is_active).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': crossEligible ? 'var(--accent-green)' : 'var(--accent-orange)', '--card-accent-dim': crossEligible ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">合戰獎金</div><div className="stat-card-value">{crossEligible ? '✅ 達標' : `${crossPass}/${CROSS_TARGETS.length} 項`}</div>
        </div>
      </div>

      {/* Tab */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {['業務', '倉管', '內勤採購', '跨部門合戰', '獎金紀錄', '指標設定'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: tab === t ? 'var(--accent-cyan)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-muted)' }}>{t}</button>
        ))}
      </div>

      {/* 業務獎金 */}
      {tab === '業務' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 自動計算區 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🔗</span> CRM 即時數據（{period}）</div>
              <span className="badge badge-success"><span className="badge-dot"></span>自動抓取</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '0 16px 16px' }}>
              {[
                { label: '贏單筆數', value: `${wonOpps.length} 筆`, sub: `金額 $${wonAmount.toLocaleString()}`, color: 'var(--accent-green)', icon: '🏆' },
                { label: '進行中商機', value: `${openOpps.length} 筆`, sub: `預估成交 $${Math.round(forecastAmount).toLocaleString()}`, color: 'var(--accent-cyan)', icon: '📈' },
                { label: '本月互動紀錄', value: `${thisMonthContacts.length} 筆`, sub: '電話/Email/LINE/拜訪', color: 'var(--accent-purple)', icon: '📊' },
                { label: '客服解決率', value: `${ticketRate}%`, sub: `已解決 ${ticketResolved}/${tickets.length} 筆`, color: Number(ticketRate) >= 80 ? 'var(--accent-green)' : 'var(--accent-red)', icon: '🎫' },
              ].map((item, i) => (
                <div key={i} style={{ padding: '12px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            {[
              { icon: '🏆', title: '成交獎金', desc: '按贏單金額比例抽成', source: 'CRM 贏單紀錄', color: 'var(--accent-green)', metric: `${wonOpps.length} 筆 · $ ${wonAmount.toLocaleString()}`, tip: '貨款收回後發放' },
              { icon: '📊', title: '數據勤奮獎', desc: '本月互動紀錄筆數', source: 'CRM 互動紀錄', color: 'var(--accent-cyan)', metric: `${thisMonthContacts.length} 筆互動`, tip: '確保業務確實輸入資料' },
              { icon: '🎯', title: '精準預測獎', desc: '預測金額 vs 實際成交差距', source: 'CRM 商機預估', color: 'var(--accent-purple)', metric: `預估 $ ${Math.round(forecastAmount).toLocaleString()}`, tip: '獎勵預測精準的業務' },
              { icon: '🔄', title: '回購長青獎', desc: '老客戶回購率', source: 'CRM 客戶紀錄', color: 'var(--accent-orange)', metric: '依客戶重複下單計算', tip: '獎勵深耕老客戶' },
            ].map((item, i) => (
              <div key={i} className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ fontSize: 28 }}>{item.icon}</div>
                  <span style={{ fontSize: 11, color: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)', padding: '2px 8px', borderRadius: 6 }}>🔗 {item.source}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{item.desc}</div>
                <div style={{ fontWeight: 700, color: item.color, fontSize: 14, marginBottom: 8 }}>{item.metric}</div>
                <div style={{ fontSize: 11, color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)', padding: '4px 8px', borderRadius: 6 }}>💡 {item.tip}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title"><span className="card-title-icon">📐</span> 業務獎金公式</div></div>
            <div style={{ padding: '16px', background: 'var(--glass-light)', margin: '0 16px 16px', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 14, fontFamily: 'monospace', padding: '12px', background: 'var(--bg-primary)', borderRadius: 8, color: 'var(--accent-cyan)' }}>
                獎金 = (成交金額 × 抽成%) + (互動筆數達標獎) + 精準預測加成 + 回購獎
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>⚠ 入帳門檻：客戶貨款確認收回後方可發放成交獎金</div>
            </div>
          </div>
        </div>
      )}

      {/* 倉管獎金 */}
      {tab === '倉管' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* WMS 自動計算 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🔗</span> WMS 即時數據（{period}）</div>
              <span className="badge badge-success"><span className="badge-dot"></span>自動抓取</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '0 16px 16px' }}>
              {[
                { label: '本月出貨單', value: `${totalShipped} 筆`, sub: '已出貨狀態', color: 'var(--accent-cyan)', icon: '🚚' },
                { label: '庫存異常調整', value: `${negAdj.length} 筆`, sub: '負向調整紀錄（損耗/錯誤）', color: negAdj.length === 0 ? 'var(--accent-green)' : 'var(--accent-red)', icon: '📦' },
                { label: '出貨異常率', value: `${errorRate}%`, sub: errorRatePass ? '✅ 低於 0.05% 達標' : '❌ 超過 0.05% 未達標', color: errorRatePass ? 'var(--accent-green)' : 'var(--accent-red)', icon: '✅' },
              ].map((item, i) => (
                <div key={i} style={{ padding: '12px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[
              { icon: '✅', title: '零出錯率獎金', desc: '出貨複核錯誤率低於 0.05%', source: 'WMS 出貨紀錄', color: 'var(--accent-green)', threshold: '錯誤率 < 0.05%', reward: '全組激勵獎金', tip: '低於萬分之一全組發放' },
              { icon: '⚡', title: '揀貨效率獎金', desc: '人均每小時揀貨量 (UPH)', source: 'WMS 揀貨紀錄', color: 'var(--accent-cyan)', threshold: 'UPH 超過基準值', reward: '超標每單 +0.5 元', tip: '超過基準值的部分計獎' },
              { icon: '📋', title: '盤點準確獎金', desc: '實物與帳面重合度', source: 'WMS 盤點紀錄', color: 'var(--accent-purple)', threshold: '準確率 ≥ 99.9%', reward: '季度盤點達標獎', tip: '循環盤點季度達成時發放' },
            ].map((item, i) => (
              <div key={i} className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ fontSize: 28 }}>{item.icon}</div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--glass-light)', padding: '2px 8px', borderRadius: 6 }}>{item.source}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{item.desc}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--glass-light)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>門檻：</span><span style={{ color: item.color, fontWeight: 600 }}> {item.threshold}</span>
                  </div>
                  <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--accent-green-dim)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>獎勵：</span><span style={{ color: 'var(--accent-green)', fontWeight: 600 }}> {item.reward}</span>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)', padding: '4px 8px', borderRadius: 6 }}>💡 {item.tip}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title"><span className="card-title-icon">📐</span> 倉管獎金公式</div></div>
            <div style={{ padding: '16px', background: 'var(--glass-light)', margin: '0 16px 16px', borderRadius: 10 }}>
              <div style={{ fontSize: 14, fontFamily: 'monospace', padding: '12px', background: 'var(--bg-primary)', borderRadius: 8, color: 'var(--accent-cyan)' }}>
                獎金 = 零錯誤獎 + (UPH超標量 × 每單獎勵) + 季度盤點準確獎
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>⚠ 若當月發生重大出貨事故，零錯誤獎金自動取消</div>
            </div>
          </div>
        </div>
      )}

      {/* 內勤採購獎金 */}
      {tab === '內勤採購' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[
              { icon: '📉', title: '庫存優化獎金', desc: '降低呆滯物料或縮短庫存周轉天數', source: 'ERP 庫存分析', color: 'var(--accent-green)', threshold: '周轉天數下降', reward: '節省利息成本分潤', tip: '從省下的財務成本中分潤' },
              { icon: '💳', title: '應收帳款催收獎', desc: '縮短平均收款天數 (DSO)', source: 'ERP 應收帳款', color: 'var(--accent-cyan)', threshold: 'DSO 達標', reward: '每縮短1天 獎勵X元', tip: '針對財務人員，加速現金回收' },
              { icon: '⏰', title: '數據及時獎', desc: '當天準時完成所有結算作業', source: 'ERP 結算紀錄', color: 'var(--accent-purple)', threshold: '當月不拖延率 ≥ 95%', reward: '行政人員全體結算獎', tip: '全公司流程當天結算才發放' },
            ].map((item, i) => (
              <div key={i} className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ fontSize: 28 }}>{item.icon}</div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--glass-light)', padding: '2px 8px', borderRadius: 6 }}>{item.source}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{item.desc}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--glass-light)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>門檻：</span><span style={{ color: item.color, fontWeight: 600 }}> {item.threshold}</span>
                  </div>
                  <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--accent-green-dim)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>獎勵：</span><span style={{ color: 'var(--accent-green)', fontWeight: 600 }}> {item.reward}</span>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)', padding: '4px 8px', borderRadius: 6 }}>💡 {item.tip}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 跨部門合戰 */}
      {tab === '跨部門合戰' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>季度大合戰獎金</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>三個條件同時達成，全公司分紅</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {CROSS_TARGETS.map((target, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderRadius: 12, border: `2px solid ${target.status === 'pass' ? 'var(--accent-green)' : target.status === 'fail' ? 'var(--accent-red)' : 'var(--border-medium)'}`, background: target.status === 'pass' ? 'var(--accent-green-dim)' : target.status === 'fail' ? 'var(--accent-red-dim)' : 'var(--glass-light)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 24 }}>{target.icon}</div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{target.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>門檻：{target.threshold}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{target.metric}</div>
                    <span className={`badge ${target.status === 'pass' ? 'badge-success' : target.status === 'fail' ? 'badge-danger' : 'badge-neutral'}`}>
                      <span className="badge-dot"></span>
                      {target.status === 'pass' ? '✅ 達標' : target.status === 'fail' ? '❌ 未達標' : '⏳ 待數據'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: '16px', borderRadius: 12, background: crossEligible ? 'var(--accent-green-dim)' : 'var(--glass-light)', border: `2px solid ${crossEligible ? 'var(--accent-green)' : 'var(--border-medium)'}`, textAlign: 'center' }}>
              {crossEligible ? (
                <>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--accent-green)' }}>恭喜！本季達標，全公司分紅發放</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⚡</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-secondary)' }}>尚有 {CROSS_TARGETS.filter(t => t.status !== 'pass').length} 項未達標，繼續加油！</div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title"><span className="card-title-icon">⚠</span> 設計目的</div></div>
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)', fontSize: 13, lineHeight: 1.8 }}>
                <strong>避免部門對立：</strong>防止業務為趕出貨把倉庫弄亂，或倉管為降低錯誤率而拖慢出貨速度。<br />
                三個系統（CRM × WMS × ERP）同時達標才發放分紅，讓全公司朝同一目標努力。
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 獎金紀錄 */}
      {tab === '獎金紀錄' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📋</span> 獎金發放紀錄</div>
            <span className="badge badge-neutral">{period}</span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>員工</th><th>職類</th><th>期間</th><th>基本績效獎</th><th>數據達標獎</th><th>獎金總額</th><th>備註</th></tr></thead>
              <tbody>
                {periodRecords.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>本期尚無獎金紀錄</td></tr>}
                {periodRecords.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.employee_name}</td>
                    <td><span className="badge badge-neutral"><span className="badge-dot"></span>{r.role_type}</span></td>
                    <td style={{ fontSize: 12 }}>{r.period}</td>
                    <td>$ {(r.base_bonus || 0).toLocaleString()}</td>
                    <td>$ {(r.data_bonus || 0).toLocaleString()}</td>
                    <td style={{ fontWeight: 800, color: 'var(--accent-green)', fontSize: 15 }}>$ {(r.total_bonus || 0).toLocaleString()}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.notes}</td>
                  </tr>
                ))}
                {periodRecords.length > 0 && (
                  <tr style={{ background: 'var(--glass-light)', fontWeight: 700 }}>
                    <td colSpan={5} style={{ textAlign: 'right', paddingRight: 16 }}>合計</td>
                    <td style={{ color: 'var(--accent-green)', fontSize: 16 }}>$ {totalPayout.toLocaleString()}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 指標設定 */}
      {tab === '指標設定' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">⚙</span> 獎金指標設定</div>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setShowSettingModal(true)}><Plus size={12} /> 新增指標</button>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>職類</th><th>指標名稱</th><th>目標值</th><th>權重</th><th>獎勵金額</th><th>週期</th><th>狀態</th></tr></thead>
              <tbody>
                {settings.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無設定，點右上角新增</td></tr>}
                {settings.map(s => (
                  <tr key={s.id}>
                    <td><span className="badge badge-neutral"><span className="badge-dot"></span>{s.role_type}</span></td>
                    <td style={{ fontWeight: 600 }}>{s.metric_name}</td>
                    <td>{s.target_value}</td>
                    <td>{s.weight}x</td>
                    <td>$ {(s.reward_amount || 0).toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{s.period}</td>
                    <td>
                      <button onClick={() => toggleSetting(s.id, s.is_active)} className={`badge ${s.is_active ? 'badge-success' : 'badge-neutral'}`} style={{ border: 'none', cursor: 'pointer' }}>
                        <span className="badge-dot"></span>{s.is_active ? '啟用' : '停用'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showRecordModal && (
        <Modal title="發放獎金紀錄" onClose={() => { setShowRecordModal(false); setPolicyBonus(0); setPerfReview(null) }} onSubmit={handleAddRecord} submitLabel="確認發放">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工姓名" required>
              <SearchableSelect
                value={recordForm.employee_name}
                onChange={(v) => handleEmployeeSelect(v || '')}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名/門市..."
              />
            </Field>
            <Field label="職類">
              <select className="form-input" style={{ width: '100%' }} value={recordForm.role_type} onChange={e => setR('role_type', e.target.value)}>
                {ROLE_TYPES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          {perfReview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)', marginBottom: 8 }}>
              <span style={{ fontSize: 15 }}>📊</span>
              <span style={{ fontSize: 13 }}>最近績效評等：<strong style={{ color: 'var(--accent-purple)' }}>{perfReview.rating}</strong>（{perfReview.period}，綜合分 {perfReview.overall_score}）— 已自動帶入建議數據達標獎</span>
            </div>
          )}
          {policyBonus > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', marginBottom: 8 }}>
              <Gift size={16} style={{ color: 'var(--accent-green)' }} />
              <span style={{ fontSize: 13 }}>福利政策自動帶入：<strong style={{ color: 'var(--accent-green)' }}>$ {policyBonus.toLocaleString()}</strong>（可手動調整）</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="期間"><input className="form-input" type="month" style={{ width: '100%' }} value={recordForm.period} onChange={e => setR('period', e.target.value)} /></Field>
            <Field label="基本績效獎"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={recordForm.base_bonus} onChange={e => setR('base_bonus', e.target.value)} /></Field>
            <Field label="數據達標獎"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={recordForm.data_bonus} onChange={e => setR('data_bonus', e.target.value)} /></Field>
          </div>
          <Field label="備註"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="說明獎金計算依據..." value={recordForm.notes} onChange={e => setR('notes', e.target.value)} /></Field>
        </Modal>
      )}

      {showSettingModal && (
        <Modal title="新增獎金指標" onClose={() => setShowSettingModal(false)} onSubmit={handleAddSetting}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="職類">
              <select className="form-input" style={{ width: '100%' }} value={settingForm.role_type} onChange={e => setS('role_type', e.target.value)}>
                {ROLE_TYPES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="指標名稱" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="零錯誤率獎金..." value={settingForm.metric_name} onChange={e => setS('metric_name', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="目標值"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0.05" value={settingForm.target_value} onChange={e => setS('target_value', e.target.value)} /></Field>
            <Field label="權重"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="1" value={settingForm.weight} onChange={e => setS('weight', e.target.value)} /></Field>
            <Field label="獎勵金額"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={settingForm.reward_amount} onChange={e => setS('reward_amount', e.target.value)} /></Field>
          </div>
          <Field label="週期">
            <select className="form-input" style={{ width: '100%' }} value={settingForm.period} onChange={e => setS('period', e.target.value)}>
              {['月', '季', '年'].map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
