import { useState, useEffect, useCallback } from 'react'
import { Hash, Plus, AlertTriangle, XCircle, RefreshCw } from 'lucide-react'
import { useOrgId } from '../../contexts/AuthContext'
import {
  getTrackUsage, createTrackAllocation, closeTrackAllocation,
  isValidTrackPeriod, LOW_REMAINING_PCT,
} from '../../lib/db/invoiceTracks'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import { toast } from '../../lib/toast'

const STATUS_LABEL = {
  active: { text: '使用中', status: 'success' },
  exhausted: { text: '已用罄', status: 'error' },
  closed: { text: '已關閉', status: 'info' },
}
const SOURCE_LABEL = { config: '配號檔', manual: '手動' }

const fmtNum = (n) => Number(n ?? 0).toLocaleString('zh-TW')
const fmtPeriodLabel = (p) => {
  const year = Math.floor(p / 100)
  const m = p % 100
  return `${year - 1911}年${String(m).padStart(2, '0')}-${String(m + 1).padStart(2, '0')}月`
}

/** F-B2 字軌配號管理：期別/字軌/起迄/已用/餘量 + 餘量警示 */
export default function InvoiceTracks() {
  const orgId = useOrgId()
  const now = new Date()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)

  // 建立表單：期別預設本期（奇數月）
  const oddMonth = now.getMonth() + 1 - ((now.getMonth() + 2) % 2)
  const [form, setForm] = useState({
    year: now.getFullYear(),
    month: oddMonth,
    track: 'AB',
    rangeStart: '',
    rangeEnd: '',
  })

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: err } = await getTrackUsage(orgId)
    if (err) {
      setError('配號資料載入失敗，請重新整理頁面')
    } else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  const formPeriod = form.year * 100 + Number(form.month)

  const handleCreate = async () => {
    if (!isValidTrackPeriod(formPeriod)) {
      toast.error('期別起始月必須為奇數月（1/3/5/7/9/11）')
      return
    }
    setSaving(true)
    try {
      await createTrackAllocation({
        organizationId: orgId,
        period: formPeriod,
        track: form.track.toUpperCase(),
        rangeStart: Number(form.rangeStart),
        rangeEnd: Number(form.rangeEnd),
        source: 'manual',
      })
      toast.success('配號區間已建立')
      setShowModal(false)
      load()
    } catch (e) {
      toast.error(e.message || '建立配號區間失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = async (row) => {
    try {
      await closeTrackAllocation(row.allocation_id, orgId)
      toast.success('配號區間已關閉')
      load()
    } catch (e) {
      toast.error(e.message || '關閉配號區間失敗')
    }
  }

  const lowRows = rows.filter(r => r.status === 'active' && Number(r.pct_remaining) < LOW_REMAINING_PCT)

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={load} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Hash size={22} /></span> 字軌配號管理</h2>
            <p>電子發票字軌配號區間 — 期別/字軌/起迄/已用/餘量</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={load}><RefreshCw size={14} /> 重新整理</button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增配號區間</button>
          </div>
        </div>
      </div>

      {/* 餘量警示 */}
      {lowRows.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 14, border: '1px solid var(--accent-orange)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={18} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
          <div>
            <strong style={{ color: 'var(--accent-orange)' }}>字軌餘量不足（低於 {LOW_REMAINING_PCT}%）</strong>
            <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
              {lowRows.map(r => `${fmtPeriodLabel(r.period)} ${r.track}（剩 ${fmtNum(r.remaining)} 號）`).join('、')}
              — 請儘速匯入或新增配號區間
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h3 className="card-title">配號區間清單</h3></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>期別</th>
                <th>字軌</th>
                <th>起號 ~ 迄號</th>
                <th style={{ textAlign: 'right' }}>已用</th>
                <th style={{ textAlign: 'right' }}>餘量</th>
                <th style={{ minWidth: 160 }}>用量</th>
                <th>來源</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無配號區間 — 未建立區間的期別/字軌沿用開放配號（相容模式）</td></tr>
              ) : rows.map((r) => {
                const usedPct = r.total > 0 ? Math.round((Number(r.used) / Number(r.total)) * 100) : 0
                const low = r.status === 'active' && Number(r.pct_remaining) < LOW_REMAINING_PCT
                const st = STATUS_LABEL[r.status] || STATUS_LABEL.active
                return (
                  <tr key={r.allocation_id}>
                    <td>{fmtPeriodLabel(r.period)}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.track}</td>
                    <td style={{ fontFamily: 'monospace' }}>{String(r.range_start).padStart(8, '0')} ~ {String(r.range_end).padStart(8, '0')}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(r.used)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: low ? 'var(--accent-orange)' : undefined }}>{fmtNum(r.remaining)}</td>
                    <td>
                      <ProgressBar
                        value={usedPct}
                        size="sm"
                        color={low ? 'var(--accent-orange)' : 'var(--accent-cyan)'}
                      />
                    </td>
                    <td>{SOURCE_LABEL[r.source] || r.source}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Badge status={st.status} dot>{st.text}</Badge>
                        {low && <Badge status="warning"><AlertTriangle size={11} style={{ marginRight: 2 }} />餘量不足</Badge>}
                      </span>
                    </td>
                    <td>
                      {r.status === 'active' && (
                        <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleClose(r)}>
                          <XCircle size={12} /> 關閉
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增配號區間 Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div className="card" style={{ width: 440, padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>新增配號區間</h3>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  年度
                  <select className="form-input" value={form.year} onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))}>
                    {[...Array(3)].map((_, i) => {
                      const y = now.getFullYear() - 1 + i
                      return <option key={y} value={y}>{y - 1911}年 ({y})</option>
                    })}
                  </select>
                </label>
                <label>
                  期別（起始奇數月）
                  <select className="form-input" value={form.month} onChange={e => setForm(f => ({ ...f, month: Number(e.target.value) }))}>
                    {[1, 3, 5, 7, 9, 11].map(m => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}-{String(m + 1).padStart(2, '0')}月</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                字軌（2 碼大寫英文）
                <input className="form-input" maxLength={2} value={form.track}
                  onChange={e => setForm(f => ({ ...f, track: e.target.value.toUpperCase() }))} placeholder="AB" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  起號（8 碼）
                  <input className="form-input" type="number" value={form.rangeStart}
                    onChange={e => setForm(f => ({ ...f, rangeStart: e.target.value }))} placeholder="55668800" />
                </label>
                <label>
                  迄號（8 碼）
                  <input className="form-input" type="number" value={form.rangeEnd}
                    onChange={e => setForm(f => ({ ...f, rangeEnd: e.target.value }))} placeholder="55668899" />
                </label>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                期別 {formPeriod}（{fmtPeriodLabel(formPeriod)}）— 配號 RPC 僅允許在使用中區間內取號
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowModal(false)} disabled={saving}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.rangeStart || !form.rangeEnd}>
                {saving ? '建立中…' : '建立'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
