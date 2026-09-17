import { useState, useEffect, useMemo } from 'react'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { Settings, RefreshCw, Lock, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import SearchableSelect from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// 固定 3 種角色（DB role_config 還沒建也能正常下拉）
const ROLE_OPTIONS = ['店長', '代理人', '督導', '正職', '兼職']

/**
 * 門市業績獎金 — 月度計算與結算
 *
 * 流程：
 *   1. 選店 + 月份 → 開單（initialize_store_bonus）自動拉在職員工
 *   2. 輸入 損益兩平 / 目標 / 本月業績 + 每人 缺失/小過/記功/補卡/前月補發
 *   3. 「重算」 → 顯示 損益獎金 / 達標 / 記功 / 稽核扣 / 補卡扣 / 應發
 *   4. 「結算發放」 → finalize（鎖定）
 */
export default function StoreBonus() {
  const { profile, hasPermission } = useAuth()
  const canCompute = hasPermission('bonus.store.compute')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState('')
  const today = new Date()
  const [yearMonth, setYearMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)

  const [monthly, setMonthly] = useState(null)
  const [employees, setEmployees] = useState([])
  const [roleConfig, setRoleConfig] = useState([])
  const [customFields, setCustomFields] = useState([])  // 自訂欄位定義（org 層，is_active）
  const [showConfig, setShowConfig] = useState(false)
  const [showCustomFields, setShowCustomFields] = useState(false)

  // 季別累積結算
  const [quarter, setQuarter] = useState('Q' + (Math.floor(today.getMonth() / 3) + 1))
  const [quarterYear, setQuarterYear] = useState(today.getFullYear())
  const [quarterDefs, setQuarterDefs] = useState([])      // [{quarter, months:[]}]
  const [quarterData, setQuarterData] = useState(null)
  const [showQuarterDef, setShowQuarterDef] = useState(false)

  // 店長競賽(org 層級,跨店排名)
  const [compYear, setCompYear] = useState(today.getFullYear())
  const [compPeriod, setCompPeriod] = useState('P' + Math.min(3, Math.floor(today.getMonth() / 4) + 1))
  const [compData, setCompData] = useState(null)

  // 個人銷售酒款激勵
  const [psiList, setPsiList] = useState([])
  const [psiEmp, setPsiEmp] = useState('')
  const [psiAmount, setPsiAmount] = useState('')
  const [psiDate, setPsiDate] = useState(new Date().toISOString().slice(0, 10))
  const [psiNotes, setPsiNotes] = useState('')

  // 新增人員(督導/代理/漏撈的人)
  const [allEmployees, setAllEmployees] = useState([])
  const [addEmpId, setAddEmpId] = useState('')
  const [addEmpRole, setAddEmpRole] = useState('正職')

  const reloadCustomFields = () => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    supabase.from('store_bonus_custom_fields').select('*')
      .eq('organization_id', orgId).eq('is_active', true).order('sort_order')
      .then(({ data }) => setCustomFields(data || []))
  }

  // 季別累積結算:把該季各月每人獎金加總
  const handleQuarterSummary = async () => {
    if (!storeId) { toast.warning('請先選門市'); return }
    const { data, error } = await supabase.rpc('store_bonus_quarter_summary', {
      p_store_id: Number(storeId), p_year: Number(quarterYear), p_quarter: quarter,
    })
    if (error || !data?.ok) { toast.error('查詢失敗：' + (error?.message || '')); return }
    setQuarterData(data)
  }
  const toggleQuarterMonth = (q, m) => setQuarterDefs(defs => defs.map(d => {
    if (d.quarter !== q) return d
    const has = (d.months || []).includes(m)
    return { ...d, months: has ? d.months.filter(x => x !== m) : [...(d.months || []), m].sort((a, b) => a - b) }
  }))
  const setQuarterPayout = (q, field, val) => setQuarterDefs(defs => defs.map(d => d.quarter === q ? { ...d, [field]: val } : d))
  const saveQuarterDefs = async () => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    for (const d of quarterDefs) {
      await supabase.from('store_bonus_quarter_def')
        .update({ months: d.months || [], payout_month: d.payout_month ?? null, payout_next_year: !!d.payout_next_year })
        .eq('organization_id', orgId).eq('quarter', d.quarter)
    }
    toast.success('季別月份已儲存')
    setShowQuarterDef(false)
  }

  // 匯出季發放清單(Excel)
  const handleExportQuarter = async () => {
    if (!quarterData?.rows?.length) { toast.warning('沒有資料可匯出，請先「季別累積」'); return }
    const _m = await import('xlsx-js-style'); const XLSX = _m.utils ? _m : (_m.default || _m)
    const storeName = stores.find(s => String(s.id) === String(storeId))?.name || ''
    const header = ['姓名', '角色', '月數', '管理獎金', '業績獎金', '功獎金', '扣款', '累積應發']
    const rows = [[`${storeName}　${quarterData.year} ${quarterData.quarter} 季發放清單（含月份：${(quarterData.months || []).join('、')}）`], [], header]
    quarterData.rows.forEach(r => rows.push([
      r.employee_name, r.role, r.months, Number(r.total_mgmt), Number(r.total_target),
      Number(r.total_merit), Number(r.total_audit || 0) + Number(r.total_punch || 0), Number(r.total_net),
    ]))
    rows.push([])
    rows.push(['合計', '', '', '', '', '', '', quarterData.rows.reduce((s, r) => s + Number(r.total_net || 0), 0)])
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, quarterData.quarter)
    XLSX.writeFile(wb, `季發放_${storeName}_${quarterData.year}${quarterData.quarter}.xlsx`)
  }
  // 確認季發放(記錄快照)
  const handleSettleQuarter = async () => {
    if (!storeId) return
    if (!confirm(`確認 ${quarterYear} ${quarter} 季發放？會記錄目前各人累積金額的快照。`)) return
    const { data, error } = await supabase.rpc('settle_store_bonus_quarter', {
      p_store_id: Number(storeId), p_year: Number(quarterYear), p_quarter: quarter, p_settler: profile?.id || null,
    })
    if (error || !data?.ok) { toast.error('季結算失敗：' + (error?.message || data?.error || '')); return }
    if (data.draft_months > 0) toast.warning(`已記錄季發放 NT$ ${Number(data.total).toLocaleString()}，但有 ${data.draft_months} 個月尚未結算，數字可能還會變`)
    else toast.success(`已確認季發放：NT$ ${Number(data.total).toLocaleString()}`)
  }

  // 店長競賽:計算排名 / 確認發放
  const handleComputeCompetition = async () => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    const { data, error } = await supabase.rpc('compute_store_competition', {
      p_org: Number(orgId), p_year: Number(compYear), p_period: compPeriod,
    })
    if (error || !data?.ok) { toast.error('計算失敗：' + (error?.message || data?.error || '')); return }
    setCompData(data)
  }
  const handleSettleCompetition = async () => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    if (!confirm(`確認 ${compYear} ${compPeriod} 店長競賽發放？會記錄前三名快照並掛到發放月薪資袋。`)) return
    const { data, error } = await supabase.rpc('settle_store_competition', {
      p_org: Number(orgId), p_year: Number(compYear), p_period: compPeriod, p_settler: profile?.id || null,
    })
    if (error || !data?.ok) { toast.error('結算失敗：' + (error?.message || data?.error || '')); return }
    toast.success(`已確認發放，前三名獎金掛 ${data.payout_year_month} 薪資袋`)
    handleComputeCompetition()
  }

  // 個人銷售酒款激勵:載入 / 登錄 / 刪除
  const loadPsi = async () => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    const { data } = await supabase.from('personal_sale_incentive').select('*')
      .eq('organization_id', orgId).order('sale_date', { ascending: false }).limit(200)
    setPsiList(data || [])
  }
  const handleAddPsi = async () => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!psiEmp || !psiAmount || !psiDate) { toast.warning('請填同仁 / 金額 / 成交日'); return }
    const emp = allEmployees.find(e => String(e.id) === String(psiEmp))
    const { error } = await supabase.from('personal_sale_incentive').insert({
      organization_id: Number(orgId), employee_id: Number(psiEmp), employee_name: emp?.name || null,
      sale_date: psiDate, sale_amount: Number(psiAmount) || 0,
      reviewer_id: profile?.id || null, created_by: profile?.id || null, notes: psiNotes || null,
    })
    if (error) { toast.error('登錄失敗：' + error.message); return }
    toast.success('已登錄')
    setPsiAmount(''); setPsiNotes('')
    loadPsi()
  }
  const handleDelPsi = async (id) => {
    if (!confirm('刪除這筆個人銷售登錄？')) return
    const { error } = await supabase.from('personal_sale_incentive').delete().eq('id', id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    loadPsi()
  }

  // 載入門市清單 + role config + 自訂欄位
  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    Promise.all([
      supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
      supabase.from('store_bonus_role_config').select('*').eq('organization_id', orgId).order('weight', { ascending: false }),
      supabase.from('store_bonus_custom_fields').select('*').eq('organization_id', orgId).eq('is_active', true).order('sort_order'),
      supabase.from('store_bonus_quarter_def').select('*').eq('organization_id', orgId).order('quarter'),
      supabase.from('employees').select('id, name').eq('organization_id', orgId).eq('status', '在職').not('is_archived', 'is', true).order('name'),
    ]).then(([s, c, cf, qd, ae]) => {
      setStores(s.data || [])
      setRoleConfig(c.data || [])
      setCustomFields(cf.data || [])
      setQuarterDefs(qd.data || [])
      setAllEmployees(ae.data || [])
      setLoading(false)
    })
    loadPsi()
  }, [profile?.organization_id])

  // 新增人員到名單(督導/代理/漏撈的人)
  const handleAddEmployee = async () => {
    if (!monthly?.id || !addEmpId) return
    const emp = allEmployees.find(e => String(e.id) === String(addEmpId))
    if (!emp) return
    if (employees.some(e => String(e.employee_id) === String(emp.id))) { toast.warning('此人已在名單'); return }
    const cfg = roleConfig.find(c => c.role === addEmpRole)
    setSaving(true)
    const { error } = await supabase.from('store_bonus_employee').insert({
      monthly_id: monthly.id, employee_id: emp.id, employee_name: emp.name, role: addEmpRole, weight: cfg?.weight || 0,
    })
    if (!error) await supabase.rpc('recalculate_store_bonus', { p_monthly_id: monthly.id })
    setSaving(false)
    if (error) { toast.error('加入失敗：' + error.message); return }
    setAddEmpId('')
    loadMonthly()
  }

  // 載入當前選擇的店 + 月度
  const loadMonthly = async () => {
    if (!storeId || !yearMonth) return
    const { data: m } = await supabase.from('store_bonus_monthly')
      .select('*')
      .eq('store_id', Number(storeId))
      .eq('year_month', yearMonth)
      .maybeSingle()
    setMonthly(m || null)
    if (m) {
      const { data: emps } = await supabase.from('store_bonus_employee')
        .select('*')
        .eq('monthly_id', m.id)
        .order('id')
      setEmployees(emps || [])
    } else {
      setEmployees([])
    }
  }
  useEffect(() => { loadMonthly() }, [storeId, yearMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const isFinalized = monthly?.status === 'finalized'

  const handleInitialize = async () => {
    if (!storeId) { toast.warning('請選門市'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('initialize_store_bonus', {
      p_store_id: Number(storeId),
      p_year_month: yearMonth,
    })
    setSaving(false)
    if (error) { toast.error('開單失敗：' + error.message); return }
    toast.success('已開單，拉入該店在職員工')
    loadMonthly()
  }

  const handleSaveMonthly = async (patch) => {
    if (!monthly?.id) return
    setSaving(true)
    const { error } = await supabase.from('store_bonus_monthly').update(patch).eq('id', monthly.id)
    setSaving(false)
    if (error) { toast.error('儲存失敗：' + error.message); return }
    setMonthly(m => ({ ...m, ...patch }))
  }

  const handleEmpFieldChange = (empId, field, value) => {
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, [field]: value } : e))
  }

  // 自訂欄位值（存進 custom_values JSONB，key = 欄位 id）
  const handleEmpCustomChange = (empId, fieldId, value) => {
    setEmployees(prev => prev.map(e => e.id === empId
      ? { ...e, custom_values: { ...(e.custom_values || {}), [fieldId]: value } }
      : e))
  }

  const handleSaveEmp = async (emp) => {
    setSaving(true)
    const patch = {
      role:                   emp.role,
      commend_count:          Number(emp.commend_count) || 0,
      minor_merit_count:      Number(emp.minor_merit_count) || 0,
      major_merit_count:      Number(emp.major_merit_count) || 0,
      absence_count:          Number(emp.absence_count) || 0,
      reprimand_count:        Number(emp.reprimand_count) || 0,
      minor_offense_count:    Number(emp.minor_offense_count) || 0,
      major_offense_count:    Number(emp.major_offense_count) || 0,
      sick_leave_count:       Number(emp.sick_leave_count) || 0,
      personal_leave_count:   Number(emp.personal_leave_count) || 0,
      annual_leave_count:     Number(emp.annual_leave_count) || 0,
      complaint_count:        Number(emp.complaint_count) || 0,
      punch_correction_count: Number(emp.punch_correction_count) || 0,
      prev_month_supplement:  Number(emp.prev_month_supplement) || 0,
      custom_values:          emp.custom_values || {},
      notes:                  emp.notes || null,
    }
    // role 改了的話 weight 也要更新
    const cfg = roleConfig.find(c => c.role === emp.role)
    if (cfg) patch.weight = cfg.weight
    const { error } = await supabase.from('store_bonus_employee').update(patch).eq('id', emp.id)
    setSaving(false)
    if (error) { toast.error(`儲存 ${emp.employee_name} 失敗：${error.message}`); return }
  }

  const handleSyncPunchCounts = async () => {
    if (!monthly?.id) return
    setSaving(true)
    const { data, error } = await supabase.rpc('sync_store_bonus_punch_counts', {
      p_monthly_id: monthly.id,
    })
    setSaving(false)
    if (error) { toast.error('同步失敗：' + error.message); return }
    if (!data?.ok) { toast.error(`同步失敗：${data?.error || 'unknown'}`); return }
    if (data.updated === 0) {
      toast.success('已是最新（沒人忘卡次數變動）')
    } else {
      toast.success(`已同步 ${data.updated} 人忘卡次數，已重算扣項`)
    }
    loadMonthly()
  }

  const handleRecalculate = async () => {
    if (!monthly?.id) return
    setSaving(true)
    // 先把所有 unsaved 改動 patch 到 DB
    for (const emp of employees) {
      await handleSaveEmp(emp)
    }
    const { error } = await supabase.rpc('recalculate_store_bonus', { p_monthly_id: monthly.id })
    setSaving(false)
    if (error) { toast.error('重算失敗：' + error.message); return }
    toast.success('重算完成')
    loadMonthly()
  }

  const handleFinalize = async () => {
    if (!monthly?.id) return
    if (!(await confirm({ message: '結算後不可修改。確定發放？' }))) return
    setSaving(true)
    // 先 save 所有 row 再 recalculate 再 finalize
    for (const emp of employees) await handleSaveEmp(emp)
    const { error: ferr } = await supabase.rpc('finalize_store_bonus', {
      p_monthly_id: monthly.id,
      p_finalizer_emp_id: profile?.id || null,
    })
    setSaving(false)
    if (ferr) { toast.error('結算失敗：' + ferr.message); return }
    toast.success('已結算發放')
    loadMonthly()
  }

  const totals = useMemo(() => ({
    profit: employees.reduce((s, e) => s + Number(e.mgmt_bonus || 0), 0),
    target: employees.reduce((s, e) => s + Number(e.target_bonus || 0), 0),
    merit:  employees.reduce((s, e) => s + Number(e.merit_bonus || 0), 0),
    audit:  employees.reduce((s, e) => s + Number(e.audit_deduction || 0), 0),
    punch:  employees.reduce((s, e) => s + Number(e.punch_deduction || 0), 0),
    suppl:  employees.reduce((s, e) => s + Number(e.prev_month_supplement || 0), 0),
    net:    employees.reduce((s, e) => s + Number(e.net_bonus || 0), 0),
  }), [employees])

  if (loading) return <LoadingSpinner />

  if (!canCompute) {
    return (
      <div className="fade-in" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <h3 style={{ margin: 0 }}>無權存取</h3>
        <p>門市業績獎金需要 <code>bonus.store.compute</code> 權限，請聯絡 admin。</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>門市業績獎金</h2>
            <p>選店 + 月份 → 輸入業績與扣項 → 重算 → 結算發放</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowCustomFields(true)}>
              <Plus size={14} /> 自訂欄位
            </button>
            <button className="btn btn-secondary" onClick={() => setShowConfig(true)}>
              <Settings size={14} /> 角色 / 扣項設定
            </button>
          </div>
        </div>
      </div>

      {/* 選擇區 */}
      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label">門市</label>
          <select className="form-input" value={storeId} onChange={e => setStoreId(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">— 選擇門市 —</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">月份</label>
          <input className="form-input" type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)} />
        </div>
        {storeId && yearMonth && !monthly && (
          <AsyncButton className="btn btn-primary" onClick={handleInitialize} busyLabel="開單中…">
            <Plus size={14} /> 開單
          </AsyncButton>
        )}
        {monthly && (
          <span style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: isFinalized ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
            color: isFinalized ? 'var(--accent-green)' : 'var(--accent-orange)',
          }}>
            {isFinalized ? '已結算' : '草稿中'}
          </span>
        )}
      </div>

      {/* 季別累積結算（自選季別 + 可定義月份） */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label">結算年度</label>
            <input className="form-input" type="number" value={quarterYear} onChange={e => setQuarterYear(e.target.value)} style={{ width: 100 }} />
          </div>
          <div>
            <label className="form-label">季別</label>
            <select className="form-input" value={quarter} onChange={e => setQuarter(e.target.value)} style={{ width: 90 }}>
              {['Q1', 'Q2', 'Q3', 'Q4'].map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 8 }}>
            {(() => {
              const d = quarterDefs.find(x => x.quarter === quarter)
              if (!d) return ''
              const pay = d.payout_month ? `　→ ${d.payout_next_year ? '隔年' : ''}${d.payout_month} 月薪資袋發放` : ''
              return `含月份：${(d.months || []).join('、')} 月${pay}`
            })()}
          </span>
          <AsyncButton className="btn btn-primary" onClick={handleQuarterSummary} busyLabel="查詢中…" disabled={!storeId}>季別累積</AsyncButton>
          <button className="btn btn-secondary" onClick={handleExportQuarter} disabled={!quarterData} title="匯出這一季每人應領清單(Excel)">匯出清單</button>
          <AsyncButton className="btn btn-primary" onClick={handleSettleQuarter} busyLabel="結算中…" disabled={!quarterData} title="記錄本季各人應領金額快照">確認季發放</AsyncButton>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={() => setShowQuarterDef(v => !v)}>定義季別月份</button>
        </div>

        {showQuarterDef && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>勾選各季包含的月份（可跨標準季自訂）</div>
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => {
              const d = quarterDefs.find(x => x.quarter === q) || { quarter: q, months: [] }
              return (
                <div key={q} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                  <b style={{ width: 30 }}>{q}</b>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                    const on = (d.months || []).includes(m)
                    return (
                      <button key={m} onClick={() => toggleQuarterMonth(q, m)} style={{
                        width: 34, padding: '4px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                        border: `1px solid ${on ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                        background: on ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                        color: on ? 'var(--accent-cyan)' : 'var(--text-muted)', fontWeight: on ? 700 : 400,
                      }}>{m}</button>
                    )
                  })}
                  <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>發放月</span>
                  <select className="form-input" style={{ width: 70, padding: '4px 6px' }}
                    value={d.payout_month ?? ''}
                    onChange={e => setQuarterPayout(q, 'payout_month', e.target.value ? Number(e.target.value) : null)}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m} 月</option>)}
                  </select>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!d.payout_next_year}
                      onChange={e => setQuarterPayout(q, 'payout_next_year', e.target.checked)} />
                    隔年
                  </label>
                </div>
              )
            })}
            <button className="btn btn-primary" onClick={saveQuarterDefs} style={{ marginTop: 6 }}>儲存季別定義</button>
          </div>
        )}

        {quarterData && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              {quarterData.year} {quarterData.quarter}（月份 {(quarterData.months || []).join('、')}）·
              {(quarterData.month_status || []).length
                ? (quarterData.month_status || []).map(m => ` ${m.year_month}(${m.status === 'finalized' ? '已結算' : '草稿'})`).join('')
                : ' 區間內尚無開單'}
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>姓名</th><th>角色</th><th>月數</th><th>管理獎金</th><th>業績獎金</th><th>功獎金</th><th>扣款</th><th>累積應發</th></tr></thead>
                <tbody>
                  {(quarterData.rows || []).map(r => (
                    <tr key={r.employee_id}>
                      <td><b>{r.employee_name}</b></td>
                      <td>{r.role}</td>
                      <td style={{ textAlign: 'center' }}>{r.months}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.total_mgmt).toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.total_target).toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.total_merit).toLocaleString()}</td>
                      <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>{Number((r.total_audit || 0) + (r.total_punch || 0)).toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-cyan)' }}>{Number(r.total_net).toLocaleString()}</td>
                    </tr>
                  ))}
                  {(quarterData.rows || []).length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>此季無資料</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 🏆 店長競賽 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>🏆 店長競賽（4個月一期・業績成長率排名）</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label">年度</label>
            <input className="form-input" type="number" value={compYear} onChange={e => setCompYear(e.target.value)} style={{ width: 100 }} />
          </div>
          <div>
            <label className="form-label">期別</label>
            <select className="form-input" value={compPeriod} onChange={e => setCompPeriod(e.target.value)} style={{ width: 190 }}>
              <option value="P1">P1（1-4月→6月發）</option>
              <option value="P2">P2（5-8月→10月發）</option>
              <option value="P3">P3（9-12月→隔年2月發）</option>
            </select>
          </div>
          <AsyncButton className="btn btn-primary" onClick={handleComputeCompetition} busyLabel="計算中…">計算排名</AsyncButton>
          <AsyncButton className="btn btn-primary" onClick={handleSettleCompetition} busyLabel="結算中…" disabled={!compData} title="記錄前三名快照＋掛發放月薪資袋">確認發放</AsyncButton>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 8 }}>門檻：達業績目標 ＋ 成長率&gt;0% ＋ 淨利率≥3%；成長率＝本期 vs 上一期</span>
        </div>
        {compData && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              {compData.year} {compData.period}（{(compData.months || []).join('、')} 月）· 發放月 {compData.payout_year_month} · 獎金 {(compData.prizes || []).map(n => Number(n).toLocaleString()).join(' / ')}
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>名次</th><th>門市</th><th>店長</th><th>本期營業額</th><th>上期營業額</th><th>成長率</th><th>淨利率</th><th>達標</th><th>資格</th><th>獎金</th></tr></thead>
                <tbody>
                  {(compData.rows || []).map(r => (
                    <tr key={r.store_id} style={{ background: r.rank && r.rank <= 3 ? 'var(--accent-orange-dim)' : undefined }}>
                      <td style={{ textAlign: 'center', fontWeight: 800 }}>{r.rank ? `#${r.rank}` : '—'}</td>
                      <td><b>{r.store_name}</b></td>
                      <td>{r.manager_name || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.cur_rev || 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{Number(r.prev_rev || 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: r.growth > 0 ? 'var(--accent-green)' : r.growth < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{r.growth == null ? '—' : (r.growth * 100).toFixed(1) + '%'}</td>
                      <td style={{ textAlign: 'right' }}>{r.net_rate == null ? '—' : (r.net_rate * 100).toFixed(1) + '%'}</td>
                      <td style={{ textAlign: 'center' }}>{r.achieved ? '✅' : '—'}</td>
                      <td style={{ textAlign: 'center' }}>{r.eligible ? '✅' : '✗'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-orange)' }}>{r.prize > 0 ? Number(r.prize).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                  {(compData.rows || []).length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>無資料</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 💰 個人銷售酒款激勵 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>💰 個人銷售酒款激勵（單筆滿4萬→1,500、滿10萬→3,000・次月20日獨立發放）</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <label className="form-label">同仁</label>
            <SearchableSelect value={psiEmp} onChange={(v) => setPsiEmp(v || '')}
              options={allEmployees.map(a => ({ value: String(a.id), label: a.name }))}
              placeholder="搜尋同仁姓名…" />
          </div>
          <div>
            <label className="form-label">成交金額（折扣後）</label>
            <input className="form-input" type="number" value={psiAmount} onChange={e => setPsiAmount(e.target.value)} style={{ width: 130 }} />
          </div>
          <div>
            <label className="form-label">成交日</label>
            <input className="form-input" type="date" value={psiDate} onChange={e => setPsiDate(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">備註（客源/佐證）</label>
            <input className="form-input" value={psiNotes} onChange={e => setPsiNotes(e.target.value)} placeholder="個人開發/引薦…" />
          </div>
          <AsyncButton className="btn btn-primary" onClick={handleAddPsi} busyLabel="登錄中…">登錄</AsyncButton>
        </div>
        {psiAmount && Number(psiAmount) > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            預計獎金：<b>{Number(psiAmount) >= 100000 ? '3,000' : Number(psiAmount) >= 40000 ? '1,500' : '0（未達 4 萬不予發放）'}</b>
          </div>
        )}
        {psiList.length > 0 && (
          <div className="data-table-wrapper" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead><tr><th>成交日</th><th>同仁</th><th>金額</th><th>獎金</th><th>發放月</th><th>備註</th><th></th></tr></thead>
              <tbody>
                {psiList.map(p => (
                  <tr key={p.id}>
                    <td>{p.sale_date}</td>
                    <td><b>{p.employee_name}</b></td>
                    <td style={{ textAlign: 'right' }}>{Number(p.sale_amount).toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: p.bonus > 0 ? 'var(--accent-orange)' : 'var(--text-muted)' }}>{p.bonus > 0 ? Number(p.bonus).toLocaleString() : '—'}</td>
                    <td>{p.payout_year_month}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.notes}</td>
                    <td><button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleDelPsi(p.id)}>刪</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 門市層輸入 */}
      {monthly && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Field label="營業額">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.actual_revenue}
                onChange={e => setMonthly(m => ({ ...m, actual_revenue: e.target.value }))}
                onBlur={e => handleSaveMonthly({ actual_revenue: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="目標（業績獎金達標用）">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.target_revenue}
                onChange={e => setMonthly(m => ({ ...m, target_revenue: e.target.value }))}
                onBlur={e => handleSaveMonthly({ target_revenue: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="營業毛利">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.gross_profit ?? 0}
                onChange={e => setMonthly(m => ({ ...m, gross_profit: e.target.value }))}
                onBlur={e => handleSaveMonthly({ gross_profit: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="營業費用">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.operating_expense ?? 0}
                onChange={e => setMonthly(m => ({ ...m, operating_expense: e.target.value }))}
                onBlur={e => handleSaveMonthly({ operating_expense: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="營業稅損">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.tax_loss ?? 0}
                onChange={e => setMonthly(m => ({ ...m, tax_loss: e.target.value }))}
                onBlur={e => handleSaveMonthly({ tax_loss: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="總部成本 %（×營業額）">
              <input className="form-input" type="number" step="0.01" disabled={isFinalized}
                value={monthly.hq_cost_pct ?? 0.07}
                onChange={e => setMonthly(m => ({ ...m, hq_cost_pct: e.target.value }))}
                onBlur={e => handleSaveMonthly({ hq_cost_pct: Number(e.target.value) || 0.07 })} />
            </Field>
          </div>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>淨利</div><div style={{ fontSize: 16, fontWeight: 700 }}>NT$ {Number(monthly.net_profit || 0).toLocaleString()}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>淨利率</div><div style={{ fontSize: 16, fontWeight: 700 }}>{(Number(monthly.net_profit_rate || 0) * 100).toFixed(2)}%</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>管理獎金提撥</div><div style={{ fontSize: 16, fontWeight: 700 }}>{(Number(monthly.mgmt_tier_pct || 0) * 100).toFixed(0)}%</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>≥6%→10% · 3~5.99%→5%</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>管理獎金池</div><div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>NT$ {Number(monthly.mgmt_bonus_pool || 0).toLocaleString()}</div></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="團隊扣（稽核/客訴/盤損·人工填總額）">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.team_deduction ?? 0}
                onChange={e => setMonthly(m => ({ ...m, team_deduction: e.target.value }))}
                onBlur={e => handleSaveMonthly({ team_deduction: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="團隊加（盤點無失誤 +4500/季）">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.team_addition ?? 0}
                onChange={e => setMonthly(m => ({ ...m, team_addition: e.target.value }))}
                onBlur={e => handleSaveMonthly({ team_addition: Number(e.target.value) || 0 })} />
            </Field>
            <div style={{ paddingBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>可分配管理獎金（池 − 團隊扣 + 團隊加）</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-green)' }}>
                NT$ {Math.max(0, Number(monthly.mgmt_bonus_pool || 0) - Number(monthly.team_deduction || 0) + Number(monthly.team_addition || 0)).toLocaleString()}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            <span>{monthly.is_target_achieved ? '✅ 達成率≥100%（發業績獎金）' : '⚠️ 未達目標（不發業績獎金）'}</span>
            <span>·</span>
            <span>總權重：{Number(monthly.total_weight).toFixed(2)}</span>
            <div style={{ flex: 1 }} />
            {!isFinalized && (
              <>
                <AsyncButton className="btn btn-secondary" onClick={handleInitialize} busyLabel="拉取中…" disabled={saving} title="重新從門市＋組織拉人(補督導/主管、開單後才到職的人；已填資料保留)">
                  <RefreshCw size={14} /> 重新拉人員
                </AsyncButton>
                <AsyncButton className="btn btn-secondary" onClick={handleSyncPunchCounts} busyLabel="同步中…" disabled={saving} title="從 clock_corrections 自動填忘卡次數">
                  <RefreshCw size={14} /> 同步忘卡次數
                </AsyncButton>
                <AsyncButton className="btn btn-secondary" onClick={handleRecalculate} busyLabel="重算中…" disabled={saving}>
                  <RefreshCw size={14} /> 重算
                </AsyncButton>
                <AsyncButton className="btn btn-primary" onClick={handleFinalize} busyLabel="結算中…" disabled={saving}>
                  <Lock size={14} /> 結算發放
                </AsyncButton>
              </>
            )}
          </div>
        </div>
      )}

      {/* 新增人員(督導/代理/開單漏撈的人) */}
      {monthly && !isFinalized && (
        <div className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label">新增人員（督導/代理/漏撈的人）</label>
            <div style={{ minWidth: 200 }}>
              <SearchableSelect
                value={addEmpId}
                onChange={(v) => setAddEmpId(v || '')}
                options={allEmployees.filter(a => !employees.some(e => String(e.employee_id) === String(a.id))).map(a => ({ value: String(a.id), label: a.name }))}
                placeholder="搜尋員工姓名…"
              />
            </div>
          </div>
          <div>
            <label className="form-label">角色</label>
            <select className="form-input" value={addEmpRole} onChange={e => setAddEmpRole(e.target.value)} style={{ width: 100 }}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={handleAddEmployee} disabled={!addEmpId || saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={14} /> 加入名單
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 8 }}>開單已自動帶入該店督導（＝店長的直屬主管）；這裡用來手動加代理或漏撈的人。有店長時督導/代理重算後自動 0</span>
        </div>
      )}

      {/* 員工表 */}
      {monthly && employees.length > 0 && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>權重</th>
                  <th>個人比</th>
                  <th>管理獎金</th>
                  <th>業績獎金</th>
                  <th>嘉獎次</th>
                  <th>小功次</th>
                  <th>大功次</th>
                  <th>功獎金</th>
                  <th>曠職</th>
                  <th>申誡</th>
                  <th>小過</th>
                  <th>大過</th>
                  <th>病假</th>
                  <th>事假</th>
                  <th>特休</th>
                  <th>客訴</th>
                  <th>忘卡次</th>
                  <th>個人扣</th>
                  <th>忘卡扣</th>
                  <th>前月補發</th>
                  {customFields.map(f => (
                    <th key={f.id} title={f.effect === 'add' ? '加項（進應發）' : f.effect === 'deduct' ? '扣項（進應發）' : '僅記錄'}>
                      {f.effect === 'add' ? '➕' : f.effect === 'deduct' ? '➖' : ''}{f.name}
                    </th>
                  ))}
                  <th>應發</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(e => (
                  <tr key={e.id}>
                    <td><b>{e.employee_name}</b></td>
                    <td>
                      <select className="form-input" disabled={isFinalized}
                        value={e.role}
                        onChange={ev => handleEmpFieldChange(e.id, 'role', ev.target.value)}
                        style={{ width: 80, padding: 4, fontSize: 12 }}>
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>{Number(e.weight).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(e.weight_ratio).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(e.mgmt_bonus || 0).toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>
                      {e.target_bonus > 0 ? Number(e.target_bonus).toLocaleString() : '—'}
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.commend_count}
                        onChange={v => handleEmpFieldChange(e.id, 'commend_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.minor_merit_count}
                        onChange={v => handleEmpFieldChange(e.id, 'minor_merit_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.major_merit_count}
                        onChange={v => handleEmpFieldChange(e.id, 'major_merit_count', v)} />
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>
                      {e.merit_bonus > 0 ? Number(e.merit_bonus).toLocaleString() : '—'}
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.absence_count}
                        onChange={v => handleEmpFieldChange(e.id, 'absence_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.reprimand_count}
                        onChange={v => handleEmpFieldChange(e.id, 'reprimand_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.minor_offense_count}
                        onChange={v => handleEmpFieldChange(e.id, 'minor_offense_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.major_offense_count}
                        onChange={v => handleEmpFieldChange(e.id, 'major_offense_count', v)} />
                    </td>
                    <td><Input n disabled={isFinalized} value={e.sick_leave_count} onChange={v => handleEmpFieldChange(e.id, 'sick_leave_count', v)} /></td>
                    <td><Input n disabled={isFinalized} value={e.personal_leave_count} onChange={v => handleEmpFieldChange(e.id, 'personal_leave_count', v)} /></td>
                    <td><Input n disabled={isFinalized} value={e.annual_leave_count} onChange={v => handleEmpFieldChange(e.id, 'annual_leave_count', v)} /></td>
                    <td><Input n disabled={isFinalized} value={e.complaint_count} onChange={v => handleEmpFieldChange(e.id, 'complaint_count', v)} /></td>
                    <td>
                      <Input n disabled={isFinalized} value={e.punch_correction_count}
                        onChange={v => handleEmpFieldChange(e.id, 'punch_correction_count', v)} />
                    </td>
                    <td style={{ textAlign: 'right', color: e.audit_deduction < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {e.audit_deduction < 0 ? `(${Math.abs(e.audit_deduction).toLocaleString()})` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: e.punch_deduction < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {e.punch_deduction < 0 ? `(${Math.abs(e.punch_deduction).toLocaleString()})` : '—'}
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.prev_month_supplement}
                        onChange={v => handleEmpFieldChange(e.id, 'prev_month_supplement', v)} step="100" />
                    </td>
                    {customFields.map(f => (
                      <td key={f.id}>
                        <input className="form-input" type={f.value_type === 'text' ? 'text' : 'number'}
                          disabled={isFinalized}
                          value={(e.custom_values?.[f.id]) ?? ''}
                          onChange={ev => handleEmpCustomChange(e.id, f.id, ev.target.value)}
                          style={{ width: f.value_type === 'text' ? 90 : 64, padding: 4, fontSize: 12, textAlign: f.value_type === 'text' ? 'left' : 'right' }} />
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: e.eligible === false ? 'var(--text-muted)' : 'var(--accent-cyan)' }}
                      title={`當月工時 ${Number(e.work_hours || 0)}h`}>
                      {Number(e.net_bonus).toLocaleString()}
                      {e.eligible === false && e.ineligible_reason && (
                        <div style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 600 }}>⚠ {e.ineligible_reason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                  <td colSpan={4} style={{ textAlign: 'right' }}>合計</td>
                  <td style={{ textAlign: 'right' }}>{totals.profit.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{totals.target.toLocaleString()}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}>{totals.merit.toLocaleString()}</td>
                  <td colSpan={9}></td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>
                    {totals.audit < 0 ? `(${Math.abs(totals.audit).toLocaleString()})` : 0}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>
                    {totals.punch < 0 ? `(${Math.abs(totals.punch).toLocaleString()})` : 0}
                  </td>
                  <td style={{ textAlign: 'right' }}>{totals.suppl.toLocaleString()}</td>
                  {customFields.map(f => <td key={f.id}></td>)}
                  <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                    {totals.net.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            ⓘ 輸入後請按「重算」更新各欄計算結果。「結算發放」鎖定後不可再改。
          </div>
        </div>
      )}

      {/* 角色設定 modal */}
      {showConfig && (
        <RoleConfigModal
          config={roleConfig}
          orgId={profile?.organization_id}
          onClose={() => setShowConfig(false)}
          onSaved={() => {
            supabase.from('store_bonus_role_config').select('*').eq('organization_id', profile?.organization_id).order('weight', { ascending: false })
              .then(({ data }) => setRoleConfig(data || []))
            setShowConfig(false)
          }}
        />
      )}

      {/* 自訂欄位設定 modal */}
      {showCustomFields && (
        <CustomFieldsModal
          orgId={profile?.organization_id}
          onClose={() => setShowCustomFields(false)}
          onSaved={() => { reloadCustomFields(); loadMonthly() }}
        />
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="form-label" style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, disabled, n, step = '1' }) {
  return (
    <input className="form-input" type="number" step={step} disabled={disabled}
      value={value ?? 0}
      onChange={e => onChange(e.target.value)}
      style={{ width: 56, padding: 4, fontSize: 12, textAlign: 'right' }} />
  )
}

function RoleConfigModal({ config, orgId, onClose, onSaved }) {
  const [rows, setRows] = useState(config)
  const handleSave = async () => {
    for (const r of rows) {
      await supabase.from('store_bonus_role_config').update({
        weight:               Number(r.weight) || 0,
        commend_amount:       Number(r.commend_amount) || 0,
        minor_merit_amount:   Number(r.minor_merit_amount) || 0,
        major_merit_amount:   Number(r.major_merit_amount) || 0,
        target_bonus_amount:  Number(r.target_bonus_amount) || 0,
        absence_deduct:       Number(r.absence_deduct) || 0,
        reprimand_deduct:     Number(r.reprimand_deduct) || 0,
        minor_offense_deduct: Number(r.minor_offense_deduct) || 0,
        major_offense_deduct: Number(r.major_offense_deduct) || 0,
        sick_leave_deduct:     Number(r.sick_leave_deduct) || 0,
        personal_leave_deduct: Number(r.personal_leave_deduct) || 0,
        annual_leave_deduct:   Number(r.annual_leave_deduct) || 0,
        complaint_deduct:      Number(r.complaint_deduct) || 0,
        punch_deduct_start:   Number(r.punch_deduct_start) || 5,
        punch_deduct_amount:  Number(r.punch_deduct_amount) || 0,
        min_work_hours:        Number(r.min_work_hours) || 0,
        bonus_from_next_month: !!r.bonus_from_next_month,
      }).eq('id', r.id)
    }
    toast.success('已儲存')
    onSaved()
  }
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ padding: 20, width: 720, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>⚙️ 獎金規則設定</h3>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>角色</th><th>權重</th><th>嘉獎獎金/筆</th><th>小功獎金/筆</th><th>大功獎金/筆</th><th>達標獎金</th>
                <th>曠職扣/筆</th><th>申誡扣/筆</th><th>小過扣/筆</th><th>大過扣/筆</th><th>病假扣/次</th><th>事假扣/次</th><th>特休扣/次</th><th>客訴扣/則</th><th>忘卡第幾次起扣</th><th>忘卡扣/次</th><th>最低工時</th><th>次月起領</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td><b>{r.role}</b></td>
                  <td><Input value={r.weight} step="0.1" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, weight: v } : x))} /></td>
                  <td><Input value={r.commend_amount} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, commend_amount: v } : x))} /></td>
                  <td><Input value={r.minor_merit_amount} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, minor_merit_amount: v } : x))} /></td>
                  <td><Input value={r.major_merit_amount} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, major_merit_amount: v } : x))} /></td>
                  <td><Input value={r.target_bonus_amount} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, target_bonus_amount: v } : x))} /></td>
                  <td><Input value={r.absence_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, absence_deduct: v } : x))} /></td>
                  <td><Input value={r.reprimand_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, reprimand_deduct: v } : x))} /></td>
                  <td><Input value={r.minor_offense_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, minor_offense_deduct: v } : x))} /></td>
                  <td><Input value={r.major_offense_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, major_offense_deduct: v } : x))} /></td>
                  <td><Input value={r.sick_leave_deduct} step="50" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, sick_leave_deduct: v } : x))} /></td>
                  <td><Input value={r.personal_leave_deduct} step="50" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, personal_leave_deduct: v } : x))} /></td>
                  <td><Input value={r.annual_leave_deduct} step="50" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, annual_leave_deduct: v } : x))} /></td>
                  <td><Input value={r.complaint_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, complaint_deduct: v } : x))} /></td>
                  <td><Input value={r.punch_deduct_start} onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, punch_deduct_start: v } : x))} /></td>
                  <td><Input value={r.punch_deduct_amount} step="50" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, punch_deduct_amount: v } : x))} /></td>
                  <td><Input value={r.min_work_hours} step="1" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, min_work_hours: v } : x))} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!!r.bonus_from_next_month}
                      onChange={e => setRows(rs => rs.map((x, j) => i === j ? { ...x, bonus_from_next_month: e.target.checked } : x))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave}>儲存</button>
        </div>
      </div>
    </div>
  )
}

// ── 自訂欄位管理 modal（新增 / 定義 / 上下移排序 / 刪除）──────────────────────
const EFFECT_LABEL = { none: '僅記錄', add: '加項（進應發）', deduct: '扣項（進應發）' }
function CustomFieldsModal({ orgId, onClose, onSaved }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    supabase.from('store_bonus_custom_fields').select('*')
      .eq('organization_id', orgId).eq('is_active', true).order('sort_order')
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [orgId])

  const patchRow = (i, patch) => setRows(rs => rs.map((x, j) => {
    if (i !== j) return x
    const next = { ...x, ...patch }
    // 進計算的欄位強制數字型別
    if (next.effect !== 'none') next.value_type = 'number'
    return next
  }))

  const addRow = () => setRows(rs => [...rs, {
    _new: true, name: '', value_type: 'number', effect: 'none', sort_order: rs.length, is_active: true,
  }])

  const move = (i, dir) => setRows(rs => {
    const j = i + dir
    if (j < 0 || j >= rs.length) return rs
    const next = [...rs];[next[i], next[j]] = [next[j], next[i]]; return next
  })

  const removeRow = (i) => setRows(rs => rs.map((x, j) => i === j ? { ...x, _deleted: true } : x))

  const handleSave = async () => {
    setSaving(true)
    try {
      const visible = rows.filter(r => !r._deleted)
      // 刪除（既有且標記刪除）
      for (const r of rows.filter(r => r._deleted && r.id)) {
        await supabase.from('store_bonus_custom_fields').delete().eq('id', r.id)
      }
      // 新增 / 更新（sort_order 用顯示順序 index）
      for (let i = 0; i < visible.length; i++) {
        const r = visible[i]
        if (!r.name || !r.name.trim()) continue
        const payload = {
          name: r.name.trim(),
          value_type: r.effect !== 'none' ? 'number' : r.value_type,
          effect: r.effect,
          sort_order: i,
          is_active: true,
        }
        if (r._new) {
          await supabase.from('store_bonus_custom_fields').insert({ ...payload, organization_id: orgId })
        } else {
          await supabase.from('store_bonus_custom_fields').update(payload).eq('id', r.id)
        }
      }
      toast.success('已儲存自訂欄位，記得回表格按「重算」更新應發')
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const visible = rows.filter(r => !r._deleted)

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ padding: 20, width: 680, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>➕ 自訂欄位</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
          欄位會出現在員工獎金表（「前月補發」與「應發」之間）。效果設「加項/扣項」會直接進「應發」計算（限數字）。
        </p>
        {loading ? <div style={{ padding: 20 }}>載入中…</div> : (
          <div className="data-table-wrapper">
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr><th style={{ width: 36 }}>順序</th><th>欄位名稱</th><th>型別</th><th>效果</th><th style={{ width: 60 }}>操作</th></tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>尚無自訂欄位</td></tr>
                ) : visible.map((r, i) => (
                  <tr key={r.id ?? `new-${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11, marginLeft: 2 }} disabled={i === visible.length - 1} onClick={() => move(i, 1)}>↓</button>
                    </td>
                    <td>
                      <input className="form-input" style={{ width: '100%', padding: 4, fontSize: 13 }} placeholder="例：特別獎勵"
                        value={r.name} onChange={e => patchRow(rows.indexOf(r), { name: e.target.value })} />
                    </td>
                    <td>
                      <select className="form-input" style={{ padding: 4, fontSize: 12 }} value={r.value_type}
                        disabled={r.effect !== 'none'}
                        onChange={e => patchRow(rows.indexOf(r), { value_type: e.target.value })}>
                        <option value="number">數字</option>
                        <option value="text">文字</option>
                      </select>
                    </td>
                    <td>
                      <select className="form-input" style={{ padding: 4, fontSize: 12 }} value={r.effect}
                        onChange={e => patchRow(rows.indexOf(r), { effect: e.target.value })}>
                        <option value="none">{EFFECT_LABEL.none}</option>
                        <option value="add">{EFFECT_LABEL.add}</option>
                        <option value="deduct">{EFFECT_LABEL.deduct}</option>
                      </select>
                    </td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent-red)' }}
                        onClick={() => removeRow(rows.indexOf(r))}>刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={addRow}><Plus size={14} /> 新增欄位</button>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <AsyncButton className="btn btn-primary" onClick={handleSave} busyLabel="儲存中…" disabled={saving}>儲存</AsyncButton>
        </div>
      </div>
    </div>
  )
}
