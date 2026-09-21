import { useState, useEffect, useRef, useCallback } from 'react'
import { ScanBarcode, Camera, X } from 'lucide-react'
import { createBarcodeListener, initCameraScanner, lookupBarcode, playBeep } from '../lib/barcodeScanner'

/**
 * BarcodeInput - 通用條碼掃描元件
 *
 * Props:
 *   onScan(code, lookupResult)  — 掃描回呼，lookupResult 可能為 null
 *   placeholder                 — 輸入框佔位文字
 *   showCamera                  — 是否顯示相機按鈕 (預設 true)
 *   autoLookup                  — 是否自動查詢 SKU (預設 true)
 *   disabled                    — 停用
 */
export default function BarcodeInput({
  onScan,
  placeholder = '掃描或輸入條碼...',
  showCamera = true,
  autoLookup = true,
  disabled = false,
}) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState('ready') // ready | found | notfound | scanning
  const [statusText, setStatusText] = useState('掃描就緒')
  const [cameraActive, setCameraActive] = useState(false)
  const [flashClass, setFlashClass] = useState('')

  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const cameraScannerRef = useRef(null)

  // USB/Bluetooth 掃描器監聽
  useEffect(() => {
    if (disabled) return
    const cleanup = createBarcodeListener((code) => {
      handleScan(code)
    })
    return cleanup
  }, [disabled, onScan, autoLookup])

  // 清理相機
  useEffect(() => {
    return () => {
      if (cameraScannerRef.current) {
        cameraScannerRef.current.stop()
      }
    }
  }, [])

  const handleScan = useCallback(async (code) => {
    if (!code || disabled) return
    setValue(code)
    setStatus('scanning')
    setStatusText('查詢中...')

    let result = null
    if (autoLookup) {
      result = await lookupBarcode(code)
    }

    if (result) {
      const name = result.type === 'sku' ? result.data.name : result.data.skus?.name || ''
      const skuCode = result.type === 'sku' ? result.data.code : result.data.skus?.code || ''
      setStatus('found')
      setStatusText(`找到: ${skuCode} ${name}`)
      setFlashClass('barcode-flash-green')
      playBeep(true)
    } else if (autoLookup) {
      setStatus('notfound')
      setStatusText('找不到條碼')
      setFlashClass('barcode-flash-red')
      playBeep(false)
    } else {
      setStatus('found')
      setStatusText(`已掃描: ${code}`)
      setFlashClass('barcode-flash-green')
      playBeep(true)
    }

    // 移除閃爍動畫
    setTimeout(() => setFlashClass(''), 500)

    if (onScan) onScan(code, result)
  }, [disabled, autoLookup, onScan])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      handleScan(value.trim())
    }
  }

  const toggleCamera = async () => {
    if (cameraActive) {
      if (cameraScannerRef.current) cameraScannerRef.current.stop()
      setCameraActive(false)
      return
    }
    setCameraActive(true)
    // 等 videoRef 渲染後再初始化
    setTimeout(async () => {
      if (videoRef.current) {
        const scanner = await initCameraScanner(videoRef.current, handleScan)
        cameraScannerRef.current = scanner
        if (!scanner.supported) {
          setStatusText('相機掃描不支援，請手動輸入')
          setCameraActive(false)
        }
      }
    }, 100)
  }

  const handleClear = () => {
    setValue('')
    setStatus('ready')
    setStatusText('掃描就緒')
    inputRef.current?.focus()
  }

  return (
    <div className={`card ${flashClass}`} style={{ marginBottom: 16, transition: 'box-shadow 0.3s' }}>
      <div className="card-header" style={{ paddingBottom: 0 }}>
        <div className="card-title">
          <span className="card-title-icon"><ScanBarcode size={16} /></span> 條碼掃描
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: status === 'found' ? 'var(--accent-green)'
              : status === 'notfound' ? 'var(--accent-red)'
              : 'var(--text-muted)'
          }}>
            {statusText}
          </span>
        </div>
      </div>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <ScanBarcode size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-muted)' }} />
            <input
              ref={inputRef}
              type="text"
              className="form-input"
              style={{ width: '100%', paddingLeft: 38, fontSize: 14, fontFamily: 'monospace' }}
              placeholder={placeholder}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
            />
          </div>
          {value && (
            <button className="btn btn-secondary" onClick={handleClear} style={{ padding: '8px' }}>
              <X size={14} />
            </button>
          )}
          {showCamera && (
            <button
              className={`btn ${cameraActive ? 'btn-primary' : 'btn-secondary'}`}
              onClick={toggleCamera}
              style={{ whiteSpace: 'nowrap', fontSize: 12 }}
              disabled={disabled}
            >
              <Camera size={14} /> 掃描
            </button>
          )}
        </div>

        {/* 相機預覽 */}
        {cameraActive && (
          <div style={{
            marginTop: 12,
            position: 'relative',
            borderRadius: 8,
            overflow: 'hidden',
            border: '2px solid var(--accent-cyan)',
            maxHeight: 240,
          }}>
            <video
              ref={videoRef}
              style={{ width: '100%', display: 'block' }}
              playsInline
              muted
            />
            {/* 掃描線動畫 */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              pointerEvents: 'none',
              background: 'linear-gradient(transparent 40%, rgba(0,200,255,0.15) 50%, transparent 60%)',
              animation: 'barcode-scanline 2s ease-in-out infinite',
            }} />
          </div>
        )}
      </div>

      <style>{`
        .barcode-flash-green { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.5) !important; }
        .barcode-flash-red { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.5) !important; }
        @keyframes barcode-scanline {
          0%, 100% { transform: translateY(-100%); }
          50% { transform: translateY(100%); }
        }
      `}</style>
    </div>
  )
}
