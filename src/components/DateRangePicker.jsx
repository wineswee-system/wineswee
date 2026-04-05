import { useState, useEffect } from 'react'

function getPresetRange(preset) {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let start

  switch (preset) {
    case '本月':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case '上月':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end.setTime(new Date(now.getFullYear(), now.getMonth(), 0).getTime())
      break
    case '近三個月':
      start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
      break
    case '近六個月':
      start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
      break
    case '今年':
      start = new Date(now.getFullYear(), 0, 1)
      break
    default:
      start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

const presets = ['本月', '上月', '近三個月', '近六個月', '今年']

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    padding: '12px 16px',
    marginBottom: 16,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginRight: 2,
  },
  input: {
    padding: '6px 10px',
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-main, #0f172a)',
    color: 'var(--text-primary)',
    outline: 'none',
    fontFamily: 'inherit',
  },
  separator: {
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  presetBtn: (active) => ({
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: active ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
    background: active ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
    color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  }),
  divider: {
    width: 1,
    height: 24,
    background: 'var(--border-subtle)',
    margin: '0 4px',
  },
}

export default function DateRangePicker({ value, onChange }) {
  const [activePreset, setActivePreset] = useState('近六個月')
  const [range, setRange] = useState(() => value || getPresetRange('近六個月'))

  useEffect(() => {
    if (value && (value.startDate !== range.startDate || value.endDate !== range.endDate)) {
      setRange(value)
    }
  }, [value])

  // Fire onChange on mount with default
  useEffect(() => {
    onChange?.(range)
  }, [])

  const handlePreset = (preset) => {
    setActivePreset(preset)
    const newRange = getPresetRange(preset)
    setRange(newRange)
    onChange?.(newRange)
  }

  const handleInputChange = (field, val) => {
    setActivePreset(null)
    const newRange = { ...range, [field]: val }
    setRange(newRange)
    onChange?.(newRange)
  }

  return (
    <div style={styles.wrapper}>
      <span style={styles.label}>日期範圍</span>
      <input
        type="date"
        value={range.startDate}
        onChange={(e) => handleInputChange('startDate', e.target.value)}
        style={styles.input}
      />
      <span style={styles.separator}>~</span>
      <input
        type="date"
        value={range.endDate}
        onChange={(e) => handleInputChange('endDate', e.target.value)}
        style={styles.input}
      />
      <div style={styles.divider} />
      {presets.map((p) => (
        <button
          key={p}
          style={styles.presetBtn(activePreset === p)}
          onClick={() => handlePreset(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

export { getPresetRange }
