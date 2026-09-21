import { supabase } from '../supabase'
import { logger } from '../logger'
import { calculateDepreciation } from './depreciation'

// ─── F-A5 固定資產：耐用年數表 + 月折舊提列 + 處分 ─────────────────
//
// - previewMonthlyDepreciation()：純前端試算（與 SQL fa_accumulated_depreciation /
//   secure_run_monthly_depreciation 同式），供 UI 預覽與單元測試
// - runMonthlyDepreciation()：呼叫 secure_run_monthly_depreciation RPC
//   （冪等：UNIQUE(org, period)，重跑回傳既有 run + already_exists=true）
// - disposeAsset()：呼叫 secure_dispose_fixed_asset RPC（出售/報廢 + 處分損益傳票）
// - 折舊公式一律取自 ./depreciation.js（calculateDepreciation），不另寫一套

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** 'YYYY-MM-DD' → {y, m, d}（手動解析，避免 new Date('YYYY-MM-DD') 的 UTC 時區偏移） */
function parseDateParts(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

/** 取得月 → 提列月的月差（提列期 'YYYY-MM'；取得當月 = 0，未取得 = 負值） */
export function monthDiffFromAcquisition(period, acquiredDate) {
  const [py, pm] = String(period).split('-').map(Number)
  const { y: ay, m: am } = parseDateParts(acquiredDate)
  return (py - ay) * 12 + (pm - am)
}

/**
 * A(d)：經過 d 個月的累計折舊 — 直接以 calculateDepreciation 求值
 * （current_date 取「取得月 + d 個月」的月中，僅月差有意義、日不影響）。
 */
function accumulatedAt(asset, months) {
  const { y: ay, m: am } = parseDateParts(asset.acquired_date)
  const total = (am - 1) + months
  const cy = ay + Math.floor(total / 12)
  const cm = (total % 12) + 1
  const currentDate = `${cy}-${String(cm).padStart(2, '0')}-15T00:00:00`
  const { accumulated_depreciation } = calculateDepreciation({
    cost: Number(asset.cost),
    salvage_value: Number(asset.salvage_value) || 0,
    useful_life_years: Number(asset.useful_life_years ?? asset.useful_life),
    method: asset.method || 'straight_line',
    acquired_date: `${String(asset.acquired_date).slice(0, 10)}T00:00:00`,
    current_date: currentDate,
  })
  return accumulated_depreciation
}

/**
 * 計算單一資產在指定期別（'YYYY-MM'）的當月折舊金額。
 * 與 SQL secure_run_monthly_depreciation 同式：
 *   單月金額 = A(d+1) − A(d)（含耐用年限封頂 → 超限期為 0）
 *   取得當月（d=0）按剩餘日數比例（期中取得按比例提列）
 * @param {{cost: number, salvage_value?: number, useful_life?: number, useful_life_years?: number, method?: string, acquired_date: string, category?: string}} asset
 * @param {string} period — 'YYYY-MM'
 * @returns {number} 當月折舊（土地 / 未取得 / 超限 → 0）
 */
export function computeMonthlyDepreciationForPeriod(asset, period) {
  if (!asset || asset.category === '土地') return 0
  const life = Number(asset.useful_life_years ?? asset.useful_life)
  if (!(Number(asset.cost) > 0) || !(life > 0)) return 0

  const d = monthDiffFromAcquisition(period, asset.acquired_date)
  if (d < 0) return 0

  let amount = round2(accumulatedAt(asset, d + 1) - accumulatedAt(asset, d))

  if (d === 0) {
    // 取得當月：按（當月剩餘日數 / 當月總日數）比例
    const [py, pm] = String(period).split('-').map(Number)
    const daysInMonth = new Date(py, pm, 0).getDate()
    const { d: acqDay } = parseDateParts(asset.acquired_date)
    amount = round2(amount * (daysInMonth - acqDay + 1) / daysInMonth)
  }

  return amount > 0 ? amount : 0
}

/**
 * 試算指定期別全部資產的折舊提列（純前端，鏡射 RPC 邏輯供 UI 預覽 + 測試）。
 * 只納入：使用中、非土地、cost/耐用年數 > 0、當月金額 > 0。
 * @param {Array<object>} assets — fixed_assets 列
 * @param {string} period — 'YYYY-MM'
 * @returns {{period: string, lines: Array<{asset_id: number|string, asset_code: string|null, asset_name: string, method: string, amount: number}>, total: number}}
 */
export function previewMonthlyDepreciation(assets, period) {
  const lines = []
  let total = 0
  for (const asset of assets || []) {
    if ((asset.status || '使用中') !== '使用中') continue
    const amount = computeMonthlyDepreciationForPeriod(asset, period)
    if (amount <= 0) continue
    lines.push({
      asset_id: asset.id,
      asset_code: asset.asset_code || null,
      asset_name: asset.name,
      method: asset.method || 'straight_line',
      amount,
    })
    total = round2(total + amount)
  }
  return { period, lines, total }
}

/**
 * 依耐用年數表（asset_useful_life_table 列）查法定年限。
 * @param {Array<{category: string, item_name: string, useful_life_years: number}>} table
 * @param {string} category
 * @param {string} itemName
 * @returns {object|null} 對應列（含 useful_life_years / source_ref）；查無 → null
 */
export function findUsefulLife(table, category, itemName) {
  return (table || []).find(r => r.category === category && r.item_name === itemName) || null
}

/**
 * 處分損益試算（純前端，與 secure_dispose_fixed_asset 同口徑：
 * 累計折舊提至處分月前一月底、處分當月不再提列）。
 * @param {object} asset — fixed_assets 列
 * @param {{proceeds?: number, disposalDate: string}} opts
 * @returns {{accumulatedDepreciation: number, bookValue: number, gainLoss: number}} gainLoss 正=利益、負=損失
 */
export function computeDisposal(asset, { proceeds = 0, disposalDate }) {
  const cost = round2(asset.cost)
  let accumulated = 0
  if (asset.category !== '土地') {
    const d = monthDiffFromAcquisition(String(disposalDate).slice(0, 7), asset.acquired_date)
    accumulated = accumulatedAt(asset, Math.max(d, 0))
  }
  const bookValue = round2(cost - accumulated)
  const gainLoss = round2((Number(proceeds) || 0) - bookValue)
  return { accumulatedDepreciation: accumulated, bookValue, gainLoss }
}

/**
 * 執行月折舊提列（secure_run_monthly_depreciation RPC）。
 * 冪等：同組織同期重跑回傳既有 run（already_exists=true），不重複入帳。
 * @param {string} period — 'YYYY-MM'
 * @returns {Promise<{run: object|null, lines: Array, journal_entry_id: number|null, total_amount: number, already_exists: boolean, skipped: boolean}>}
 * @throws {Error} RPC 錯誤（期別格式 / 未登入 / 拋轉失敗）
 */
export async function runMonthlyDepreciation(period) {
  const { data, error } = await supabase.rpc('secure_run_monthly_depreciation', {
    p_period: period,
  })

  if (error) {
    logger.error('[fixedAssetOps] 月折舊提列失敗', { period, error: error.message })
    throw new Error(`月折舊提列失敗（${period}）：${error.message}`)
  }
  return data
}

/**
 * 處分固定資產（secure_dispose_fixed_asset RPC）：
 * 沖銷成本與累計折舊、認列處分損益，自動拋轉 'asset_disposal' 傳票。
 * @param {number|string} assetId
 * @param {'出售'|'報廢'} disposalType
 * @param {number} [proceeds=0] — 處分價款（報廢通常為 0）
 * @param {string} [disposalDate] — 'YYYY-MM-DD'，預設今天
 * @returns {Promise<{asset: object, accumulated_depreciation: number, book_value: number, gain_loss: number, journal_entry_id: number|null}>}
 * @throws {Error} RPC 錯誤（資產不存在 / 已處分 / 價款為負）
 */
export async function disposeAsset(assetId, disposalType, proceeds = 0, disposalDate) {
  const { data, error } = await supabase.rpc('secure_dispose_fixed_asset', {
    p_asset_id: assetId,
    p_disposal_type: disposalType,
    p_proceeds: proceeds,
    p_disposal_date: disposalDate || new Date().toISOString().slice(0, 10),
  })

  if (error) {
    logger.error('[fixedAssetOps] 固定資產處分失敗', {
      assetId: String(assetId), disposalType, error: error.message,
    })
    throw new Error(`固定資產處分失敗：${error.message}`)
  }
  return data
}
