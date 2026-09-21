/**
 * 簽核鏈設定檢查 — 給 HR 表單建單頁用
 *
 * 三種檢查模式：
 *   1. useChainGuard({ formType }) — leave/overtime/trip/correction：靜態查 form_chain_configs
 *   2. useChainGuard({ formType: 'form_submission', templateId }) — 看 template.approval_chain_id
 *   3. checkChainByAmount({ category, amount }) — expense/expense_request 送出時呼叫
 *
 * 用法：
 *   const guard = useChainGuard({ formType: 'leave', organizationId: profile?.organization_id })
 *   if (guard.blocked) → 顯示 banner + disable 送出
 *   <button disabled={!guard.ready || guard.blocked}>送出</button>
 *
 *   handleSubmit: const r = await checkChainByAmount({ category: '費用申請', amount })
 *                 if (!r.chainId) return toast.error(r.reason)
 */

import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const FORM_TYPE_LABEL = {
  leave: '請假', overtime: '加班', trip: '出差', correction: '補打卡', expense: '費用報銷',
}

/**
 * 靜態 chain guard — 查一次就好，不依賴金額
 *
 * @param {Object} opts
 * @param {string} opts.formType          'leave' | 'overtime' | 'trip' | 'correction' | 'form_submission'
 * @param {number} [opts.organizationId]  非 form_submission 時必填
 * @param {number} [opts.templateId]      form_submission 時必填
 * @param {number} [opts.employeeId]      申請人 employee_id（查組織圖判斷是否為部門/門市主管）
 * @param {boolean} [opts.enabled=true]   false → 跳過檢查（給條件性 mount 用）
 * @returns {{ ready: boolean, blocked: boolean, reason: string, chainId: number|null }}
 */
export function useChainGuard({ formType, organizationId, templateId, employeeId = null, enabled = true }) {
  const [state, setState] = useState({ ready: false, blocked: false, reason: '', chainId: null })

  useEffect(() => {
    if (!enabled) {
      setState({ ready: true, blocked: false, reason: '', chainId: null })
      return
    }
    let cancelled = false

    const check = async () => {
      // ── form_submission：看 template.approval_chain_id ──
      if (formType === 'form_submission') {
        if (!templateId) return
        const { data } = await supabase.from('form_templates')
          .select('id, name, approval_chain_id')
          .eq('id', templateId)
          .maybeSingle()
        if (cancelled) return
        if (!data?.approval_chain_id) {
          setState({
            ready: true, blocked: true, chainId: null,
            reason: `表單「${data?.name || '此表單'}」尚未設定簽核鏈，請聯絡管理員至「表單設定」設定`,
          })
        } else {
          setState({ ready: true, blocked: false, reason: '', chainId: data.approval_chain_id })
        }
        return
      }

      // ── HR 表（form_chain_configs by form_type + org） ──
      if (!organizationId) {
        setState({ ready: false, blocked: false, reason: '', chainId: null })
        return
      }

      // 查組織圖：此員工是否為部門/門市主管
      let isManager = false
      if (employeeId) {
        const { count } = await supabase.from('departments').select('id', { count: 'exact', head: true })
          .eq('manager_id', employeeId).eq('organization_id', organizationId)
        isManager = (count || 0) > 0
      }

      const specificType = isManager ? 'manager' : 'staff'
      const { data: rows } = await supabase.from('form_chain_configs')
        .select('chain_id, is_active, applicant_type')
        .eq('form_type', formType)
        .eq('organization_id', organizationId)
        .eq('is_active', true)

      if (cancelled) return

      const byType = (rows || []).reduce((acc, r) => { acc[r.applicant_type] = r; return acc }, {})
      const best = byType[specificType] || byType['all']

      if (!best?.chain_id) {
        setState({
          ready: true, blocked: true, chainId: null,
          reason: `${FORM_TYPE_LABEL[formType] || formType}簽核鏈尚未設定，請聯絡管理員至「簽核設定」設定`,
        })
      } else {
        setState({ ready: true, blocked: false, reason: '', chainId: best.chain_id })
      }
    }
    check()
    return () => { cancelled = true }
  }, [formType, organizationId, templateId, employeeId, enabled])

  return state
}


/**
 * 依金額查 chain — 給費用申請 / 費用報銷送出時呼叫
 *
 * @param {Object} opts
 * @param {string} opts.category   '費用申請' | '費用報銷'
 * @param {number} opts.amount
 * @param {boolean} [opts.fallbackFormConfig=false]  找不到金額 chain 時是否 fallback form_chain_configs
 * @param {string} [opts.fallbackFormType]            fallback 用的 form_type（如 'expense'）
 * @param {number} [opts.fallbackOrgId]               fallback 用的 organization_id
 * @returns {Promise<{ chainId: number|null, reason: string }>}
 */
export async function checkChainByAmount({
  category, amount,
  fallbackFormConfig = false, fallbackFormType, fallbackOrgId,
}) {
  const v = Number(amount) || 0

  // 先查金額區間
  const { data: chains } = await supabase.from('approval_chains')
    .select('id, min_amount, max_amount')
    .eq('category', category)
    .eq('is_active', true)
  // 用 JS filter 避免 or() 語法歧義
  const matched = (chains || [])
    .filter(c => (c.min_amount == null || c.min_amount <= v))
    .filter(c => (c.max_amount == null || c.max_amount >= v))
    .sort((a, b) => (b.min_amount || 0) - (a.min_amount || 0))[0]

  if (matched?.id) return { chainId: matched.id, reason: '' }

  // fallback form_chain_configs
  if (fallbackFormConfig && fallbackFormType && fallbackOrgId) {
    const { data: cfg } = await supabase.from('form_chain_configs')
      .select('chain_id, is_active')
      .eq('form_type', fallbackFormType)
      .eq('organization_id', fallbackOrgId)
      .maybeSingle()
    if (cfg?.chain_id && cfg?.is_active) return { chainId: cfg.chain_id, reason: '' }
  }

  return {
    chainId: null,
    reason: `金額 NT$ ${v.toLocaleString()} 找不到對應的「${category}」簽核鏈，請聯絡管理員至「簽核鏈管理」新增此金額區間的 chain`,
  }
}
