import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path'
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..')
function le(){const p=join(ROOT,'.env');if(!existsSync(p))return{};return Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}).filter(([k])=>k))}
const env={...le(),...process.env}; const supa=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const {data}=await supa.from('attendance_records').select('employee_id,date,clock_in,clock_out,total_hours').not('clock_in','is',null).not('clock_out','is',null).gte('date','2026-06-01').limit(6)
function mins(t){ if(!t)return null; const m=String(t).match(/(\d{1,2}):(\d{2})/); return m?(+m[1]*60+ +m[2]):null }
for(const a of data||[]){
  const {data:sch}=await supa.from('schedules').select('shift,actual_start,actual_end').eq('employee_id',a.employee_id).eq('date',a.date).maybeSingle()
  const ci=mins(a.clock_in), co=mins(a.clock_out)
  let actual = (ci!=null&&co!=null)?((co<ci?co+1440:co)-ci)/60 : null
  const ss=mins(sch?.actual_start), se=mins(sch?.actual_end)
  let schDur = (ss!=null&&se!=null)?((se<=ss?se+1440:se)-ss)/60 : null
  console.log(`emp${a.employee_id} ${a.date} | 打卡 ${a.clock_in}~${a.clock_out} (實際${actual?.toFixed(2)}h) | 班表 ${sch?.shift||'-'} ${sch?.actual_start||'?'}~${sch?.actual_end||'?'} (${schDur?.toFixed?.(2)??'?'}h) | total_hours=${a.total_hours}`)
}
