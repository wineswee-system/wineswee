import { describe, it, expect } from 'vitest'
import { DEFAULT_LOCALE, AVAILABLE_LOCALES, translations, createI18n } from '../i18n.js'

describe('i18n constants', () => {
  it('default locale is zh-TW', () => {
    expect(DEFAULT_LOCALE).toBe('zh-TW')
  })

  it('supports zh-TW and en', () => {
    expect(AVAILABLE_LOCALES).toContain('zh-TW')
    expect(AVAILABLE_LOCALES).toContain('en')
  })

  it('both locales have translations', () => {
    expect(Object.keys(translations['zh-TW']).length).toBeGreaterThan(50)
    expect(Object.keys(translations['en']).length).toBeGreaterThan(50)
  })

  it('zh-TW and en have matching keys', () => {
    const zhKeys = Object.keys(translations['zh-TW'])
    const enKeys = Object.keys(translations['en'])
    // en should cover most zh-TW keys
    const missing = zhKeys.filter(k => !enKeys.includes(k))
    expect(missing.length).toBeLessThan(zhKeys.length * 0.1) // < 10% missing is ok
  })
})

describe('createI18n', () => {
  it('creates i18n instance with default locale', () => {
    const i18n = createI18n()
    expect(i18n.locale).toBe('zh-TW')
  })

  it('translates zh-TW keys', () => {
    const i18n = createI18n('zh-TW')
    expect(i18n.t('common.save')).toBe('儲存')
    expect(i18n.t('common.cancel')).toBe('取消')
    expect(i18n.t('nav.dashboard')).toBe('儀表板')
  })

  it('translates en keys', () => {
    const i18n = createI18n('en')
    expect(i18n.t('common.save')).toBe('Save')
    expect(i18n.t('common.cancel')).toBe('Cancel')
  })

  it('falls back to zh-TW for missing en keys', () => {
    const i18n = createI18n('en')
    // If a key exists in zh-TW but not en, should fallback
    const zhOnly = Object.keys(translations['zh-TW']).find(k => !translations['en']?.[k])
    if (zhOnly) {
      expect(i18n.t(zhOnly)).toBe(translations['zh-TW'][zhOnly])
    }
  })

  it('returns key itself if no translation found', () => {
    const i18n = createI18n()
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('switches locale', () => {
    const i18n = createI18n('zh-TW')
    expect(i18n.locale).toBe('zh-TW')
    i18n.setLocale('en')
    expect(i18n.locale).toBe('en')
    expect(i18n.t('common.save')).toBe('Save')
  })

  it('rejects invalid locale', () => {
    const i18n = createI18n('invalid')
    expect(i18n.locale).toBe('zh-TW') // Falls back to default

    i18n.setLocale('invalid')
    expect(i18n.locale).toBe('zh-TW') // Stays unchanged
  })

  it('exposes available locales', () => {
    const i18n = createI18n()
    expect(i18n.availableLocales).toEqual(AVAILABLE_LOCALES)
  })
})
