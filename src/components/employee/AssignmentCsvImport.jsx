import { useState, useMemo } from 'react'
import { X, Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
/**
 * CSV / TSV importer for employee_assignments.
 *
 * Expected columns (header row, order-insensitive, Chinese or English):
 *   員工編號 / employee_number
 *   姓名 / name
 *   部門名稱 / department         — may also be a store name (門市)
 *   職稱 / position
 *   職等 / job_grade
 *   員工類型 / employment_type    — 全職 / 兼職 / 其他
 *   部門類型 / department_type   — 主要 / 次要 (default 主要)
 *   部分工時(是/否) / is_part_time
 *   平均每週工作時數 / avg_weekly_hours
 *   開始日期 / start_date
 *   結束日期 / end_date
 *   生效中 / is_active
 *   更新日期 / updated_at         — ignored (DB trigger sets it)
 *   修改人 / updated_by           — resolved by name
 */

const HEADER_ALIASES = {
  員工編號: 'employee_number', employee_number: 'employee_number',
  姓名: 'name', name: 'name',
  部門名稱: 'department', department: 'department',
  職稱: 'position', position: 'position',
  職等: 'job_grade', job_grade: 'job_grade',
  員工類型: 'employment_type', employment_type: 'employment_type',
  部門類型: 'department_type', department_type: 'department_type',
  '部分工時(是/否)': 'is_part_time', 部分工時: 'is_part_time', is_part_time: 'is_part_time',
  平均每週工作時數: 'avg_weekly_hours', avg_weekly_hours: 'avg_weekly_hours',
  開始日期: 'start_date', start_date: 'start_date',
  結束日期: 'end_date', end_date: 'end_date',
  生效中: 'is_active', is_active: 'is_active',
  更新日期: 'updated_at', updated_at: 'updated_at',
  修改人: 'updated_by_name', updated_by: 'updated_by_name',
}

function splitLine(line, delim) {
  // Minimal CSV split: handles quoted fields with commas inside.
  if (delim === '\t') return line.split('\t')
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQ = !inQ; continue }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

function parseTable(text) {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { headers: [], rows: [] }
  const firstLine = trimmed.split(/\r?\n/)[0]
  const delim = firstLine.includes('\t') ? '\t' : ','
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim())
  const headers = splitLine(lines[0], delim).map(h => HEADER_ALIASES[h.trim()] || h.trim())
  const rows = lines.slice(1).map(l => {
    const cells = splitLine(l, delim)
    const row = {}
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
  return { headers, rows }
}

const truthy = (v) => {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return s === '是' || s === 'true' || s === '1' || s === 'yes' || s === 'y'
}

export default function AssignmentCsvImport({ employees, departments, stores, onClose, onDone }) {
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState(null)
  const [importing, setImporting] = useState(false)

  const empByNumber = useMemo(() => new Map(employees.map(e => [e.employee_number, e])), [employees])
  const empByName = useMemo(() => new Map(employees.map(e => [e.name, e])), [employees])
  const deptByName = useMemo(() => new Map(departments.map(d => [d.name, d])), [departments])
  const storeByName = useMemo(() => new Map(stores.map(s => [s.name, s])), [stores])
  // Rule: 門市 staff belong to 營運部.
  const opsDept = useMemo(() => departments.find(d => d.name === '營運部') || null, [departments])

  const buildPreview = () => {
    const { rows } = parseTable(raw)
    const resolved = rows.map((r, idx) => {
      const emp = empByNumber.get(r.employee_number) || empByName.get(r.name) || null
      let dept = r.department ? deptByName.get(r.department) : null
      const store = r.department ? storeByName.get(r.department) : null
      const positionIsOps = r.position && (r.position.includes('門市') || r.position.includes('店長'))
      // Rule: 門市 assigned OR position contains 門市 / 店長 → 營運部.
      if (opsDept && (store || positionIsOps)) dept = opsDept
      const modBy = r.updated_by_name ? empByName.get(r.updated_by_name) : null
      const issues = []
      if (!emp) issues.push(`找不到員工 ${r.employee_number || r.name}`)
      if (r.department && !dept && !store) issues.push(`無法對應 ${r.department}（既非部門也非門市）`)
      if ((store || positionIsOps) && !opsDept) issues.push('需歸屬營運部，但系統找不到「營運部」')
      if (!r.start_date) issues.push('缺少開始日期')
      return {
        idx, raw: r, emp, dept, store, updated_by: modBy?.id || null,
        autoOpsDept: Boolean((store || positionIsOps) && opsDept && dept === opsDept),
        issues,
      }
    })
    setPreview(resolved)
  }

  const importRows = async () => {
    if (!preview) return
    const ok = preview.filter(p => p.emp && !p.issues.some(i => i.startsWith('缺少') || i.startsWith('找不到')))
    if (!ok.length) { toast.error('沒有可匯入的有效資料'); return }
    if (!(await confirm({ message: `匯入 ${ok.length} / ${preview.length} 筆指派紀錄？` }))) return
    setImporting(true)
    try {
      const payload = ok.map(p => ({
        employee_id: p.emp.id,
        department_id: p.dept?.id || null,
        store_id: p.store?.id || null,
        position: p.raw.position || null,
        job_grade: p.raw.job_grade || null,
        employment_type: p.raw.employment_type || null,
        department_type: p.raw.department_type === '次要' ? '次要' : '主要',
        is_part_time: truthy(p.raw.is_part_time),
        avg_weekly_hours: Number(p.raw.avg_weekly_hours) || 0,
        start_date: p.raw.start_date,
        end_date: p.raw.end_date || null,
        is_active: p.raw.is_active ? truthy(p.raw.is_active) : null, // null → trigger auto-computes
        updated_by: p.updated_by,
      }))
      // Insert in chunks of 100 to avoid payload limits.
      let inserted = 0
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100).map(r => {
          if (r.is_active === null) { const { is_active, ...rest } = r; return rest }
          return r
        })
        const { error } = await supabase.from('employee_assignments').insert(chunk)
        if (error) throw error
        inserted += chunk.length
      }
      toast.error(`成功匯入 ${inserted} 筆`)
      onDone?.()
      onClose()
    } catch (err) {
      console.error('[CsvImport] failed:', err)
      toast.error('匯入失敗：' + (err.message || 'unknown'))
    }
    setImporting(false)
  }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setRaw(await f.text())
  }

  const badCount = preview?.filter(p => p.issues.length).length || 0

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" onClick={e => e.stopPropagation()}
        style={{ width: 'min(1100px, 94vw)', maxHeight: '92vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}><Upload size={18} style={{ verticalAlign: -3 }} /> 匯入員工指派紀錄（CSV / TSV）</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              支援 Excel 貼上（TSV）或 CSV 檔案。欄位名稱支援中英文，對應 employee_assignments schema。
            </p>
          </div>
          <button className="btn btn-sm" onClick={onClose}><X size={12} /></button>
        </div>

        {!preview && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
              <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer' }}>
                <Upload size={12} /> 選擇檔案
                <input type="file" accept=".csv,.tsv,.txt" onChange={onFile} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>或直接貼上：</span>
            </div>
            <textarea className="form-input"
              placeholder="將試算表內容複製貼到此處（含標題列）..."
              style={{ width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 12 }}
              value={raw} onChange={e => setRaw(e.target.value)} />
            <div style={{ display: 'flex', gap: 10, marginTop: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={buildPreview} disabled={!raw.trim()}>
                預覽
              </button>
            </div>
          </>
        )}

        {preview && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12 }}>
                共 <strong>{preview.length}</strong> 筆，有問題 <strong style={{ color: badCount ? 'var(--accent-red)' : 'inherit' }}>{badCount}</strong> 筆
              </span>
              <button className="btn btn-sm btn-secondary" onClick={() => setPreview(null)}>返回修改</button>
              <button className="btn btn-sm btn-primary" onClick={importRows} disabled={importing} style={{ marginLeft: 'auto' }}>
                {importing ? '匯入中…' : `匯入 ${preview.length - badCount} 筆`}
              </button>
            </div>
            <div className="data-table-wrapper" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>員工</th>
                    <th>部門 / 門市</th>
                    <th>職稱</th>
                    <th>類型</th>
                    <th>主 / 次</th>
                    <th>起</th>
                    <th>迄</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map(p => (
                    <tr key={p.idx} style={{ background: p.issues.length ? 'var(--accent-red-dim, #fee)' : undefined }}>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.idx + 1}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{p.emp?.name || p.raw.name} <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.raw.employee_number}</code></div>
                        {p.issues.map((m, i) => (
                          <div key={i} style={{ fontSize: 10, color: 'var(--accent-red)' }}>
                            <AlertTriangle size={9} /> {m}
                          </div>
                        ))}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {p.dept?.name && <span className="badge badge-cyan" style={{ fontSize: 10 }}>部門 {p.dept.name}</span>}
                        {p.store?.name && <span className="badge badge-purple" style={{ fontSize: 10 }}>門市 {p.store.name}</span>}
                        {p.autoOpsDept && <div style={{ fontSize: 10, color: 'var(--accent-cyan)', marginTop: 2 }}>自動對應為營運部</div>}
                        {!p.dept && !p.store && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{p.raw.department || '—'}</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{p.raw.position}</td>
                      <td style={{ fontSize: 12 }}>{p.raw.employment_type}</td>
                      <td style={{ fontSize: 12 }}>{p.raw.department_type || '主要'}</td>
                      <td style={{ fontSize: 11 }}>{p.raw.start_date}</td>
                      <td style={{ fontSize: 11 }}>{p.raw.end_date}</td>
                      <td style={{ fontSize: 11 }}>
                        {p.issues.length === 0
                          ? <span style={{ color: 'var(--accent-green)' }}><CheckCircle2 size={11} /> OK</span>
                          : <span style={{ color: 'var(--accent-red)' }}>跳過</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
