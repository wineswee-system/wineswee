import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { X, Download, Search, Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// 年資文字（到 resign_date 或今天）
function seniorityText(join, resign) {
  if (!join) return ''
  const start = new Date(join)
  const end = resign ? new Date(resign) : new Date()
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (end.getDate() < start.getDate()) months--
  if (months < 0) months = 0
  return `${Math.floor(months / 12)}年${months % 12}個月`
}
const yn = (v) => v == null || v === '' ? '' : (v ? '是' : '否')

// 欄位分組（key = employees 欄位；get = 自訂取值）
const GROUPS = [
  { group: '基本資料', cols: [
    { key: 'birth_date', label: '生日' },
    { key: 'gender', label: '性別' },
    { key: 'name_en', label: '英文姓名' },
    { key: 'nationality', label: '國籍' },
    { key: 'marital_status', label: '婚姻狀況' },
    { key: 'ethnic_group', label: '身份族群' },
    { key: 'disability_type', label: '身心障礙類別' },
    { key: 'military_status', label: '兵役狀況' },
  ] },
  { group: '聯絡資料', cols: [
    { key: 'email', label: 'Email' },
    { key: 'personal_email', label: '個人 Email' },
    { key: 'phone', label: '手機' },
    { key: 'work_phone', label: '公司電話' },
    { key: 'address', label: '通訊地址' },
    { key: 'registered_address', label: '戶籍地址' },
    { key: 'emergency_name', label: '緊急聯絡人', get: e => e.emergency_contact_name || e.emergency_name || '' },
    { key: 'emergency_phone', label: '緊急聯絡電話', get: e => e.emergency_contact_phone || e.emergency_phone || '' },
  ] },
  { group: '職務', cols: [
    { key: 'status', label: '在職狀況' },
    { key: 'employment_type', label: '員工類型' },
    { key: 'dept', label: '部門', get: e => e.departments?.name || e.dept || '' },
    { key: 'store', label: '門市', get: e => e.stores?.name || e.store || '' },
    { key: 'join_date', label: '到職日期' },
    { key: 'resign_date', label: '離職日期' },
    { key: 'probation_end', label: '試用期滿', get: e => e.probation_end_date || e.probation_end || '' },
    { key: 'job_category', label: '職務類別' },
    { key: 'position', label: '職稱／職位' },
    { key: 'responsibility_type', label: '責任區分' },
    { key: 'is_direct_staff', label: '直接／間接', get: e => e.is_direct_staff == null ? '' : (e.is_direct_staff ? '直接' : '間接') },
    { key: 'staffing_status', label: '編制狀態' },
  ] },
  { group: '年資', cols: [
    { key: '_seniority', label: '年資', get: e => seniorityText(e.join_date, e.resign_date) },
  ] },
]
const SENSITIVE = { group: '機敏資料', cols: [
  { key: 'id_number', label: '身分證字號' },
  { key: 'base_salary', label: '本薪' },
  { key: 'bank_code', label: '銀行代碼' },
  { key: 'bank_account', label: '銀行帳號' },
] }

// 預設勾選(對齊 104 常用)
const DEFAULT_COLS = new Set(['birth_date', 'name_en', 'email', 'phone', 'status', 'employment_type', 'dept', 'store', 'join_date', 'position', 'job_category', '_seniority'])

export default function EmployeeExportModal({ open, onClose, employees = [], orgId, allowSensitive = false }) {
  const groups = useMemo(() => allowSensitive ? [...GROUPS, SENSITIVE] : GROUPS, [allowSensitive])
  const [cols, setCols] = useState(() => new Set(DEFAULT_COLS))
  const [empIds, setEmpIds] = useState(() => new Set(employees.map(e => e.id)))
  const [empSearch, setEmpSearch] = useState('')
  const [exporting, setExporting] = useState(false)

  const shownEmps = employees.filter(e => {
    if (!empSearch.trim()) return true
    const q = empSearch.trim().toLowerCase()
    return [e.name, e.name_en, e.employee_number, e.email].some(f => (f || '').toLowerCase().includes(q))
  })

  if (!open) return null

  const toggleCol = (k) => setCols(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleGroup = (g) => setCols(prev => {
    const n = new Set(prev)
    const allOn = g.cols.every(c => n.has(c.key))
    g.cols.forEach(c => allOn ? n.delete(c.key) : n.add(c.key))
    return n
  })
  const toggleEmp = (id) => setEmpIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allEmpShown = shownEmps.length > 0 && shownEmps.every(e => empIds.has(e.id))
  const toggleAllShown = () => setEmpIds(prev => {
    const n = new Set(prev)
    shownEmps.forEach(e => allEmpShown ? n.delete(e.id) : n.add(e.id))
    return n
  })

  const doExport = async () => {
    const ids = [...empIds]
    if (ids.length === 0) return toast.warning('請至少選一位同仁')
    const selectedCols = groups.flatMap(g => g.cols).filter(c => cols.has(c.key))
    if (selectedCols.length === 0) return toast.warning('請至少選一個匯出欄位')

    setExporting(true)
    try {
      // 撈完整資料(列表是輕量查詢,缺生日/身分證等)
      let q = supabase.from('employees')
        .select('*, departments!department_id(name), stores!store_id(name)')
        .in('id', ids).order('id')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data: full, error } = await q
      if (error) throw error

      const rows = (full || []).map(e => {
        const row = { 員工編號: e.employee_number || '', 姓名: e.name || '' }
        for (const c of selectedCols) row[c.label] = c.get ? c.get(e) : (e[c.key] ?? '')
        return row
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '員工資料')
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      XLSX.writeFile(wb, `員工資料_${stamp}.xlsx`)
      toast.success(`已匯出 ${rows.length} 位同仁`)
      onClose?.()
    } catch (err) {
      toast.error('匯出失敗：' + (err?.message || '未知錯誤'))
    } finally {
      setExporting(false)
    }
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div style={{ width: '100%', maxWidth: 760, maxHeight: '86vh', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>📤 匯出員工資料</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>選欄位、選同仁 → 匯出 Excel（.xlsx）。姓名／員編一律包含。</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16 }}>
          {/* 欄位 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 8 }}>匯出欄位</div>
            {groups.map(g => (
              <div key={g.group} style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="checkbox" checked={g.cols.every(c => cols.has(c.key))} onChange={() => toggleGroup(g)} />
                  {g.group}{g.group === '機敏資料' && <span style={{ fontSize: 10, color: 'var(--accent-red)', fontWeight: 600 }}>（含身分證／薪資，請留意）</span>}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {g.cols.map(c => (
                    <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={cols.has(c.key)} onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 同仁 */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>匯出同仁（{empIds.size}）</span>
              <button onClick={toggleAllShown} style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {allEmpShown ? '取消全選' : '全選'}
              </button>
            </div>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="搜尋姓名／員編"
                style={{ width: '100%', padding: '6px 8px 6px 26px', borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-card)', maxHeight: '46vh' }}>
              {shownEmps.map(e => (
                <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}>
                  <input type="checkbox" checked={empIds.has(e.id)} onChange={() => toggleEmp(e.id)} />
                  <span style={{ fontWeight: 600 }}>{e.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>{e.employee_number || ''}</span>
                  {e.status === '離職' && <span style={{ fontSize: 10, color: 'var(--accent-red)' }}>離職</span>}
                </label>
              ))}
              {shownEmps.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>查無同仁</div>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={doExport} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {exporting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 匯出中…</> : <><Download size={14} /> 匯出 Excel（{empIds.size} 人）</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
