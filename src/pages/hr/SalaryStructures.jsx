import { useState, useEffect, useMemo } from 'react'
import { Plus, Edit2, DollarSign, Users, X, Download } from 'lucide-react'
// xlsx 改為動態 import（見 handleExport）— 避免打進主 bundle
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { useAuth } from '../../contexts/AuthContext'

import { toast } from '../../lib/toast'
import { fmtNT as fmt } from '../../lib/currency'

// 內建常見津貼項目，廠商可一鍵加入；也支援完全自訂
const PRESET_ALLOWANCES = [
  '夜班津貼', '主管加給', '證照津貼', '外語津貼',
  '專業加給', '危險津貼', '久任津貼', '油資補貼',
  '通訊費補助', '託兒津貼', '房屋津貼', '績效獎金',
]

const EMPLOYMENT_CATEGORY_LABELS = {
  regular:  '正職門市',
  admin:    '行政',
  parttime: '兼職',
  piece:    '計件',
}
const EMPLOYMENT_CATEGORY_COLORS = {
  regular:  { bg: 'var(--accent-cyan-dim)',   fg: 'var(--accent-cyan)' },
  admin:    { bg: 'var(--accent-purple-dim)', fg: 'var(--accent-purple)' },
  parttime: { bg: 'var(--accent-blue-dim)',   fg: 'var(--accent-blue)' },
  piece:    { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' },
}

const emptyForm = {
  employee_id: '',
  base_salary: '',           // 本薪（合約名義）
  base_insured: '',          // 申報底薪（投保用）— 雙基薪制
  role_allowance: '',        // 職務津貼
  supervisor_allowance: '',  // 主管加給
  meal_allowance: '',
  transport_allowance: '',
  night_shift_allowance: '', // 夜班津貼
  cross_store_allowance: '', // 跨區津貼
  attendance_bonus: '',
  employment_category: 'regular',
  salary_type: 'monthly',
  hourly_rate: '',
  piece_rate: '',
  current_piece_count: '',
  health_ins_dependents: '0',
  insurance_grade_id: '',    // 投保級距 (預留 fk)
  effective_from: new Date().toISOString().slice(0, 10),
  year_end_bonus_months: '',
  notes: '',
  custom_allowances: [],     // [{name, amount}]
}

export default function SalaryStructures() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [structures, setStructures] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')  // active=在職(非離職) / resigned=離職 / all=全部
  const [exporting, setExporting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const loadData = () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('salary_structures').select('*').eq('organization_id', orgId).order('id', { ascending: false }),
      // 載入「全部狀態」員工 → 離職者的薪資結構也看得到名字、可篩在職/離職（下拉仍只給在職）
      supabase.from('employees').select('id, name, name_en, employee_number, status, resign_date, dept, store, position, department_id, store_id, departments!department_id(name), stores!store_id(name)').eq('organization_id', orgId).order('name'),
      supabase.from('departments').select('*').eq('organization_id', orgId).order('name'),
    ]).then(([s, e, d]) => {
      setStructures(s.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const empMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const filtered = useMemo(() => {
    return structures.filter(s => {
      const emp = empMap[s.employee_id]
      if (deptFilter && !(emp && emp.dept === deptFilter)) return false
      if (statusFilter === 'active'   && !(emp && emp.status !== '離職')) return false
      if (statusFilter === 'resigned' && !(emp && emp.status === '離職')) return false
      return true
    })
  }, [structures, deptFilter, statusFilter, empMap])

  // Summary cards
  const totalConfigured = new Set(structures.map(s => s.employee_id)).size
  const avgBase = structures.length > 0
    ? Math.round(structures.reduce((sum, s) => sum + (s.base_salary || 0), 0) / structures.length)
    : 0

  // 整理畫面:0/空 → 淡色「—」(不再滿版 NT$ 0);有值才顯示金額,讓真的有津貼的跳出來
  const money = (v, muted = false) => {
    const n = Number(v) || 0
    if (n <= 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>
    return muted ? <span style={{ color: 'var(--text-muted)' }}>{fmt(n)}</span> : fmt(n)
  }
  const anyPos = (...vals) => vals.some(v => (Number(v) || 0) > 0)

  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (s) => {
    setEditingId(s.id)
    setForm({
      employee_id: String(s.employee_id || ''),
      base_salary: String(s.base_salary || ''),
      base_insured: String(s.base_insured || ''),
      role_allowance: String(s.role_allowance || ''),
      supervisor_allowance: String(s.supervisor_allowance || ''),
      meal_allowance: String(s.meal_allowance || ''),
      transport_allowance: String(s.transport_allowance || ''),
      night_shift_allowance: String(s.night_shift_allowance || ''),
      cross_store_allowance: String(s.cross_store_allowance || ''),
      attendance_bonus: String(s.attendance_bonus || ''),
      employment_category: s.employment_category || 'regular',
      salary_type: s.salary_type || 'monthly',
      hourly_rate: String(s.hourly_rate || ''),
      piece_rate: String(s.piece_rate || ''),
      current_piece_count: String(s.current_piece_count || ''),
      health_ins_dependents: String(s.health_ins_dependents || 0),
      insurance_grade_id: String(s.insurance_grade_id || ''),
      effective_from: s.effective_from || new Date().toISOString().slice(0, 10),
      year_end_bonus_months: String(s.year_end_bonus_months || ''),
      notes: s.notes || '',
      custom_allowances: Array.isArray(s.custom_allowances) ? s.custom_allowances : [],
    })
    setShowModal(true)
  }

  // 自訂津貼操作
  const addCustomAllowance = (preset) => {
    const name = preset || ''
    setForm(f => ({
      ...f,
      custom_allowances: [...(f.custom_allowances || []), { name, amount: 0 }],
    }))
  }
  const updateCustomAllowance = (idx, key, val) => {
    setForm(f => ({
      ...f,
      custom_allowances: f.custom_allowances.map((c, i) => i === idx ? { ...c, [key]: val } : c),
    }))
  }
  const removeCustomAllowance = (idx) => {
    setForm(f => ({
      ...f,
      custom_allowances: f.custom_allowances.filter((_, i) => i !== idx),
    }))
  }

  const handleSubmit = async () => {
    if (!form.employee_id) return toast.warning('請選擇員工')
    const payload = {
      employee_id: Number(form.employee_id),
      organization_id: orgId,
      base_salary: Number(form.base_salary) || 0,
      // base_insured 留空 → NULL，讓 Salary.jsx 自動算 min(本薪+所有津貼, 45,800)
      // 只有當 admin 確實想覆寫時才填值
      base_insured: form.base_insured && String(form.base_insured).trim() !== '' ? Number(form.base_insured) : null,
      role_allowance: Number(form.role_allowance) || 0,
      supervisor_allowance: Number(form.supervisor_allowance) || 0,
      meal_allowance: Number(form.meal_allowance) || 0,
      transport_allowance: Number(form.transport_allowance) || 0,
      night_shift_allowance: Number(form.night_shift_allowance) || 0,
      cross_store_allowance: Number(form.cross_store_allowance) || 0,
      attendance_bonus: Number(form.attendance_bonus) || 0,
      employment_category: form.employment_category || 'regular',
      salary_type: form.employment_category === 'parttime' ? 'hourly' : 'monthly',
      hourly_rate: form.employment_category === 'parttime' ? (Number(form.hourly_rate) || 0) : 0,
      piece_rate: Number(form.piece_rate) || 0,
      current_piece_count: Number(form.current_piece_count) || 0,
      health_ins_dependents: Number(form.health_ins_dependents) || 0,
      insurance_grade_id: form.insurance_grade_id ? Number(form.insurance_grade_id) : null,
      effective_from: form.effective_from,
      year_end_bonus_months: Number(form.year_end_bonus_months) || 0,
      notes: form.notes || '',
      custom_allowances: (form.custom_allowances || [])
        .filter(c => c.name && c.name.trim())
        .map(c => ({ name: c.name.trim(), amount: Number(c.amount) || 0 })),
    }
    try {
      if (editingId) {
        const { data, error } = await supabase.from('salary_structures').update(payload).eq('id', editingId).select().single()
        if (error) throw error
        setStructures(prev => prev.map(s => s.id === editingId ? data : s))
      } else {
        const { data, error } = await supabase.from('salary_structures').insert(payload).select().single()
        if (error) throw error
        setStructures(prev => [data, ...prev])
      }
      setShowModal(false)
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 匯出薪資架構 + 匯款帳戶（Excel）— 依目前篩選(部門/在職狀態)匯出
  const handleExport = async () => {
    setExporting(true)
    try {
      // 銀行帳號在 RLS 鎖 admin 的表，走 SECURITY DEFINER RPC 撈
      const { data: banks, error: bErr } = await supabase.rpc('list_employee_bank_accounts', { p_org: orgId })
      if (bErr) throw bErr
      const bankMap = {}
      ;(Array.isArray(banks) ? banks : []).forEach(b => { bankMap[b.employee_id] = b })
      const catLabel = (s) => {
        const cat = s.employment_category || (s.salary_type === 'hourly' ? 'parttime' : 'regular')
        return EMPLOYMENT_CATEGORY_LABELS[cat] || cat
      }
      const rows = filtered.map(s => {
        const emp = empMap[s.employee_id] || {}
        const bank = bankMap[s.employee_id] || {}
        const custom = Array.isArray(s.custom_allowances)
          ? s.custom_allowances.map(c => `${c.name}:${Number(c.amount) || 0}`).join('、') : ''
        return {
          '員工編號': emp.employee_number || '',
          '姓名': emp.name || `#${s.employee_id}`,
          '在職狀態': emp.status || '',
          '離職日': emp.resign_date || '',
          '部門': emp.dept || '',
          '門市': emp.store || '',
          '員工分類': catLabel(s),
          '本薪': Number(s.base_salary) || 0,
          '申報底薪': s.base_insured != null ? Number(s.base_insured) : '',
          '時薪': Number(s.hourly_rate) || 0,
          '件單價': Number(s.piece_rate) || 0,
          '本月件數': Number(s.current_piece_count) || 0,
          '主管加給': Number(s.supervisor_allowance) || 0,
          '夜班津貼': Number(s.night_shift_allowance) || 0,
          '跨區津貼': Number(s.cross_store_allowance) || 0,
          '餐費津貼': Number(s.meal_allowance) || 0,
          '交通津貼': Number(s.transport_allowance) || 0,
          '全勤獎金': Number(s.attendance_bonus) || 0,
          '其他自訂津貼': custom,
          // 銀行代號/帳號維持文字，避免 Excel 變科學記號或吃掉開頭 0
          '銀行代號': String(bank.bank_code || ''),
          '銀行': bank.bank_name || '',
          '分行': bank.bank_branch || '',
          '帳號': String(bank.bank_account || ''),
          '戶名': bank.account_holder || '',
          '生效日': s.effective_from || '',
          '備註': s.notes || '',
        }
      })
      if (rows.length === 0) { toast.warning('目前篩選沒有資料可匯出'); return }
      const XLSX = await import('xlsx') // lazy-load：按下匯出才下載 xlsx
      const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0]) })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '薪資架構')
      const tag = statusFilter === 'active' ? '在職' : statusFilter === 'resigned' ? '離職' : '全部'
      XLSX.writeFile(wb, `薪資架構與匯款帳戶_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`)
      toast.success(`已匯出 ${rows.length} 筆`)
    } catch (err) {
      console.error('Export failed:', err)
      toast.error('匯出失敗：' + (err.message || '未知錯誤'))
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>⚠ {error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>薪資結構管理</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>設定員工底薪、津貼及薪資類型</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExport} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={16} /> {exporting ? '匯出中…' : '匯出 Excel'}
            </button>
            <button className="btn btn-primary" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} /> 新增薪資結構
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Users size={18} style={{ color: 'var(--accent-cyan)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>已設定員工數</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{totalConfigured}</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <DollarSign size={18} style={{ color: 'var(--accent-green)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>平均底薪</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(avgBase)}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>部門篩選：</label>
        <select className="form-input" value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
        <label style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>在職狀態：</label>
        <select className="form-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 140 }}>
          <option value="active">在職</option>
          <option value="resigned">離職</option>
          <option value="all">全部</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>共 {filtered.length} 筆</span>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
                {['員工', '狀態', '部門', '門市', '薪資類型', '本薪 / 投保', '主管/夜班/跨區', '餐費/交通', '全勤', '其他津貼', '生效日', '操作'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>尚無薪資結構資料</td></tr>
              ) : filtered.map(s => {
                const emp = empMap[s.employee_id]
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{emp?.name || `#${s.employee_id}`}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {(() => {
                        const st = emp?.status || '—'
                        const isResigned = st === '離職'
                        const c = isResigned
                          ? { bg: 'var(--accent-red-dim)', fg: 'var(--accent-red)' }
                          : st === '試用'
                            ? { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' }
                            : { bg: 'var(--accent-green-dim)', fg: 'var(--accent-green)' }
                        return (
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
                            {st}{isResigned && emp?.resign_date ? ` ${emp.resign_date.slice(5)}` : ''}
                          </span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{emp?.dept || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>{emp?.store || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {(() => {
                        const cat = s.employment_category || (s.salary_type === 'hourly' ? 'parttime' : 'regular')
                        const c = EMPLOYMENT_CATEGORY_COLORS[cat] || EMPLOYMENT_CATEGORY_COLORS.regular
                        return (
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg }}>
                            {EMPLOYMENT_CATEGORY_LABELS[cat] || cat}
                          </span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.3 }}>
                      {Number(s.base_salary) > 0 ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{fmt(s.base_salary)}</div>
                          <div style={{ color: 'var(--text-muted)' }}>投保 {fmt(s.base_insured || s.base_salary)}</div>
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.3 }}>
                      {anyPos(s.supervisor_allowance, s.night_shift_allowance, s.cross_store_allowance) ? (
                        <>
                          <div>{money(s.supervisor_allowance)}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{money(s.night_shift_allowance, true)} / {money(s.cross_store_allowance, true)}</div>
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.3 }}>
                      {anyPos(s.meal_allowance, s.transport_allowance) ? (
                        <>
                          <div>{money(s.meal_allowance)}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{money(s.transport_allowance, true)}</div>
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{money(s.attendance_bonus)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {Array.isArray(s.custom_allowances) && s.custom_allowances.length > 0 ? (
                        <div title={s.custom_allowances.map(c => `${c.name}: ${fmt(c.amount)}`).join('\n')}>
                          {fmt(s.custom_allowances.reduce((sum, c) => sum + (Number(c.amount) || 0), 0))}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                            ({s.custom_allowances.length} 項)
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{s.effective_from || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => openEdit(s)} style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', padding: 4 }}>
                        <Edit2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯薪資結構' : '新增薪資結構'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工">
            <SearchableSelect
              value={form.employee_id}
              onChange={(v) => set('employee_id', v || '')}
              options={empOptions(employees)}
              placeholder="搜尋員工姓名/部門/門市..."
              disabled={!!editingId}
            />
          </Field>
          <Field label="員工分類">
            <select className="form-input" value={form.employment_category || 'regular'}
              onChange={e => {
                const cat = e.target.value
                set('employment_category', cat)
                if (cat === 'piece' && !form.piece_rate) set('piece_rate', '2000')
              }}>
              <option value="regular">正職（門市，加班 1.34/1.67 階梯）</option>
              <option value="admin">行政（月薪含 OT）</option>
              <option value="parttime">兼職（時薪制，投保 PT 級距）</option>
              <option value="piece">計件（月薪 = 件數 × 單價，不算加班）</option>
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {form.employment_category === 'piece' ? (
              <>
                <Field label="每件單價 (NT$)">
                  <input className="form-input" type="number" value={form.piece_rate} onChange={e => set('piece_rate', e.target.value)} placeholder="2000" />
                </Field>
                <Field label="本月件數">
                  <input className="form-input" type="number" value={form.current_piece_count} onChange={e => set('current_piece_count', e.target.value)} placeholder="0" />
                  {Number(form.current_piece_count) > 0 && Number(form.piece_rate) > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--accent-cyan)', marginTop: 2 }}>
                      預估月薪：NT$ {(Number(form.current_piece_count) * Number(form.piece_rate)).toLocaleString()}
                    </div>
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label="本薪 (合約名義)">
                  <input className="form-input" type="number" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} placeholder="0" />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>合約上的薪資</div>
                </Field>
                <Field label="申報底薪 (投保用)">
                  <input className="form-input" type="number" value={form.base_insured} onChange={e => set('base_insured', e.target.value)} placeholder="留空＝自動 min(本薪+津貼, 45,800)" />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>勞健保 / 勞退提撥基準</div>
                </Field>
              </>
            )}
            {form.employment_category === 'parttime' && (
              <Field label="時薪">
                <input className="form-input" type="number" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} placeholder="0" />
              </Field>
            )}
            <Field label="主管加給">
              <input className="form-input" type="number" value={form.supervisor_allowance} onChange={e => set('supervisor_allowance', e.target.value)} placeholder="0" />
            </Field>
            {/* 職務津貼欄位 2026-05-13 移除（Plan A）— DB column role_allowance 保留向下相容，
                Salary.jsx 仍 fallback 讀（老資料用），新資料只走 supervisor_allowance */}
            <Field label="夜班津貼">
              <input className="form-input" type="number" value={form.night_shift_allowance} onChange={e => set('night_shift_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="跨區津貼">
              <input className="form-input" type="number" value={form.cross_store_allowance} onChange={e => set('cross_store_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="餐費津貼">
              <input className="form-input" type="number" value={form.meal_allowance} onChange={e => set('meal_allowance', e.target.value)} placeholder="0" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>NT$ 3,000 以下免稅</div>
            </Field>
            <Field label="交通津貼">
              <input className="form-input" type="number" value={form.transport_allowance} onChange={e => set('transport_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="全勤獎金">
              <input className="form-input" type="number" value={form.attendance_bonus} onChange={e => set('attendance_bonus', e.target.value)} placeholder="0" />
            </Field>
            <Field label="健保眷屬人數">
              <input className="form-input" type="number" value={form.health_ins_dependents} onChange={e => set('health_ins_dependents', e.target.value)} min="0" />
            </Field>
            <Field label="投保級距 ID (選填)">
              <input className="form-input" type="number" value={form.insurance_grade_id} onChange={e => set('insurance_grade_id', e.target.value)} placeholder="—" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>之後接 insurance_grades 表</div>
            </Field>
            <Field label="年終獎金月數">
              <input className="form-input" type="number" value={form.year_end_bonus_months} onChange={e => set('year_end_bonus_months', e.target.value)} placeholder="0" step="0.5" />
            </Field>
          </div>
          <Field label="生效日">
            <input className="form-input" type="date" value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
          </Field>

          {/* ─── 自訂津貼 ─── */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                其他自訂津貼
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {(form.custom_allowances || []).length} 項
              </span>
            </div>

            {/* 預設快選 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {PRESET_ALLOWANCES.map(name => {
                const used = (form.custom_allowances || []).some(c => c.name === name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => !used && addCustomAllowance(name)}
                    disabled={used}
                    style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: used ? 'default' : 'pointer',
                      border: '1px solid var(--border-subtle)',
                      background: used ? 'var(--bg-tertiary)' : 'transparent',
                      color: used ? 'var(--text-muted)' : 'var(--accent-cyan)',
                      opacity: used ? 0.5 : 1,
                    }}
                  >
                    {used ? '✓ ' : '+ '}{name}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => addCustomAllowance('')}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                  border: '1px dashed var(--accent-purple)',
                  background: 'rgba(167,139,250,0.08)', color: 'var(--accent-purple)',
                }}
              >+ 完全自訂</button>
            </div>

            {/* 已加入的津貼列表 */}
            {(form.custom_allowances || []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {form.custom_allowances.map((c, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      className="form-input"
                      placeholder="津貼名稱"
                      value={c.name}
                      onChange={e => updateCustomAllowance(idx, 'name', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="金額"
                      value={c.amount}
                      onChange={e => updateCustomAllowance(idx, 'amount', e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeCustomAllowance(idx)}
                      style={{
                        background: 'transparent', border: '1px solid var(--border-subtle)',
                        color: 'var(--accent-red)', cursor: 'pointer',
                        borderRadius: 6, padding: 6, display: 'flex',
                      }}
                    ><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Field label="備註">
            <textarea className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="備註說明..." />
          </Field>
        </Modal>
      )}
    </div>
  )
}
