// 全站字體大小調整：透過 body.style.zoom 整體縮放（瀏覽器原生支援）
// localStorage 存使用者偏好，登入後 / 重新整理後自動還原。

const KEY = 'app.fontScale'
const MIN = 0.80
const MAX = 1.50
const STEP = 0.10
const DEFAULT = 1.20  // 預設往上 2 格，方便閱讀

export function getFontScale() {
  const v = localStorage.getItem(KEY)
  const n = v ? parseFloat(v) : DEFAULT
  return isFinite(n) ? Math.max(MIN, Math.min(MAX, n)) : DEFAULT
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
