import { useState, useRef, useEffect, useMemo } from 'react'
import { Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react'

// 緊湊雙月曆區間選擇器（樣式參考人力銀行的 range picker）
// props: start/end 為 'YYYY-MM-DD' 字串；onChange(nextStart, nextEnd)
// 內部先存草稿，選好「起→迄」兩點才 onChange 回拋（避免半途查詢）。

const pad = (n) => String(n).padStart(2, '0')
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const fmt = (s) => (s ? s.replace(/-/g, '/') : '')
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const sameDay = (a, b) => a && b && a.getTime() === b.getTime()
const daysInclusive = (s, e) => (s && e ? Math.round((parse(e) - parse(s)) / 86400000) + 1 : 0)

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function monthCells(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()               // 週日=0
  const gridStart = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    return { date: d, inMonth: d.getMonth() === month }
  })
}

const PRESETS = [
  { label: '本月', fn: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n] } },
  { label: '上月', fn: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] } },
  { label: '近 7 天', fn: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), n.getDate() - 6), n] } },
  { label: '近 30 天', fn: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), n.getDate() - 29), n] } },
]

export default function DateRangeField({ start, end, onChange }) {
  const [open, setOpen] = useState(false)
  const [align, setAlign] = useState('left')   // 依觸發欄位置自動決定往左/右展開
  const [draft, setDraft] = useState({ s: start || null, e: end || null })
  const [view, setView] = useState(() => (start ? addMonths(parse(start), 0) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const ref = useRef(null)

  // 開啟時量觸發欄位置：若往右展開會超出視窗右緣 → 改右對齊往左展開
  const toggleOpen = () => setOpen((o) => {
    const next = !o
    if (next && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      const POPUP_W = 440
      setAlign(rect.left + POPUP_W > window.innerWidth ? 'right' : 'left')
    }
    return next
  })

  useEffect(() => { setDraft({ s: start || null, e: end || null }) }, [start, end])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const sDate = parse(draft.s), eDate = parse(draft.e)
  const total = daysInclusive(draft.s, draft.e)

  const pick = (d) => {
    const ds = toStr(d)
    // 沒起點 or 已選完整區間 → 重新開始
    if (!draft.s || (draft.s && draft.e)) { setDraft({ s: ds, e: null }); return }
    // 有起點、選迄點
    if (parse(ds) < parse(draft.s)) { setDraft({ s: ds, e: null }); return }  // 選到起點之前 → 當新起點
    const next = { s: draft.s, e: ds }
    setDraft(next)
    onChange?.(next.s, next.e)
    setOpen(false)
  }

  const applyPreset = (p) => {
    const [a, b] = p.fn()
    const next = { s: toStr(a), e: toStr(b) }
    setDraft(next); setView(new Date(a.getFullYear(), a.getMonth(), 1))
    onChange?.(next.s, next.e); setOpen(false)
  }

  const inRange = (d) => sDate && eDate && d >= sDate && d <= eDate
  const isEnd = (d) => sameDay(d, sDate) || sameDay(d, eDate)

  const renderMonth = (base) => {
    const y = base.getFullYear(), m = base.getMonth()
    return (
      <div style={{ padding: '0 4px' }}>
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          {m + 1} 月 <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{y}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 26px)', gap: 1 }}>
          {WEEK.map((w) => (
            <div key={w} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', height: 20, lineHeight: '20px' }}>{w}</div>
          ))}
          {monthCells(y, m).map(({ date, inMonth }, i) => {
            const sel = isEnd(date), rng = inRange(date)
            return (
              <button
                key={i}
                onClick={() => pick(date)}
                style={{
                  height: 26, width: 26, border: 'none', cursor: 'pointer', fontSize: 12,
                  borderRadius: sel ? 6 : 0,
                  background: sel ? 'var(--accent-cyan)' : rng ? 'var(--accent-cyan-dim)' : 'transparent',
                  color: sel ? '#fff' : inMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                  opacity: inMonth ? 1 : 0.45,
                  fontWeight: sel ? 700 : 400,
                }}
              >{date.getDate()}</button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {/* 觸發欄 */}
      <div
        onClick={toggleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '6px 10px', fontSize: 13, minWidth: 190,
          background: 'var(--bg-input)', border: '1px solid var(--border-medium)', borderRadius: 8,
          color: draft.s ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        <Calendar size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, whiteSpace: 'nowrap' }}>
          {draft.s ? `${fmt(draft.s)} — ${fmt(draft.e) || '…'}` : '選擇日期區間'}
        </span>
        {draft.s && (
          <X size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); applyPreset(PRESETS[0]) }} />
        )}
      </div>

      {/* 彈窗 */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', [align]: 0, zIndex: 50,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <button onClick={() => setView((v) => addMonths(v, -1))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
              <ChevronLeft size={16} />
            </button>
            {renderMonth(view)}
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
            {renderMonth(addMonths(view, 1))}
            <button onClick={() => setView((v) => addMonths(v, 1))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => applyPreset(p)}
                  style={{
                    fontSize: 12, padding: '4px 10px', cursor: 'pointer',
                    background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 6,
                  }}>{p.label}</button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {total > 0 ? <>共 <b style={{ color: 'var(--accent-cyan)' }}>{total}</b> 日</> : '請選起訖日'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
