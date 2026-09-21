import { createContext, useContext, useEffect, useState } from 'react'
import i18n from '../lib/i18n/i18n'
import { activate, deactivate } from '../lib/i18n/domTranslator'

const LanguageContext = createContext({ lang: 'zh', setLang: () => {} })
export const useLanguage = () => useContext(LanguageContext)

const KEY = 'app_lang'

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => i18n.language === 'en' ? 'en' : 'zh')

  // 初次載入若為英文 → 啟動 DOM fallback（i18next 已在 i18n.js init）
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-Hant')
    if (lang === 'en') activate()
    else deactivate()
  }, [lang])

  const setLang = (l) => {
    if (l === lang) return
    try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
    i18n.changeLanguage(l)
    if (l === 'zh') {
      // 中文=原始內容，DOM 已被改過 → reload 最乾淨還原
      window.location.reload()
    } else {
      setLangState('en')
    }
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}
