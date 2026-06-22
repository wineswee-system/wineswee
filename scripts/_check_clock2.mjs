import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path'
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..')
function le(){const p=join(ROOT,'.env');if(!existsSync(p))return{};return Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}).filter(([k])=>k))}
const env={...le(),...process.env}; const supa=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const {data:e}=await supa.from('employees').select('id').eq('name','賴德旻').maybeSingle()
const {data}=await supa.from('attendance_records').select('*').eq('employee_id',e.id).gte('date','2026-06-18').lte('date','2026-06-21').order('date')
for(const a of data||[]){
  const f={}
  for(const k of Object.keys(a)) if(/method|mode|ip|created|updated|source|note|clock/.test(k)) f[k]=a[k]
  console.log(`\n--- ${a.date} (id=${a.id}) ---`)
  console.log(JSON.stringify(f,null,0))
}
