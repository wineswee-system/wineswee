import { supabase } from '../supabase'

// ── 5. 特休結清 ──
// 到職滿一年，未使用的特休在下月薪資結清
// 例：3月到職 → 隔年3月週年 → 4月薪資結清未休特休
export async function calculateAnnualLeaveSettlement() {
  const today = new Date()
  const currentMonth = today.toISOString().slice(0, 7) // e.g. 2026-04

  const { data: employees } = await supabase
    .from('employees').select('*').eq('status', '在職')

  if (!employees) return []

  const settlements = []

  for (const emp of employees) {
    if (!emp.join_date) continue

    const joinDate = new Date(emp.join_date)
    const yearsWorked = Math.floor((today - joinDate) / (365.25 * 86400000))

    if (yearsWorked < 1) continue

    // Anniversary month: join_date month
    const anniversaryMonth = joinDate.getMonth() // 0-based
    // Settlement month = anniversary month + 1
    const settlementMonth = anniversaryMonth + 1 // 1-based for display
    const currentMonthNum = today.getMonth() + 1

    // Only process in the settlement month
    if (currentMonthNum !== (settlementMonth === 13 ? 1 : settlementMonth)) continue

    // Idempotency check: skip if settlement already exists for this employee+year
    const settlementYear = today.getFullYear()
    const { data: existing } = await supabase
      .from('leave_settlements')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('settlement_month', currentMonth)
      .maybeSingle()

    if (existing) continue

    // 結清的是「剛結束那個服務年」的特休額度 = §38 滿(yearsWorked-1)年
    //   (原本每年都錯一格:結清剛完成的第 N 年卻套用下一年額度,且漏掉第一年 3 天檔 → 系統性多結)
    //   滿6月3天 / 滿1年7 / 滿2年10 / 滿3~4年14 / 滿5~9年15 / 滿10年起每年+1封頂30
    const settledYear = yearsWorked // 剛完成第 settledYear 個服務年
    let entitled
    if      (settledYear === 1) entitled = 3
    else if (settledYear === 2) entitled = 7
    else if (settledYear === 3) entitled = 10
    else if (settledYear <= 5)  entitled = 14  // 完成第4、5年 = 滿3、4年
    else if (settledYear <= 11) entitled = 15  // 完成第6~11年 = 滿5~10年
    else entitled = Math.min(30, 15 + (settledYear - 11)) // 完成第12年起 = 滿11年起

    // Get used leave in the past year
    const yearStart = new Date(today.getFullYear() - 1, anniversaryMonth, joinDate.getDate())
    const { data: leaves } = await supabase
      .from('leave_requests')
      .select('days')
      .eq('employee_id', emp.id)
      .eq('type', '特休')
      .eq('status', '已核准')
      .is('deleted_at', null)
      .gte('start_date', yearStart.toISOString().slice(0, 10))

    const used = (leaves || []).reduce((s, l) => s + (l.days || 0), 0)
    const unused = Math.max(0, entitled - used)

    if (unused > 0) {
      // Calculate daily rate for settlement
      const { data: salary } = await supabase
        .from('salary_records')
        .select('base_salary')
        .eq('employee_id', emp.id)
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle()

      const dailyRate = salary ? (salary.base_salary || 0) / 30 : 0
      const settlementAmount = Math.round(unused * dailyRate)

      settlements.push({
        employee: emp.name,
        yearsWorked,
        entitled,
        used,
        unused,
        dailyRate: Math.round(dailyRate),
        settlementAmount,
        settlementMonth: currentMonth,
      })
    }
  }

  return settlements
}
