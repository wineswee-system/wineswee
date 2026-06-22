import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv(){const p=join(ROOT,'.env');if(!existsSync(p))return{};return Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}).filter(([k])=>k))}
const env={...loadEnv(),...process.env}
const supa=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const {data}=await supa.from('employees').select('name, store, additional_stores').not('additional_stores','is',null).limit(8)
console.log('=== 有設 additional_stores 的範例（看存名稱 or id）===')
for(const e of data||[]) console.log(`${e.name}\tstore=${e.store}\tadditional_stores=${JSON.stringify(e.additional_stores)}`)
const {count}=await supa.from('employees').select('*',{count:'exact',head:true}).not('additional_stores','is',null)
console.log(`\n有設的員工數: ${count}`)
const {data:stores}=await supa.from('stores').select('id,name,organization_id').eq('organization_id',1).order('id')
console.log('\n=== org1 門市（名稱）===')
console.log((stores||[]).map(s=>s.name).join(', '))
