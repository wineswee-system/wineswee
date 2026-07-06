/**
 * 電子發票模組（E-Invoice）— re-export shim
 *
 * 實作已重構至 `src/lib/einvoice/`（MIG 4.1 升版，F-B1）。
 * 本檔僅保留 re-export，讓既有 `from '../lib/einvoice'` 匯入不需改動。
 * 新程式請直接 import `./einvoice/mig41.js` 等子模組。
 */
export * from './einvoice/index.js'
