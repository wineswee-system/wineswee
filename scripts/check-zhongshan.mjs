import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  'https://mvkvnuxeamahhfahclmi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo'
)

const emps = ['劉家君', '張丞佑', '黃為燁', '莊浩隆', '王澤昇', '許辰', '林則宇']

// Check ALL schedules for these employees
const { data, error } = await supabase.from('schedules').select('employee, date, shift')
  .in('employee', emps)
  .order('date')
  .limit(20)

console.log('Schedules for 中山 employees:', data?.length || 0)
if (data?.length > 0) {
  for (const s of data) console.log(`  ${s.employee} | ${s.date} | ${s.shift}`)
} else {
  console.log('  (none found - schedule data may not be in database yet)')
}
