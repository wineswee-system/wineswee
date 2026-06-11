import { useState, useEffect, useRef } from 'react'
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { parseCSV } from '../../lib/wenzhong'
import { formatShiftLabel } from '../../lib/scheduleUtils'
import { toast } from '../../lib/toast'

// ── 假別中文 → code ──────────────────────────────────────
const LEAVE_TYPE_MAP = {
  '特休': 'annual', '年假': 'annual', '特休假': 'annual',
  '特別休假': 'annual', '年休假': 'annual', '年資特休': 'annual',
  '病假': 'sick',
  '事假': 'personal',
  '公假': 'official',
  '產假': 'maternity',
  '陪產假': 'paternity',
  '生理假': 'menstrual',
  '婚假': 'marriage',
  '喪假': 'bereavement',
  '工傷假': 'occupational',
  '家庭照顧假': 'family_care', '家假': 'family_care',
  '心理健康假': 'mental_health',
  '產檢假': 'prenatal',
  '育嬰假': 'parental',
  '哺乳假': 'nursing', '護理假': 'nursing',
  '補休假': 'comp', '補休': 'comp',
}

// ── 模組定義 ─────────────────────────────────────────────
const HR_MODULES = {
  attendance: {
    label: '打卡紀錄',
    icon: '⏰',
    table: 'attendance_records',
    templateHeaders: ['員工姓名', '日期', '上班時間', '下班時間', '狀態'],
    templateExample: [
      ['林襄', '2026/05/01', '09:00', '18:00', '正常'],
      ['陳虹', '2026/05/01', '09:05', '18:30', ''],
    ],
    required: ['員工姓名', '日期'],
    fieldMap: {
      '員工姓名': 'employee', '員工': 'employee', '姓名': 'employee', '名字': 'employee',
      '日期': 'date',
      '上班時間': 'clock_in', '打卡時間': 'clock_in', '上班打卡': 'clock_in',
      '下班時間': 'clock_out', '下班打卡': 'clock_out',
      '狀態': 'status', '打卡狀態': 'status',
    },
  },
  schedules: {
    label: '班表',
    icon: '📅',
    table: 'schedules',
    templateHeaders: ['員工', '日期', '班別'],
    templateExample: [
      ['林襄', '2026/05/01', '早班'],
      ['陳虹', '2026/05/01', '休'],
    ],
    required: ['員工', '日期', '班別'],
    fieldMap: {
      '員工': 'employee', '員工姓名': 'employee', '姓名': 'employee',
      '日期': 'date',
      '班別': 'shift', '班次': 'shift',
    },
  },
  leave: {
    label: '請假紀錄',
    icon: '🏖️',
    table: 'leave_requests',
    templateHeaders: ['員工', '假別', '開始日期', '結束日期', '天數', '原因'],
    templateExample: [
      ['林襄', '特休', '2026/05/01', '2026/05/02', '2', '年假'],
      ['陳虹', '病假', '2026/05/03', '2026/05/03', '1', ''],
    ],
    required: ['員工', '假別', '開始日期', '結束日期'],
    fieldMap: {
      '員工': 'employee', '員工姓名': 'employee', '姓名': 'employee',
      '假別': 'type', '假種': 'type', '假種類': 'type',
      '假勤項目': 'type', '假種名稱': 'type',
      '開始日期': 'start_date', '起始日期': 'start_date', '請假日期': 'start_date',
      '假勤開始日期': 'start_date',
      '結束日期': 'end_date', '截止日期': 'end_date',
      '假勤結束日期': 'end_date',
      '天數': 'days',
      '請假時數': 'hours',
      '原因': 'reason', '備註': 'reason', '請假原因': 'reason',
    },
  },
  overtime: {
    label: '加班紀錄',
    icon: '🕐',
    table: 'overtime_requests',
    templateHeaders: ['員工', '日期', '加班時數', '類型', '開始時間', '結束時間', '原因'],
    templateExample: [
      ['林襄', '2026/05/01', '2', '平日加班', '18:00', '20:00', '月底結案'],
      ['陳虹', '2026/05/03', '3', '', '', '', ''],
    ],
    required: ['員工', '日期', '加班時數'],
    fieldMap: {
      '員工': 'employee', '員工姓名': 'employee', '姓名': 'employee',
      '日期': 'date', '加班歸屬日': 'date',
      '加班時數': 'hours', '加班小時': 'hours', '時數': 'hours',
      '類型': 'category', '加班類型': 'category',
      '開始時間': 'start_time', '加班開始': 'start_time', '加班開始時間': 'start_time',
      '結束時間': 'end_time', '加班結束': 'end_time', '加班結束時間': 'end_time',
      '原因': 'reason', '備註': 'reason', '加班原因': 'reason',
    },
  },
}

// ── 日期 / 時間正規化 ────────────────────────────────────
function normalizeDate(s) {
  if (!s) return null
  const clean = String(s).trim().replace(/[./年月]/g, '-').replace(/日$/, '')
  const m = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function normalizeTime(s) {
  if (!s) return null
  const clean = String(s).trim()
  const m = clean.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
}

// 104 假別名稱統一對應（含「特休假2025結算」、「舊系統結算特休」等動態名稱）
function resolveLeaveType(raw) {
  if (!raw) return ''
  const s = raw.trim()
  if (LEAVE_TYPE_MAP[s]) return LEAVE_TYPE_MAP[s]
  // 含「特休」關鍵字 → annual（特休假2025結算 / 2025年結算特休 / 舊系統結算特休）
  if (s.includes('特休')) return 'annual'
  // 含「補休」關鍵字 → comp（補休假 / 舊人資系統補休結算）
  if (s.includes('補休')) return 'comp'
  return s
}

// 打卡明細：每筆一行（上班/下班各一行）→ 合併成一行
// 支援兩種來源格式：
//   舊 104：欄位「上/下班」+「打卡日期時間」+「日期」
//   新格式：欄位「卡別」+「實際打卡時間」(完整 datetime) +「工作日期」
function transformPunchDetail(rows) {
  const map = new Map()
  for (const r of rows) {
    const rawName = r['姓名'] || r['員工姓名'] || r['員工'] || ''
    // "0001 林襄" → "林襄"
    const nameM = String(rawName).trim().match(/^\S*\d+\s+(.+)$/)
    const name = nameM ? nameM[1].trim() : String(rawName).trim()

    const date = r['工作日期'] || r['日期'] || ''
    const direction = r['卡別'] || r['上/下班'] || ''
    // 只認實際打卡時間；應刷卡時間是「預期該打」不是「實際打了」，不能用來假裝有打卡
    const rawTs = r['實際打卡時間'] || r['打卡日期時間'] || r['打卡時間'] || r['時間'] || ''
    const timeM = String(rawTs).match(/(\d{1,2}):(\d{2})/)
    const time = timeM ? `${timeM[1]}:${timeM[2]}` : ''

    if (!name || !date) continue
    const empNo = r['員工編號'] || r['員工編碼'] || ''
    const key = `${name}__${date}`
    if (!map.has(key)) map.set(key, { '員工姓名': name, '員工編號': empNo, '日期': date })
    const entry = map.get(key)
    if (direction === '上班' && time) entry['上班時間'] = time
    if (direction === '下班' && time) entry['下班時間'] = time
    if (r['狀態'] && !entry['狀態']) entry['狀態'] = r['狀態']
    if (r['比對結果'] && !entry['狀態']) entry['狀態'] = r['比對結果']
  }
  return [...map.values()]
}

// ── 產生 CSV 範本 blob ────────────────────────────────────
function downloadTemplate(mod) {
  const m = HR_MODULES[mod]
  const rows = [m.templateHeaders, ...m.templateExample]
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n')
  const bom = '﻿'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `hr_import_${mod}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// ── 主元件 ───────────────────────────────────────────────
export default function HRImport() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id

  const [mod, setMod] = useState('attendance')
  const [employees, setEmployees] = useState([])
  const [preview, setPreview] = useState([])   // [{ rowNo, payload, errors, isDup }]
  const [dupMode, setDupMode] = useState('skip')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!orgId) return
    supabase.from('employees').select('id, name, employee_number')
      .eq('organization_id', orgId)
      .then(({ data, error }) => {
        if (error) console.error('[HRImport] employees query error:', error)
        console.log('[HRImport] loaded employees:', data?.length, 'orgId:', orgId)
        setEmployees(data || [])
      })
  }, [orgId])

  function empLookup(nameOrNo) {
    if (!nameOrNo) return null
    const q = String(nameOrNo).trim()
    return employees.find(e => e.name === q || e.employee_number === q) || null
  }

  // ── 從 XLSX sheet 抽出 flat rows（略過 metadata，自動找標題行）──
  function xlsxToRows(buffer) {
    const wb  = XLSX.read(buffer, { type: 'array' })
    const ws  = wb.Sheets[wb.SheetNames[0]]
    const mat = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    // 找到真正的標題行（同 CSV 邏輯）
    let hi = mat.findIndex(row => {
      const cells = row.map(c => String(c))
      return cells.some(c => c.includes('員工編號') || c.includes('員工編碼')) ||
        (cells.some(c => c.includes('姓名')) && cells.some(c => c.includes('部門')))
    })
    if (hi < 0) hi = 0

    const headers = mat[hi].map(String)
    return mat.slice(hi + 1)
      .filter(row => row.some(c => c !== ''))
      .map(row => {
        const obj = {}
        headers.forEach((h, i) => { if (h.trim()) obj[h.trim()] = row[i] ?? '' })
        return obj
      })
  }

  // ── 解析 CSV / XLSX → preview ────────────────────────
  function handleFile(file) {
    if (!file) return
    setResult(null)
    setPreview([])

    const isXlsx = /\.xlsx?$/i.test(file.name)
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        let rawRows
        if (isXlsx) {
          rawRows = xlsxToRows(new Uint8Array(e.target.result))
        } else {
          // 104 匯出前幾行是 metadata（資料類型/日期/條件/筆數 + 空白）
          // 找到真正的欄位標題行（含「員工編號」或「員工姓名」或同時含「姓名」+「部門」）
          let csvText = e.target.result
          const lines = csvText.split(/\r?\n/)
          const headerIdx = lines.findIndex(line =>
            line.includes('員工編號') || line.includes('員工編碼') ||
            (line.includes('姓名') && line.includes('部門'))
          )
          if (headerIdx > 0) csvText = lines.slice(headerIdx).join('\n')
          ;({ rows: rawRows } = parseCSV(csvText))
        }

        // 打卡明細格式偵測：每筆打卡一行含「卡別」或「上/下班」欄 → 先合併成一天一行
        const isPunchDetail = mod === 'attendance' && rawRows.length > 0
          && ('卡別' in rawRows[0] || '上/下班' in rawRows[0])
        const rows = isPunchDetail ? transformPunchDetail(rawRows) : rawRows
        const m = HR_MODULES[mod]
        const parsed = rows.map((rawRow, idx) => {
          // 欄位對應（以 fieldMap 正向 + 原始欄名 fallback）
          const mapped = {}
          Object.entries(rawRow).forEach(([header, val]) => {
            const target = m.fieldMap[header.trim()] || header.trim()
            mapped[target] = val
          })

          const errors = []
          // 名字查不到時再試 104 的員工編號欄（rawRow['員工編號']）
          let emp = empLookup(mapped.employee)
          if (!emp && rawRow['員工編號']) emp = empLookup(String(rawRow['員工編號']).trim())
          if (!mapped.employee) errors.push('缺員工欄位')
          else if (!emp)        errors.push(`找不到員工「${mapped.employee}」`)

          let payload = { organization_id: orgId }
          if (emp) {
            payload.employee    = emp.name
            payload.employee_id = emp.id
          }

          if (mod === 'attendance') {
            const date = normalizeDate(mapped.date)
            if (!date) errors.push('日期格式錯誤')
            const clockIn  = normalizeTime(mapped.clock_in)
            const clockOut = normalizeTime(mapped.clock_out)
            let totalHours = null
            if (clockIn && clockOut) {
              const [ih, im] = clockIn.split(':').map(Number)
              const [oh, om] = clockOut.split(':').map(Number)
              let mins = (oh * 60 + om) - (ih * 60 + im)
              if (mins < 0) mins += 1440
              totalHours = parseFloat((mins / 60).toFixed(2))
            }
            payload = { ...payload, date, clock_in: clockIn, clock_out: clockOut,
              total_hours: totalHours, status: mapped.status || '正常',
              clock_in_mode: 'normal', clock_out_mode: 'normal' }

          } else if (mod === 'schedules') {
            const date = normalizeDate(mapped.date)
            if (!date) errors.push('日期格式錯誤')
            if (!mapped.shift) errors.push('缺班別')
            payload = { ...payload, date, shift: formatShiftLabel(mapped.shift || '') || mapped.shift }

          } else if (mod === 'leave') {
            const startDate = normalizeDate(mapped.start_date)
            const endDate   = normalizeDate(mapped.end_date)
            if (!startDate) errors.push('開始日期格式錯誤')
            if (!endDate)   errors.push('結束日期格式錯誤')
            const type = resolveLeaveType(mapped.type || '')
            if (!type) errors.push('缺假別')
            let days, leaveUnit = 'day', leaveHours = null
            if (mapped.days) {
              days = Math.round(Number(mapped.days))
            } else if (mapped.hours) {
              // 104 格式：8h 的倍數存天數；非整數天數用 unit='hour' 存原始小時
              // 同時把小時數存進 hours 欄位，讓薪資計算 (Salary.jsx) 的 l.hours 可直接用
              const hrs = Number(mapped.hours)
              if (hrs > 0) {
                leaveHours = hrs
                if (hrs % 8 === 0) {
                  days = hrs / 8
                  leaveUnit = 'day'
                } else {
                  days = Math.round(hrs)
                  leaveUnit = 'hour'
                }
              }
            } else if (startDate && endDate) {
              days = Math.floor((new Date(endDate) - new Date(startDate)) / 86400000) + 1
            }
            if (!days || days <= 0) errors.push('天數無效')
            payload = { ...payload, type, start_date: startDate, end_date: endDate,
              days, unit: leaveUnit,
              ...(leaveHours !== null ? { hours: leaveHours } : {}),
              reason: mapped.reason || '', status: '已核准',
              approver: profile?.name || '' }

          } else if (mod === 'overtime') {
            const date = normalizeDate(mapped.date)
            if (!date) errors.push('日期格式錯誤')
            const hours = Number(mapped.hours)
            if (!hours || hours <= 0) errors.push('加班時數無效')
            payload = { ...payload, date, hours,
              category: mapped.category || null,
              start_time: normalizeTime(mapped.start_time) || null,
              end_time: normalizeTime(mapped.end_time) || null,
              reason: mapped.reason || '', status: '已核准', source: 'import',
              store: emp?.store || null }
          }

          return { rowNo: idx + 2, raw: rawRow, payload, errors, isDup: false }
        })
        setPreview(parsed)
      } catch (err) {
        toast.error((isXlsx ? 'XLSX' : 'CSV') + ' 解析失敗：' + err.message)
      }
    }
    if (isXlsx) {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsText(file, 'utf-8')
    }
  }

  // ── 執行匯入 ─────────────────────────────────────────
  async function handleImport() {
    const valid = preview.filter(r => r.errors.length === 0)
    if (!valid.length) { toast.error('沒有可匯入的有效資料'); return }
    setImporting(true)

    const m = HR_MODULES[mod]
    let inserted = 0, skipped = 0, errored = 0
    const CHUNK = 500  // RPC 批次大小

    try {
      if (mod === 'schedules') {
        // schedules 有唯一約束 (employee, date)，直接 upsert
        for (let i = 0; i < valid.length; i += CHUNK) {
          const chunk = valid.slice(i, i + CHUNK).map(r => r.payload)
          const conflict = dupMode === 'overwrite'
            ? 'employee,date'
            : undefined
          let q = supabase.from('schedules')
          if (conflict) {
            const { error } = await q.upsert(chunk, { onConflict: conflict })
            if (error) { errored += chunk.length } else { inserted += chunk.length }
          } else {
            const { error } = await q.insert(chunk)
            if (error?.code === '23505') { skipped += chunk.length }
            else if (error) { errored += chunk.length }
            else { inserted += chunk.length }
          }
        }

      } else if (mod === 'attendance') {
        // RPC 批次：繞過 trigger，支援覆蓋模式
        for (let i = 0; i < valid.length; i += CHUNK) {
          const chunk = valid.slice(i, i + CHUNK).map(r => r.payload)
          const { data, error } = await supabase.rpc('bulk_import_attendance',
            { p_records: chunk, p_overwrite: dupMode === 'overwrite' })
          if (error) { toast.error('批次失敗：' + error.message); errored += chunk.length }
          else { inserted += data.inserted; skipped += data.skipped }
        }

      } else if (mod === 'leave') {
        // RPC 批次：繞過 chain / LINE 通知 trigger
        for (let i = 0; i < valid.length; i += CHUNK) {
          const chunk = valid.slice(i, i + CHUNK).map(r => r.payload)
          const { data, error } = await supabase.rpc('bulk_import_leave',
            { p_records: chunk, p_overwrite: dupMode === 'overwrite' })
          if (error) { toast.error('批次失敗：' + error.message); errored += chunk.length }
          else { inserted += data.inserted; skipped += data.skipped }
        }

      } else if (mod === 'overtime') {
        // RPC 批次：繞過 chain / LINE 通知 trigger
        for (let i = 0; i < valid.length; i += CHUNK) {
          const chunk = valid.slice(i, i + CHUNK).map(r => r.payload)
          const { data, error } = await supabase.rpc('bulk_import_overtime',
            { p_records: chunk, p_overwrite: dupMode === 'overwrite' })
          if (error) { toast.error('批次失敗：' + error.message); errored += chunk.length }
          else { inserted += data.inserted; skipped += data.skipped }
        }
      }
    } catch (err) {
      toast.error('匯入中斷：' + err.message)
    }

    setImporting(false)
    setResult({ inserted, skipped, errored })
    if (inserted > 0) toast.success(`匯入完成：${inserted} 筆`)
  }

  function reset() {
    setPreview([]); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const m = HR_MODULES[mod]
  const validRows   = preview.filter(r => r.errors.length === 0)
  const invalidRows = preview.filter(r => r.errors.length > 0)

  return (
    <div style={{ padding: 28, maxWidth: 1000 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700 }}>HR 資料匯入</h2>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 14 }}>
        支援打卡紀錄、班表、請假、加班四種 CSV 批次匯入
      </p>

      {/* 模組選擇 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {Object.entries(HR_MODULES).map(([key, cfg]) => (
          <button key={key}
            onClick={() => { setMod(key); reset() }}
            style={{
              padding: '8px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', border: '2px solid',
              borderColor: mod === key ? 'var(--accent-cyan)' : 'var(--border-medium)',
              background: mod === key ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
              color: mod === key ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            }}>
            {cfg.icon} {cfg.label}
          </button>
        ))}
      </div>

      {/* 操作列 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" style={{ fontSize: 13 }}
          onClick={() => downloadTemplate(mod)}>
          <Download size={14} /> 下載範本
        </button>
        <span style={{ fontSize: 12, color: employees.length > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
          已載入 {employees.length} 位員工
        </span>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
          background: 'var(--accent-cyan)', color: '#fff',
          fontSize: 13, fontWeight: 600,
        }}>
          <Upload size={14} /> 選擇 CSV / XLSX
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </label>

        {preview.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>重複處理：</span>
              {['skip', 'overwrite'].map(v => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="radio" name="dupMode" value={v}
                    checked={dupMode === v} onChange={() => setDupMode(v)} />
                  {v === 'skip' ? '跳過' : '覆蓋'}
                </label>
              ))}
            </div>

            <button className="btn btn-primary" style={{ fontSize: 13 }}
              onClick={handleImport} disabled={importing || validRows.length === 0}>
              {importing ? <><RefreshCw size={14} className="spin" /> 匯入中…</> : `匯入 ${validRows.length} 筆`}
            </button>

            <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={reset}>
              清除
            </button>
          </>
        )}
      </div>

      {/* 匯入結果 */}
      {result && (
        <div style={{
          padding: '14px 18px', borderRadius: 10, marginBottom: 20,
          background: result.errored > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
          border: `1px solid ${result.errored > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
          display: 'flex', gap: 24, fontSize: 14,
        }}>
          <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>✅ 匯入 {result.inserted} 筆</span>
          <span style={{ color: 'var(--text-muted)' }}>⏭️ 跳過 {result.skipped} 筆（重複）</span>
          {result.errored > 0 && <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>❌ 失敗 {result.errored} 筆</span>}
        </div>
      )}

      {/* 預覽表 */}
      {preview.length > 0 && (
        <div>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
            <span>共 {preview.length} 行</span>
            <span style={{ color: 'var(--accent-green)' }}>✓ 有效 {validRows.length}</span>
            {invalidRows.length > 0 && (
              <span style={{ color: 'var(--accent-red)' }}>✗ 錯誤 {invalidRows.length}</span>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 13, minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>行</th>
                    <th>狀態</th>
                    {m.templateHeaders.map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => {
                    const ok = row.errors.length === 0
                    const p = row.payload
                    return (
                      <tr key={row.rowNo} style={{ background: ok ? undefined : 'rgba(239,68,68,0.05)' }}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{row.rowNo}</td>
                        <td>
                          {ok
                            ? <CheckCircle2 size={15} color="var(--accent-green)" />
                            : <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>
                                <XCircle size={13} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                                {row.errors.join('；')}
                              </span>
                          }
                        </td>
                        {/* 原始欄位值 */}
                        {m.templateHeaders.map(h => {
                          const fieldKey = m.fieldMap[h] || h
                          const val = row.raw[h] ?? ''
                          return <td key={h} style={{ color: val ? undefined : 'var(--text-muted)' }}>{val || '—'}</td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 空白提示 */}
      {preview.length === 0 && (
        <div style={{
          border: '2px dashed var(--border-medium)',
          borderRadius: 12, padding: '48px 24px',
          textAlign: 'center', color: 'var(--text-muted)',
        }}>
          <Upload size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 15 }}>先下載範本，填好後上傳 CSV</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>支援 UTF-8（含 BOM）或一般 CSV 格式</div>
        </div>
      )}
    </div>
  )
}
