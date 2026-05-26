/**
 * RecurrenceEditor — visual RRULE builder for tasks.
 *
 * Props:
 *   value   {string}   - RRULE string (e.g. "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1")
 *   until   {string}   - ISO date for recurrence end date (task.recurrence_until)
 *   onChange(rule, until) - called on every change; until is '' when cleared
 *
 * Supports: DAILY, WEEKLY (BYDAY), MONTHLY (BYMONTHDAY), YEARLY
 *           INTERVAL, end by date
 */
import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { describeRule, listOccurrences } from '../../lib/recurrence'

const DAYS = [
  { code: 'MO', label: '一' },
  { code: 'TU', label: '二' },
  { code: 'WE', label: '三' },
  { code: 'TH', label: '四' },
  { code: 'FR', label: '五' },
  { code: 'SA', label: '六' },
  { code: 'SU', label: '日' },
]

const FREQ_UNITS = { DAILY: '天', WEEKLY: '週', MONTHLY: '月', YEARLY: '年' }

// ---------------------------------------------------------------------------
// RRULE helpers
// ---------------------------------------------------------------------------
function buildRule({ freq, interval, byday, bymonthday }) {
  if (!freq) return ''
  const parts = [`FREQ=${freq}`]
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (freq === 'WEEKLY' && byday?.length) parts.push(`BYDAY=${byday.join(',')}`)
  if (freq === 'MONTHLY' && bymonthday) parts.push(`BYMONTHDAY=${bymonthday}`)
  return parts.join(';')
}

function parseLocal(rule) {
  if (!rule) return { freq: '', interval: 1, byday: [], bymonthday: 1 }
  const p = Object.fromEntries(rule.split(';').map((kv) => kv.split('=')))
  return {
    freq: p.FREQ || '',
    interval: Number(p.INTERVAL || 1),
    byday: p.BYDAY ? p.BYDAY.split(',') : [],
    bymonthday: Number(p.BYMONTHDAY || 1),
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function RecurrenceEditor({ value = '', until = '', onChange }) {
  const [state, setState] = useState(() => parseLocal(value))
  const [endMode, setEndMode] = useState(() => (until ? 'until' : 'never'))

  // Sync when task switches
  useEffect(() => {
    setState(parseLocal(value))
    setEndMode(until ? 'until' : 'never')
  }, [value, until])

  const emit = (nextState, nextEndMode, nextUntil) => {
    const rule = buildRule(nextState)
    const untilVal = nextEndMode === 'until' ? (nextUntil ?? until) : ''
    onChange(rule, untilVal)
  }

  const update = (patch) => {
    const next = { ...state, ...patch }
    setState(next)
    emit(next, endMode, until)
  }

  const changeEndMode = (mode) => {
    setEndMode(mode)
    emit(state, mode, until)
  }

  const toggleDay = (code) => {
    const cur = state.byday || []
    const next = cur.includes(code) ? cur.filter((d) => d !== code) : [...cur, code]
    update({ byday: next })
  }

  const rule = buildRule(state)
  const upcoming = rule
    ? listOccurrences(rule, new Date(), 3).map((d) => `${d.getMonth() + 1}/${d.getDate()}`)
    : []

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }
  const labelStyle = { fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }
  const pillStyle = (active) => ({
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-medium)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    background: active ? 'var(--accent-purple-dim)' : 'var(--bg-secondary)',
    color: active ? 'var(--accent-purple)' : 'var(--text-muted)',
  })

  return (
    <div>
      {/* ── Frequency + interval ── */}
      <div style={rowStyle}>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 90 }}
          value={state.freq}
          onChange={(e) =>
            update({ freq: e.target.value, byday: [], bymonthday: 1, interval: 1 })
          }
        >
          <option value="">不重複</option>
          <option value="DAILY">每天</option>
          <option value="WEEKLY">每週</option>
          <option value="MONTHLY">每月</option>
          <option value="YEARLY">每年</option>
        </select>

        {state.freq && (
          <>
            <span style={labelStyle}>每隔</span>
            <input
              type="number"
              className="form-input"
              min={1}
              max={99}
              style={{ width: 56, textAlign: 'center' }}
              value={state.interval}
              onChange={(e) =>
                update({ interval: Math.max(1, Number(e.target.value) || 1) })
              }
            />
            <span style={labelStyle}>{FREQ_UNITS[state.freq]}</span>
          </>
        )}
      </div>

      {/* ── Weekly: day picker ── */}
      {state.freq === 'WEEKLY' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {DAYS.map((d) => {
            const active = state.byday.includes(d.code)
            return (
              <button
                key={d.code}
                type="button"
                onClick={() => toggleDay(d.code)}
                style={{
                  width: 30, height: 30, borderRadius: '50%',
                  border: '1px solid var(--border-medium)',
                  background: active ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                  color: active ? '#fff' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                }}
              >
                {d.label}
              </button>
            )
          })}
          {state.byday.length === 0 && (
            <span style={{ ...labelStyle, alignSelf: 'center', marginLeft: 4 }}>
              （選擇星期）
            </span>
          )}
        </div>
      )}

      {/* ── Monthly: day-of-month ── */}
      {state.freq === 'MONTHLY' && (
        <div style={rowStyle}>
          <span style={labelStyle}>每月第</span>
          <input
            type="number"
            className="form-input"
            min={1}
            max={31}
            style={{ width: 56, textAlign: 'center' }}
            value={state.bymonthday}
            onChange={(e) =>
              update({ bymonthday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
            }
          />
          <span style={labelStyle}>日</span>
        </div>
      )}

      {/* ── End condition ── */}
      {state.freq && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" style={pillStyle(endMode === 'never')} onClick={() => changeEndMode('never')}>
              永不結束
            </button>
            <button type="button" style={pillStyle(endMode === 'until')} onClick={() => changeEndMode('until')}>
              到指定日期
            </button>
          </div>
          {endMode === 'until' && (
            <input
              type="date"
              className="form-input"
              style={{ width: '100%', marginBottom: 8 }}
              value={until || ''}
              onChange={(e) => emit(state, 'until', e.target.value)}
            />
          )}
        </>
      )}

      {/* ── Upcoming preview ── */}
      {rule && (
        <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4, fontWeight: 600, lineHeight: 1.6 }}>
          <Calendar size={10} style={{ display: 'inline', marginRight: 3 }} />
          {describeRule(rule)} · 完成後自動建立下次
          {upcoming.length > 0 && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
              （近期：{upcoming.join('、')}）
            </span>
          )}
        </div>
      )}
    </div>
  )
}
