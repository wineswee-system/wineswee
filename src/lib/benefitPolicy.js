/**
 * 福利政策解析引擎
 *
 * 解析優先序：員工級 > 門市級 > 全公司
 * 設計原則：假別只能加給（additive only），不可低於法定最低標準
 */

import { supabase } from './supabase'
import { LEAVE_TYPES, getLeaveTypeInfo } from './leavePolicy'

// ══════════════════════════════════════
//  解析有效福利政策
// ══════════════════════════════════════

/**
 * 取得某員工在某門市的有效福利政策
 * @param {number|null} employeeId
 * @param {number|null} storeId
 * @param {'leave'|'bonus'} category
 * @returns {Promise<Record<string, object>>} code → config 的 map
 */
export async function getEffectiveBenefits(employeeId, storeId, category) {
  let q = supabase
    .from('benefit_policies')
    .select('*')
    .eq('category', category)
    .eq('is_active', true)
    .or('effective_to.is.null,effective_to.gte.' + new Date().toISOString().slice(0, 10))
    .lte('effective_from', new Date().toISOString().slice(0, 10))

  // 取出所有可能適用的政策（全公司 + 門市 + 個人）
  const filters = ['store_id.is.null,employee_id.is.null'] // global
  if (storeId) filters.push(`store_id.eq.${storeId},employee_id.is.null`) // store-level
  if (employeeId && storeId) filters.push(`employee_id.eq.${employeeId},store_id.eq.${storeId}`) // employee+store
  if (employeeId) filters.push(`employee_id.eq.${employeeId},store_id.is.null`) // employee global

  // 由於 Supabase or filter 限制，分批查詢合併
  const allPolicies = []

  // Global policies
  const { data: globalP } = await supabase
    .from('benefit_policies')
    .select('*')
    .eq('category', category)
    .eq('is_active', true)
    .is('store_id', null)
    .is('employee_id', null)
  if (globalP) allPolicies.push(...globalP)

  // Store-level policies
  if (storeId) {
    const { data: storeP } = await supabase
      .from('benefit_policies')
      .select('*')
      .eq('category', category)
      .eq('is_active', true)
      .eq('store_id', storeId)
      .is('employee_id', null)
    if (storeP) allPolicies.push(...storeP)
  }

  // Employee-level policies
  if (employeeId) {
    const { data: empP } = await supabase
      .from('benefit_policies')
      .select('*')
      .eq('category', category)
      .eq('is_active', true)
      .eq('employee_id', employeeId)
    if (empP) allPolicies.push(...empP)
  }

  // 過濾生效日期
  const now = new Date().toISOString().slice(0, 10)
  const active = allPolicies.filter(p =>
    p.effective_from <= now && (!p.effective_to || p.effective_to >= now)
  )

  // 按 code 分組，最具體的優先（employee+store > employee > store > global）
  const result = {}
  for (const p of active) {
    const specificity = (p.employee_id ? 2 : 0) + (p.store_id ? 1 : 0)
    const existing = result[p.code]
    if (!existing || specificity > existing._specificity) {
      result[p.code] = { ...p.config, _policyId: p.id, _specificity: specificity, _notes: p.notes }
    }
  }

  // 清除內部欄位
  for (const code of Object.keys(result)) {
    delete result[code]._specificity
  }

  return result
}

// ══════════════════════════════════════
//  假別解析：法定 + 加給
// ══════════════════════════════════════

/**
 * 解析假別實際天數（法定 + 門市/員工加給）
 * @param {string} leaveCode - 假別代碼 (annual, sick, etc.)
 * @param {number} yearsWorked - 年資
 * @param {object|null} customPolicy - 來自 getEffectiveBenefits 的 config
 * @returns {{ legalDays: number, extraDays: number, totalDays: number }}
 */
export function resolveLeaveEntitlement(leaveCode, yearsWorked, customPolicy) {
  const leaveType = LEAVE_TYPES.find(t => t.code === leaveCode)
  if (!leaveType) return { legalDays: 0, extraDays: 0, totalDays: 0 }

  // 法定天數
  let legalDays = 0
  if (leaveType.calcEntitlement) {
    legalDays = leaveType.calcEntitlement(yearsWorked)
  } else if (leaveType.maxDays) {
    legalDays = leaveType.maxDays
  }

  // 門市/員工加給
  const extraDays = Math.max(0, customPolicy?.extra_days || 0)

  return {
    legalDays,
    extraDays,
    totalDays: legalDays + extraDays,
  }
}

// ══════════════════════════════════════
//  獎金解析
// ══════════════════════════════════════

/**
 * 計算獎金金額
 * @param {object} bonusConfig - 來自 getEffectiveBenefits 的 config
 * @param {object} context - 計算上下文 { sales, attendance_rate, ... }
 * @returns {number} 獎金金額
 */
export function calculateBonus(bonusConfig, context = {}) {
  if (!bonusConfig?.type) return 0

  switch (bonusConfig.type) {
    case 'fixed':
      return bonusConfig.amount || 0

    case 'percent': {
      const base = context[bonusConfig.base] || 0
      const raw = Math.round(base * (bonusConfig.rate || 0))
      return bonusConfig.cap ? Math.min(raw, bonusConfig.cap) : raw
    }

    case 'milestone': {
      const tiers = bonusConfig.tiers || []
      const value = context[bonusConfig.base] || context.value || 0
      let reward = 0
      for (const tier of tiers.sort((a, b) => b.target - a.target)) {
        if (value >= tier.target) {
          reward = tier.reward
          break
        }
      }
      return reward
    }

    default:
      return 0
  }
}

// ══════════════════════════════════════
//  驗證政策
// ══════════════════════════════════════

/**
 * 驗證福利政策設定是否合法
 * @param {'leave'|'bonus'} category
 * @param {string} code
 * @param {object} config
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateBenefitPolicy(category, code, config) {
  if (!category || !code) {
    return { valid: false, error: '類別和代碼不可為空' }
  }

  if (category === 'leave') {
    if (config.extra_days !== undefined && config.extra_days < 0) {
      return { valid: false, error: '加給天數不可為負（只能加給，不可低於法定標準）' }
    }
    if (config.extra_hours !== undefined && config.extra_hours < 0) {
      return { valid: false, error: '加給時數不可為負' }
    }
    // 確認假別代碼存在
    const leaveType = LEAVE_TYPES.find(t => t.code === code)
    if (!leaveType) {
      return { valid: false, error: `無效的假別代碼：${code}` }
    }
  }

  if (category === 'bonus') {
    if (!config.type) {
      return { valid: false, error: '獎金類型不可為空（fixed / percent / milestone）' }
    }
    if (config.type === 'fixed' && (config.amount === undefined || config.amount < 0)) {
      return { valid: false, error: '固定獎金金額不可為負' }
    }
    if (config.type === 'percent' && (config.rate === undefined || config.rate < 0)) {
      return { valid: false, error: '獎金比例不可為負' }
    }
  }

  return { valid: true }
}

// ══════════════════════════════════════
//  工具函數
// ══════════════════════════════════════

/** 取得門市 ID by 門市名稱 */
export async function getStoreIdByName(storeName) {
  if (!storeName) return null
  const { data } = await supabase.from('stores').select('id').eq('name', storeName).single()
  return data?.id || null
}

/** 獎金類型顯示名稱 */
export const BONUS_TYPE_LABELS = {
  fixed: '固定金額',
  percent: '業績比例',
  milestone: '階梯達標',
}

/** 假別代碼 → 顯示名稱 */
export function getLeaveLabel(code) {
  const t = LEAVE_TYPES.find(lt => lt.code === code)
  return t ? `${t.shortName || t.name}` : code
}
