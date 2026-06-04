import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, AlertCircle, RefreshCw, FileText, Send, CheckCircle, X, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'

const TYPE_LABEL = {
  MISSING:     '未打卡',
  LATE:        '遲到',
  EARLY_LEAVE: '早退',
  UNSCHEDULED: '未排班打卡',
  OVERWORK:    '多上時數',
  UNDERTIME:   '時數不足',
}

const TYPE_COLOR = {
  MISSING:     { bg: 'var(--accent-red-dim)',    fg: 'var(--accent-red)' },
  LATE:        { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' },
  EARLY_LEAVE: { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' },
  UNSCHEDULED: { bg: 'var(--accent-green-dim)',  fg: 'var(--accent-green)' },
  OVERWORK:    { bg: 'var(--accent-green-dim)',  fg: 'var(--accent-green)' },
  UNDERTIME:   { bg: 'var(--accent-yellow-dim)', fg: 'var(--accent-yellow)' },
}

function formatYM(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`
}

export default function AttendanceDiffReport() {
  const { profile } = useAuth()
  const isAdmin = ['admin', 'super_admin'].includes(profile?.role)

  // 預設「上個月」
  const now = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [year, setYear] = useState(last.getFullYear())
  const [month, setMonth] = useState(last.getMonth() + 1)
  const [storeId, setStoreId] = useState('')
  const [stores, setStores] = useState([])
  const [report, setReport] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailEmp, setDetailEmp] = useState(null)
  const [detailDiffs, setDetailDiffs] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [committing, setCommitting] = useState(false)

  const ym = formatYM(year, month)

  useEffect(() => {
    supabase.from('stores').select('id, name').order('name').then(({ data }) => setStores(data || []))
  }, [])

  const load = () => {
    setLoading(true)
    supabase
      .rpc('admin_attendance_diff_report', {
        p_year_month: ym,
        p_store_id: storeId === '' ? null : Number(storeId),
      })
      .then(({ data }) => {
        setReport(Array.isArray(data) ? data : [])
        setLoading(false)
      })
  }
  useEffect(load, [ym, storeId])

  const stats = useMemo(() => {
    const withDiff = report.filter(r => r.diff_count > 0)
    const notified = withDiff.filter(r => r.notified)
    return {
      totalEmp: report.length,
      withDiff: withDiff.length,
      notified: notified.length,
      pending: withDiff.length - notified.length,
      totalDiff: withDiff.reduce((s, r) => s + Number(r.diff_count || 0), 0),
    }
  }, [report])

  const openDetail = async (emp) => {
    setDetailEmp(emp)
    setDetailLoading(true)
    const { data } = await supabase.rpc('monthly_attendance_diff', {
      p_employee_id: emp.employee_id,
      p_year_month: ym,
    })
    setDetailDiffs((Array.isArray(data) ? data : []).filter(d => d.diff_type))
    setDetailLoading(false)
  }

  const goPrev = () => {
    if (month === 1) { setMonth(12); setYear(year - 1) }
    else setMonth(month - 1)
  }
  const goNext = () => {
    if (month === 12) { setMonth(1); setYear(year + 1) }
    else setMonth(month + 1)
  }

  const handleCommitWriteback = async () => {
    if (!isAdmin) return
    if (!confirm(
      `要把 ${ym} 的「排班 vs 打卡」差異結算寫回 attendance_records 嗎？\n\n` +
      `會把該月所有 attendance_records 的 late_minutes/is_late 先重置 0/false，` +
      `再依排班比對寫回 LATE。寫回後批次計薪會讀到正確的遲到分鐘數。\n\n` +
      `請確保員工該補的請假/補卡/加班申請都已簽完才做這步。`
    )) return
    setCommitting(true)
    try {
      const { data, error } = await supabase.rpc('commit_attendance_diff_writeback', {
        p_year_month: ym,
        p_store_id: storeId === '' ? null : Number(storeId),
      })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      toast.success(
        `結算寫回完成：${r?.employees_processed || 0} 人處理、` +
        `${r?.records_reset || 0} 筆重置、${r?.late_records_written || 0} 筆遲到寫回`
      )
      load()
    } catch (e) {
      toast.error('結算寫回失敗：' + (e.message || '未知'))
    }
    setCommitting(false)
  }

  const handleSendNotifications = async () => {
    if (!isAdmin) return
    if (!confirm(`要對 ${ym} 所有「未通知」員工發送 LINE 提醒嗎？`)) return
    setTriggering(true)
    try {
      const pendingIds = report.filter(r => r.diff_count > 0 && !r.notified).map(r => r.employee_id)
      if (pendingIds.length === 0) {
        toast.info('沒有未通知的員工')
        setTriggering(false)
        return
      }
      const { data, error } = await supabase.functions.invoke('monthly-attendance-diff-notify', {
        body: { year_month: ym, employee_ids: pendingIds },
      })
      if (error) throw error
      toast.success(`已送出：${data?.notified || 0} 人成功，${data?.failed || 0} 人失敗`)
      load()
    } catch (e) {
      toast.error('觸發失敗：' + (e.message || '未知'))
    }
    setTriggering(false)
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 打卡核對報表</h2>
            <p>對比排班 vs 打卡，找出待員工申請補卡 / 請假 / 加班的差異</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={load}>
              <RefreshCw size={14} /> 重新整理
            </button>
            {isAdmin && (
              <button className="btn btn-primary" onClick={handleSendNotifications} disabled={triggering || stats.pending === 0}>
                <Send size={14} /> {triggering ? '送出中...' : `發 LINE 給 ${stats.pending} 人`}
              </button>
            )}
            {isAdmin && (
              <button
                className="btn btn-secondary"
                onClick={handleCommitWriteback}
                disabled={committing}
                title="把排班 vs 打卡差異結算寫回 attendance_records，供批次計薪讀"
                style={{ background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}
              >
                <Save size={14} /> {committing ? '寫回中...' : '結算寫回'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 控制列 */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={goPrev} className="btn btn-secondary" style={{ padding: '4px 8px' }}>
            <ChevronLeft size={14} />
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 100, textAlign: 'center' }}>
            {year} 年 {month} 月
          </div>
          <button onClick={goNext} className="btn btn-secondary" style={{ padding: '4px 8px' }}>
            <ChevronRight size={14} />
          </button>
        </div>
        <select
          value={storeId} onChange={e => setStoreId(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 13,
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="">全部門市</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* 統計卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>檢視員工</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{stats.totalEmp}</div>
        </div>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>有差異</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-orange)' }}>{stats.withDiff}</div>
        </div>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>已通知</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-green)' }}>{stats.notified}</div>
        </div>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>未通知</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-red)' }}>{stats.pending}</div>
        </div>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>差異總筆數</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-red)' }}>{stats.totalDiff}</div>
        </div>
      </div>

      {/* 報表 */}
      <div className="card" style={{ padding: 0 }}>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>員工</th>
              <th>門市</th>
              <th style={{ textAlign: 'center' }}>差異筆數</th>
              <th style={{ textAlign: 'center' }}>通知狀態</th>
              <th style={{ textAlign: 'center' }}>詳情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>載入中…</td></tr>
            ) : report.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>無資料</td></tr>
            ) : report.map(r => (
              <tr key={r.employee_id} style={{ opacity: r.diff_count > 0 ? 1 : 0.5 }}>
                <td>{r.employee_name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{r.store_name || '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  {r.diff_count > 0 ? (
                    <span style={{
                      padding: '2px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                    }}>{r.diff_count}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>0</span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {r.diff_count === 0 ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                  ) : r.notified ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-green)', fontSize: 12, fontWeight: 600 }}>
                      <CheckCircle size={12} /> 已通知
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-orange)', fontSize: 12, fontWeight: 600 }}>
                      <AlertCircle size={12} /> 未通知
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {r.diff_count > 0 && (
                    <button onClick={() => openDetail(r)} className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }}>
                      <FileText size={12} /> 看
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 詳情 modal — 用 createPortal 渲染到 body，避免 layout wrapper transform 影響 fixed */}
      {detailEmp && createPortal(
        <div
          onClick={() => setDetailEmp(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 20px 20px',
            overflow: 'hidden',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 700, maxHeight: '90vh',
              background: 'var(--bg-card)', borderRadius: 16,
              border: '1px solid var(--border-subtle)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* Header — 固定不 scroll */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0, background: 'var(--bg-card)',
            }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{detailEmp.employee_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ym} · {detailEmp.store_name || '—'}</div>
              </div>
              <button onClick={() => setDetailEmp(null)} style={{
                background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                cursor: 'pointer', color: 'var(--text-muted)',
                width: 32, height: 32, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={18} />
              </button>
            </div>

            {/* Body — 可 scroll */}
            <div style={{ overflowY: 'auto', padding: '16px 24px', flex: 1 }}>
            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>載入中…</div>
            ) : detailDiffs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>無差異</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detailDiffs.map((d, i) => {
                  const color = TYPE_COLOR[d.diff_type] || { bg: '#eee', fg: '#666' }
                  return (
                    <div key={i} style={{
                      padding: '10px 14px', borderRadius: 8,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {d.diff_date}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>
                            ({new Date(d.diff_date).toLocaleDateString('zh-TW', { weekday: 'short' })})
                          </span>
                        </div>
                        <span style={{
                          padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: color.bg, color: color.fg,
                        }}>{TYPE_LABEL[d.diff_type] || d.diff_type}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>排班</span>
                          {d.expected_shift || '無班'}
                          {d.expected_hours > 0 && ` (${d.expected_hours}h)`}
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>實際</span>
                          {d.actual_clock_in
                            ? `${d.actual_clock_in.slice(0,5)} - ${d.actual_clock_out?.slice(0,5) || '?'}`
                            : '未打卡'}
                          {d.actual_hours > 0 && ` (${d.actual_hours}h)`}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                        {d.message}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
