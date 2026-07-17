import { createContext, useContext, useState } from 'react'
import i18n from '../lib/i18n/i18n'

const LanguageContext = createContext({ lang: 'zh', setLang: () => {} })
export const useLanguage = () => useContext(LanguageContext)

const KEY = 'app_lang'

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => i18n.language === 'en' ? 'en' : 'zh')

  const setLang = (l) => {
    if (l === lang) return
    try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
    i18n.changeLanguage(l)
    document.documentElement.setAttribute('lang', l === 'en' ? 'en' : 'zh-Hant')
    setLangState(l)
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}
