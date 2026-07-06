/**
 * 電子發票 XML 共用工具
 * 轉義、MIG 日期/時間格式化、欄位序列化（順序固定）
 */

/**
 * XML 特殊字元轉義
 * @param {*} str
 * @returns {string}
 */
export function escapeXml(str) {
  if (str === null || str === undefined || str === '') return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 格式化日期為 MIG 格式 YYYYMMDD
 * @param {string|Date} [d] - ISO 字串 / Date；空值取今日
 */
export function formatMIGDate(d) {
  if (!d) {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  }
  // YYYY-MM-DD 純日期字串直接轉換，避免 new Date() 時區位移
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    return d.trim().replace(/-/g, '')
  }
  const date = new Date(d)
  if (isNaN(date.getTime())) {
    return String(d).replace(/-/g, '').slice(0, 8)
  }
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 格式化時間為 HH:MM:SS
 * @param {string|Date} [d]
 */
export function formatMIGTime(d) {
  // 已是 HH:MM:SS 直接回傳（builder 可傳明確時間確保可測性）
  if (typeof d === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(d.trim())) return d.trim()
  const date = new Date(d)
  if (isNaN(date.getTime())) return new Date().toTimeString().slice(0, 8)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

/**
 * 依 [tag, value] 陣列序列化 XML 欄位 — 欄位順序即陣列順序（deterministic）
 * value 為 null/undefined 時整個節點省略；空字串會輸出空節點
 * @param {Array<[string, *]>} pairs
 * @param {string} indent
 * @returns {string}
 */
export function renderFields(pairs, indent = '    ') {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([tag, v]) => `${indent}<${tag}>${escapeXml(v)}</${tag}>`)
    .join('\n')
}
