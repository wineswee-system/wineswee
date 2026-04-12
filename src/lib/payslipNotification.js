/**
 * Payslip LINE Notification — sends monthly payslip summary to employees via LIFF / LINE Messaging API.
 *
 * Usage:
 *   import { sendPayslipNotification, sendBulkPayslipNotifications } from '../lib/payslipNotification'
 *   await sendPayslipNotification(employee, payslipData)
 *   await sendBulkPayslipNotifications(month)  // sends to all employees for that month
 */
import { supabase } from './supabase'

const LIFF_ID = import.meta.env.VITE_LIFF_ID

/**
 * Build a LINE Flex Message for a payslip.
 */
function buildPayslipFlexMessage(employee, payslip) {
  const month = payslip.month || ''
  const net = (payslip.net_salary || 0).toLocaleString()
  const base = (payslip.base_salary || 0).toLocaleString()
  const allowance = (payslip.allowance || 0).toLocaleString()
  const overtime = (payslip.overtime || 0).toLocaleString()
  const deductions = (payslip.deductions || 0).toLocaleString()
  const insurance = (payslip.insurance || 0).toLocaleString()

  return {
    type: 'flex',
    altText: `${month} 薪資單 — 實發 $${net}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `${month} 薪資單`, weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: employee, size: 'sm', color: '#aaaaaa', margin: 'sm' },
        ],
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'separator', margin: 'md' },
          makeRow('底薪', `$${base}`),
          makeRow('津貼', `$${allowance}`),
          makeRow('加班費', `$${overtime}`),
          { type: 'separator', margin: 'md' },
          makeRow('扣除額', `-$${deductions}`, '#ff4444'),
          makeRow('勞健保', `-$${insurance}`, '#ff8800'),
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'lg',
            contents: [
              { type: 'text', text: '實發金額', weight: 'bold', size: 'md' },
              { type: 'text', text: `$${net}`, weight: 'bold', size: 'lg', color: '#1DB446', align: 'end' },
            ],
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '查看詳細薪資單', uri: `https://liff.line.me/${LIFF_ID}/hr/self-service` },
            style: 'primary',
            color: '#1DB446',
          },
        ],
        paddingAll: '12px',
      },
    },
  }
}

function makeRow(label, value, color) {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#555555', flex: 0 },
      { type: 'text', text: value, size: 'sm', color: color || '#111111', align: 'end' },
    ],
  }
}

/**
 * Send a payslip notification to a single employee.
 * Requires the employee to have a LINE user_id linked.
 */
export async function sendPayslipNotification(employeeName, payslipData) {
  // Look up the employee's LINE user ID
  const { data: emp } = await supabase
    .from('employees')
    .select('id, name, line_user_id')
    .eq('name', employeeName)
    .single()

  if (!emp?.line_user_id) {
    console.warn(`[Payslip] No LINE user_id for ${employeeName}, skipping notification`)
    return { sent: false, reason: 'no_line_id' }
  }

  const message = buildPayslipFlexMessage(employeeName, payslipData)

  // Call Supabase Edge Function to send via LINE Messaging API
  const { data, error } = await supabase.functions.invoke('send-line-message', {
    body: {
      to: emp.line_user_id,
      messages: [message],
    },
  })

  if (error) {
    console.error(`[Payslip] Failed to send to ${employeeName}:`, error)
    return { sent: false, reason: error.message }
  }

  return { sent: true, data }
}

/**
 * Send payslip notifications to all employees for a given month.
 * @param {string} month - e.g. '2026-04'
 * @returns {{ sent: number, failed: number, skipped: number }}
 */
export async function sendBulkPayslipNotifications(month) {
  const { data: salaries } = await supabase
    .from('salary_records')
    .select('*')
    .eq('month', month)

  if (!salaries?.length) return { sent: 0, failed: 0, skipped: 0 }

  let sent = 0, failed = 0, skipped = 0

  for (const sal of salaries) {
    const result = await sendPayslipNotification(sal.employee, sal)
    if (result.sent) sent++
    else if (result.reason === 'no_line_id') skipped++
    else failed++
  }

  return { sent, failed, skipped }
}
