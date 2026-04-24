import { useState, useEffect } from 'react'

/**
 * 通用輸入 Modal
 * Props:
 *   isOpen       - boolean
 *   title        - string
 *   label        - string (optional)
 *   placeholder  - string (optional)
 *   onConfirm    - (value: string) => void
 *   onCancel     - () => void
 *   maxLength    - number (default 500)
 *   multiline    - boolean (default false)
 *   required     - boolean (default true) — if false, Confirm enabled even when empty
 */
export default function InputModal({
  isOpen,
  title,
  label,
  placeholder,
  onConfirm,
  onCancel,
  maxLength = 500,
  multiline = false,
  required = true,
}) {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (isOpen) setValue('')
  }, [isOpen])

  if (!isOpen) return null

  const handleConfirm = () => {
    if (required && !value.trim()) return
    onConfirm(value.trim())
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); handleConfirm() }
    if (e.key === 'Escape') onCancel()
  }

  const canConfirm = required ? value.trim().length > 0 : true

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onMouseDown={onCancel}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16, marginTop: 0 }}>
          {title}
        </h3>

        {label && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, marginTop: 0 }}>
            {label}
          </p>
        )}

        {multiline ? (
          <textarea
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: 14,
              resize: 'none',
              height: 96,
              boxSizing: 'border-box',
              outline: 'none',
            }}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus
          />
        ) : (
          <input
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: 14,
              boxSizing: 'border-box',
              outline: 'none',
            }}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus
          />
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4, marginBottom: 16 }}>
          {value.length}/{maxLength}
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: canConfirm ? 'var(--accent-cyan)' : 'var(--border-medium)',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'default',
              fontSize: 13,
              fontWeight: 700,
              opacity: canConfirm ? 1 : 0.5,
            }}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            確認
          </button>
        </div>
      </div>
    </div>
  )
}
