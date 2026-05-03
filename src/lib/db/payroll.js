import { supabase } from '../supabase'
import { dedup } from './utils'

export const getPayrollRuns = () =>
  dedup('payrollRuns', () =>
    supabase.from('payroll_runs').select('*').order('pay_period', { ascending: false })
  )

export const getPayrollRecords = (runId) =>
  supabase.from('payroll_records').select('*').eq('payroll_run_id', runId).order('id')

export const updatePayrollRun = (id, data) =>
  supabase.from('payroll_runs').update(data).eq('id', id).select().single()

export const getLeaveStepSettings = () =>
  dedup('leaveStepSettings', () =>
    supabase.from('leave_step_settings').select('*')
  )

export const getSalaryRecords = (month, orgId) => {
  let q = supabase.from('salary_records').select('*').order('id')
  if (month) q = q.eq('month', month)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const upsertSalaryRecord = (data) =>
  supabase.rpc('secure_upsert_salary', {
    p_employee: data.employee,
    p_month: data.month,
    p_base_salary: data.base_salary,
    p_allowance: data.allowance ?? 0,
    p_overtime: data.overtime ?? 0,
    p_deductions: data.deductions ?? 0,
    p_insurance: data.insurance ?? 0,
    p_net_salary: data.net_salary ?? null,
  })

export const updateSalaryRecord = (id, data) =>
  supabase.rpc('secure_update_salary', { p_id: id, p_data: data })

export const getInsuranceSettings = () =>
  supabase.from('insurance_settings').select('*').order('id')

export const getTaxWithholdingRecords = (year) => {
  const q = supabase.from('tax_withholding_records').select('*').order('employee')
  return year ? q.eq('year', year) : q
}

export const upsertTaxWithholding = (data) =>
  supabase.from('tax_withholding_records').upsert(data, { onConflict: 'employee,year' }).select().single()

export const getBonusRecords = (period) => {
  let q = supabase.from('bonus_records').select('*').order('id', { ascending: false })
  return period ? q.eq('period', period) : q
}

export const createBonusRecord = (data) =>
  supabase.from('bonus_records').insert(data).select().single()

export const updateBonusRecord = (id, data) =>
  supabase.from('bonus_records').update(data).eq('id', id).select().single()

export const getBonusSettings = (storeId) => {
  let q = supabase.from('bonus_settings').select('*').eq('is_active', true).order('id')
  return storeId ? q.eq('store_id', storeId) : q
}

export const createBonusSetting = (data) =>
  supabase.from('bonus_settings').insert(data).select().single()

export const updateBonusSetting = (id, data) =>
  supabase.from('bonus_settings').update(data).eq('id', id).select().single()

export const deleteBonusSetting = (id) =>
  supabase.from('bonus_settings').delete().eq('id', id)
