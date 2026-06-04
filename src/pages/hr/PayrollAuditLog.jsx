/**
 * 薪資調整稽核儀表板
 *
 * 顯示 salary_adjustments 紀錄，含篩選 + 影響金額估算 + 異常標記。
 * 給老闆查「HR 改了什麼」、「誰大幅調」、「為什麼這月薪資差這麼多」。
 *
 * 走 RPC: get_salary_audit_log（R3 已建）
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Filter, AlertTriangle, RotateCcw, ArrowLeft, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { fmtNT as fmt } from '../../lib/currency'
import { estimateAdjustmentImpact } from '../../lib/payrollAdjustments'

const SOURCE_LABEL = {
  attendance:       '打卡',
  leave:            '請假',
  overtime:         '加班單',
  manual_bonus:     '一次性紅包',
  manual_deduction: '一次性扣項',
}

const FIELD_LABEL = {
  late_minutes:     '遲到分鐘',
  ot_hours_weekday: '平日加班時數',
  ot_hours_holiday: '假日加班時數',
  leave_days:       '請假天數',
  leave_pay_mode:   '請假扣薪方式',
  amount:           '金額',
}

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatJsonValue(v) {
  if (v == null) return '—'
  if (typeof v !== 'object') return String(v)
  // Common shapes
  if ('value' in v)  return String(v.value) + (v.suffix || '')
  if ('days' in v)   return `${v.days} 天${v.bucket ? ` (${v.bucket === 'half' ? '半薪' : v.bucket === 'unpaid' ? '無薪' : v.bucket})` : ''}`
  if ('mode' in v)   return `${v.mode === 'paid' ? '不扣薪' : v.mode === 'half' ? '扣半薪' : '扣全薪'}${v.days ? ` (${v.days} 天)` : ''}`
  if ('amount' in v) return fmt(v.amount) + (v.label ? ` (${v.label})` : '')
  return JSON.stringify(v)
}

export default function PayrollAuditLog() {
  const { profile, profileReady } = useAuth()
  const navigate = useNavigate()

  const orgId = profile?.organization_id ?? null

  // Filters
  const [month, setMonth]                 = useState(currentMonth())
  const [creatorFilter, setCreatorFilter] = useState('')
  const [empFilter, setEmpFilter]         = useState('')
  const [sourceFilter, setSourceFilter]   = useState('')
  const [minImpact, setMinImpact]         = useState(0)
  const [includeSuperseded, setIncludeSuperseded] = useState(false)
  const [search, setSearch]               = useState('')

  // Data
  const [logs, setLogs]               = useState([])
  const [employees, setEmployees]     = useState({})  // for hourly_rate lookup
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')

  // ── Load ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('get_salary_audit_log', {
        p_month:              month || null,
        p_organization_id:    orgId,
        p_creator_id:         creatorFilter || null,
        p_employee_id:        empFilter || null,
        p_source_type:        sourceFilter || null,
        p_include_superseded: includeSuperseded,
        p_limit:              500,
      })
      if (e) throw e

      // Load employee salary structures for hourly rate (estimate impact)
      const empIds = [...new Set((data || []).map(r => r.employee_id).filter(Boolean))]
      let empMap = {}
      if (empIds.length) {
        const { data: emps } = await supabase
          .from('employees')
          .select('id, name, salary_structures(salary_type, hourly_rate, base_salary)')
          .in('id', empIds)
        empMap = Object.fromEntries((emps || []).map(e => [e.id, e]))
      }

      setLogs(data || [])
      setEmployees(empMap)
    } catch (err) {
      console.error('Audit log load failed:', err)
      setError(err.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [month, orgId, creatorFilter, empFilter, sourceFilter, includeSuperseded])

  useEffect(() => {
    if (!profileReady) return
    load()
  }, [profileReady, load])

  // ── 影響金額估算 + 異常標記 ──────────────────────────────────────
  const enrichedLogs = useMemo(() => {
    return logs.map(log => {
      const emp = employees[log.employee_id]
      const ss  = emp?.salary_structures?.[0] || emp?.salary_structures || {}
      const hourlyRate = Number(ss.hourly_rate) || (ss.base_salary ? Math.round(ss.base_salary / 30 / 8) : 0)
      const impact = estimateAdjustmentImpact(log, hourlyRate)
      // 異常標記
      const flags = []
      if (Math.abs(impact) > 1000) flags.push('high_impact')
      if (!log.reason || log.reason.trim().length < 2) flags.push('no_reason')
      return { ...log, _impact: impact, _flags: flags }
    }).filter(log => {
      if (minImpact > 0 && Math.abs(log._impact) < minImpact) return false
      if (search && !log.employee_name?.includes(search) && !log.created_by_name?.includes(search)) return false
      return true
    })
  }, [logs, employees, minImpact, search])

  // ── Summary stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    let totalImpact = 0
    let creators = new Set()
    let employeesSet = new Set()
    for (const l of enrichedLogs) {
      totalImpact += l._impact
      if (l.created_by_id) creators.add(l.created_by_id)
      if (l.employee_id)   employeesSet.add(l.employee_id)
    }
    return {
      count: enrichedLogs.length,
      totalImpact,
      creatorCount: creators.size,
      employeeCount: employeesSet.size,
    }
  }, [enrichedLogs])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={load} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔍</span> 薪資調整稽核</h2>
            <p>{stats.count} 筆調整 · {stats.creatorCount} 位調整人 · {stats.employeeCount} 位被調員工 · 總影響 {fmt(stats.totalImpact)}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/hr/salary')}>
              <ArrowLeft size={14} /> 回薪資主頁
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>月份</label>
            <input type="month"
              className="form-input"
              style={{ fontSize: 12, padding: '4px 8px', width: 130 }}
              value={month}
              onChange={e => setMonth(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>來源類型</label>
            <select className="form-input"
              style={{ fontSize: 12, padding: '4px 8px', width: 140 }}
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>最小影響金額</label>
            <input type="number"
              className="form-input"
              placeholder="0"
              style={{ fontSize: 12, padding: '4px 8px', width: 100 }}
              value={minImpact}
              onChange={e => setMinImpact(Number(e.target.value) || 0)} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>搜尋姓名</label>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text"
                className="form-input"
                style={{ fontSize: 12, padding: '4px 8px 4px 28px', width: '100%' }}
                placeholder="員工或調整人..."
                value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={includeSuperseded}
                onChange={e => setIncludeSuperseded(e.target.checked)} />
              <History size={12} /> 含歷史版本
            </label>
          </div>
        </div>
      </div>

      {/* Logs table */}
      <div className="card" style={{ padding: 0 }}>
        {enrichedLogs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Filter size={32} style={{ margin: '0 auto 12px', display: 'block', color: 'var(--text-muted)' }} />
            找不到符合條件的調整紀錄
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>時間</th>
                  <th style={{ width: 100 }}>調整人</th>
                  <th style={{ width: 100 }}>員工</th>
                  <th style={{ width: 80 }}>來源</th>
                  <th style={{ width: 110 }}>項目</th>
                  <th style={{ width: 180 }}>原 → 新</th>
                  <th style={{ width: 100, textAlign: 'right' }}>影響</th>
                  <th>理由 / 標記</th>
                </tr>
              </thead>
              <tbody>
                {enrichedLogs.map(log => {
                  const isSuper = !!log.superseded_at
                  const impact  = log._impact
                  return (
                    <tr key={log.adjustment_id} style={{
                      opacity:    isSuper ? 0.5 : 1,
                      background: log._flags.includes('high_impact') ? 'rgba(245,158,11,0.08)' : undefined,
                    }}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(log.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ fontWeight: 600 }}>{log.created_by_name || '—'}</td>
                      <td>{log.employee_name || '—'}</td>
                      <td>
                        <span style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: 'var(--bg-card)', color: 'var(--text-secondary)',
                        }}>
                          {SOURCE_LABEL[log.source_type] || log.source_type}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{FIELD_LABEL[log.field] || log.field}</td>
                      <td style={{ fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{formatJsonValue(log.original_value)}</span>
                        {' → '}
                        <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{formatJsonValue(log.new_value)}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700,
                        color: impact > 0 ? 'var(--accent-green)' : impact < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                        {impact === 0 ? '—' : (impact > 0 ? '+' : '') + fmt(impact)}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {log.reason || <span style={{ fontStyle: 'italic' }}>(無理由)</span>}
                        {log._flags.includes('high_impact') && (
                          <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)' }}>
                            <AlertTriangle size={9} /> 大金額
                          </span>
                        )}
                        {log._flags.includes('no_reason') && !log.reason && (
                          <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            color: 'var(--accent-red)', background: 'var(--accent-red-dim)' }}>
                            無理由
                          </span>
                        )}
                        {isSuper && (
                          <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}>
                            <RotateCcw size={9} /> 已被取代
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
