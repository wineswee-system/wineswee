// i18next 設定 — 自然鍵（中文字串直接當 key）
// zh 模式：無 zh resource → t() 回傳 key 本身(中文)。
// en 模式：查 en 對照；查不到 → 回傳 key(中文) → 未翻譯的先維持中文（逐步翻）。
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'

const stored = (() => {
  try { return localStorage.getItem('app_lang') === 'en' ? 'en' : 'zh' } catch { return 'zh' }
})()

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: stored,
  fallbackLng: false,      // 查不到不 fallback → 回 key(中文)
  keySeparator: false,     // 中文字串不當巢狀 key
  nsSeparator: false,      // 中文含「:」不當 namespace
  returnEmptyString: false,
  interpolation: { escapeValue: false },
})

export default i18n
