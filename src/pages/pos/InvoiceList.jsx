import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import Badge from '../../components/ui/Badge'

const INV_LABEL   = { pending: '待開立', issued: '已開立', voided: '已作廢' }
const INV_VARIANT = { pending: 'warning', issued: 'success', voided: 'default' }

const METHOD_LABEL = { cash: '現金', card: '信用卡', line_pay: 'LINE Pay', jkopay: '街口', other: '其他' }

const CARRIER_LABEL = {
  '3J0002':  '手機條碼',
  'CQ0001':  '自然人憑證',
  'ECA0001': '悠遊卡/一卡通',
}

export default function InvoiceList() {
  const { storeId } = useTenant()
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(false)
  const [invStatus, setInvStatus] = useState('')
  const [dateFrom,  setDateFrom]  = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo,      setDateTo]      = useState(() => new Date().toISOString().slice(0, 10))
  const [voidConfirm, setVoidConfirm] = useState(null)

  async function load() {
    if (!storeId) return
    setLoading(true)
    let q = supabase
      .from('pos_payments')
      .select('id, order_id, amount, payment_method, carrier_type, carrier_number, invoice_number, invoice_status, paid_at, pos_orders(order_number, res_tables(table_number))')
      .eq('store_id', storeId)
      .gte('paid_at', `${dateFrom}T00:00:00`)
      .lte('paid_at', `${dateTo}T23:59:59`)
      .order('paid_at', { ascending: false })
      .limit(300)
    if (invStatus) q = q.eq('invoice_status', invStatus)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [storeId, dateFrom, dateTo, invStatus])

  async function handleVoid(paymentId) {
    const { error } = await supabase.functions.invoke('void-invoice', { body: { paymentId } })
    if (!error) {
      setVoidConfirm(null)
      load()
    }
  }

  function exportCSV() {
    const headers = ['結帳時間', '訂單號', '桌號', '金額', '付款方式', '載具', '發票號碼', '狀態']
    const body = rows.map(r => [
      fmtTime(r.paid_at),
      '#' + (r.pos_orders?.order_number ?? ''),
      'T' + (r.pos_orders?.res_tables?.table_number ?? ''),
      r.amount ?? '',
      METHOD_LABEL[r.payment_method] ?? r.payment_method ?? '',
      r.carrier_type ? (CARRIER_LABEL[r.carrier_type] ?? r.carrier_type) : '',
      r.invoice_number ?? '',
      INV_LABEL[r.invoice_status] ?? r.invoice_status ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.map(h => `"${h}"`).join(','), ...body].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleIssue(paymentId) {
    // Generate a placeholder invoice number — replace with real CERP/tax integration
    const num = `AB-${Date.now().toString().slice(-8)}`
    await supabase
      .from('pos_payments')
      .update({ invoice_status: 'issued', invoice_number: num })
      .eq('id', paymentId)
    load()
  }

  const issuedCount  = rows.filter(r => r.invoice_status === 'issued').length
  const pendingCount = rows.filter(r => r.invoice_status === 'pending').length

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>發票查詢</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.input} />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={S.input} />
        <select value={invStatus} onChange={e => setInvStatus(e.target.value)} style={S.input}>
          <option value="">全部狀態</option>
          {Object.entries(INV_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button onClick={load} style={S.btn}>查詢</button>
        <button onClick={exportCSV} disabled={rows.length === 0} style={{ ...S.btn, background: 'var(--accent-green)', marginLeft: 'auto' }}>
          ↓ 匯出 CSV
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          ['待開立', pendingCount, 'var(--accent-orange)'],
          ['已開立', issuedCount,  'var(--accent-green)'],
          ['總筆數', rows.length,  'var(--text-secondary)'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: '10px 20px', minWidth: 100 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-primary)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              {['結帳時間', '訂單', '桌號', '金額', '付款', '載具', '發票號碼', '狀態', '操作'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>查無記錄</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(r.paid_at)}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>#{r.pos_orders?.order_number ?? '—'}</td>
                <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>T{r.pos_orders?.res_tables?.table_number ?? '—'}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>${r.amount?.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{METHOD_LABEL[r.payment_method] ?? r.payment_method}</td>
                <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
                  {r.carrier_type ? CARRIER_LABEL[r.carrier_type] ?? r.carrier_type : '—'}
                  {r.carrier_number && <div style={{ fontSize: 11 }}>{r.carrier_number}</div>}
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>{r.invoice_number || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <Badge variant={INV_VARIANT[r.invoice_status] ?? 'default'}>{INV_LABEL[r.invoice_status] ?? r.invoice_status}</Badge>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {r.invoice_status === 'pending' && (
                      <button onClick={() => handleIssue(r.id)} style={S.actBtn('#0891b2')}>開立</button>
                    )}
                    {r.invoice_status === 'issued' && (
                      <button onClick={() => setVoidConfirm(r)} style={S.actBtn('#dc2626')}>折讓/作廢</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Void confirm dialog */}
      {voidConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 14, padding: 28, maxWidth: 360, width: '90%' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>確認發票作廢</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 6 }}>發票號碼：{voidConfirm.invoice_number}</div>
            <div style={{ fontSize: 13, color: 'var(--accent-orange)', marginBottom: 20 }}>此操作無法復原，請確認後再執行</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setVoidConfirm(null)} style={{ flex: 1, ...S.actBtn('var(--bg-tertiary)', 'var(--text-secondary)') }}>取消</button>
              <button onClick={() => handleVoid(voidConfirm.id)} style={{ flex: 1, ...S.actBtn('#dc2626') }}>確認作廢</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const S = {
  input:  { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' },
  btn:    { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  actBtn: (bg, color = '#fff') => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }),
}
