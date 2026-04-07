import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Auto-playing step-by-step feature carousel
 * Each step has a title, description, and a visual mockup (React node)
 */
export default function FeatureCarousel({ steps, interval = 4000, accentColor = '#2563eb' }) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

  const next = useCallback(() => setCurrent(i => (i + 1) % steps.length), [steps.length])
  const prev = useCallback(() => setCurrent(i => (i - 1 + steps.length) % steps.length), [steps.length])

  useEffect(() => {
    if (paused) return
    const t = setInterval(next, interval)
    return () => clearInterval(t)
  }, [paused, next, interval])

  const step = steps[current]

  return (
    <div
      className="fc-root"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Progress bar */}
      <div className="fc-progress">
        {steps.map((_, i) => (
          <button
            key={i}
            className={`fc-dot ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}
            style={i === current ? { '--fc-color': accentColor } : undefined}
            onClick={() => setCurrent(i)}
          >
            <span className="fc-dot-label">步驟 {i + 1}</span>
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="fc-body">
        {/* Left: text */}
        <div className="fc-text">
          <div className="fc-step-num" style={{ color: accentColor }}>
            Step {current + 1}/{steps.length}
          </div>
          <h3 className="fc-step-title">{step.title}</h3>
          <p className="fc-step-desc">{step.desc}</p>

          {/* Nav arrows */}
          <div className="fc-nav">
            <button className="fc-arrow" onClick={prev}><ChevronLeft size={18} /></button>
            <button className="fc-arrow" onClick={next}><ChevronRight size={18} /></button>
          </div>
        </div>

        {/* Right: mockup screen */}
        <div className="fc-screen">
          <div className="fc-screen-bar">
            <span className="fc-screen-dot" />
            <span className="fc-screen-dot" />
            <span className="fc-screen-dot" />
            <span className="fc-screen-url">{step.screenTitle || step.title}</span>
          </div>
          <div className="fc-screen-body" key={current}>
            {step.screen}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   Reusable mockup building blocks
   ════════════════════════════════════════ */

export function MockTable({ headers, rows }) {
  return (
    <table className="mock-table">
      <thead>
        <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

export function MockStat({ label, value, color }) {
  return (
    <div className="mock-stat">
      <div className="mock-stat-value" style={color ? { color } : undefined}>{value}</div>
      <div className="mock-stat-label">{label}</div>
    </div>
  )
}

export function MockBadge({ children, color = '#059669' }) {
  return (
    <span className="mock-badge" style={{ background: `${color}15`, color, borderColor: `${color}30` }}>
      {children}
    </span>
  )
}

export function MockBtn({ children, primary }) {
  return (
    <span className={`mock-btn ${primary ? 'primary' : ''}`}>{children}</span>
  )
}

export function MockField({ label, value }) {
  return (
    <div className="mock-field">
      <div className="mock-field-label">{label}</div>
      <div className="mock-field-value">{value}</div>
    </div>
  )
}

export function MockCard({ title, children }) {
  return (
    <div className="mock-card">
      {title && <div className="mock-card-title">{title}</div>}
      {children}
    </div>
  )
}

export function MockRow({ children }) {
  return <div className="mock-row">{children}</div>
}
