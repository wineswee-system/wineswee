import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, RefreshCw, Printer, Download, X, Clock, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import PageHeader from '../../components/ui/PageHeader'
import LoadingSpinner from '../../components/LoadingSpinner'

function expiresLabel(isoStr) {
  const diff = new Date(isoStr).getTime() - Date.now()
  if (diff <= 0) return '已過期'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m} 分鐘後到期`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return `${h} 小時${rem ? ` ${rem} 分` : ''}後到期`
}

function menuUrl(storeId, tableId, token) {
  return `${window.location.origin}/menu/${storeId}/${tableId}?token=${token}`
}

// ── QR preview modal ──────────────────────────────────────────────────────────

function QRModal({ session, storeName, tableNumber, onClose, onRefresh }) {
  const canvasRef = useRef(null)
  const url = menuUrl(session.store_id, session.table_id, session.token)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, url, {
      width: 260,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
  }, [url])

  const download = () => {
    if (!canvasRef.current) return
    const a = document.createElement('a')
    a.href = canvasRef.current.toDataURL('image/png')
    a.download = `QR_T${tableNumber}.png`
    a.click()
  }

  const print = () => {
    if (!canvasRef.current) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    const expiryStr = session?.expires_at ? (() => {
      const d = new Date(session.expires_at)
      return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    })() : null
    const win = window.open('', '_blank', 'width=320,height=480')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html>
<head>
  <meta charset="UTF-8">
  <title>桌卡 T${tableNumber}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:"Noto Sans TC","微軟正黑體",sans-serif;text-align:center;padding:16px 12px;background:#fff;color:#000}
    .store{font-size:13px;color:#666;margin-bottom:4px}
    .line{border:none;border-top:1px dashed #999;margin:8px 0}
    .tnum{font-size:42px;font-weight:900;letter-spacing:2px;margin:8px 0 12px}
    img{display:block;margin:0 auto}
    .hint{font-size:14px;font-weight:600;margin-top:10px}
    .expiry{font-size:11px;color:#888;margin-top:4px}
    @media print{@page{margin:4mm;size:80mm auto}}
  </style>
</head>
<body>
  <div class="store">${storeName || '威士威'}</div>
  <hr class="line">
  <div class="tnum">T${tableNumber}</div>
  <img src="${dataUrl}" width="180" height="180">
  <div class="hint">掃碼點餐</div>
  ${expiryStr ? `<div class="expiry">有效至 ${expiryStr}</div>` : ''}
  <hr class="line">
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`)
    win.document.close()
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--bg-secondary)', borderRadius: 16,
        border: '1px solid var(--border-primary)',
        padding: 28, minWidth: 320, maxWidth: 360,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
        >
          <X size={18} />
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>
            桌號 T{tableNumber}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {expiresLabel(session.expires_at)}
          </div>
        </div>

        {/* white background so QR is scannable even on dark theme */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 12, display: 'inline-block' }}>
          <canvas ref={canvasRef} />
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', textAlign: 'center', maxWidth: 280 }}>
          {url}
        </div>

        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            onClick={print}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'var(--accent-cyan)', color: '#fff',
              fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Printer size={14} /> 列印
          </button>
          <button
            onClick={download}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Download size={14} /> 下載
          </button>
          <button
            onClick={() => { onClose(); onRefresh() }}
            style={{
              padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="重新產生"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Single table card ─────────────────────────────────────────────────────────

function TableCard({ table, session, orgId, storeId, sessionMinutes, storeName, onSessionChange }) {
  const [busy,   setBusy]   = useState(false)
  const [showQR, setShowQR] = useState(false)

  const isActive  = session && !session.revoked_at && new Date(session.expires_at) > new Date()
  const isExpired = session && (session.revoked_at || new Date(session.expires_at) <= new Date())

  const generate = async () => {
    setBusy(true)
    try {
      // 1. Open order for this table
      const { data: order, error: orderErr } = await supabase
        .from('pos_orders')
        .insert({
          organization_id: orgId,
          store_id:        storeId,
          table_id:        table.id,
          status:          'open',
          order_source:    'qr',
        })
        .select('id')
        .single()
      if (orderErr) throw orderErr

      // 2. Revoke any existing session for this table
      if (session) {
        await supabase
          .from('qr_order_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', session.id)
      }

      // 3. Create QR session (token auto-generated by DB default)
      const expiresAt = new Date(Date.now() + sessionMinutes * 60000).toISOString()
      const { data: newSession, error: sessErr } = await supabase
        .from('qr_order_sessions')
        .insert({
          organization_id: orgId,
          store_id:        storeId,
          table_id:        table.id,
          order_id:        order.id,
          expires_at:      expiresAt,
        })
        .select('*')
        .single()
      if (sessErr) throw sessErr

      toast.success(`桌號 T${table.table_number} QR 碼已產生`)
      onSessionChange(table.id, newSession)
      setShowQR(true)
    } catch (e) {
      toast.error('產生失敗：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!session) return
    setBusy(true)
    try {
      const { error } = await supabase
        .from('qr_order_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', session.id)
      if (error) throw error
      toast.success(`桌號 T${table.table_number} QR 已吊銷`)
      onSessionChange(table.id, null)
    } catch (e) {
      toast.error('吊銷失敗：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{
        background: 'var(--bg-secondary)',
        border: `1px solid ${isActive ? 'var(--accent-green)' : 'var(--border-primary)'}`,
        borderRadius: 12, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--text-primary)' }}>
            T{table.table_number}
          </div>
          {table.capacity && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{table.capacity} 人</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          {isActive ? (
            <>
              <CheckCircle2 size={13} style={{ color: 'var(--accent-green)' }} />
              <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                {expiresLabel(session.expires_at)}
              </span>
            </>
          ) : isExpired ? (
            <>
              <AlertCircle size={13} style={{ color: 'var(--accent-orange)' }} />
              <span style={{ color: 'var(--accent-orange)' }}>已過期 / 已吊銷</span>
            </>
          ) : (
            <>
              <Clock size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-muted)' }}>無 QR</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {isActive ? (
            <>
              <button
                disabled={busy}
                onClick={() => setShowQR(true)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: 'var(--accent-cyan)', color: '#fff',
                  fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <QrCode size={13} /> 顯示 QR
              </button>
              <button
                disabled={busy}
                onClick={generate}
                title="重新產生（舊的自動失效）"
                style={{
                  padding: '8px 10px', borderRadius: 8,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <RefreshCw size={13} />
              </button>
              <button
                disabled={busy}
                onClick={revoke}
                title="吊銷 QR"
                style={{
                  padding: '8px 10px', borderRadius: 8,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--accent-red)',
                  background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={generate}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
                background: 'var(--accent-cyan)', color: '#fff',
                fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <QrCode size={13} /> {busy ? '產生中…' : '產生 QR 碼'}
            </button>
          )}
        </div>
      </div>

      {showQR && isActive && (
        <QRModal
          session={session}
          storeName={storeName}
          tableNumber={table.table_number}
          onClose={() => setShowQR(false)}
          onRefresh={generate}
        />
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const sel = {
  background: 'var(--bg-input)', border: '1px solid var(--border-medium)',
  borderRadius: 8, color: 'var(--text-primary)', padding: '8px 12px',
  fontSize: 14, outline: 'none', cursor: 'pointer', appearance: 'none',
}

function Chip({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
      borderRadius: 8, padding: '6px 14px', fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}：</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  )
}

export default function QRTableManager() {
  const orgId = useOrgId()

  const [stores,         setStores]         = useState([])
  const [storeId,        setStoreId]        = useState(null)
  const [storeName,      setStoreName]      = useState('')
  const [tables,         setTables]         = useState([])
  const [sessions,       setSessions]       = useState({})
  const [sessionMinutes, setSessionMinutes] = useState(240)
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    if (!orgId) return
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data }) => {
        setStores(data ?? [])
        if (data?.length) {
          setStoreId(s => s ?? data[0].id)
          setStoreName(data[0].name)
        }
      })
  }, [orgId])

  const loadTableData = useCallback(async () => {
    if (!storeId || !orgId) return
    setLoading(true)
    try {
      const now = new Date().toISOString()
      const [{ data: tableData }, { data: sessionData }, { data: settings }] = await Promise.all([
        supabase
          .from('res_tables')
          .select('id, table_number, capacity')
          .eq('store_id', storeId)
          .order('table_number'),
        supabase
          .from('qr_order_sessions')
          .select('*')
          .eq('store_id', storeId)
          .is('revoked_at', null)
          .gt('expires_at', now),
        supabase
          .from('pos_store_settings')
          .select('qr_session_minutes')
          .eq('store_id', storeId)
          .eq('organization_id', orgId)
          .maybeSingle(),
      ])

      setTables(tableData ?? [])
      const sessionMap = {}
      for (const s of (sessionData ?? [])) sessionMap[s.table_id] = s
      setSessions(sessionMap)
      if (settings?.qr_session_minutes) setSessionMinutes(settings.qr_session_minutes)
    } finally {
      setLoading(false)
    }
  }, [storeId, orgId])

  useEffect(() => { loadTableData() }, [loadTableData])

  const handleSessionChange = (tableId, newSession) => {
    setSessions(prev => {
      if (!newSession) { const next = { ...prev }; delete next[tableId]; return next }
      return { ...prev, [tableId]: newSession }
    })
  }

  const activeCount = Object.values(sessions).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📱</span> QR 桌台管理</h2>
            <p>為每張桌台產生 QR 碼，客人掃描後可自助點餐</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {stores.length > 1 && (
              <div style={{ position: 'relative' }}>
                <select
                  value={storeId ?? ''}
                  onChange={e => {
                    const id = e.target.value
                    setStoreId(id)
                    setStoreName(stores.find(s => s.id === id)?.name ?? '')
                  }}
                  style={{ ...sel, paddingRight: 32 }}
                >
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              </div>
            )}
            <button
              className="btn"
              onClick={loadTableData}
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} /> 重新整理
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <Chip label="桌台總數"  value={tables.length} color="var(--accent-blue)" />
        <Chip label="QR 啟用中" value={activeCount}   color="var(--accent-green)" />
        <Chip label="未啟用"    value={tables.length - activeCount} color="var(--text-muted)" />
        <Chip label="連結時效"  value={`${sessionMinutes} 分鐘`}  color="var(--accent-cyan)" />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : tables.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🪑</div>
          <div style={{ fontSize: 15 }}>此門市尚未設定桌台</div>
          <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>
            請先至「訂位管理 → 桌台設定」新增桌台
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          {tables.map(table => (
            <TableCard
              key={table.id}
              table={table}
              session={sessions[table.id] ?? null}
              orgId={orgId}
              storeId={storeId}
              sessionMinutes={sessionMinutes}
              storeName={storeName}
              onSessionChange={handleSessionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
