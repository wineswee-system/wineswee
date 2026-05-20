import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { Download, Upload, Calendar, FileUp, CheckCircle, AlertCircle } from 'lucide-react'

function downloadCsv(filename, headers, rows) {
  const bom = '﻿'
  const escape = cell => {
    const s = cell == null ? '' : String(cell)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(','), ...rows.map(r => r.map(escape).join(','))]
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('zh-TW', { hour12: false })
}

export default function DataImportExport() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [files, setFiles] = useState({}) // kept for non-candidate imports
  const [loading, setLoading] = useState({})
  const [attendFrom, setAttendFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [attendTo, setAttendTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [salaryMonth, setSalaryMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const setLoad = (key, val) => setLoading(prev => ({ ...prev, [key]: val }))

  const exportEmployees = async () => {
    setLoad('employees', true)
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('employee_id, name, email, phone, dept, title, employment_type, hire_date, is_active')
        .eq('organization_id', orgId)
        .order('dept').order('name')
      if (error) throw error
      downloadCsv(`員工名冊_${new Date().toISOString().slice(0,10)}.csv`,
        ['員工編號','姓名','Email','電話','部門','職稱','雇用類型','到職日','在職'],
        (data || []).map(r => [
          r.employee_id, r.name, r.email, r.phone, r.dept, r.title,
          r.employment_type, r.hire_date, r.is_active ? '是' : '否',
        ])
      )
      toast.success('員工名冊已下載')
    } catch (e) {
      toast.error('匯出失敗：' + e.message)
    } finally {
      setLoad('employees', false)
    }
  }

  const exportAttendance = async () => {
    setLoad('attendance', true)
    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('date, clock_in, clock_out, hours, status, employees(name, dept)')
        .eq('organization_id', orgId)
        .gte('date', attendFrom)
        .lte('date', attendTo)
        .order('date').order('employees(name)')
      if (error) throw error
      downloadCsv(`考勤報表_${attendFrom}_${attendTo}.csv`,
        ['日期','姓名','部門','上班','下班','工時','狀態'],
        (data || []).map(r => [
          r.date, r.employees?.name, r.employees?.dept,
          fmt(r.clock_in), fmt(r.clock_out),
          r.hours != null ? Number(r.hours).toFixed(2) : '', r.status,
        ])
      )
      toast.success('考勤報表已下載')
    } catch (e) {
      toast.error('匯出失敗：' + e.message)
    } finally {
      setLoad('attendance', false)
    }
  }

  const exportJobs = async () => {
    setLoad('jobs', true)
    try {
      const { data, error } = await supabase
        .from('recruitment_jobs')
        .select('title, dept, location, type, headcount, posted, status, description')
        .eq('organization_id', orgId)
        .eq('status', '招募中')
        .order('posted', { ascending: false })
      if (error) throw error
      downloadCsv(`職缺清單_${new Date().toISOString().slice(0,10)}.csv`,
        ['職位名稱','部門','工作地點','類型','需求人數','刊登日','狀態','職缺說明'],
        (data || []).map(r => [
          r.title, r.dept, r.location, r.type, r.headcount || 1, r.posted, r.status, r.description || '',
        ])
      )
      toast.success('職缺清單已下載，可直接上傳至 104')
    } catch (e) {
      toast.error('匯出失敗：' + e.message)
    } finally {
      setLoad('jobs', false)
    }
  }

  const exportInventory = async () => {
    setLoad('inventory', true)
    try {
      const { data, error } = await supabase
        .from('stock_levels')
        .select('quantity, reorder_point, location, skus(code, name, category, unit_cost, unit)')
        .eq('organization_id', orgId)
        .order('skus(category)').order('skus(name)')
      if (error) throw error
      downloadCsv(`庫存報表_${new Date().toISOString().slice(0,10)}.csv`,
        ['品號','品名','分類','單位','庫存量','再訂點','單位成本','庫存總值','儲位'],
        (data || []).map(r => [
          r.skus?.code, r.skus?.name, r.skus?.category, r.skus?.unit,
          r.quantity, r.reorder_point,
          r.skus?.unit_cost != null ? Number(r.skus.unit_cost).toFixed(2) : '',
          r.skus?.unit_cost != null && r.quantity != null
            ? (r.skus.unit_cost * r.quantity).toFixed(2) : '',
          r.location,
        ])
      )
      toast.success('庫存報表已下載')
    } catch (e) {
      toast.error('匯出失敗：' + e.message)
    } finally {
      setLoad('inventory', false)
    }
  }

  const exportSalary = async () => {
    setLoad('salary', true)
    try {
      const { data, error } = await supabase
        .from('salary_records')
        .select('month, base_salary, bonus, deductions, net_salary, employees(name, dept, title)')
        .eq('organization_id', orgId)
        .eq('month', salaryMonth)
        .order('employees(dept)').order('employees(name)')
      if (error) throw error
      downloadCsv(`薪資報表_${salaryMonth}.csv`,
        ['月份','姓名','部門','職稱','底薪','獎金','扣款','實發'],
        (data || []).map(r => [
          r.month, r.employees?.name, r.employees?.dept, r.employees?.title,
          r.base_salary, r.bonus, r.deductions, r.net_salary,
        ])
      )
      toast.success('薪資報表已下載')
    } catch (e) {
      toast.error('匯出失敗：' + e.message)
    } finally {
      setLoad('salary', false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-primary)' }}>資料匯入匯出</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>批次匯入資料與匯出 CSV 報表</p>
      </div>

      {/* Export */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Download size={16} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>匯出報表</span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <ExportCard icon="👥" title="員工名冊" desc="匯出所有在職/離職員工基本資料">
            <button className="btn btn-primary" onClick={exportEmployees} disabled={loading.employees}>
              {loading.employees ? '匯出中…' : '下載 CSV'}
            </button>
          </ExportCard>

          <ExportCard icon="📅" title="考勤報表" desc="依日期區間匯出打卡與出勤紀錄">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
              <input type="date" className="form-input" style={{ width: 140 }}
                value={attendFrom} onChange={e => setAttendFrom(e.target.value)} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>至</span>
              <input type="date" className="form-input" style={{ width: 140 }}
                value={attendTo} onChange={e => setAttendTo(e.target.value)} />
              <button className="btn btn-primary" onClick={exportAttendance} disabled={loading.attendance}>
                {loading.attendance ? '匯出中…' : '下載 CSV'}
              </button>
            </div>
          </ExportCard>

          <ExportCard icon="💰" title="薪資報表" desc="依月份匯出薪資明細">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
              <input type="month" className="form-input" style={{ width: 150 }}
                value={salaryMonth} onChange={e => setSalaryMonth(e.target.value)} />
              <button className="btn btn-primary" onClick={exportSalary} disabled={loading.salary}>
                {loading.salary ? '匯出中…' : '下載 CSV'}
              </button>
            </div>
          </ExportCard>

          <ExportCard icon="💼" title="招募中職缺" desc="匯出職缺清單 CSV，可上傳至 104 等平台">
            <button className="btn btn-primary" onClick={exportJobs} disabled={loading.jobs}>
              {loading.jobs ? '匯出中…' : '下載 CSV'}
            </button>
          </ExportCard>

          <ExportCard icon="📦" title="庫存報表" desc="匯出所有品項庫存量與庫存總值">
            <button className="btn btn-primary" onClick={exportInventory} disabled={loading.inventory}>
              {loading.inventory ? '匯出中…' : '下載 CSV'}
            </button>
          </ExportCard>

        </div>
      </div>

      {/* Import */}
      <div className="card">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={16} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>匯入資料</span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CandidateImporter orgId={orgId} />
          {[
            { icon: '👥', title: '員工資料', desc: '批次新增員工（即將推出）' },
            { icon: '🤝', title: '客戶資料', desc: '批次匯入客戶與聯絡資訊（即將推出）' },
          ].map(item => (
            <div key={item.title} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px',
              background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border-primary)', opacity: 0.6 }}>
              <div style={{ fontSize: 26, flexShrink: 0 }}>{item.icon}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.desc}</div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', flexShrink: 0 }}>即將推出</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const splitLine = (line) => {
    const result = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ }
      else if (line[i] === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else { cur += line[i] }
    }
    result.push(cur.trim())
    return result
  }
  const headers = splitLine(lines[0])
  const rows = lines.slice(1).map(l => splitLine(l))
  return { headers, rows }
}

function detectCol(headers, candidates) {
  return headers.findIndex(h => candidates.some(c => h.toLowerCase().includes(c)))
}

function CandidateImporter({ orgId }) {
  const fileRef = useRef()
  const [parsed, setParsed] = useState(null)   // { headers, rows }
  const [jobId, setJobId] = useState('')
  const [jobs, setJobs] = useState([])
  const [colMap, setColMap] = useState({ name: -1, email: -1, phone: -1, source: -1 })
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)   // { ok, fail }

  useState(() => {
    if (orgId) supabase.from('recruitment_jobs').select('id,title').eq('organization_id', orgId).eq('status', '招募中')
      .order('id', { ascending: false }).then(({ data }) => setJobs(data || []))
  })

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const { headers, rows } = parseCsv(ev.target.result)
      setParsed({ headers, rows })
      setColMap({
        name:   detectCol(headers, ['姓名', 'name', '名字']),
        email:  detectCol(headers, ['email', '電子', 'mail']),
        phone:  detectCol(headers, ['電話', '手機', 'phone', 'tel']),
        source: detectCol(headers, ['來源', 'source']),
      })
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleImport = async () => {
    if (!parsed || colMap.name < 0) { toast.warning('請先選擇 CSV 且確認姓名欄'); return }
    setImporting(true)
    setResult(null)
    let ok = 0, fail = 0
    const toInsert = parsed.rows
      .filter(r => r[colMap.name]?.trim())
      .map(r => ({
        name: r[colMap.name]?.trim(),
        email: colMap.email >= 0 ? (r[colMap.email]?.trim() || null) : null,
        phone: colMap.phone >= 0 ? (r[colMap.phone]?.trim() || null) : null,
        source: colMap.source >= 0 ? (r[colMap.source]?.trim() || '平台') : '平台',
        job_id: jobId ? Number(jobId) : null,
        organization_id: orgId,
        stage: '投遞',
        stage_history: [{ stage: '投遞', changed_at: new Date().toISOString() }],
      }))

    for (const row of toInsert) {
      const { error } = await supabase.from('candidates').insert(row)
      if (error) fail++; else ok++
    }
    setImporting(false)
    setResult({ ok, fail })
    if (ok > 0) toast.success(`成功匯入 ${ok} 位應徵者`)
    if (fail > 0) toast.error(`${fail} 筆失敗（可能重複或缺少必填）`)
  }

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border-primary)', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>🧑‍💼</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>應徵者 CSV 匯入</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>支援 104 / 求才平台匯出的 CSV，自動對應姓名、Email、電話欄位</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>選擇 CSV 檔案</div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
            style={{ display: 'none' }} />
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => fileRef.current?.click()}>
            <FileUp size={14} /> 選擇檔案
          </button>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>尚無格式？</div>
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => downloadCsv('應徵者匯入範本.csv',
              ['姓名', '電子信箱', '電話', '來源'],
              [
                ['王小明', 'ming@example.com', '0912-345-678', '104'],
                ['陳雅婷', 'ting@example.com', '0987-654-321', '主動投遞'],
                ['林志遠', '', '0933-111-222', '員工推薦'],
              ]
            )}>
            <Download size={14} /> 下載範本
          </button>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>關聯職缺（選填）</div>
          <select className="form-input" style={{ minWidth: 200 }} value={jobId} onChange={e => setJobId(e.target.value)}>
            <option value="">不指定職缺</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
      </div>

      {parsed && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            {['name', 'email', 'phone'].map(field => {
              const labels = { name: '姓名欄 *', email: 'Email 欄', phone: '電話欄' }
              return (
                <div key={field}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{labels[field]}</div>
                  <select className="form-input" style={{ minWidth: 140, fontSize: 13 }}
                    value={colMap[field]}
                    onChange={e => setColMap(m => ({ ...m, [field]: Number(e.target.value) }))}>
                    <option value={-1}>（不對應）</option>
                    {parsed.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              )
            })}
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['姓名', 'Email', '電話'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-primary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>{colMap.name >= 0 ? r[colMap.name] : '—'}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{colMap.email >= 0 ? r[colMap.email] : '—'}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{colMap.phone >= 0 ? r[colMap.phone] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 5 && (
              <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                … 共 {parsed.rows.length} 筆（預覽前 5 筆）
              </div>
            )}
          </div>

          {result && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--accent-green)' }}>
                <CheckCircle size={14} /> 成功 {result.ok} 筆
              </span>
              {result.fail > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--accent-red)' }}>
                  <AlertCircle size={14} /> 失敗 {result.fail} 筆
                </span>
              )}
            </div>
          )}

          <button className="btn btn-primary" onClick={handleImport} disabled={importing || colMap.name < 0}>
            {importing ? '匯入中…' : `匯入 ${parsed.rows.filter(r => r[colMap.name]?.trim()).length} 筆應徵者`}
          </button>
        </>
      )}
    </div>
  )
}

function ExportCard({ icon, title, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px',
      background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border-primary)', flexWrap: 'wrap' }}>
      <div style={{ fontSize: 26, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: '1 1 160px' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}
