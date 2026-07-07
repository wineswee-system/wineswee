import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, RefreshCw, Printer, Download, X, Clock, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
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

function QRModal({ session, orgName, storeName, storeCity, tableNumber, onClose, onRefresh }) {
  const canvasRef = useRef(null)
  const url = menuUrl(session.store_id, session.table_id, session.token)

  useEffect(() => {
    if (!canvasRef.current) return
    // 熱感機是純黑白 1-bit：dark 一定要純黑(#000)，用 #0f172a 會被抖色成灰 → 糊。
    // 解析度拉高(440)避免印在 ~40mm(203dpi≈320點)時被放大糊掉。
    QRCode.toCanvas(canvasRef.current, url, {
      width: 440,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
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
    const fmt = iso => {
      if (!iso) return null
      const d = new Date(iso)
      return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    }
    const openStr   = fmt(session?.created_at)
    const expiryStr = fmt(session?.expires_at)
    const cityLine  = storeCity ? `<div class="hdr-city">${storeCity}</div>` : ''
    // 紙寬：58mm 熱感機縮小版面（可印寬 ~48mm），否則沿用 80mm 桌卡
    const is58 = (() => { try { return localStorage.getItem('pos_paper_width') === '58' } catch { return false } })()
    const bodyW  = is58 ? '48mm' : '76mm'
    const pageW  = is58 ? '58mm' : '80mm'
    // QR 尺寸用 mm 精準鎖定：58mm 桌卡固定 20mm×20mm（黑點少不中斷、省紙），80mm 維持大張。
    const qrSize = is58 ? '25mm' : '52mm'
    const tnumPx = is58 ? '40px' : '50px'
    const win = window.open('', '_blank', 'width=340,height=560')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html>
<head>
  <meta charset="UTF-8">
  <title>桌卡 T${tableNumber}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;outline:none!important}
    /* 熱感機全純黑：灰色印出來會抖成灰點/太淡 → 一律 #000 */
    body{font-family:"Noto Sans TC","蘋方","微軟正黑體",sans-serif;
         text-align:center;padding:12px 10px 16px;background:#fff;color:#000;font-weight:700;
         width:${bodyW};max-width:100%;margin:0 auto}
    .hdr{padding:7px 10px;margin-bottom:8px}
    .hdr-brand{font-size:13px;font-weight:700;letter-spacing:1px;color:#000}
    .hdr-name{font-size:17px;font-weight:900;letter-spacing:2px;margin-top:2px;color:#000}
    .hdr-city{font-size:11px;color:#000;margin-top:2px;letter-spacing:1px}
    .dash{border:none;border-top:1px dashed #000;margin:8px 0}
    .open{font-size:11px;color:#000;margin-bottom:6px}
    .tnum{font-size:${tnumPx};font-weight:900;letter-spacing:4px;color:#000;
          line-height:1;margin:6px 0 10px}
    .qr-wrap{display:inline-block;border:1px solid #000;padding:6px;margin-bottom:6px}
    img{display:block;image-rendering:pixelated;image-rendering:crisp-edges}
    .cta{font-size:15px;font-weight:700;letter-spacing:3px;margin:8px 0 2px;color:#000}
    .expiry{font-size:11px;color:#000;margin-top:4px}
    .foot{font-size:9px;color:#000;margin-top:10px;letter-spacing:1px}
    @media print{
      *{outline:none!important}
      @page{margin:0;size:${pageW} auto}
      body{padding:6px 4px 12px;-webkit-print-color-adjust:exact}
    }
  </style>
</head>
<body>
  <div class="hdr">
    ${orgName ? `<div class="hdr-brand">${orgName}</div>` : ''}
    <div class="hdr-name">${storeName || '門市'}</div>
    ${cityLine}
  </div>
  <hr class="dash">
  ${openStr ? `<div class="open">開桌 ${openStr}</div>` : ''}
  <div class="tnum">T${tableNumber}</div>
  <div class="qr-wrap"><img src="${dataUrl}" style="width:${qrSize};height:${qrSize}"></div>
  <div class="cta">掃 碼 點 餐</div>
  <hr class="dash">
  ${expiryStr ? `<div class="expiry">有效至 ${expiryStr}（4 小時）</div>` : ''}
  <div class="foot">請勿將此卡轉交他人使用</div>
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

function TableCard({ table, session, orgId, storeId, sessionMinutes, orgName, storeName, storeCity, onSessionChange }) {
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
          orgName={orgName}
          storeName={storeName}
          storeCity={storeCity}
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
  const { profile, organization } = useAuth()
  const orgId  = profile?.organization_id ?? null
  const orgName = organization?.name ?? ''

  const [stores,         setStores]         = useState([])
  const [storeId,        setStoreId]        = useState(null)
  const [storeName,      setStoreName]      = useState('')
  const [storeCity,      setStoreCity]      = useState('')
  const [tables,         setTables]         = useState([])
  const [sessions,       setSessions]       = useState({})
  const [sessionMinutes, setSessionMinutes] = useState(240)
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    if (!orgId) return
    supabase.from('stores').select('id, name, city').eq('organization_id', orgId).order('name')
      .then(({ data }) => {
        setStores(data ?? [])
        if (data?.length) {
          setStoreId(prev => {
            const effectiveId = prev ?? data[0].id
            const found = data.find(x => String(x.id) === String(effectiveId)) ?? data[0]
            setStoreName(found.name)
            setStoreCity(found.city ?? '')
            return effectiveId
          })
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
                    const found = stores.find(s => String(s.id) === String(id))
                    setStoreName(found?.name ?? '')
                    setStoreCity(found?.city ?? '')
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
              orgName={orgName}
              storeName={storeName}
              storeCity={storeCity}
              onSessionChange={handleSessionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
