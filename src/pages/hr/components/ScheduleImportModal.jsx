import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Upload, Download, X, CheckCircle, AlertTriangle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// CSV 欄位順序
const CSV_HEADERS = ['員工名稱', '日期', '班別', '門市']
const CSV_TEMPLATE = '﻿' + CSV_HEADERS.join(',') + '\n' +
  '範例：張庭瑋,2026-06-07,11~20,台北永春\n' +
  '範例：黃蘊珊,2026-06-07,休,\n' +
  '範例：林巧玉,2026-06-08,11:00~20:00,六張犁\n'

const ABSENCE_TYPES = ['休', '補休', '特休', '病', '事', '婚', '喪', '公', '產', '生', '工傷', '陪產', '會議']

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue }
    if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  out.push(cur.trim())
  return out
}

// 標準化時段：11~20 / 11:00~20:00 / 1100-2000 → start, end (HH:MM)
function normalizeShift(raw) {
  if (!raw) return null
  if (ABSENCE_TYPES.includes(raw)) return { type: 'absence', shift: raw }

  // 把 -, ～, －, — 統一成 ~
  const txt = raw.replace(/[-～－—]/g, '~')
  const m = txt.match(/^(\d{1,2}):?(\d{0,2})~(\d{1,2}):?(\d{0,2})$/)
  if (!m) return null

  const sh = String(m[1]).padStart(2, '0')
  const sm = (m[2] || '00').padStart(2, '0')
  const eh = String(m[3]).padStart(2, '0')
  const em = (m[4] || '00').padStart(2, '0')
  const start = `${sh}:${sm}`
  const end   = `${eh}:${em}`
  const label = `${m[1]}~${m[3]}`  // 顯示簡化
  return { type: 'time', shift: label, start, end }
}

export default function ScheduleImportModal({ open, onClose, employees, stores, orgId, onImported }) {
  const [parsed, setParsed] = useState([])
  const [importing, setImporting] = useState(false)

  if (!open) return null

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '排班匯入模板.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const text = (await file.text()).replace(/^﻿/, '')
    parseCsv(text)
  }

  const parseCsv = (text) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l)
    if (lines.length < 2) {
      toast.error('CSV 內容太少（至少要 header + 1 行）')
      return
    }

    // 驗 header
    const header = parseCsvLine(lines[0])
    const headerOk = CSV_HEADERS.every(h => header.includes(h))
    if (!headerOk) {
      toast.error(`CSV header 欄位不符，需要：${CSV_HEADERS.join(', ')}`)
      return
    }
    const idx = {
      name: header.indexOf('員工名稱'),
      date: header.indexOf('日期'),
      shift: header.indexOf('班別'),
      store: header.indexOf('門市'),
    }

    const storeNames = new Set((stores || []).map(s => s.name))
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i])
      const name = cells[idx.name]
      const date = cells[idx.date]
      const shiftRaw = cells[idx.shift]
      const store = cells[idx.store]?.trim()

      const row = { rowNum: i + 1, name, date, shiftRaw, store, issue: null }

      // 跳過範例列
      if (name?.startsWith('範例')) continue

      // 驗欄位
      if (!name || !date || !shiftRaw) {
        row.issue = '欄位不完整'
        rows.push(row)
        continue
      }

      // 驗日期
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        row.issue = '日期格式錯（要 YYYY-MM-DD）'
        rows.push(row)
        continue
      }

      // 找員工（name 唯一就用，重名要提示）
      const empMatches = (employees || []).filter(e => e.name === name)
      if (empMatches.length === 0) { row.issue = '找不到員工'; rows.push(row); continue }
      if (empMatches.length > 1)   { row.issue = '員工重名'; rows.push(row); continue }
      const emp = empMatches[0]
      row.employee_id = emp.id
      row.employee = emp

      // 驗門市（空 = 用主店；有值 = 必須在 stores 清單裡 + 員工授權的店）
      if (store) {
        if (!storeNames.has(store)) {
          row.issue = `門市 ${store} 不存在`
          rows.push(row)
          continue
        }
        const allowed = [emp.store, ...(emp.additional_stores || [])].filter(Boolean)
        if (!allowed.includes(store)) {
          row.issue = `員工未授權門市 ${store}`
          rows.push(row)
          continue
        }
        row.source_store = store
      } else {
        row.source_store = emp.store || null
      }

      // 解析班別
      const norm = normalizeShift(shiftRaw)
      if (!norm) {
        row.issue = `班別格式錯：${shiftRaw}`
        rows.push(row)
        continue
      }
      row.shift = norm.shift
      row.actual_start = norm.start || null
      row.actual_end = norm.end || null
      row.shift_type = norm.type

      rows.push(row)
    }
    setParsed(rows)
  }

  const validRows = parsed.filter(r => !r.issue && r.employee_id)

  const handleImport = async () => {
    if (validRows.length === 0) { toast.error('沒有可匯入的有效資料'); return }
    if (!window.confirm(`確認匯入 ${validRows.length} 筆排班？\n會覆蓋同員工同日期的舊資料`)) return
    setImporting(true)
    let success = 0
    let fail = 0
    let errors = []

    // 批次匯入走 import_schedules RPC：一次呼叫，RPC 內逐列 upsert(employee+date)+savepoint，
    // 取代原本 N 列 2N 次網路來回；一列壞不影響其他，回 success/fail/errors。
    const rows = validRows.map(r => ({
      rowNum: r.rowNum, name: r.name, date: r.date, shift: r.shift,
      actual_start: r.actual_start, actual_end: r.actual_end, source_store: r.source_store,
    }))
    const { data: res, error: impErr } = await supabase.rpc('import_schedules', {
      p_rows: rows,
      p_org: orgId || null,
    })
    if (impErr || !res?.ok) {
      fail = validRows.length
      errors = [impErr?.message || res?.error || '未知錯誤']
    } else {
      success = res.success
      fail = res.fail
      errors = (res.errors || []).map(e => `列 ${e.row} (${e.name} ${e.date}): ${e.error}`)
    }

    setImporting(false)
    if (fail > 0) {
      console.error('Import errors:', errors)
      toast.error(`匯入完成：成功 ${success}、失敗 ${fail}（詳見 console）`)
    } else {
      toast.success(`匯入完成：${success} 筆`)
    }
    onImported?.()
    setParsed([])
    onClose()
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '4vh 20px 20px', overflow: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', borderRadius: 12,
        border: '1px solid var(--border-medium)', boxShadow: 'var(--shadow-xl)',
        width: '100%', maxWidth: 980,
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📤 匯入排班 CSV</h3>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          {/* 動作列 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
              <Download size={14} /> 下載 CSV 模板
            </button>
            <label className="btn btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
              <Upload size={14} /> 選 CSV 檔案
            </label>
            {parsed.length > 0 && (
              <button className="btn btn-primary" onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? '匯入中...' : `確認匯入 ${validRows.length} 筆`}
              </button>
            )}
          </div>

          {/* 說明 */}
          <div style={{ padding: 10, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-card)', borderRadius: 6 }}>
            <strong>CSV 欄位：</strong>員工名稱、日期(YYYY-MM-DD)、班別、門市<br />
            <strong>班別格式：</strong>時段（<code>11~20</code> / <code>11:00~20:00</code>）或假別（休/補休/特休/病/事/會議/產 等）<br />
            <strong>門市：</strong>空白 = 用員工主店；填的話必須是員工授權的店（主店或可支援門市）<br />
            <strong>覆寫規則：</strong>同員工同日期會直接覆蓋舊資料
          </div>

          {/* 預覽表 */}
          {parsed.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: 400, border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
              <table style={{ width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
                  <tr>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>狀態</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>列</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>員工</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>日期</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>班別</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>門市</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => (
                    <tr key={i} style={{
                      background: r.issue ? 'rgba(239,68,68,0.05)' : undefined,
                      borderTop: '1px solid var(--border-subtle)',
                    }}>
                      <td style={{ padding: '5px 8px' }}>
                        {r.issue
                          ? <span style={{ color: 'var(--accent-red)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={12} /> {r.issue}</span>
                          : <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />}
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{r.rowNum}</td>
                      <td style={{ padding: '5px 8px' }}>{r.name}</td>
                      <td style={{ padding: '5px 8px' }}>{r.date}</td>
                      <td style={{ padding: '5px 8px' }}>{r.shiftRaw}</td>
                      <td style={{ padding: '5px 8px', color: r.source_store && r.employee && r.source_store !== r.employee.store ? 'var(--accent-purple)' : undefined }}>
                        {r.source_store || '（主店）'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
