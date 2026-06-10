import { useState, useRef, useEffect, useMemo } from 'react'
import { Upload, CheckCircle2, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, FileSpreadsheet, Users, Calendar } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { formatShiftLabel, parseWorkRange } from '../../lib/scheduleUtils'
import { logger } from '../../lib/logger'

// ── 假別標籤 → schedules.absence_type（與 ABSENCE_CONFIG 對齊）────
const ABSENCE_MAP = {
  // 完整標籤（XLSX 常見格式）
  '例假日':     '例假',   // 勞基法 §36 強制例假
  '休息日':     '休息',   // 勞基法 §36 休息日（可加班）
  // 短格式（不帶「日」的縮寫）
  '例假':       '例假',
  '休息':       '休息',
  // 國定
  '國定假日':   '國定假', // 國定假日（獨立類型，非 §36）
  // 病/事/特休
  '病假':       '病',
  '特休':       '特休',
  '特休假':     '特休',
  '特別休假':   '特休',
  '事假':       '事',
  '公假':       '公',
  '補休':       '補休',
  '補休假':     '補休',
  '婚假':       '婚',
  '喪假':       '喪',
  '生理假':     '生',
  '產假':       '產',
  '陪產假':     '陪產',
  '育嬰假':     '育嬰',
  '產檢假':     '產檢',
  '工傷假':     '工傷',
  '家庭照顧假': '家',
  '心理健康假': '心',
  '會議':       '會議',
}
const OFF_LABELS = new Set(Object.keys(ABSENCE_MAP))

// ── 店名前綴辨識 ──────────────────────────────────────────
// 命名班別尾端的班型關鍵字：早/中/晚/大夜/小夜/日/夜/凌晨，後接可選「班」與數字
const SHIFT_SUFFIX_RE = /(早|中|晚|大夜|小夜|日|夜|凌晨)(班)?(\s*\d+)?$/
// 純 CJK 統一表意字元（U+4E00–U+9FFF 主區 + U+3400–U+4DBF 擴充A）
// 不含全形 ASCII（Ａ-Ｚ、０-９），避免全形字母的班別代碼前綴被誤判為店名
const CJK_RE = /^[一-鿿㐀-䶿]+$/

// 解析命名班別，抽出店名前綴
// "文心晚班 2" → { shift: "晚班 2", store: "文心" }
// "微風早"     → { shift: "早",     store: "微風" }
// "大夜班"     → { shift: "大夜班", store: null }   ← 無前綴
// "AU-正晚班"  → { shift: "AU-正晚班", store: null } ← 前綴含 ASCII，不視為店名
function parseNamedShift(raw) {
  const m = raw.match(SHIFT_SUFFIX_RE)
  if (!m || m.index === 0) return { shift: raw, store: null }
  const prefix = raw.slice(0, m.index).trim()
  // 店名至少 2 個 CJK 字元，避免單字（如 "豐"）被誤判
  if (prefix.length < 2 || !CJK_RE.test(prefix)) return { shift: raw, store: null }
  return { shift: raw.slice(m.index).trim(), store: prefix }
}

// ── 班別代碼正規化 ─────────────────────────────────────────
// normalizeShiftFull — 單一轉換路徑，回傳 { shift, store }
// 所有呼叫端透過此函式取值，確保 shift 與 store 永遠一致
// "AU-正11-20" → { shift: "11:00~20:00", store: null }
// "文心晚班 2" → { shift: "晚班 2",       store: "文心" }
// "大夜班"     → { shift: "大夜班",        store: null }
function normalizeShiftFull(raw) {
  if (!raw) return { shift: raw, store: null }
  const direct = formatShiftLabel(raw)
  if (direct !== raw) return { shift: direct, store: null }
  const m = raw.match(/(\d{1,4}[-~]\d{1,4})$/)
  if (m) {
    const normalized = formatShiftLabel(m[1])
    if (normalized !== m[1]) {
      // 確認抽出的小時值合理（0–23），防止非時間數字被誤判為時段
      const hm = normalized.match(/^(\d{2}):\d{2}~(\d{2}):\d{2}$/)
      if (hm && parseInt(hm[1]) <= 23 && parseInt(hm[2]) <= 23) {
        return { shift: normalized, store: null }
      }
    }
  }
  return parseNamedShift(raw)
}

// 僅需班別字串時的便利包裝（多行合併、純班別比對等場合）
function normalizeShift(raw) {
  return normalizeShiftFull(raw).shift
}

// ── 員工姓名正規化 ─────────────────────────────────────────
// 去除 "0001 林襄" 格式的員工編號前綴
function normalizeName(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^\S*\d+\s+(.+)$/)
  return m ? m[1].trim() : s
}

// ── XLSX 解析（純函式，無副作用）────────────────────────────
function parseScheduleXlsx(buffer) {
  const wb  = XLSX.read(buffer, { type: 'array' })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const companyRaw   = String(raw[0]?.[0] || '').replace('公司名稱：', '').trim()
  const dateRangeRaw = String(raw[3]?.[0] || '').replace('起迄時間：', '').trim()
  const exportedRaw  = String(raw[2]?.[0] || '').replace('匯出日期：', '').trim()

  // 從日期範圍抓年份（例：2026/04/01 ~ 2026/04/30）
  const yearMatch = dateRangeRaw.match(/(\d{4})/)
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear())

  // Row 5（0-base）= 欄位標題行
  const headers     = (raw[5] || []).map(String)
  const dateHeaders = headers.slice(4) // 跳過 員工編號,姓名,部門,群組

  // "04/01(三)" → "YYYY-MM-DD"
  const dates = dateHeaders.map(h => {
    const m = h.match(/(\d{2})\/(\d{2})/)
    return m ? `${year}-${m[1]}-${m[2]}` : null
  })

  const empList = []
  const records = []

  for (const row of raw.slice(6)) {
    const empNo = String(row[0] || '').trim()
    if (!empNo) continue
    const name  = normalizeName(row[1])
    if (!name)  continue
    const dept  = String(row[2] || '').trim()

    let empRecordCount = 0

    for (let i = 0; i < dateHeaders.length; i++) {
      const date    = dates[i]
      if (!date) continue
      const rawCell = String(row[4 + i] || '').trim()
      if (!rawCell) {
        records.push({ employee: name, employee_no: empNo, date, shift: '休息', absence_type: '休息', month_group: date.slice(0, 7), store: null })
        empRecordCount++
        continue
      }

      // 多行 cell（\n 分隔）
      const lines     = rawCell.split('\n').map(l => l.trim()).filter(Boolean)
      const firstLine = lines[0]

      let shift        = null
      let absence_type = null
      let store        = null  // 店名前綴（顯示用，不寫入 DB）

      const offType = ABSENCE_MAP[firstLine]
      if (offType) {
        absence_type = offType
        if (lines.length > 1 && !OFF_LABELS.has(lines[1])) {
          // 第二行是班別代碼（假日加班）→ 正規化班別，並嘗試抽店名
          ;({ shift, store } = normalizeShiftFull(lines[1]))
        } else {
          // 純假日/休息 → shift 與 absence_type 一致
          shift = offType
        }
      } else if (lines.length > 1) {
        // 兩段時間 → 各自正規化再合併；取第一個找到的店名
        const parts = lines.map(normalizeShiftFull)
        shift = parts.map(p => p.shift).join(' / ')
        store = parts.find(p => p.store)?.store || null
      } else {
        ;({ shift, store } = normalizeShiftFull(firstLine))
      }

      records.push({ employee: name, employee_no: empNo, date, shift, absence_type: absence_type || null, month_group: date.slice(0, 7), store })
      empRecordCount++
    }

    empList.push({ empNo, name, dept, recordCount: empRecordCount })
  }

  return { meta: { company: companyRaw, dateRange: dateRangeRaw, exportedAt: exportedRaw, year }, empList, records }
}

// ── 班別定義目錄解析（掃描所有工作表找 班別名稱/工作範圍 標頭）────
function parseShiftCatalog(wb) {
  for (const sheetName of wb.SheetNames) {
    const ws  = wb.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    for (let ri = 0; ri < Math.min(raw.length, 20); ri++) {
      const row      = raw[ri].map(c => String(c).trim())
      const nameCol  = row.findIndex(c => c === '班別名稱' || c === '班別')
      const rangeCol = row.findIndex(c => c === '工作範圍' || c === '工作時間' || c === '工作時段')
      if (nameCol < 0 || rangeCol < 0) continue
      const defs = []
      for (let i = ri + 1; i < raw.length; i++) {
        const name     = String(raw[i][nameCol]  || '').trim()
        const rangeRaw = String(raw[i][rangeCol] || '').trim()
        if (!name) continue
        const parsed = rangeRaw ? parseWorkRange(rangeRaw) : null
        defs.push({ name, rangeRaw, ...(parsed || {}) })
      }
      if (defs.length > 0) return defs
    }
  }
  return []
}

// ── 班別目錄工時對應 ──────────────────────────────────────
// 嘗試四種策略匹配班別名稱到目錄中的時段
//   1. 直接比對 shift
//   2. 店名前綴重組：store + shift（"微風" + "早" → "微風早"）
//   3. 剝去代碼前綴："文-文心晚班 2" → "文心晚班 2"
//   4. 直接從班別字串 parse 時段（"11:00~20:00" 本身就是時間範圍）
function resolveShiftTime(shift, store, catalogMap) {
  if (!shift) return null
  if (catalogMap?.size) {
    if (catalogMap.has(shift)) return catalogMap.get(shift)
    if (store && catalogMap.has(store + shift)) return catalogMap.get(store + shift)
    const stripped = shift.replace(/^[\w一-鿿]{1,3}-/, '')
    if (stripped !== shift && catalogMap.has(stripped)) return catalogMap.get(stripped)
  }
  // 班別代碼已被 normalizeShiftFull 轉為 "HH:MM~HH:MM" — 直接 parse 時段
  return parseWorkRange(shift)
}

// ── 員工列（可展開顯示每日班別）────────────────────────────
function EmpRow({ emp, dbMatched, resigned, records, catalogMap }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <tr
        onClick={() => setOpen(v => !v)}
        style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <td style={{ padding: '8px 12px', width: 24, color: 'var(--text-muted)' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
          {emp.empNo}
        </td>
        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{emp.name}</td>
        <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)' }}>{emp.dept}</td>
        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: !dbMatched ? 'var(--accent-orange-dim)' : resigned ? 'var(--accent-purple-dim)' : 'var(--accent-green-dim)',
            color:      !dbMatched ? 'var(--accent-orange)'     : resigned ? 'var(--accent-purple)'     : 'var(--accent-green)',
          }}>
            {!dbMatched ? '! 未找到' : resigned ? '↩ 已離職' : '✓ 已對應'}
          </span>
        </td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>
          {emp.recordCount} 筆
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <div style={{
              background: 'var(--bg-tertiary)', padding: '10px 16px',
              borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto',
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {records.map((r, i) => {
                  const isOff     = !!(r.absence_type && r.shift === r.absence_type)
                  const isOT      = !!(r.absence_type && r.shift !== r.absence_type)
                  const resolved  = !isOff ? resolveShiftTime(r.shift, r.store, catalogMap) : null
                  return (
                    <div key={i} title={`${r.date} ${r.shift}${resolved ? ` → ${resolved.start}~${resolved.end} (${resolved.netHours}h淨)` : ''}`} style={{
                      fontSize: 11, padding: '3px 7px', borderRadius: 6,
                      background: isOff ? 'var(--bg-secondary)' : isOT ? 'var(--accent-orange-dim)' : 'var(--accent-cyan-dim)',
                      color:      isOff ? 'var(--text-muted)'   : isOT ? 'var(--accent-orange)'     : 'var(--accent-cyan)',
                      border: '1px solid var(--border-subtle)',
                    }}>
                      <span style={{ opacity: 0.65 }}>{r.date.slice(5)}</span>{' '}
                      {resolved ? `${resolved.start}~${resolved.end}` : r.shift}
                      {isOT && <span style={{ opacity: 0.6, marginLeft: 3 }}>({r.absence_type})</span>}
                    </div>
                  )
                })}
                {records.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>無班次資料</span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── 主元件 ───────────────────────────────────────────────────
export default function ScheduleXlsxImport() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id

  const [dbEmployees,   setDbEmployees] = useState([])
  const [empsLoading,   setEmpsLoading] = useState(false)
  const [parsed,        setParsed]      = useState(null)   // { meta, empList, records }
  const [enriched,      setEnriched]    = useState([])     // records + dbEmp
  const [unmatchedEmps, setUnmatched]   = useState([])
  const [dupMode,         setDupMode]       = useState('overwrite')
  const [importing,       setImporting]     = useState(false)
  const [result,          setResult]        = useState(null)
  const [dragging,        setDragging]      = useState(false)
  const [shiftCatalog,    setShiftCatalog]  = useState([])
  const [catalogDragging, setCatalogDrag]  = useState(false)
  const [savedCatalog,    setSavedCatalog] = useState(null)
  const fileRef    = useRef(null)
  const catalogRef = useRef(null)

  // 從 localStorage 載入上次班別定義（per-org）
  useEffect(() => {
    if (!orgId) return
    try {
      const raw = localStorage.getItem(`sme_shift_catalog_${orgId}`)
      if (raw) setSavedCatalog(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [orgId])

  // 含離職員工 — 匯入歷史排班仍需對應到已離職者的 employee_id
  useEffect(() => {
    if (!orgId) return
    setEmpsLoading(true)
    supabase
      .from('employees')
      .select('id, name, employee_number, status')
      .eq('organization_id', orgId)
      .then(({ data }) => {
        setDbEmployees(data || [])
        setEmpsLoading(false)
      })
  }, [orgId])

  // 員工資料或解析結果更新時重新比對（處理競態：解析先於 DB 回應）
  useEffect(() => {
    if (!parsed || dbEmployees.length === 0) return
    matchEmployees(parsed, dbEmployees)
  }, [dbEmployees, parsed]) // eslint-disable-line react-hooks/exhaustive-deps

  // 比對 DB 員工
  function matchEmployees(parsedData, dbEmps) {
    const lookup = (name, no) =>
      dbEmps.find(e => e.name === name || e.employee_number === no) || null

    const enrichedList = parsedData.records.map(r => ({
      ...r,
      dbEmp: lookup(r.employee, r.employee_no),
      organization_id: orgId,
    }))
    setEnriched(enrichedList)

    const unmatched = parsedData.empList.filter(
      e => !lookup(e.name, e.empNo)
    )
    setUnmatched(unmatched)
  }

  async function handleFile(file) {
    if (!file) return
    if (empsLoading) { toast.error('員工資料載入中，請稍候再試'); return }
    if (!file.name.match(/\.xlsx?$/i)) { toast.error('請選擇 .xlsx 或 .xls 檔案'); return }
    setResult(null); setParsed(null); setEnriched([]); setUnmatched([]); setShiftCatalog([])

    const buffer = await file.arrayBuffer()
    const bytes  = new Uint8Array(buffer)
    try {
      const wb         = XLSX.read(bytes, { type: 'array' })
      const parsedData = parseScheduleXlsx(bytes)
      const catalog    = parseShiftCatalog(wb)
      setParsed(parsedData)
      setShiftCatalog(catalog)
    } catch (err) {
      toast.error('解析失敗：' + err.message)
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  async function handleCatalogFile(file) {
    if (!file) return
    if (!file.name.match(/\.xlsx?$/i)) { toast.error('請選擇 .xlsx / .xls 檔案'); return }
    const buffer = await file.arrayBuffer()
    try {
      const wb      = XLSX.read(new Uint8Array(buffer), { type: 'array' })
      const catalog = parseShiftCatalog(wb)
      if (catalog.length === 0) {
        toast.error('未找到班別定義欄位（需含「班別名稱」與「工作範圍」欄）')
      } else {
        setShiftCatalog(catalog)
        setSavedCatalog(catalog)
        try { localStorage.setItem(`sme_shift_catalog_${orgId}`, JSON.stringify(catalog)) } catch { /* storage full */ }
        toast.success(`已載入 ${catalog.length} 筆班別定義`)
      }
    } catch (err) {
      toast.error('班別定義解析失敗：' + err.message)
    }
  }

  function onDropCatalog(e) {
    e.preventDefault(); setCatalogDrag(false)
    handleCatalogFile(e.dataTransfer.files[0])
  }

  function handleReuseCatalog() {
    if (!savedCatalog?.length) return
    setShiftCatalog(savedCatalog)
    toast.success(`已套用上次班別定義（${savedCatalog.length} 筆）`)
  }

  async function handleImport() {
    const toImport = enriched.filter(r => r.dbEmp)
    if (!toImport.length) { toast.error('沒有可匯入的有效資料'); return }
    setImporting(true)

    const rows = toImport.map(r => {
      const resolved = resolveShiftTime(r.shift, r.store, catalogMap)
      return {
        organization_id: orgId,
        employee:        r.employee,
        employee_id:     r.dbEmp?.id ?? null,
        date:            r.date,
        shift:           r.shift,
        absence_type:    r.absence_type,
        month_group:     r.month_group,
        actual_start:    resolved?.start ?? null,
        actual_end:      resolved?.end   ?? null,
      }
    })

    const CHUNK = 500
    let inserted = 0, errored = 0

    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK)
        if (dupMode === 'overwrite') {
          const { error } = await supabase.from('schedules').upsert(chunk, { onConflict: 'employee,date' })
          if (error) { errored += chunk.length; logger.error('schedule upsert failed', { error, chunkSize: chunk.length }) }
          else inserted += chunk.length
        } else {
          const { error } = await supabase.from('schedules').insert(chunk)
          if (error?.code === '23505') { /* skipped */ }
          else if (error) { errored += chunk.length; logger.error('schedule insert failed', { error, chunkSize: chunk.length }) }
          else inserted += chunk.length
        }
      }
      setResult({ inserted, errored })
      if (inserted > 0) toast.success(`匯入完成：${inserted} 筆班表已寫入`)
    } catch (err) {
      toast.error('匯入中斷：' + err.message)
    }
    setImporting(false)
  }

  function reset() {
    setParsed(null); setEnriched([]); setUnmatched([]); setResult(null)
    setShiftCatalog([])
    if (fileRef.current) fileRef.current.value = ''
  }

  // 班別目錄 Map（name → def）— 用於工時對應與匯入填值
  const catalogMap = useMemo(() => {
    const m = new Map()
    for (const d of shiftCatalog) {
      if (d.name && d.start && d.end) m.set(d.name, d)
    }
    return m
  }, [shiftCatalog])

  // 衍生統計（三類互斥：一般班次 + 假日加班 + 例休/假日 = matchedRecs）
  // 判斷依據：純假日的 shift === absence_type；假日加班的 shift 是實際時段（≠ absence_type）
  const matchedRecs    = enriched.filter(r => r.dbEmp)
  const offRecs        = matchedRecs.filter(r => r.absence_type && r.shift === r.absence_type)
  const holidayOTRecs  = matchedRecs.filter(r => r.absence_type && r.shift !== r.absence_type)
  const pureWorkRecs   = matchedRecs.filter(r => !r.absence_type)
  const resolvedCount  = pureWorkRecs.filter(r => resolveShiftTime(r.shift, r.store, catalogMap)).length

  return (
    <div style={{ padding: 28, maxWidth: 1100 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>排班總表匯入</h2>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', fontSize: 14 }}>
        支援標準排班總表 XLSX 格式。解析後預覽員工對應與班次，確認無誤再寫入資料庫。
      </p>

      {/* ── 拖曳 / 選擇區 ── */}
      {!parsed && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
            borderRadius: 16, padding: '60px 40px', textAlign: 'center',
            background: dragging ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
            transition: 'all .15s', cursor: 'pointer',
          }}
        >
          <FileSpreadsheet size={48} style={{ color: 'var(--accent-cyan)', marginBottom: 16 }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            拖曳排班總表 XLSX 到這裡
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
            或點擊選擇檔案 &nbsp;·&nbsp; 支援 .xlsx / .xls
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 24px', borderRadius: 8,
            background: 'var(--accent-cyan)', color: '#fff', fontSize: 14, fontWeight: 600,
          }}>
            <Upload size={16} /> 選擇檔案
          </span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}

      {/* ── 解析後 UI ── */}
      {parsed && (
        <>
          {/* 檔案資訊列 */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20,
            padding: '16px 20px', borderRadius: 12,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
          }}>
            <FileSpreadsheet size={32} style={{ color: 'var(--accent-cyan)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>
                {parsed.meta.company || '排班總表'}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {parsed.meta.dateRange}&nbsp;·&nbsp;匯出：{parsed.meta.exportedAt}
              </div>
            </div>
            <button onClick={reset} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
            }}>
              重選檔案
            </button>
          </div>

          {/* 統計卡片 */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {[
              { label: '員工數',    value: parsed.empList.length,  color: 'var(--accent-cyan)',   icon: Users },
              { label: '一般班次',  value: pureWorkRecs.length,   color: 'var(--accent-green)',  icon: Calendar },
              { label: '例休/假日', value: offRecs.length,        color: 'var(--text-muted)',    icon: Calendar },
              { label: '假日加班',  value: holidayOTRecs.length,  color: 'var(--accent-orange)', icon: Calendar },
              { label: '未對應員工', value: unmatchedEmps.length,  color: unmatchedEmps.length > 0 ? 'var(--accent-red)' : 'var(--accent-green)', icon: Users },
              ...(catalogMap.size > 0 ? [{ label: '已對應工時', value: `${resolvedCount}/${pureWorkRecs.length}`, color: resolvedCount > 0 ? 'var(--accent-green)' : 'var(--text-muted)', icon: Calendar }] : []),
            ].map(s => (
              <div key={s.label} style={{
                flex: '1 1 140px', padding: '14px 18px', borderRadius: 12,
                background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* 未對應警告 */}
          {unmatchedEmps.length > 0 && (
            <div style={{
              display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 10, marginBottom: 20,
              background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)',
              alignItems: 'flex-start',
            }}>
              <AlertTriangle size={18} style={{ color: 'var(--accent-orange)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13 }}>
                <strong>找不到 {unmatchedEmps.length} 位員工</strong>（其班次將略過）：
                {unmatchedEmps.map(e => e.name).join('、')}
              </div>
            </div>
          )}

          {/* 操作列 */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>重複班次：</span>
              {[{ val: 'overwrite', label: '覆蓋（推薦）' }, { val: 'skip', label: '跳過' }].map(opt => (
                <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="radio" name="dupMode" value={opt.val}
                    checked={dupMode === opt.val} onChange={() => setDupMode(opt.val)} />
                  {opt.label}
                </label>
              ))}
            </div>

            <button
              onClick={handleImport}
              disabled={importing || matchedRecs.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                border: 'none', cursor: matchedRecs.length > 0 ? 'pointer' : 'not-allowed',
                background: matchedRecs.length > 0 ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                color: matchedRecs.length > 0 ? '#fff' : 'var(--text-muted)',
              }}
            >
              {importing
                ? <><RefreshCw size={15} className="spin" /> 匯入中…</>
                : `匯入 ${matchedRecs.length} 筆班次到資料庫`}
            </button>
          </div>

          {/* 匯入結果 */}
          {result && (
            <div style={{
              display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 10, marginBottom: 20,
              background: result.errored > 0 ? 'var(--accent-orange-dim)' : 'var(--accent-green-dim)',
              border: `1px solid ${result.errored > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'}`,
              alignItems: 'center',
            }}>
              <CheckCircle2 size={18} style={{ color: result.errored > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }} />
              <span style={{ fontSize: 13 }}>
                已寫入 <strong>{result.inserted}</strong> 筆
                {result.errored > 0 && <> ，<strong style={{ color: 'var(--accent-red)' }}>{result.errored}</strong> 筆失敗</>}
              </span>
            </div>
          )}

          {/* 班別定義目錄 */}
          <div style={{ marginTop: 24, border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>班別定義目錄</span>
              {shiftCatalog.length > 0
                ? <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)' }}>{shiftCatalog.length} 筆</span>
                : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>未載入</span>
              }
              <span style={{ flex: 1 }} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <Upload size={12} />
                {shiftCatalog.length > 0 ? '重新上傳' : '上傳班別定義 XLSX'}
                <input ref={catalogRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                  onChange={e => handleCatalogFile(e.target.files[0])} />
              </label>
            </div>
            {shiftCatalog.length === 0 ? (
              <>
                {savedCatalog?.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--bg-secondary)',
                  }}>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
                      上次已上傳班別定義（{savedCatalog.length} 筆）
                    </span>
                    <button
                      onClick={handleReuseCatalog}
                      style={{
                        padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)',
                        border: '1px solid var(--accent-purple)', cursor: 'pointer',
                      }}
                    >
                      ↩ 套用上次
                    </button>
                  </div>
                )}
                <div
                  onDragOver={e => { e.preventDefault(); setCatalogDrag(true) }}
                  onDragLeave={() => setCatalogDrag(false)}
                  onDrop={onDropCatalog}
                  onClick={() => catalogRef.current?.click()}
                  style={{
                    padding: '32px 24px', textAlign: 'center', cursor: 'pointer',
                    background: catalogDragging ? 'var(--accent-purple-dim)' : 'var(--bg-secondary)',
                    outline: catalogDragging ? '2px dashed var(--accent-purple)' : undefined,
                    transition: 'all .15s',
                  }}
                >
                  <Upload size={28} style={{ color: 'var(--accent-purple)', marginBottom: 10 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>拖曳班別定義 XLSX 到這裡</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>需含「班別名稱」與「工作範圍」欄位</div>
                </div>
              </>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 320 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>班別名稱</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>工作範圍（原始）</th>
                      <th style={{ padding: '6px 12px', textAlign: 'center' }}>開始</th>
                      <th style={{ padding: '6px 12px', textAlign: 'center' }}>結束</th>
                      <th style={{ padding: '6px 12px', textAlign: 'center' }}>跨日</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>毛工時</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>淨工時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftCatalog.map((d, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '5px 12px', fontWeight: 600 }}>{d.name}</td>
                        <td style={{ padding: '5px 12px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{d.rangeRaw || '—'}</td>
                        <td style={{ padding: '5px 12px', textAlign: 'center' }}>{d.start || <span style={{ color: 'var(--accent-red)' }}>?</span>}</td>
                        <td style={{ padding: '5px 12px', textAlign: 'center' }}>{d.end   || <span style={{ color: 'var(--accent-red)' }}>?</span>}</td>
                        <td style={{ padding: '5px 12px', textAlign: 'center' }}>
                          {d.crossMidnight
                            ? <span style={{ color: 'var(--accent-orange)', fontSize: 11 }}>跨日</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ padding: '5px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {d.grossHours != null ? `${d.grossHours}h` : '—'}
                        </td>
                        <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                          {d.netHours != null ? `${d.netHours}h` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 員工預覽表 */}
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)', fontWeight: 600, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Users size={16} style={{ color: 'var(--text-muted)' }} />
              員工班表預覽
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                · 點擊展開查看各日班別
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', fontSize: 12, color: 'var(--text-muted)' }}>
                  <th style={{ width: 24 }} />
                  <th style={{ padding: '8px 4px', textAlign: 'left' }}>員工編號</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>姓名</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>部門</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>資料庫對應</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>班次筆數</th>
                </tr>
              </thead>
              <tbody>
                {parsed.empList.map(emp => {
                  const dbEmp     = dbEmployees.find(d => d.name === emp.name || d.employee_number === emp.empNo)
                  const dbMatched = !!dbEmp
                  const resigned  = dbEmp?.status === '離職'
                  const empRecs = enriched.filter(r => r.employee_no === emp.empNo)
                  return (
                    <EmpRow key={emp.empNo} emp={emp} dbMatched={dbMatched} resigned={resigned} records={empRecs} catalogMap={catalogMap} />
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
