import { useState, useRef, useEffect } from 'react'
import Spinner from './Spinner'

/**
 * 取代普通 <button>，自動處理「點擊期間 disable + 顯示 spinner」防重送
 *
 * 用法：
 *   <AsyncButton className="btn btn-primary" onClick={async () => { await save() }}>
 *     送出
 *   </AsyncButton>
 *
 * onClick 可 sync 也可 async；只要 click handler 還沒 resolve 就會 disable。
 *
 * Props 跟原生 <button> 一致，再加：
 *   - busyLabel?: string  ／按鈕在 loading 中要顯示的文字（預設不變，只多一個 spinner）
 *   - spinnerColor?: string ／spinner 顏色（預設 currentColor）
 *   - spinnerSize?: number ／spinner 大小（預設 12）
 */
export default function AsyncButton({
  onClick,
  children,
  busyLabel,
  spinnerColor,
  spinnerSize = 12,
  disabled = false,
  style,
  ...rest
}) {
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const handleClick = async (e) => {
    if (busy || disabled || !onClick) return
    setBusy(true)
    try {
      await onClick(e)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const finalStyle = (busy || disabled)
    ? { ...style, opacity: 0.65, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }
    : { ...style, display: 'inline-flex', alignItems: 'center', gap: 6 }

  return (
    <button
      {...rest}
      onClick={handleClick}
      disabled={busy || disabled}
      aria-busy={busy}
      style={finalStyle}
    >
      {busy && <Spinner size={spinnerSize} color={spinnerColor || 'currentColor'} />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
