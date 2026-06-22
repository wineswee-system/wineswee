import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path'
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..')
function le(){const p=join(ROOT,'.env');if(!existsSync(p))return{};return Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}).filter(([k])=>k))}
const env={...le(),...process.env}; const supa=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
for(const name of ['賴德旻','張彥婷']){
  const {data:e}=await supa.from('employees').select('id,name,store').eq('name',name).maybeSingle()
  if(!e){console.log(name,'找不到');continue}
  const {data}=await supa.from('attendance_records').select('*').eq('employee_id',e.id).gte('date','2026-06-18').lte('date','2026-06-21').order('date').order('clock_in')
  console.log(`\n===== ${name} (id=${e.id}, store=${e.store}) =====`)
  for(const a of data||[]) console.log(JSON.stringify({date:a.date,clock_in:a.clock_in,clock_out:a.clock_out,total_hours:a.total_hours,status:a.status,is_late:a.is_late,early_leave_minutes:a.early_leave_minutes,store_id:a.store_id,clock_mode:a.clock_mode,id:a.id}))
}
