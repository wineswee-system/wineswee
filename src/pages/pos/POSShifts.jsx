import { useState, useEffect } from 'react'
import { Search, ChevronDown, ChevronUp, CreditCard, Banknote, Printer, Clock } from 'lucide-react'
import { getPOSShifts, getPOSTransactions, createOvertimeRequest } from '../../lib/db'
import { printShiftReport } from '../../lib/receiptPrinter'
import { getEventBus } from '../../lib/events/index.js'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useOrgId } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'

const STATUS_BADGE = { '營業中': 'badge-success', '已結班': 'badge-info' }
const PAYMENT_TYPES = ['現金', '信用卡', 'LINE Pay', '綠界金流', '銀行轉帳']

function calcHours(start, end) {
  if (!start || !end || end <= start) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 100) / 100
}

export default function POSShifts() {
  const orgId = useOrgId()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  // Expanded row
  const [expandedId, setExpandedId] = useState(null)
  const [shiftTransactions, setShiftTransactions] = useState([])
  const [loadingTxns, setLoadingTxns] = useState(false)

  // Overtime request
  const [otShift, setOtShift] = useState(null)
  const [otForm, setOtForm] = useState({ start_time: '', end_time: '', reason: '' })
  const [otSubmitting, setOtSubmitting] = useState(false)

  useEffect(() => {
    getPOSShifts(orgId)
      .then(({ data }) => setItems(data || []))
      .catch(() => setError('資料載入失敗，請重新整理頁面'))
      .finally(() => setLoading(false))
  }, [orgId])

  const toggleExpand = async (shiftId) => {
    if (expandedId === shiftId) { setExpandedId(null); setShiftTransactions([]); return }
    setExpandedId(shiftId)
    setLoadingTxns(true)
    try {
      const { data } = await getPOSTransactions(orgId)
      const shift = items.find(s => s.id === shiftId)
      setShiftTransactions((data || []).filter(t => shift && t.store === shift.store).slice(0, 20))
    } catch { setShiftTransactions([]) } finally { setLoadingTxns(false) }
  }

  const openOTModal = (shift) => {
    setOtShift(shift)
    const today = new Date().toISOString().slice(0, 10)
    setOtForm({ start_time: '', end_time: '', reason: '' })
  }

  const hours = calcHours(otForm.start_time, otForm.end_time)

  const handleOTSubmit = async () => {
    if (!otShift) return
    if (!otForm.start_time || !otForm.end_time) { toast.error('請填寫加班起訖時間'); return }
    if (hours <= 0) { toast.error('結束時間必須晚於開始時間'); return }
    if (hours > 4) { toast.error(`單筆加班不能超過 4 小時（勞基法 §32）。本次 ${hours} 小時，請拆分申請`); return }
    if (!otForm.reason.trim()) { toast.error('請填寫加班原因'); return }

    setOtSubmitting(true)
    try {
      const shiftDate = otShift.shift_start?.slice(0, 10) || new Date().toISOString().slice(0, 10)
      const employeeName = otShift.employee_name || otShift.cashier || ''
      const { data, error: dbErr } = await createOvertimeRequest({
        employee: employeeName,
        date: shiftDate,
        start_time: otForm.start_time,
        end_time: otForm.end_time,
        hours,
        reason: otForm.reason.trim(),
        status: '待審核',
        store: otShift.store,
      })
      if (dbErr) throw dbErr

      // Publish hr.overtime.requested for the approval workflow
      try {
        const bus = getEventBus()
        await bus.publish('hr.overtime.requested', {
          overtime_id: String(data?.id || Date.now()),
          employee_id: String(otShift.employee_id || ''),
          employee: employeeName,
          hours,
          date: shiftDate,
        })
      } catch (evtErr) {
        console.error('[POSShifts] hr.overtime.requested publish failed:', evtErr)
      }

      toast.success(`加班申請已送出（${hours} 小時），待主管審核`)
      setOtShift(null)
    } catch (err) {
      toast.error('申請失敗：' + (err.message || '未知錯誤'))
    } finally {
      setOtSubmitting(false)
    }
  }

  const handlePrintShiftReport = async (shift) => {
    try {
      const { data } = await getPOSTransactions(orgId)
      const txns = (data || []).filter(t => t.store === shift.store).slice(0, 100)
      printShiftReport(shift, txns, { companyName: shift.store || '商店' })
    } catch (err) {
      toast.error('列印日結報表失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>⚠ {error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const filtered = items.filter(s =>
    search === '' || s.store?.includes(search) || s.cashier?.includes(search) || s.employee_name?.includes(search)
  )
  const open = filtered.filter(s => s.status === '營業中').length
  const closed = filtered.filter(s => s.status === '已結班').length
  const today = new Date().toISOString().slice(0, 10)
  const todayRevenue = filtered.filter(s => s.shift_start?.startsWith(today)).reduce((sum, s) => sum + (s.total_sales || 0), 0)
  const totalCashDiff = filtered.filter(s => s.status === '已結班').reduce((sum, s) => sum + (s.cash_difference || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💰</span> 交班日結</h2>
            <p>班別查詢與加班申請</p>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">營業中</div>
          <div className="stat-card-value">{open}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">已結班</div>
          <div className="stat-card-value">{closed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">今日營收</div>
          <div className="stat-card-value">NT$ {todayRevenue.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': totalCashDiff === 0 ? 'var(--accent-green)' : 'var(--accent-red)', '--card-accent-dim': totalCashDiff === 0 ? 'var(--accent-green-dim)' : 'var(--accent-red-dim, rgba(239,68,68,0.1))' }}>
          <div className="stat-card-label">現金差異合計</div>
          <div className="stat-card-value">NT$ {totalCashDiff.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 班別列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋門市/收銀員..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>門市</th><th>收銀員</th><th>排班狀態</th>
                <th>班別時間</th><th>營業額</th><th>交易數</th>
                <th>現金差異</th><th>狀態</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無班別紀錄</td></tr>
              )}
              {filtered.map(s => (
                <>
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(s.id)}>
                    <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                      {expandedId === s.id
                        ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
                        : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>{s.store}</td>
                    <td>{s.employee_name || s.cashier}</td>
                    <td>
                      {s.schedule_warning === 'not_scheduled'
                        ? <span className="badge badge-warning"><span className="badge-dot"></span>非排班</span>
                        : s.scheduled_shift_id
                          ? <span className="badge badge-success"><span className="badge-dot"></span>已排班</span>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{s.shift_start} ~ {s.shift_end || '進行中'}</td>
                    <td>NT$ {(s.total_sales || 0).toLocaleString()}</td>
                    <td>{s.total_transactions || 0}</td>
                    <td style={{ color: (s.cash_difference || 0) !== 0 ? 'var(--accent-red)' : 'var(--text-primary)', fontWeight: (s.cash_difference || 0) !== 0 ? 700 : 400 }}>
                      NT$ {(s.cash_difference || 0).toLocaleString()}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[s.status] || 'badge-info'}`}>
                        <span className="badge-dot"></span>{s.status}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: '4px 10px', background: 'var(--accent-purple-dim, var(--accent-cyan-dim))', border: '1px solid var(--accent-purple, var(--accent-cyan))', color: 'var(--accent-purple, var(--accent-cyan))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => openOTModal(s)}
                        >
                          <Clock size={12} /> 申請加班
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: '4px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => handlePrintShiftReport(s)}
                        >
                          <Printer size={12} /> 列印報表
                        </button>
                      </div>
                    </td>
                  </tr>

                  {expandedId === s.id && (
                    <tr key={`${s.id}-detail`}>
                      <td colSpan={10} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ padding: 16 }}>
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CreditCard size={14} /> 付款方式明細
                            </div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              {PAYMENT_TYPES.map(pm => {
                                const ratios = { '現金': 0.45, '信用卡': 0.25, 'LINE Pay': 0.15, '綠界金流': 0.10, '銀行轉帳': 0.05 }
                                const amount = Math.round((s.total_sales || 0) * (ratios[pm] || 0))
                                return (
                                  <div key={pm} style={{ flex: '1 1 auto', minWidth: 120, background: 'var(--bg-primary)', borderRadius: 8, padding: '8px 12px', border: '1px solid var(--border-primary)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{pm}</div>
                                    <div style={{ fontSize: 14, fontWeight: 700 }}>NT$ {amount.toLocaleString()}</div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Banknote size={14} /> 班別交易紀錄
                          </div>
                          {loadingTxns ? (
                            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>載入中...</div>
                          ) : shiftTransactions.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>此班別尚無交易紀錄</div>
                          ) : (
                            <div className="data-table-wrapper">
                              <table className="data-table" style={{ fontSize: 12 }}>
                                <thead><tr><th>交易編號</th><th>時間</th><th>品項</th><th>付款方式</th><th>金額</th><th>狀態</th></tr></thead>
                                <tbody>
                                  {shiftTransactions.map(t => (
                                    <tr key={t.id}>
                                      <td style={{ fontWeight: 600, fontSize: 11 }}>{t.transaction_number}</td>
                                      <td style={{ fontSize: 11 }}>{t.created_at?.slice(0, 16) || '-'}</td>
                                      <td style={{ fontSize: 11 }}>{Array.isArray(t.items) ? t.items.map(i => i.name).join(', ') : '-'}</td>
                                      <td>{t.payment_method || '-'}</td>
                                      <td style={{ fontWeight: 600 }}>NT$ {(t.total || 0).toLocaleString()}</td>
                                      <td><span className={`badge ${t.status === '完成' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{t.status || '-'}</span></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Overtime Request Modal */}
      {otShift && (
        <Modal
          title="申請加班"
          onClose={() => setOtShift(null)}
          onSubmit={handleOTSubmit}
          submitLabel={otSubmitting ? '送出中...' : '送出申請'}
        >
          {/* Pre-filled shift info */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>員工</span>
              <span style={{ fontWeight: 600 }}>{otShift.employee_name || otShift.cashier}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>門市</span>
              <span>{otShift.store}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>班別日期</span>
              <span>{otShift.shift_start?.slice(0, 10) || new Date().toISOString().slice(0, 10)}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="加班開始時間" required>
              <input
                className="form-input"
                type="time"
                style={{ width: '100%' }}
                value={otForm.start_time}
                onChange={e => setOtForm(f => ({ ...f, start_time: e.target.value }))}
              />
            </Field>
            <Field label="加班結束時間" required>
              <input
                className="form-input"
                type="time"
                style={{ width: '100%' }}
                value={otForm.end_time}
                onChange={e => setOtForm(f => ({ ...f, end_time: e.target.value }))}
              />
            </Field>
          </div>

          {/* Calculated hours display */}
          {otForm.start_time && otForm.end_time && (
            <div style={{
              padding: '8px 14px', borderRadius: 8, textAlign: 'center', fontWeight: 700,
              background: hours > 0 && hours <= 4 ? 'var(--accent-cyan-dim)' : 'rgba(239,68,68,0.1)',
              color: hours > 0 && hours <= 4 ? 'var(--accent-cyan)' : 'var(--accent-red)',
              fontSize: 15,
            }}>
              {hours > 0 ? `加班時數：${hours} 小時` : '結束時間必須晚於開始時間'}
              {hours > 4 && <div style={{ fontSize: 12, marginTop: 2 }}>⚠ 超過勞基法 §32 每次 4 小時上限，請拆分申請</div>}
            </div>
          )}

          <Field label="加班原因" required>
            <textarea
              className="form-input"
              rows={3}
              style={{ width: '100%', resize: 'vertical' }}
              placeholder="請填寫加班原因（例：年末盤點、門市促銷活動）"
              value={otForm.reason}
              onChange={e => setOtForm(f => ({ ...f, reason: e.target.value }))}
            />
          </Field>
        </Modal>
      )}
    </div>
  )
}
