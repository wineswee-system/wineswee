import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  'https://mvkvnuxeamahhfahclmi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo'
)

const { data: stores } = await supabase.from('stores').select('id, name')
console.log('Stores:', stores)

const { data: emps } = await supabase.from('employees').select('name, store, employment_type, status').eq('status', '在職').order('store')
console.log('\nEmployees:')
for (const e of (emps || [])) console.log(`  ${e.store} | ${e.name} (${e.employment_type})`)

// Check schedules for April
const { data: schCount } = await supabase.from('schedules').select('employee, date, shift', { count: 'exact' }).gte('date', '2026-04-01').lte('date', '2026-04-30').limit(5)
console.log('\nSample April schedules:', schCount)

const { data: offReqs } = await supabase.from('off_requests').select('*').gte('date', '2026-04-01').lte('date', '2026-04-30')
console.log('\nExisting April off_requests:', offReqs?.length, offReqs?.slice(0, 3))
