/**
 * Import rest days from screenshot into off_requests
 * 中山 (01中山國小門市) April 2026
 *
 * Read from screenshot:
 * April 2026: 1(三) 2(四) 3(五/兒童) 4(六/節) 5(日/清明) 6(一/節) 7(二/月會)
 *             8(三) 9(四) 10(五) 11(六) 12(日) 13(一) 14(二) 15(三)
 *             16(四) 17(五) 18(六) 19(日) 20(一) 21(二) 22(三) 23(四)
 *             24(五) 25(六) 26(日) 27(一) 28(二) 29(三) 30(四)
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://mvkvnuxeamahhfahclmi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo'
)

const d = (day) => `2026-04-${String(day).padStart(2, '0')}`

// Extracted from screenshot — days where each employee has 休/補休
// 休假天數 column confirms the count
const restDays = {
  // 劉家君 (全職) — 休假天數: 10
  // 1:11-22, 2:11~16:30, 3:休, 4:休, 5:休, 6:補休, 7:休, 8:11-20, 9:11-20, 10:11-22
  // 11:11-22, 12:11-20, 13:15-24, 14:休, 15:15-24, 16:休, 17:11-20, 18:11-20, 19:11-20
  // 20:休, 21:休, 22:11-20, 23:15-24, 24:15-24, 25:休, 26:休, 27:11-20, 28:11-20, 29:休, 30:11-20
  '劉家君': [3, 4, 5, 6, 7, 14, 16, 20, 21, 29],

  // 張丞佑 (全職) — 休假天數: 10
  // 1:休, 2:1500~2400, 3:16-01, 4:16-01, 5:休, 6:15-24, 7:15-24, 8:休, 9:休, 10:15-24
  // 11:11-20, 12:11-20, 13:休, 14:15-24, 15:15-24, 16:15-24, 17:休, 18:休, 19:15-24, 20:15-24
  // 21:休, 22:11-20, 23:11-20, 24:11-20, 25:休, 26:11-20, 27:11-20, 28:休, 29:11-20, 30:11-20
  '張丞佑': [1, 5, 8, 9, 13, 17, 18, 21, 25, 28],

  // 黃為燁 (全職) — 休假天數: 10
  // 1:15-24, 2:休, 3:休, 4:11-20, 5:11-20, 6:15-24, 7:15-24, 8:休, 9:16-01, 10:16-01
  // 11:15-24, 12:15-24, 13:休, 14:11-20, 15:休, 16:16-01, 17:16-01, 18:休, 19:11-20, 20:11-20
  // 21:11-20, 22:休, 23:11-20, 24:11-20, 25:休, 26:15-24, 27:15-24, 28:休, 29:休, 30:16-01
  '黃為燁': [2, 3, 8, 13, 15, 18, 22, 25, 28, 29],

  // 莊浩隆 (PT) — 休假天數: 13
  // 1:休, 2:18-24, 3:11-18, 4:11-18, 5:11-18, 6:休, 7:休, 8:18-22, 9:18-24, 10:休
  // 11:休, 12:休, 13:休, 14:11-18, 15:11-18, 16:11-18, 17:休, 18:11-18, 19:11-18, 20:休
  // 21:18-24, 22:18-24, 23:休, 24:18-01, 25:18-01, 26:18-24, 27:休, 28:18-24, 29:休, 30:休
  '莊浩隆': [1, 6, 7, 10, 11, 12, 13, 17, 20, 23, 27, 29, 30],

  // 王澤昇 (PT) — 休假天數: 12
  // 1:11-18, 2:11-18, 3:11-18, 4:休, 5:休, 6:11-18, 7:11-18, 8:11-18, 9:11-18, 10:11-18
  // 11:休, 12:休, 13:11-18, 14:11-18, 15:休, 16:11-18, 17:11-18, 18:休, 19:11-18, 20:11-18
  // 21:11-18, 22:休, 23:11-18, 24:休, 25:11-18, 26:11-18, 27:休, 28:11-18, 29:11-18, 30:休
  '王澤昇': [4, 5, 11, 12, 15, 18, 22, 24, 27, 30],

  // 許辰 (PT) — 休假天數: 18
  // 1:休, 2:休, 3:休, 4:休, 5:18-01, 6:11-18, 7:休, 8:休, 9:21-24, 10:18-01, 11:休
  // 12:休, 13:休, 14:休, 15:休, 16:18-24, 17:18-24, 18:18-24, 19:休, 20:休, 21:休
  // 22:18-24, 23:18-24, 24:18-01, 25:18-01, 26:休, 27:18-24, 28:18-24, 29:休, 30:休
  '許辰': [1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15, 19, 20, 21, 26, 29, 30],

  // 林則宇 (PT) — 休假天數: 13
  // 1:18-24, 2:18-01, 3:18-01, 4:18-01, 5:18-01, 6:18-24, 7:休, 8:18-24, 9:休, 10:休
  // 11:18-24, 12:18-24, 13:休, 14:18-24, 15:18-24, 16:休, 17:18-01, 18:18-24, 19:18-24, 20:18-24
  // 21:休, 22:18-24, 23:18-24, 24:休, 25:18-24, 26:18-24, 27:休, 28:18-24, 29:休, 30:休
  '林則宇': [7, 9, 10, 13, 16, 21, 24, 27, 29, 30],
}

// Verify counts
console.log('Rest day counts:')
for (const [name, days] of Object.entries(restDays)) {
  console.log(`  ${name}: ${days.length} days → ${days.join(', ')}`)
}

// Convert to off_request rows
const rows = []
for (const [employee, days] of Object.entries(restDays)) {
  for (const day of days) {
    rows.push({ employee, date: d(day) })
  }
}

console.log(`\nTotal: ${rows.length} off_requests to insert`)

// Get employee names for cleanup
const empNames = Object.keys(restDays)

// Step 1: Delete existing off_requests
const { error: delErr } = await supabase.from('off_requests').delete()
  .in('employee', empNames)
  .gte('date', '2026-04-01').lte('date', '2026-04-30')

if (delErr) { console.error('Delete failed:', delErr); process.exit(1) }
console.log('Cleared existing off_requests')

// Step 2: Insert
const { error: insErr } = await supabase.from('off_requests')
  .upsert(rows, { onConflict: 'employee,date' })

if (insErr) { console.error('Insert failed:', insErr); process.exit(1) }

console.log(`\n✅ Imported ${rows.length} rest days as off_requests (希望休) for 中山 April 2026`)
