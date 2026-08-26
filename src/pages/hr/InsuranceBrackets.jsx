import { useState, useEffect, useCallback, memo } from 'react'
import { Plus, Trash2, Save, Copy, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// 三張級距表設定:欄位/上限提示不同
const KINDS = {
  labor:   { table: 'labor_ins_brackets',    label: '勞保',  valueCol: 'insured_salary', premiums: true,  note: '投保上限 45,800（職災共用此表、上限 72,800）' },
  health:  { table: 'health_ins_brackets',   label: '健保',  valueCol: 'insured_salary', premiums: true,  note: '最高 313,000' },
  pension: { table: 'labor_pension_brackets', label: '勞退',  valueCol: 'monthly_wage',   premiums: false, note: '月提繳工資，最高 150,000' },
}
const inp = { width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }

// 單列 memo:只有被改的那列 row 物件變 → 只重繪該列,避免整張表(80+級)每打字重繪卡頓
const BracketRow = memo(function BracketRow({ r, i, valueCol, premiums, onCell, onDel }) {
  return (
    <tr>
      <td><input style={inp} type="number" value={r.grade ?? ''} onChange={e => onCell(i, 'grade', e.target.value)} /></td>
      <td><input style={inp} type="number" value={r.min_salary ?? ''} onChange={e => onCell(i, 'min_salary', e.target.value)} /></td>
      <td><input style={inp} type="number" value={r[valueCol] ?? ''} onChange={e => onCell(i, valueCol, e.target.value)} /></td>
      {premiums && <td><input style={inp} type="number" value={r.employee_premium ?? ''} onChange={e => onCell(i, 'employee_premium', e.target.value)} /></td>}
      {premiums && <td><input style={inp} type="number" value={r.employer_premium ?? ''} onChange={e => onCell(i, 'employer_premium', e.target.value)} /></td>}
      <td><button onClick={() => onDel(i)} title="刪除此級" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><Trash2 size={15} /></button></td>
    </tr>
  )
})

export default function InsuranceBrackets() {
  const [years, setYears] = useState([])
  const [year, setYear] = useState(null)
  const [kind, setKind] = useState('labor')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const cfg = KINDS[kind]

  const loadYears = async () => {
    const ys = new Set()
    for (const k of Object.values(KINDS)) {
      const { data } = await supabase.from(k.table).select('year')
      ;(data || []).forEach(r => ys.add(Number(r.year)))
    }
    const arr = [...ys].sort((a, b) => b - a)
    setYears(arr)
    if (year == null) setYear(arr[0] || new Date().getFullYear())
    return arr
  }

  const loadRows = async () => {
    if (year == null) return
    setLoading(true)
    const { data } = await supabase.from(cfg.table).select('*').eq('year', year).order('grade')
    setRows((data || []).map(r => ({ ...r })))
    setLoading(false)
  }

  useEffect(() => { loadYears().finally(() => setLoading(false)) }, [])
  useEffect(() => { loadRows() }, [year, kind])

  const setCell = useCallback((i, k, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r)), [])
  const delRow = useCallback((i) => setRows(rs => rs.filter((_, idx) => idx !== i)), [])
  const addRow = () => setRows(rs => [...rs, { year, grade: (rs.length ? Math.max(...rs.map(r => Number(r.grade) || 0)) + 1 : 1), min_salary: '', [cfg.valueCol]: '', employee_premium: '', employer_premium: '' }])

  const save = async () => {
    if (!rows.length) { toast.error('沒有資料可儲存'); return }
    setSaving(true)
    const payload = rows.map(r => {
      const base = { year, grade: Number(r.grade) || 0, min_salary: Number(r.min_salary) || 0, [cfg.valueCol]: Number(r[cfg.valueCol]) || 0 }
      if (cfg.premiums) { base.employee_premium = Number(r.employee_premium) || 0; base.employer_premium = Number(r.employer_premium) || 0 }
      return base
    })
    const { error: delErr } = await supabase.from(cfg.table).delete().eq('year', year)
    if (delErr) { toast.error('儲存失敗（刪除舊資料）：' + delErr.message); setSaving(false); return }
    const { error: insErr } = await supabase.from(cfg.table).insert(payload)
    setSaving(false)
    if (insErr) { toast.error('儲存失敗（寫入）：' + insErr.message + '，請再按一次儲存'); return }
    toast.success(`已儲存 ${year} 年 ${cfg.label} 級距（${payload.length} 級）`)
    loadRows()
  }

  const addYear = async () => {
    const y = window.prompt('要新增哪個年度？（西元，例：2027）')
    const ny = Number(y)
    if (!ny || ny < 2020 || ny > 2100) return
    if (years.includes(ny)) { toast.error(`${ny} 年度已存在`); return }
    const src = years[0]
    if (!(await confirm({ message: `以 ${src} 年為範本，建立 ${ny} 年度的勞保/健保/勞退級距？（建立後可再逐項調整）` }))) return
    setSaving(true)
    try {
      for (const k of Object.values(KINDS)) {
        const { data } = await supabase.from(k.table).select('*').eq('year', src).order('grade')
        const copy = (data || []).map(({ ...r }) => ({ ...r, year: ny }))
        // 移除可能的 id 欄(若有)
        copy.forEach(r => { delete r.id })
        if (copy.length) await supabase.from(k.table).insert(copy)
      }
      toast.success(`已建立 ${ny} 年度（複製自 ${src}），請逐項核對修改`)
      await loadYears()
      setYear(ny)
    } catch (e) { toast.error('建立年度失敗：' + (e.message || '')) } finally { setSaving(false) }
  }

  const nextYear = new Date().getFullYear() + 1
  const missingNext = years.length > 0 && !years.includes(nextYear)

  if (loading && !rows.length && year == null) return <LoadingSpinner />

  return (
    <div className="fade-in" style={{ padding: 4 }}>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>投保級距表</h2>
            <p>維護每年度的勞保 / 健保 / 勞退級距表；系統的帶入、下拉、計薪都自動吃「當年度」這張表</p>
          </div>
          <button className="btn btn-secondary" onClick={addYear} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Copy size={14} /> 新增年度
          </button>
        </div>
      </div>

      {missingNext && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', fontWeight: 600 }}>
          <AlertTriangle size={16} /> 尚未建立 {nextYear} 年度級距——跨年前請按「新增年度」建好，否則元旦後帶入/計薪會查不到當年度級距。
        </div>
      )}

      {/* 年度 + 險別 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={year ?? ''} onChange={e => setYear(Number(e.target.value))} style={{ ...inp, width: 'auto', fontWeight: 700 }}>
          {years.map(y => <option key={y} value={y}>{y} 年</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.entries(KINDS).map(([k, c]) => (
            <button key={k} onClick={() => setKind(k)}
              style={{ padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700,
                border: `1.5px solid ${kind === k ? 'var(--accent-cyan)' : 'var(--border)'}`,
                background: kind === k ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                color: kind === k ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>{c.label}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{cfg.note}</span>
        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Save size={14} /> {saving ? '儲存中…' : '儲存本年度' + cfg.label}
        </button>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: cfg.premiums ? 720 : 460 }}>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>級</th>
                  <th>實際工資下限</th>
                  <th>{kind === 'pension' ? '月提繳工資' : '投保薪資'}</th>
                  {cfg.premiums && <th>員工保費</th>}
                  {cfg.premiums && <th>雇主保費</th>}
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={cfg.premiums ? 6 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>此年度尚無資料，按下方「新增一級」或用「新增年度」複製</td></tr>}
                {rows.map((r, i) => (
                  <BracketRow key={i} r={r} i={i} valueCol={cfg.valueCol} premiums={cfg.premiums} onCell={setCell} onDel={delRow} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 12 }}>
            <button onClick={addRow} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'none', color: 'var(--accent-cyan)', cursor: 'pointer' }}>
              <Plus size={14} /> 新增一級
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
