import { supabase } from './supabase'

// ── USB/Bluetooth 條碼掃描器監聽 ─────────────────────────────
// 這類掃描器模擬鍵盤輸入，快速輸入字元後按 Enter
export function createBarcodeListener(onScan, options = {}) {
  const { minLength = 3, maxDelay = 50 } = options // 兩次按鍵間最大延遲 50ms
  let buffer = ''
  let lastKeyTime = 0

  function handleKeyDown(e) {
    const now = Date.now()
    // 如果間隔太長，代表是手動打字，清空緩衝
    if (now - lastKeyTime > maxDelay && buffer.length > 0) {
      buffer = ''
    }
    lastKeyTime = now

    if (e.key === 'Enter') {
      if (buffer.length >= minLength) {
        e.preventDefault()
        onScan(buffer.trim())
      }
      buffer = ''
      return
    }

    // 只接受可列印字元
    if (e.key.length === 1) {
      buffer += e.key
    }
  }

  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}

// ── 相機條碼掃描 (BarcodeDetector API) ───────────────────────
// Chrome/Edge 原生支援，不支援則回退至手動輸入
export async function initCameraScanner(videoElement, onScan) {
  if (!('BarcodeDetector' in window)) {
    return { supported: false, stop: () => {} }
  }

  const detector = new BarcodeDetector({
    formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code']
  })
  let stream = null
  let animationId = null
  let lastScanned = ''

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    })
    videoElement.srcObject = stream
    await videoElement.play()

    const scan = async () => {
      try {
        const barcodes = await detector.detect(videoElement)
        if (barcodes.length > 0 && barcodes[0].rawValue !== lastScanned) {
          lastScanned = barcodes[0].rawValue
          onScan(barcodes[0].rawValue)
          // 2 秒後允許重複掃描同一條碼
          setTimeout(() => { lastScanned = '' }, 2000)
        }
      } catch (e) { /* 忽略偵測錯誤 */ }
      animationId = requestAnimationFrame(scan)
    }
    scan()

    return {
      supported: true,
      stop: () => {
        if (animationId) cancelAnimationFrame(animationId)
        if (stream) stream.getTracks().forEach(t => t.stop())
      }
    }
  } catch (err) {
    return { supported: false, error: err.message, stop: () => {} }
  }
}

// ── 條碼查詢 SKU ─────────────────────────────────────────────
export async function lookupBarcode(code) {
  // 精確比對 SKU code
  const { data } = await supabase.from('skus').select('*').eq('code', code).single()
  if (data) return { type: 'sku', data }

  // 嘗試批號比對
  const { data: lot } = await supabase.from('inventory_lots').select('*, skus(*)').eq('lot_number', code).single()
  if (lot) return { type: 'lot', data: lot }

  return null
}

// ── 掃描提示音 (Web Audio API) ───────────────────────────────
let audioCtx = null
export function playBeep(success = true) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const oscillator = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    oscillator.connect(gain)
    gain.connect(audioCtx.destination)
    oscillator.type = 'sine'
    oscillator.frequency.value = success ? 880 : 220 // 成功=高音，失敗=低音
    gain.gain.value = 0.15
    oscillator.start()
    oscillator.stop(audioCtx.currentTime + (success ? 0.12 : 0.3))
  } catch (e) { /* 靜音失敗不影響功能 */ }
}
