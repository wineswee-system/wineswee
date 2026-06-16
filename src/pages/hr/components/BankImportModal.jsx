import { useState, useEffect, useCallback } from 'react'
import { X, Upload, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// 匯入 + 核對員工銀行帳號（admin 專用）
// CSV 欄位：員工編號, 姓名, 銀行代號, 分行代號, 帳號（第一列若是標題自動跳過）
// 檔案只在使用者瀏覽器解析 → 自己的 DB，不外傳。僅 admin 可讀寫（RPC / RLS 鎖死）。

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

export default function BankImportModal({ onClose }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  // 核對清單
  const [roster, setRoster] = useState([])
  const [loadingRoster, setLoadingRoster] = useState(true)
  const [showFull, setShowFull] = useState(false)

  // 撈在職員工 + 各自帳號（admin 才讀得到帳號;RLS 把關）
  const loadRoster = useCallback(async () => {
    setLoadingRoster(true)
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, employee_number, status, employee_bank_accounts(bank_code, bank_branch, bank_account)')
      .eq('status', '在職')
      .order('name')
    if (error) { toast.error('讀取清單失敗：' + error.message); setRoster([]) }
    else setRoster(data || [])
    setLoadingRoster(false)
  }, [])

  useEffect(() => { loadRoster() }, [loadRoster])

  const handleFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name); setResult(null)
    const buf = await f.arrayBuffer()
    let text = new TextDecoder('utf-8').decode(buf)
    if (text.includes('�')) { try { text = new TextDecoder('big5').decode(buf) } catch { /* keep */ } }
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
    if (ok > 0) toast.success(`成功匯入 ${ok} 筆`)
    loadRoster() // 匯完刷新核對清單
  }

  const maskAcct = (a) => { if (!a) return ''; if (showFull) return a; return a.length <= 4 ? a : '••••' + a.slice(-4) }
  // employee_id 有 UNIQUE → PostgREST 巢狀關聯回「物件」(非陣列);相容兩種寫法
  const bankOf = (e) => Array.isArray(e.employee_bank_accounts) ? e.employee_bank_accounts[0] : e.employee_bank_accounts
  const haveCount = roster.filter(e => bankOf(e)?.bank_account).length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12, width: 'min(640px, 95vw)', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>銀行帳號 — 匯入與核對</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
        </div>

        {/* 匯入區 */}
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 12, padding: 12, background: 'var(--glass-light)', borderRadius: 8 }}>
          CSV 欄位:<b>員工編號, 姓名, 銀行代號, 分行代號, 帳號</b>。標題列自動跳過;UTF-8/Big5 皆可。
          <span style={{ color: 'var(--text-muted)' }}> 檔案只在你瀏覽器解析→寫進你的 DB,不外傳;僅 admin 可匯入。</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <Upload size={14} /> 選擇 CSV
            <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
          </label>
          {fileName && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fileName}（{rows.length} 筆）</span>}
          <button className="btn btn-primary" onClick={handleImport} disabled={busy || rows.length === 0} style={{ marginLeft: 'auto' }}>
            {busy ? '匯入中…' : `匯入 ${rows.length} 筆`}
          </button>
        </div>

        {result && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <span style={{ color: 'var(--accent-green)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={15} /> 成功 {result.ok}</span>
            {result.fail > 0 && <span style={{ marginLeft: 14, color: 'var(--accent-orange)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={15} /> 對不到 {result.fail}</span>}
            {result.fail > 0 && (
              <div style={{ marginTop: 6, maxHeight: 120, overflow: 'auto', fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 6, padding: 8 }}>
                {result.fails.map((f, i) => <div key={i}>• {f}</div>)}
              </div>
            )}
          </div>
        )}

        {/* 核對清單 */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              目前帳號狀態
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
                在職 {roster.length} 人 · 已建 {haveCount} · 缺 {roster.length - haveCount}
              </span>
            </div>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setShowFull(v => !v)}>
              {showFull ? <><EyeOff size={13} /> 遮罩</> : <><Eye size={13} /> 顯示完整</>}
            </button>
          </div>
          {loadingRoster ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>載入中…</div> : (
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                <thead><tr>
                  <th>姓名</th><th>銀行</th><th>分行</th><th>帳號</th>
                </tr></thead>
                <tbody>
                  {roster.map(e => {
                    const b = bankOf(e)
                    const missing = !b?.bank_account
                    return (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.name}</td>
                        <td>{b?.bank_code || (missing ? <span style={{ color: 'var(--accent-red)' }}>—</span> : '')}</td>
                        <td>{b?.bank_branch || ''}</td>
                        <td style={{ fontFamily: 'monospace' }}>
                          {missing ? <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>未設定</span> : maskAcct(b.bank_account)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}
