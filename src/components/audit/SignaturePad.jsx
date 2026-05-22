import { useRef, useState, useEffect } from 'react'
import { RotateCcw, Check, X } from 'lucide-react'

// 手寫簽名 modal：給當班人員當場簽名用
// onConfirm(dataUrl) — 完成時回傳 base64 PNG data URL
export default function SignaturePad({ open, signerName, onConfirm, onClose }) {
  const canvasRef = useRef(null)
  const [drawing, setDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    // 高 DPI 設定
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    setHasDrawn(false)
  }, [open])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const touch = e.touches?.[0]
    const x = (touch ? touch.clientX : e.clientX) - rect.left
    const y = (touch ? touch.clientY : e.clientY) - rect.top
    return { x, y }
  }

  const start = (e) => {
    e.preventDefault()
    setDrawing(true)
    const { x, y } = getPos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  const move = (e) => {
    if (!drawing) return
    e.preventDefault()
    const { x, y } = getPos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasDrawn(true)
  }
  const end = (e) => {
    e?.preventDefault?.()
    setDrawing(false)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    setHasDrawn(false)
  }

  const submit = () => {
    if (!hasDrawn) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onConfirm(dataUrl)
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card" style={{ width: 'min(500px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>請簽名</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>簽名人：{signerName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{
            border: '2px dashed var(--border)', borderRadius: 8, background: '#ffffff', position: 'relative',
            aspectRatio: '2 / 1', overflow: 'hidden',
          }}>
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            />
            {!hasDrawn && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#cccccc', fontSize: 14, pointerEvents: 'none',
              }}>
                在此處簽名
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={clear} disabled={!hasDrawn}>
            <RotateCcw size={14} /> 重簽
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={submit} disabled={!hasDrawn}>
              <Check size={14} /> 完成簽名
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
