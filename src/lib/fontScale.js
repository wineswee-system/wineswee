// 全站字體大小調整：透過 #root 的 CSS zoom 整體縮放（瀏覽器原生支援）
// zoom 放在 #root 而非 body，讓 portal overlay（append 到 body）不受 zoom 影響
// localStorage 存使用者偏好，登入後 / 重新整理後自動還原。
// 未設定偏好時自動依視窗寬度計算，基準：1920px = 1.20。

const KEY = 'app.fontScale'
const MIN = 0.80       // 手動調整最小值
const MAX = 1.50
const STEP = 0.10
const DEFAULT = 1.20   // 設計基準（1920px 下的預設值）
const BASE_WIDTH = 1920
const AUTO_MIN = 0.70  // 自動縮放允許更低，讓小螢幕不跑版

// 依目前視窗寬度自動計算最佳縮放值
function calcAutoScale() {
  if (typeof window === 'undefined') return DEFAULT
  const raw = (window.innerWidth / BASE_WIDTH) * DEFAULT
  return Math.max(AUTO_MIN, Math.min(MAX, raw))
}

export function getFontScale() {
  const v = localStorage.getItem(KEY)
  if (v) {
    const n = parseFloat(v)
    return isFinite(n) ? Math.max(MIN, Math.min(MAX, n)) : calcAutoScale()
  }
  // 無使用者偏好 → 依視窗自動計算
  return calcAutoScale()
}

// 清除使用者偏好，回到自動縮放
export function resetFontScale() {
  localStorage.removeItem(KEY)
  const s = calcAutoScale()
  applyFontScale(s)
  return s
}

export function setFontScale(scale) {
  const n = Math.max(MIN, Math.min(MAX, Number(scale) || DEFAULT))
  localStorage.setItem(KEY, String(n))
  applyFontScale(n)
  return n
}

export function applyFontScale(scale) {
  if (typeof document === 'undefined') return
  // 只改 CSS 變數；index.css 把它套到 .main-content 上，sidebar/topbar 不受影響。
  // 也清掉舊版本可能殘留在 body 的 zoom。
  document.documentElement.style.setProperty('--app-font-scale', String(scale || DEFAULT))
  if (document.body.style.zoom) document.body.style.zoom = ''
}

export const FONT_SCALE_LIMITS = { MIN, MAX, STEP, DEFAULT }
