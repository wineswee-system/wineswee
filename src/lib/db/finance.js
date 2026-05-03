import { supabase } from '../supabase'

export const getAccounts = () =>
  supabase.from('accounts').select('*').order('code')

export const createAccount = (data) =>
  supabase.from('accounts').insert(data).select().single()

export const updateAccount = (id, data) =>
  supabase.from('accounts').update(data).eq('id', id).select().single()

export const deleteAccount = (id) =>
  supabase.from('accounts').delete().eq('id', id)

export const getJournalEntries = (orgId) => {
  let q = supabase.from('journal_entries').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getJournalLines = (entryId) =>
  supabase.from('journal_lines').select('*').eq('entry_id', entryId).order('id')

export const getAllJournalLines = () =>
  supabase.from('journal_lines').select('*').order('id')

export const createJournalEntry = (data, lines = null) =>
  supabase.rpc('secure_create_journal_entry', {
    p_entry_date: data.entry_date,
    p_description: data.description,
    p_lines: lines ?? [],
    p_source: data.source ?? null,
    p_source_id: data.source_id ?? null,
    p_created_by: data.created_by ?? null,
  })

export const createJournalLine = (data) =>
  supabase.rpc('secure_create_journal_line', {
    p_entry_id: data.entry_id,
    p_account_code: data.account_code,
    p_account_name: data.account_name,
    p_debit: data.debit ?? 0,
    p_credit: data.credit ?? 0,
    p_memo: data.memo ?? null,
    p_cost_center: data.cost_center ?? null,
  })

export const updateJournalEntry = (id, data) =>
  supabase.rpc('secure_update_journal_entry', { p_id: id, p_data: data })

export const batchCreateJournalLines = (lines) =>
  supabase.rpc('secure_batch_create_journal_lines', { p_lines: lines })

export const getAccountsReceivable = (orgId) => {
  let q = supabase.from('accounts_receivable').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createAccountReceivable = (data) =>
  supabase.from('accounts_receivable').insert(data).select().single()

export const getAccountsPayable = (orgId) => {
  let q = supabase.from('accounts_payable').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createAccountPayable = (data) =>
  supabase.from('accounts_payable').insert(data).select().single()

export const getBudgets = (orgId) => {
  let q = supabase.from('budgets').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createBudget = (data) =>
  supabase.from('budgets').insert(data).select().single()

export const updateBudget = (id, data) =>
  supabase.from('budgets').update(data).eq('id', id).select().single()

export const getBankTransactions = () =>
  supabase.from('bank_transactions').select('*').order('transaction_date', { ascending: false })

export const updateBankTransaction = (id, data) =>
  supabase.from('bank_transactions').update(data).eq('id', id).select().single()

export const getInventoryTransactions = (sku) => {
  const q = supabase.from('inventory_transactions').select('*').order('date')
  return sku ? q.eq('sku', sku) : q
}

export const getStockLevels = () =>
  supabase.from('stock_levels').select('*').order('id')

export const getInventoryCostLayers = (skuId) => {
  const q = supabase.from('inventory_cost_layers').select('*, skus(code, name)').order('receipt_date', { ascending: true })
  return skuId ? q.eq('sku_id', skuId) : q
}

export const getActiveCostLayers = (skuId, warehouseId) => {
  let q = supabase.from('inventory_cost_layers').select('*').gt('quantity_remaining', 0).order('receipt_date', { ascending: true })
  if (skuId) q = q.eq('sku_id', skuId)
  if (warehouseId) q = q.eq('warehouse_id', warehouseId)
  return q
}

export const createInventoryCostLayer = (data) =>
  supabase.from('inventory_cost_layers').insert(data).select().single()

export const updateInventoryCostLayer = (id, data) =>
  supabase.from('inventory_cost_layers').update(data).eq('id', id).select().single()

export const getInventoryValuations = (costingMethod) => {
  const q = supabase.from('inventory_valuations').select('*, skus(code, name)').order('valuation_date', { ascending: false })
  return costingMethod ? q.eq('costing_method', costingMethod) : q
}

export const createInventoryValuation = (data) =>
  supabase.from('inventory_valuations').insert(data).select().single()

export const batchCreateInventoryValuations = (rows) =>
  supabase.from('inventory_valuations').insert(rows).select()

export const getFixedAssets = () =>
  supabase.from('fixed_assets').select('*').order('id')

export const createFixedAsset = (data) =>
  supabase.from('fixed_assets').insert(data).select().single()

export const updateFixedAsset = (id, data) =>
  supabase.from('fixed_assets').update(data).eq('id', id).select().single()

export const deleteFixedAsset = (id) =>
  supabase.from('fixed_assets').delete().eq('id', id)

export const getCostCenters = () =>
  supabase.from('cost_centers').select('*').order('code')

export const createCostCenter = (data) =>
  supabase.from('cost_centers').insert(data).select().single()

export const updateCostCenter = (id, data) =>
  supabase.from('cost_centers').update(data).eq('id', id).select().single()

export const deleteCostCenter = (id) =>
  supabase.from('cost_centers').delete().eq('id', id)

export const getAccountingPeriods = () =>
  supabase.from('accounting_periods').select('*').order('period')

export const createAccountingPeriod = (data) =>
  supabase.from('accounting_periods').insert(data).select().single()

export const updateAccountingPeriod = (id, data) =>
  supabase.from('accounting_periods').update(data).eq('id', id).select().single()

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

export const updateCommissionRecord = (id, data) =>
  supabase.from('commission_records').update(data).eq('id', id).select().single()
