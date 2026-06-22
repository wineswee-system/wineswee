import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path'
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..')
function le(){const p=join(ROOT,'.env');if(!existsSync(p))return{};return Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}).filter(([k])=>k))}
const env={...le(),...process.env}; const supa=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const {data:e}=await supa.from('employees').select('id,name,employment_type,position,base_salary,store').eq('name','賴德旻').maybeSingle()
console.log('員工:',JSON.stringify(e))
const {data:ss}=await supa.from('salary_structures').select('salary_type,employment_category,hourly_rate,base_salary,piece_rate').eq('employee_id',e.id).maybeSingle()
console.log('薪資結構:',JSON.stringify(ss))
