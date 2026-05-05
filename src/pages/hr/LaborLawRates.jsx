import { useState, useEffect } from 'react'
import { Info, Upload, Download, Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  )
}

function StaticRow({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-subtle)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: accent || 'var(--accent-cyan)' }}>{value}</span>
    </div>
  )
}

function PremiumTable({ brackets }) {
  if (!brackets.length) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      此年度尚無級距資料，按上方「匯入新年度級距」匯入。
    </div>
  )
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>級距</th>
            <th>投保薪資</th>
            <th>月薪下限</th>
            <th>員工負擔</th>
            <th>雇主負擔</th>
          </tr>
        </thead>
        <tbody>
          {brackets.map((b) => (
            <tr key={`${b.year}-${b.grade}`}>
              <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{b.grade}</td>
              <td style={{ fontWeight: 600 }}>NT$ {Number(b.insured_salary).toLocaleString()}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {b.min_salary ? `NT$ ${Number(b.min_salary).toLocaleString()}` : '—'}
              </td>
              <td>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  NT$ {Number(b.employee_premium).toLocaleString()}
                </span>
              </td>
              <td>
                <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                  NT$ {Number(b.employer_premium).toLocaleString()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CSV_HEADER = 'grade,insured_salary,min_salary,employee_premium,employer_premium'

const SAMPLE_CSV = `${CSV_HEADER}
1,27470,0,714,2500
2,28800,27471,749,2621
3,30300,28801,788,2757`

export default function LaborLawRates() {
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin'].includes(role?.name || profile?.role)
  const [year, setYear] = useState(new Date().getFullYear())
  const [laborBrackets, setLaborBrackets] = useState([])
  const [healthBrackets, setHealthBrackets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [importModal, setImportModal] = useState(null) // { table: 'labor_ins_brackets' | 'health_ins_brackets' }

  const fetchRates = async () => {
    try {
      setLoading(true)
      const [laborRes, healthRes] = await Promise.all([
        supabase.from('labor_ins_brackets').select('*').eq('year', year).order('grade'),
        supabase.from('health_ins_brackets').select('*').eq('year', year).order('grade'),
      ])
      if (laborRes.error) throw laborRes.error
      if (healthRes.error) throw healthRes.error
      setLaborBrackets(laborRes.data || [])
      setHealthBrackets(healthRes.data || [])
    } catch (err) {
      console.error('Failed to load labor law rates:', err)
      setError('費率資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { fetchRates() }, [year])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const yearOptions = []
  const ny = new Date().getFullYear()
  for (let y = ny - 3; y <= ny + 2; y++) yearOptions.push(y)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>勞動法令費率管理</h2>
            <p>勞健保、基本工資、勞退提繳等法定費率</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
            <select className="form-input" style={{ width: 110, fontSize: 13 }} value={year} onChange={e => setYear(Number(e.target.value))}>
              {yearOptions.map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '12px 16px', background: 'var(--accent-blue-dim)',
        border: '1px solid var(--border-subtle)', borderRadius: 10,
        marginBottom: 20, fontSize: 13, color: 'var(--text-secondary)',
      }}>
        <Info size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 1 }} />
        <div>
          每年 12/1 系統會自動發送提醒，請至此頁面檢查並匯入隔年級距。
          {isAdmin && <> 範本：<a href="data:text/csv;charset=utf-8,grade%2Cinsured_salary%2Cmin_salary%2Cemployee_premium%2Cemployer_premium%0A1%2C27470%2C0%2C714%2C2500" download="labor_brackets_template.csv" style={{ color: 'var(--accent-cyan)' }}>下載 CSV 範本</a></>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <SectionHeader title="基本工資" subtitle={`${year} 年度適用`} />
          <StaticRow label="月薪基本工資" value="NT$ 29,500" />
          <StaticRow label="時薪基本工資" value="NT$ 196" />
          <StaticRow label="生效日" value={`${year}-01-01`} accent="var(--text-secondary)" />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>※ 基本工資目前手動維護，未來可加 minimum_wage_history 表</div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <SectionHeader title="勞退提繳率" subtitle="勞工退休金條例第14條" />
          <StaticRow label="雇主最低提繳率" value="6%" />
          <StaticRow label="員工可自願提繳" value="0% – 6%" accent="var(--text-secondary)" />
          <div style={{
            marginTop: 12, padding: 10, background: 'var(--bg-secondary)',
            borderRadius: 8, fontSize: 12, color: 'var(--text-muted)',
          }}>
            員工自願提繳享所得稅優惠，上限月工資 6%。
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <SectionHeader title="二代健保補充保費" subtitle="全民健康保險法第31條" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>費率</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent-cyan)' }}>2.11%</div>
          </div>
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>起徵門檻</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent-orange)' }}>單次 NT$ 2,000 以上</div>
          </div>
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>法源</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>全民健保法 §31</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">勞保費率 — 投保薪資級距（{year} 年）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{laborBrackets.length} 筆</span>
            {isAdmin && (
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11 }}
                onClick={() => setImportModal({ table: 'labor_ins_brackets', label: '勞保費率', current: laborBrackets })}>
                <Upload size={11} /> 匯入新年度
              </button>
            )}
          </div>
        </div>
        <PremiumTable brackets={laborBrackets} />
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">健保費率 — 投保薪資級距（{year} 年）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{healthBrackets.length} 筆</span>
            {isAdmin && (
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11 }}
                onClick={() => setImportModal({ table: 'health_ins_brackets', label: '健保費率', current: healthBrackets })}>
                <Upload size={11} /> 匯入新年度
              </button>
            )}
          </div>
        </div>
        <PremiumTable brackets={healthBrackets} />
      </div>

      {importModal && (
        <ImportModal
          modal={importModal}
          year={year}
          onClose={() => setImportModal(null)}
          onApplied={() => { setImportModal(null); fetchRates() }}
        />
      )}
    </div>
  )
}

function ImportModal({ modal, year, onClose, onApplied }) {
  const [csvText, setCsvText] = useState(SAMPLE_CSV)
  const [targetYear, setTargetYear] = useState(year)
  const [parsed, setParsed] = useState(null) // [{ grade, insured_salary, ...}]
  const [diff, setDiff] = useState(null) // { added: [], updated: [], removed: [] }
  const [applying, setApplying] = useState(false)

  const parse = () => {
    try {
      const lines = csvText.trim().split(/\r?\n/).filter(Boolean)
      const headerLine = lines[0].toLowerCase()
      const cols = headerLine.split(',').map(s => s.trim())
      const required = ['grade', 'insured_salary', 'min_salary', 'employee_premium', 'employer_premium']
      for (const r of required) {
        if (!cols.includes(r)) throw new Error(`缺欄位：${r}（min_salary 為必填，影響薪資計算 RPC 的級距查找）`)
      }
      const rows = []
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(s => s.trim())
        const r = {}
        cols.forEach((c, idx) => { r[c] = cells[idx] })
        if (!r.grade) continue
        if (r.min_salary === '' || r.min_salary == null) {
          throw new Error(`級距 ${r.grade} 缺 min_salary（必填，否則薪資計算會抓錯級距）`)
        }
        rows.push({
          year: targetYear,
          grade: parseInt(r.grade),
          insured_salary: Number(r.insured_salary),
          min_salary: Number(r.min_salary),
          employee_premium: Number(r.employee_premium),
          employer_premium: Number(r.employer_premium),
        })
      }
      if (rows.length === 0) throw new Error('沒有任何資料列')
      setParsed(rows)
      computeDiff(rows)
    } catch (err) {
      alert('解析失敗：' + err.message)
      setParsed(null)
      setDiff(null)
    }
  }

  const computeDiff = async (newRows) => {
    const { data: existing } = await supabase
      .from(modal.table)
      .select('*')
      .eq('year', targetYear)
      .order('grade')
    const existingByGrade = Object.fromEntries((existing || []).map(r => [r.grade, r]))
    const newByGrade = Object.fromEntries(newRows.map(r => [r.grade, r]))
    const added = newRows.filter(r => !existingByGrade[r.grade])
    const removed = (existing || []).filter(r => !newByGrade[r.grade])
    const updated = []
    for (const r of newRows) {
      const old = existingByGrade[r.grade]
      if (!old) continue
      if (Number(old.insured_salary) !== r.insured_salary
        || Number(old.employee_premium) !== r.employee_premium
        || Number(old.employer_premium) !== r.employer_premium) {
        updated.push({ old, new: r })
      }
    }
    setDiff({ added, updated, removed })
  }

  const apply = async () => {
    if (!parsed) return alert('請先解析')
    if (!confirm(`確定套用？這會：\n- INSERT ${diff.added.length} 筆新級距\n- UPDATE ${diff.updated.length} 筆異動\n- DELETE ${diff.removed.length} 筆移除\n至 ${targetYear} 年`)) return
    setApplying(true)
    try {
      // 用 upsert 一次處理 added + updated
      for (const r of parsed) {
        const { error } = await supabase.from(modal.table).upsert(r, { onConflict: 'year,grade' })
        if (error) throw error
      }
      // delete removed
      for (const r of diff.removed) {
        await supabase.from(modal.table).delete().eq('year', targetYear).eq('grade', r.grade)
      }
      alert('套用完成')
      onApplied()
    } catch (err) {
      alert('套用失敗：' + (err.message || '未知錯誤'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal title={`匯入 ${modal.label} — ${targetYear} 年`} onClose={onClose} onSubmit={parsed ? apply : parse} submitLabel={parsed ? (applying ? '套用中…' : '✓ 確認套用') : '解析 CSV'} maxWidth={900}>
      <Field label="目標年度">
        <input className="form-input" type="number" value={targetYear} onChange={e => { setTargetYear(Number(e.target.value)); setParsed(null); setDiff(null) }} />
      </Field>
      <Field label={`CSV 內容（標頭：${CSV_HEADER}）`}>
        <textarea className="form-input" rows={12} style={{ fontFamily: 'monospace', fontSize: 12 }}
          value={csvText} onChange={e => { setCsvText(e.target.value); setParsed(null); setDiff(null) }} />
      </Field>
      {diff && (
        <div style={{ background: 'var(--glass-light)', padding: 14, borderRadius: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>📊 變更比對</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 10 }}>
            <span style={{ color: 'var(--accent-green)' }}>新增 {diff.added.length}</span>
            <span style={{ color: 'var(--accent-orange)' }}>異動 {diff.updated.length}</span>
            <span style={{ color: 'var(--accent-red)' }}>移除 {diff.removed.length}</span>
          </div>
          {diff.updated.slice(0, 5).map((d, i) => (
            <div key={i} style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px dashed var(--border-subtle)' }}>
              級距 {d.new.grade}：員工 {Number(d.old.employee_premium)} → <b style={{ color: 'var(--accent-orange)' }}>{d.new.employee_premium}</b>
              　雇主 {Number(d.old.employer_premium)} → <b style={{ color: 'var(--accent-orange)' }}>{d.new.employer_premium}</b>
            </div>
          ))}
          {diff.updated.length > 5 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>… 還有 {diff.updated.length - 5} 筆異動</div>}
          {diff.added.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent-green)' }}>
              新增級距：{diff.added.slice(0, 8).map(a => a.grade).join(', ')}
            </div>
          )}
          {diff.removed.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>
              將移除級距：{diff.removed.slice(0, 8).map(a => a.grade).join(', ')}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
