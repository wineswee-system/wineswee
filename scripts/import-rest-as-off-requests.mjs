/**
 * One-off script: Extract 休 from 中山 store April 2026 schedule
 * and insert as off_requests (希望休)
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://mvkvnuxeamahhfahclmi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo'
)

const STORE_NAME = '01中山國小門市'
const DATE_START = '2026-04-01'
const DATE_END = '2026-04-30'

// Absence types that count as rest
const ABSENCE_SHIFTS = ['休', '補休', '例假', '休息日', '國定假日', '特休', '事假', '病假', '公假', '婚假', '喪假', '產假', '陪產假', '育嬰假', '生理假', '家庭照顧假', '心理健康假', '職災傷病假', '哺乳假', '產檢假']

async function main() {
  // 1. Get 中山 store employees
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('name, store')
    .eq('store', STORE_NAME)
    .eq('status', '在職')

  if (empErr) { console.error('Failed to load employees:', empErr); return }
  console.log(`Found ${employees.length} employees in ${STORE_NAME}:`, employees.map(e => e.name))

  const empNames = employees.map(e => e.name)

  // 2. Get current schedules for April
  const { data: schedules, error: schErr } = await supabase
    .from('schedules')
    .select('employee, date, shift')
    .in('employee', empNames)
    .gte('date', DATE_START)
    .lte('date', DATE_END)

  if (schErr) { console.error('Failed to load schedules:', schErr); return }
  console.log(`Found ${schedules.length} schedule entries`)

  // 3. Extract rest days
  const restDays = schedules.filter(s => ABSENCE_SHIFTS.includes(s.shift))
  console.log(`\nFound ${restDays.length} rest days:`)

  // Group by employee for display
  const byEmp = {}
  for (const r of restDays) {
    if (!byEmp[r.employee]) byEmp[r.employee] = []
    byEmp[r.employee].push(r.date)
  }
  for (const [emp, dates] of Object.entries(byEmp)) {
    dates.sort()
    console.log(`  ${emp}: ${dates.length} days → ${dates.map(d => d.slice(8)).join(', ')}`)
  }

  // 4. Delete existing off_requests for this period
  const { error: delErr } = await supabase
    .from('off_requests')
    .delete()
    .in('employee', empNames)
    .gte('date', DATE_START)
    .lte('date', DATE_END)

  if (delErr) { console.error('Failed to delete old off_requests:', delErr); return }
  console.log(`\nCleared existing off_requests for ${STORE_NAME} April`)

  // 5. Insert rest days as off_requests
  const rows = restDays.map(r => ({ employee: r.employee, date: r.date }))
  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from('off_requests')
      .upsert(rows, { onConflict: 'employee,date' })

    if (insErr) { console.error('Failed to insert off_requests:', insErr); return }
  }

  console.log(`\n✅ Imported ${rows.length} rest days as off_requests (希望休)`)
}

main().catch(console.error)
