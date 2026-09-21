import { supabase } from '../supabase'

export const getAccounts = (orgId) => {
  let q = supabase.from('accounts').select('*').order('code')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

// 幣別單一來源（currencies 表）— 之後加幣別只要在表 INSERT 一列
export const getCurrencies = () =>
  supabase.from('currencies').select('code, name, symbol, decimals').eq('is_active', true).order('sort_order')

export const getAccountsReceivable = (orgId) => {
  let q = supabase.from('accounts_receivable').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getAccountsPayable = (orgId) => {
  let q = supabase.from('accounts_payable').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getCommissionRules = () =>
  supabase.from('commission_rules').select('*').order('id')

export const createCommissionRule = (data) =>
  supabase.from('commission_rules').insert(data).select().single()

export const updateCommissionRule = (id, data) =>
  supabase.from('commission_rules').update(data).eq('id', id).select().single()

export const deleteCommissionRule = (id) =>
  supabase.from('commission_rules').delete().eq('id', id)

export const getCommissionRecords = (period) => {
  const q = supabase.from('commission_records').select('*').order('id', { ascending: false })
  return period ? q.eq('period', period) : q
}

export const createCommissionRecord = (data) =>
  supabase.from('commission_records').insert(data).select().single()
