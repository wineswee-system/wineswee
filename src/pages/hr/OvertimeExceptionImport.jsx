/**
 * 加班補登 — 管理員批次匯入加班紀錄
 *
 * 設計：
 *   - 路由不掛 sidebar，需直接 URL 進入
 *   - admin / super_admin 才能用
 *   - 上方統計：選定月份各員工的加班累計（一般 vs 額外）
 *   - CSV 預覽：每列即時計算「加進去後該員工該月總時數」
 *   - 寫入時設 is_exception=true (DB 欄)，跳過 §32 守門 trigger
 *
 * UI 參照 BatchPayrollModal 的計算流程（月選 → 載資料 → 預覽 → 確認）
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Download, AlertCircle, AlertTriangle, CheckCircle, FileSpreadsheet, Calculator, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import LoadingSpinner from '../../components/LoadingSpinner'
import Salary from './Salary'

const CSV_HEADERS = ['員工名稱', '日期', '開始時間', '結束時間', '時數', '類型', '原因', '備註']

// ot_category 代碼 → 中文（真正算薪的分類，由 classify_ot_category_safe 讀班表+月曆判）
const CAT_LABEL = { weekday: '平日', restday: '休息日', weekly_off: '例假', holiday: '國定假日' }

const CSV_TEMPLATE = '﻿' + CSV_HEADERS.join(',') + '\n' +
  '範例：張庭瑋,2026-06-05,18:00,22:00,4,假日,客戶緊急驗收,勞資會議第3次決議\n'

// 勞基法上限（小時）
const LIMIT_MONTHLY_REGULAR  = 46
const LIMIT_MONTHLY_AGREEMENT = 54  // 勞資會議特例上限
const LIMIT_MONTHLY_DANGER   = 60   // 紅色危險區
const LIMIT_DAILY            = 4

// 警示顏色判斷（label 只用中性「高/偏高/略高/接近」，不暴露法定門檻）
const warnLevel = (totalHours) => {
  if (totalHours > LIMIT_MONTHLY_DANGER)   return { color: 'var(--accent-red)',    label: '高',     bg: 'var(--accent-red-dim)' }
  if (totalHours > LIMIT_MONTHLY_AGREEMENT) return { color: 'var(--accent-orange)', label: '偏高',   bg: 'var(--accent-orange-dim)' }
  if (totalHours > LIMIT_MONTHLY_REGULAR)  return { color: 'var(--accent-orange)', label: '略高',   bg: 'var(--accent-orange-dim)' }
  if (totalHours > LIMIT_MONTHLY_REGULAR - 4) return { color: 'var(--accent-yellow, var(--accent-orange))', label: '接近上限', bg: 'var(--accent-orange-dim)' }
  return { color: 'var(--accent-green)', label: '正常', bg: 'transparent' }
}

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const parseCsvLine = (line) => {
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
  return out.map(s => s.trim())
}

export default function OvertimeExceptionImport() {
  const { profile, hasPermission } = useAuth()
  const navigate = useNavigate()

  const isAuthorized = hasPermission('system.admin')
  const orgId = profile?.organization_id

  const [month, setMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(false)
  const [employees, setEmployees] = useState([])    // 全部在職 + 當月離職員工
  const [otByEmp, setOtByEmp] = useState({})        // { emp_id: { regular: hrs, exception: hrs } }
  const [parsed, setParsed] = useState([])          // CSV 預覽資料
  const [importing, setImporting] = useState(false)
  const [recentImports, setRecentImports] = useState([])
  const [statsSearch, setStatsSearch] = useState('')
  const [showOnlyOver, setShowOnlyOver] = useState(false)
  // Google Sheet 直讀（記住上次貼的連結）
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem('otx_sheet_url') || '')
  const [readingSheet, setReadingSheet] = useState(false)

  // ── 載入該月所有員工的 OT 累計（一般 vs 特例）+ 在職員工 + 最近匯入 ──
  const loadMonthStats = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [yr, mo] = month.split('-').map(Number)
      const monthStart = `${month}-01`
      const monthEnd = `${month}-${String(new Date(yr, mo, 0).getDate()).padStart(2, '0')}`

      const [empRes, otRes, recRes] = await Promise.all([
        // employees：在職 + 當月離職（給批次計薪用，欄位對齊 Salary.jsx 第 145 行）
        supabase.from('employees')
          .select('id, name, employee_number, dept, store, department_id, position, store_id, base_salary, hourly_rate, salary_type, meal_allowance, transport_allowance, housing_allowance, join_date, resign_date, status, labor_pension_self_rate, organization_id, departments!department_id(name), stores!store_id(name)')
          .eq('organization_id', orgId)
          .or(`status.eq.在職,and(status.eq.離職,resign_date.gte.${monthStart})`)
          .order('name'),
        supabase.from('overtime_requests')
          .select('employee_id, ot_hours, hours, is_exception, status, request_date, date')
          .eq('organization_id', orgId)
          .gte('request_date', monthStart).lte('request_date', monthEnd),
        supabase.from('overtime_requests')
          .select('id, employee, employee_id, request_date, ot_hours, ot_type, reason, exception_note, exception_imported_at, exception_imported_by, status')
          .eq('organization_id', orgId)
          .eq('is_exception', true)
          .order('exception_imported_at', { ascending: false, nullsFirst: false })
          .limit(50),
      ])

      const tally = {}
      for (const r of (otRes.data || [])) {
        if (['已退回', '已駁回', '已取消', '已拒絕'].includes(r.status)) continue
        const h = Number(r.ot_hours ?? r.hours ?? 0)
        if (!tally[r.employee_id]) tally[r.employee_id] = { regular: 0, exception: 0 }
        if (r.is_exception) tally[r.employee_id].exception += h
        else                tally[r.employee_id].regular  += h
      }

      setEmployees(empRes.data || [])
      setOtByEmp(tally)
      setRecentImports(recRes.data || [])
    } catch (err) {
      console.error('Load failed:', err)
      toast.error('載入失敗：' + (err.message || ''))
    } finally {
      setLoading(false)
    }
  }, [orgId, month])

  useEffect(() => {
    if (isAuthorized) loadMonthStats()
  }, [isAuthorized, loadMonthStats])

  // ── CSV 解析 + lookup employees + 計算「加進後合計」──
  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''  // 重設讓同檔可重選
    const text = (await file.text()).replace(/^﻿/, '')
    parseCsv(text)
  }

  // ── 從 Google Sheet 直讀（gviz CSV；Sheet 須設「知道連結的人可檢視」）──
  // 月份分頁制：選的月份 2026-07 → 自動讀分頁「2026/7」，一條連結六個月通用
  const monthToTabName = (m) => {
    const [y, mm] = m.split('-')
    return `${y}/${Number(mm)}`  // 2026-07 → 2026/7
  }

  const readFromSheet = async () => {
    const url = sheetUrl.trim()
    if (!url) { toast.error('請先貼上 Google Sheet 連結'); return }
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (!idMatch) { toast.error('連結格式不對，請貼完整的 Google Sheet 網址'); return }
    const id = idMatch[1]
    const tab = monthToTabName(month)
    // 用分頁名讀（對應 OTX 選的月份），不靠 URL 裡的 gid
    const gviz = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`
    setReadingSheet(true)
    try {
      const resp = await fetch(gviz)
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const text = (await resp.text()).replace(/^﻿/, '')
      if (!text.trim()) { toast.error(`分頁「${tab}」是空的，或沒有這個分頁（確認月份選對 + Sheet 已公開）`); return }
      localStorage.setItem('otx_sheet_url', url)
      parseCsv(text)
      toast.success(`已讀取分頁「${tab}」`)
    } catch (err) {
      toast.error('讀取失敗：' + (err.message || '') + '（確認 Sheet 已設「知道連結的人可檢視」）')
    } finally {
      setReadingSheet(false)
    }
  }

  const parseCsv = async (text) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l)
    if (lines.length < 2) {
      toast.error('CSV 至少要有 header 跟 1 列資料')
      return
    }
    const header = parseCsvLine(lines[0]).map(c => c.trim())  // 用 parseCsvLine：相容 gviz 引號包住的欄名
    const headerMap = {}
    CSV_HEADERS.forEach(h => {
      const idx = header.indexOf(h)
      headerMap[h] = idx
    })
    if (headerMap['員工名稱'] < 0 || headerMap['日期'] < 0 || headerMap['時數'] < 0) {
      toast.error('CSV header 缺少必要欄（員工名稱 / 日期 / 時數），請下載模板確認格式')
      return
    }

    const rows = lines.slice(1).map((line, i) => {
      const cells = parseCsvLine(line)
      return {
        rowNum:     i + 2,
        name:       cells[headerMap['員工名稱']] || '',
        date:       cells[headerMap['日期']] || '',
        start_time: headerMap['開始時間'] >= 0 ? cells[headerMap['開始時間']] || '' : '',
        end_time:   headerMap['結束時間'] >= 0 ? cells[headerMap['結束時間']] || '' : '',
        hours:      parseFloat(cells[headerMap['時數']] || '0'),
        type:       headerMap['類型'] >= 0 ? cells[headerMap['類型']] || '一般' : '一般',
        reason:     headerMap['原因'] >= 0 ? cells[headerMap['原因']] || '' : '',
        note:       headerMap['備註'] >= 0 ? cells[headerMap['備註']] || '' : '',
      }
    })

    // 用名字 lookup employee_id（已在 employees state 內，但用 fresh fetch 確保涵蓋這次月份外的）
    const nameMap = {}
    for (const e of employees) {
      if (!nameMap[e.name]) nameMap[e.name] = []
      nameMap[e.name].push(e)
    }

    const enriched = rows.map(r => {
      const matches = nameMap[r.name] || []
      let issue = ''
      let employee = null
      if (matches.length === 0)      issue = '❌ 找不到員工'
      else if (matches.length > 1)   issue = `⚠️ 同名 ${matches.length} 人，請改用員編`
      else                            employee = matches[0]

      if (!issue && (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))) issue = '❌ 日期格式應為 YYYY-MM-DD'
      if (!issue && (!r.hours || r.hours <= 0)) issue = '❌ 時數需 > 0'
      if (!issue && r.hours > 12) issue = '❌ 單筆時數超過 12 小時'

      // 推算這筆會落到哪個月（依日期），跟使用者選的 month 是否同月
      const rowMonth = r.date?.slice(0, 7)
      const sameMonth = rowMonth === month

      // 該員工該月已有的 OT (regular + exception)
      const empTally = employee && otByEmp[employee.id]
        ? otByEmp[employee.id]
        : { regular: 0, exception: 0 }
      const existingTotal = empTally.regular + empTally.exception
      const newTotal = existingTotal + (r.hours || 0)

      return {
        ...r,
        employee,
        employee_id: employee?.id || null,
        issue,
        sameMonth,
        rowMonth,
        existingRegular:   empTally.regular,
        existingException: empTally.exception,
        existingTotal,
        newTotal,
        alreadyImported: false,
      }
    })

    // ── 防重複：比對 DB 已匯入的 exception OT（員工+日期+時數）標記，不重複進 ──
    const validForCheck = enriched.filter(r => r.employee_id && !r.issue)
    if (validForCheck.length > 0) {
      const empIds = [...new Set(validForCheck.map(r => r.employee_id))]
      const dates  = [...new Set(validForCheck.map(r => r.date))]
      const { data: existing } = await supabase
        .from('overtime_requests')
        .select('employee_id, request_date, ot_hours')
        .eq('is_exception', true)
        .in('employee_id', empIds)
        .in('request_date', dates)
      const dupSet = new Set((existing || []).map(o => `${o.employee_id}|${o.request_date}|${Number(o.ot_hours)}`))
      enriched.forEach(r => {
        if (r.employee_id && !r.issue) {
          r.alreadyImported = dupSet.has(`${r.employee_id}|${r.date}|${Number(r.hours)}`)
        }
      })

      // ── 預覽時就算出真正的類型（讀班表+國定假日，跟匯入時 trigger 同一支）──
      await Promise.all(validForCheck.map(async (r) => {
        const { data: cat } = await supabase.rpc('classify_ot_category_safe', {
          p_date: r.date, p_employee_id: r.employee_id,
        })
        r.realCategory = cat || null
      }))
    }
    setParsed(enriched)
  }

  // ── 統計：每員工該月加班/額外加總 ──
  // 薪資相關欄位已搬到上方嵌入的薪資管理，這裡只顯示 OT 統計
  const empStats = useMemo(() => {
    return employees
      .map(e => {
        const t = otByEmp[e.id] || { regular: 0, exception: 0 }
        const total = t.regular + t.exception
        return { ...e, regular: t.regular, exception: t.exception, total }
      })
      .filter(e => !statsSearch || e.name.includes(statsSearch) || e.employee_number?.includes(statsSearch))
      .filter(e => !showOnlyOver || e.total > LIMIT_MONTHLY_REGULAR)
      .sort((a, b) => b.total - a.total)
  }, [employees, otByEmp, statsSearch, showOnlyOver])

  // ── 匯入 ──
  const handleImport = async () => {
    const validRows = parsed.filter(r => !r.issue && r.employee_id && !r.alreadyImported)
    const dupCount  = parsed.filter(r => r.alreadyImported).length
    if (validRows.length === 0) { toast.error('沒有新的可匯入資料（其餘為無效或已匯入）'); return }
    if (!window.confirm(`確認匯入 ${validRows.length} 筆新加班紀錄？\n(略過 ${dupCount} 筆已匯入、${parsed.length - validRows.length - dupCount} 筆無效)`)) return

    setImporting(true)
    let success = 0, fail = 0
    const errors = []

    for (const r of validRows) {
      const payload = {
        employee: r.name,
        employee_id: r.employee_id,
        request_date: r.date,
        date: r.date,
        start_time: r.start_time || null,
        end_time: r.end_time || null,
        ot_hours: r.hours,
        hours: r.hours,
        ot_type: r.type || '一般',
        reason: r.reason || '(批次補登)',
        status: '已核准',
        organization_id: orgId,
        is_exception: true,
        exception_imported_at: new Date().toISOString(),
        exception_imported_by: profile?.id || null,
        exception_note: r.note,
      }
      const { error } = await supabase.from('overtime_requests').insert(payload)
      if (error) {
        fail++
        errors.push(`列 ${r.rowNum} (${r.name}): ${error.message}`)
      } else {
        success++
      }
    }
    setImporting(false)
    if (fail > 0) {
      console.error('Import errors:', errors)
      toast.error(`匯入完成：成功 ${success}、失敗 ${fail}（詳見 console）`)
    } else {
      toast.success(`✅ 匯入 ${success} 筆完成`)
    }
    setParsed([])
    loadMonthStats()
  }

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '加班補登模板.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── 權限拒絕 ──
  if (!profile) return <LoadingSpinner />
  if (!isAuthorized) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h3>❌ 沒有權限</h3>
        <p style={{ color: 'var(--text-muted)' }}>此頁面僅限 admin / super_admin 使用</p>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>回首頁</button>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {/* ─── Page header ─── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📥</span> 加班補登</h2>
            <p>批次匯入額外加班紀錄（管理員專用）</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={loadMonthStats} disabled={loading}>
              <RefreshCw size={14} /> 重整
            </button>
            <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
              <Download size={14} /> 下載 CSV 模板
            </button>
            <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
              <Upload size={14} /> 選 CSV 檔案
            </label>
          </div>
        </div>
      </div>

      {/* ─── 從 Google Sheet 直讀 ─── */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <FileSpreadsheet size={18} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Google Sheet 連結</span>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: 240, fontSize: 13 }}
            placeholder="貼上加班 Google Sheet 網址（須設「知道連結的人可檢視」）"
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
          />
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>月份</span>
          <input
            type="month"
            className="form-input"
            style={{ fontSize: 13, width: 150 }}
            value={month}
            onChange={e => setMonth(e.target.value)}
          />
          <button className="btn btn-primary" disabled={readingSheet} onClick={readFromSheet} style={{ whiteSpace: 'nowrap' }}>
            <FileSpreadsheet size={14} /> {readingSheet ? '讀取中…' : '讀取 Sheet'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          會自動讀取「<b>{(() => { const [y, mm] = month.split('-'); return `${y}/${Number(mm)}` })()}</b>」分頁（對應上方選的月份）。
          欄位需含 員工名稱 / 日期 / 時數（選填 開始時間 / 結束時間 / 類型 / 原因 / 備註）。連結會記住免再貼。
        </div>
      </div>

      {/* ─── 警語 ─── */}
      <div className="card" style={{ padding: 12, marginBottom: 16, background: 'var(--accent-orange-dim)', borderColor: 'var(--accent-orange)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertCircle size={18} style={{ color: 'var(--accent-orange)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong>注意</strong>：本頁匯入的紀錄會直接入帳，並會被薪資計算引用。
            每筆匯入會記錄操作人與時間，作為內部稽核追溯依據。請確認資料正確後再匯入。
          </div>
        </div>
      </div>

      {/* ─── CSV 解析狀態（按鈕在 header）─── */}
      {parsed.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          已解析 {parsed.length} 列 · 🟢 新筆 {parsed.filter(r => !r.issue && r.employee_id && !r.alreadyImported).length} · 🔵 已匯入 {parsed.filter(r => r.alreadyImported).length} · ⚠️ 無效 {parsed.filter(r => r.issue).length}
        </div>
      )}

      {/* ─── CSV 預覽 ─── */}
      {parsed.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">CSV 預覽（含計算）</div>
            <button className="btn btn-primary" disabled={importing}
              onClick={handleImport}>
              {importing ? '匯入中...' : `匯入 ${parsed.filter(r => !r.issue && r.employee_id && !r.alreadyImported).length} 筆新資料`}
            </button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 400 }}>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 12, width: '100%' }}>
                <thead>
                  <tr>
                    <th>狀態</th>
                    <th>列</th>
                    <th>員工</th>
                    <th>門市/部門</th>
                    <th>日期</th>
                    <th style={{ textAlign: 'right' }}>本筆時數</th>
                    <th>類型（系統判）</th>
                    <th style={{ textAlign: 'right' }}>該月已有<br/>(加班)</th>
                    <th style={{ textAlign: 'right' }}>該月已有<br/>(額外)</th>
                    <th style={{ textAlign: 'right', fontWeight: 700 }}>加後合計</th>
                    <th>警示</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => {
                    const valid = !r.issue
                    const w = valid && r.sameMonth ? warnLevel(r.newTotal) : null
                    return (
                      <tr key={i} style={!valid ? { background: 'rgba(239,68,68,0.06)' } : (w?.bg && w.bg !== 'transparent' ? { background: w.bg } : undefined)}>
                        <td>
                          {valid
                            ? <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />
                            : <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>{r.issue}</span>}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.rowNum}</td>
                        <td>{r.name} {r.employee?.employee_number && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({r.employee.employee_number})</span>}</td>
                        <td style={{ fontSize: 11 }}>{r.employee?.store || r.employee?.stores?.name || r.employee?.dept || r.employee?.departments?.name || '—'}</td>
                        <td>{r.date} {r.rowMonth !== month && <span style={{ fontSize: 10, color: 'var(--accent-orange)' }}>不同月</span>}</td>
                        <td style={{ textAlign: 'right' }}>{r.hours}</td>
                        <td>
                          {r.realCategory
                            ? <span style={{ fontWeight: 600, color: r.realCategory === 'weekday' ? 'var(--text-secondary)' : 'var(--accent-cyan)' }}>{CAT_LABEL[r.realCategory] || r.realCategory}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{valid && r.sameMonth ? r.existingRegular.toFixed(1) : '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{valid && r.sameMonth ? r.existingException.toFixed(1) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: w?.color || 'var(--text-muted)' }}>
                          {valid && r.sameMonth ? r.newTotal.toFixed(1) : '—'}
                        </td>
                        <td>
                          {w && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: w.color }}>
                              <AlertTriangle size={11} /> {w.label}
                            </span>
                          )}
                        </td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── 嵌入完整薪資管理（同 /hr/salary 全功能）─── */}
      <Salary />

      {/* ─── 最近匯入紀錄 ─── */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <FileSpreadsheet size={14} style={{ verticalAlign: 'middle' }} /> 最近匯入紀錄
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{recentImports.length} 筆</span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th>員工</th>
                  <th>日期</th>
                  <th style={{ textAlign: 'right' }}>時數</th>
                  <th>類型</th>
                  <th>原因</th>
                  <th>備註</th>
                  <th>匯入時間</th>
                </tr>
              </thead>
              <tbody>
                {recentImports.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>尚無匯入紀錄</td></tr>
                ) : recentImports.map(r => (
                  <tr key={r.id}>
                    <td>{r.employee}</td>
                    <td>{r.request_date}</td>
                    <td style={{ textAlign: 'right' }}>{r.ot_hours}</td>
                    <td>{r.ot_type}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.exception_note || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {r.exception_imported_at?.slice(0, 16).replace('T', ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── 統計面板：全員加班/額外時數總覽 ─── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title">
            <Calculator size={14} style={{ verticalAlign: 'middle' }} /> {month} 全員加班總覽
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="text" placeholder="搜尋姓名 / 員編"
              className="form-input" style={{ width: 180, fontSize: 12 }}
              value={statsSearch} onChange={e => setStatsSearch(e.target.value)} />
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showOnlyOver} onChange={e => setShowOnlyOver(e.target.checked)} />
              只看偏高
            </label>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><LoadingSpinner /></div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 460 }}>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 12, width: '100%', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>員編</th>
                    <th>部門</th>
                    <th style={{ textAlign: 'right' }}>加班</th>
                    <th style={{ textAlign: 'right' }}>額外</th>
                    <th style={{ textAlign: 'right', fontWeight: 700 }}>合計時數</th>
                    <th>警示</th>
                  </tr>
                </thead>
                <tbody>
                  {empStats.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無資料</td></tr>
                  ) : empStats.map(e => {
                    const w = warnLevel(e.total)
                    return (
                      <tr key={e.id}>
                        <td>{e.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{e.employee_number || '—'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.dept || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{e.regular.toFixed(1)}</td>
                        <td style={{ textAlign: 'right', color: e.exception > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                          {e.exception > 0 ? e.exception.toFixed(1) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: w.color }}>{e.total.toFixed(1)}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: w.color, background: w.bg }}>
                            {w.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
