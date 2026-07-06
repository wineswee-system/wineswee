/**
 * 電子發票模組（E-Invoice）— MIG 4.1
 *
 * 結構：
 *   constants.js  — 稅別/載具/訊息別常數、MIG_VERSION、TURNKEY_CONFIG
 *   validation.js — 統編（112.4 新制檢查碼）、發票號碼、載具驗證
 *   tax.js        — 稅額計算
 *   mig41.js      — MIG 4.1 XML builders（F0401/F0501/F0701/D0401/D0501）
 *   legacy.js     — MIG 3.2 builders（@deprecated，相容保留）
 *   xmlUtils.js   — XML 轉義 / 日期時間格式化
 */
export * from './constants.js'
export * from './validation.js'
export * from './tax.js'
export * from './mig41.js'
export * from './legacy.js'
export * from './xmlUtils.js'
