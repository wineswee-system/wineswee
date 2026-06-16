#!/usr/bin/env node
// 查截圖那批員工的 can_open/can_close，確認 S8 是不是「null 被當不可開店」
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv() {
  const p = join(ROOT, '.env'); if (!existsSync(p)) return {}
  return Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }).filter(([k]) => k))
}
const env = { ...loadEnv(), ...process.env }
const supa = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const names = ['張惇惠', '徐宥芯', '洪瑛妏', '蔡伊真', '許亦翎', '陳嘉益', '陳柔逸', '黃傑查絡']
const { data } = await supa.from('employees').select('name, store, can_open, can_close').in('name', names)
console.log('員工          can_open   can_close')
let nullOpen = 0
for (const e of data || []) {
  console.log(`${e.name.padEnd(8)}  ${String(e.can_open).padEnd(8)}  ${e.can_close}`)
  if (e.can_open == null) nullOpen++
}
// 全公司 can_open 統計
const { data: all } = await supa.from('employees').select('can_open').eq('status', '在職')
const t = { true: 0, false: 0, null: 0 }
for (const e of all || []) t[e.can_open === true ? 'true' : e.can_open === false ? 'false' : 'null']++
console.log(`\n截圖門市 ${nullOpen}/${data?.length} 人 can_open=null（未設定）`)
console.log(`全公司在職：can_open=true ${t.true} 人 / =false ${t.false} 人 / =null(未設) ${t.null} 人`)
console.log(t.true === 0 ? '\n→ 全公司沒人設過 can_open=true，演算法每天都會報「無開店資格人員」'
                         : '')
