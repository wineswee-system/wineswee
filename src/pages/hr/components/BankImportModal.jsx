import { useState } from 'react'
import { X, Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// 匯入員工銀行帳號（admin 專用）
// CSV 欄位：員工編號, 姓名, 銀行代號, 分行代號, 帳號（第一列若是標題自動跳過）
// CSV 在瀏覽器解析後逐列呼叫 import_employee_bank_account RPC（函式內已鎖只有 admin 能寫）。
// 檔案只在使用者瀏覽器 → 自己的 DB，不外傳。

function parseLine(line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

export default function BankImportModal({ onClose, onDone }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])      // parsed CSV rows (data only)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, fail, fails:[] }

  const handleFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name); setResult(null)
    const buf = await f.arrayBuffer()
    let text = new TextDecoder('utf-8').decode(buf)
    if (text.includes('�')) {
      try { text = new TextDecoder('big5').decode(buf) } catch { /* keep utf8 */ }
    }
    let lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(parseLine)
    if (lines.length && /編號|姓名|帳號|代號/.test(lines[0].join(''))) lines = lines.slice(1)
    setRows(lines)
  }

  const handleImport = async () => {
    if (rows.length === 0) { toast.error('請先選擇 CSV 檔'); return }
    setBusy(true)
    let ok = 0; const fails = []
    for (const r of rows) {
      const [empNo, name, bankCode, branch, account] = r
      const { data, error } = await supabase.rpc('import_employee_bank_account', {
        p_employee_number: empNo || '', p_name: name || '',
        p_bank_code: bankCode || '', p_bank_branch: branch || '', p_bank_account: account || '',
      })
      if (error) fails.push(`${empNo} ${name} — ${error.message}`)
      else if (data?.ok) ok++
      else fails.push(`${empNo} ${name} — ${data?.error === 'NOT_AUTHORIZED' ? '無權限(需 admin)' : (data?.error === 'EMPLOYEE_NOT_FOUND' ? '對不到員工' : data?.error)}`)
    }
    setBusy(false)
    setResult({ ok, fail: fails.length, fails })
    if (ok > 0) { toast.success(`成功匯入 ${ok} 筆`); onDone?.() }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12, width: 'min(560px, 94vw)', maxHeight: '88vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>匯入銀行帳號</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16, padding: 12, background: 'var(--glass-light)', borderRadius: 8 }}>
          CSV 欄位順序:<b>員工編號, 姓名, 銀行代號, 分行代號, 帳號</b><br />
          第一列標題會自動跳過;UTF-8 / Big5 都能讀。對不到的員工會列出來,改完再上傳即可(同人會覆蓋)。<br />
          <span style={{ color: 'var(--text-muted)' }}>檔案只在你瀏覽器解析 → 寫進你的資料庫,不外傳。僅 admin 可匯入。</span>
        </div>

        <label className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <Upload size={14} /> 選擇 CSV 檔
          <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
        </label>
        {fileName && <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-secondary)' }}>{fileName}（{rows.length} 筆）</span>}

        {result && (
          <div style={{ marginTop: 16, fontSize: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-green)', fontWeight: 700 }}>
              <CheckCircle2 size={16} /> 成功 {result.ok} 筆
            </div>
            {result.fail > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-orange)', fontWeight: 700 }}>
                  <AlertTriangle size={16} /> 對不到/失敗 {result.fail} 筆
                </div>
                <div style={{ marginTop: 6, maxHeight: 180, overflow: 'auto', fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 6, padding: 10 }}>
                  {result.fails.map((f, i) => <div key={i}>• {f}</div>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>關閉</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={busy || rows.length === 0}>
            {busy ? '匯入中…' : `匯入 ${rows.length} 筆`}
          </button>
        </div>
      </div>
    </div>
  )
}
