import { useState, useRef, useMemo } from 'react'
import { ScanLine, CheckCircle, AlertTriangle } from 'lucide-react'
import Badge from '../../../components/ui/Badge'
import { resolveScan } from '../../../lib/barcode'
import { lookupByBarcode } from '../../../lib/db/skuBarcodes'
import { playBeep } from '../../../lib/barcodeScanner'
import { logger } from '../../../lib/logger'

// 出貨掃碼檢核（F-C4）：掃描 → resolveScan（秤重碼解析/條碼主檔查詢）→ 比對揀貨/包裝明細
// 純前端核對面板，不寫庫 — 供包裝步驟人工檢核用

export default function ScanVerifyPanel({ items = [], orgId, title = '掃碼檢核' }) {
  const [scanned, setScanned] = useState({})   // { sku_code: count }
  const [mismatches, setMismatches] = useState([]) // [{ code, reason }]
  const [last, setLast] = useState(null)       // 最後一筆掃描結果
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const expected = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      const key = it.sku_code
      if (!key) continue
      const qty = Number(it.qty ?? it.qty_ordered ?? it.qty_picked) || 0
      const prev = map.get(key)
      if (prev) {
        prev.qty += qty // 同品項跨箱 → 數量彙總
        if (!prev.name && it.name) prev.name = it.name
      } else {
        map.set(key, { sku_code: key, name: it.name || '', qty })
      }
    }
    return [...map.values()]
  }, [items])

  const doneCount = expected.filter(it => (scanned[it.sku_code] || 0) >= it.qty && it.qty > 0).length
  const overCount = expected.filter(it => (scanned[it.sku_code] || 0) > it.qty).length

  const handleScan = async () => {
    const code = input.trim()
    if (!code || busy) return
    setBusy(true)
    setInput('')
    try {
      const result = await resolveScan(code, (c) => lookupByBarcode(orgId, c))
      const skuCode = result.sku?.sku?.code || null

      if (!result.found || !skuCode) {
        playBeep(false)
        setLast({ code, ok: false, reason: result.type === 'unknown' ? '條碼格式無法辨識' : '查無此條碼對應的品項' })
        setMismatches(prev => [...prev, { code, reason: result.type === 'unknown' ? '格式無法辨識' : '查無品項' }])
        return
      }

      const target = expected.find(it => it.sku_code === skuCode)
      if (!target) {
        playBeep(false)
        setLast({ code, skuCode, ok: false, reason: `品項 ${skuCode} 不在本單明細內` })
        setMismatches(prev => [...prev, { code, reason: `${skuCode} 不在明細內` }])
        return
      }

      const next = (scanned[skuCode] || 0) + 1
      setScanned(prev => ({ ...prev, [skuCode]: next }))
      const over = next > target.qty
      playBeep(!over)
      setLast({
        code, skuCode, ok: !over,
        reason: over ? `超掃！應揀 ${target.qty}、已掃 ${next}` : `✓ ${skuCode}（${next}/${target.qty}）`,
        embeddedPrice: result.embeddedPrice,
      })
      if (over) setMismatches(prev => [...prev, { code, reason: `${skuCode} 超掃（${next}/${target.qty}）` }])
    } catch (err) {
      logger.error('ScanVerifyPanel scan failed', { code, error: err?.message })
      playBeep(false)
      setLast({ code, ok: false, reason: '掃碼查詢失敗，請重試' })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const statusOf = (it) => {
    const n = scanned[it.sku_code] || 0
    if (n === 0) return { badge: <Badge color="gray" size="sm">未掃</Badge> }
    if (n < it.qty) return { badge: <Badge status="warning" size="sm">部分 {n}/{it.qty}</Badge> }
    if (n === it.qty) return { badge: <Badge status="success" size="sm">✓ 完成 {n}/{it.qty}</Badge> }
    return { badge: <Badge status="error" size="sm">✗ 超掃 {n}/{it.qty}</Badge> }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ScanLine size={15} /> {title}
        </span>
        <Badge status="success" size="sm">✓ 完成 {doneCount}/{expected.length} 項</Badge>
        {(mismatches.length > 0 || overCount > 0) && (
          <Badge status="error" size="sm">✗ 異常 {mismatches.length} 筆</Badge>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          ref={inputRef}
          className="form-input"
          style={{ flex: 1, fontFamily: 'monospace' }}
          placeholder="掃描或輸入條碼後按 Enter（支援 GTIN-13/店內碼/秤重碼）"
          value={input}
          autoFocus
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan() } }}
        />
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy || !input.trim()} onClick={handleScan}>
          檢核
        </button>
      </div>

      {last && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, marginBottom: 10,
          background: last.ok ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
          color: last.ok ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 12, fontWeight: 600,
        }}>
          {last.ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          <span style={{ fontFamily: 'monospace' }}>{last.code}</span>
          <span>{last.reason}</span>
          {last.embeddedPrice != null && <span>｜秤重碼內含金額 ${last.embeddedPrice}</span>}
        </div>
      )}

      <div className="data-table-wrapper">
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead><tr><th>品號</th><th>品名</th><th style={{ textAlign: 'right' }}>應揀</th><th style={{ textAlign: 'right' }}>已掃</th><th>狀態</th></tr></thead>
          <tbody>
            {expected.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>本單無品項明細可檢核</td></tr>
            )}
            {expected.map(it => (
              <tr key={it.sku_code}>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{it.sku_code}</td>
                <td>{it.name || '-'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{it.qty}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{scanned[it.sku_code] || 0}</td>
                <td>{statusOf(it).badge}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mismatches.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={13} /> 異常掃描記錄
          </span>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
            {mismatches.map((m, i) => (
              <li key={i}><span style={{ fontFamily: 'monospace' }}>{m.code}</span> — {m.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
