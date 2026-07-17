import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const sb = createClient('https://mvkvnuxeamahhfahclmi.supabase.co', process.env.SVC)
const { data } = await sb.rpc('_dump_function_defs', { p_names: ['_compute_payroll_for_employee'] })
let body = (data||[])[0]?.fn_def || ''
if (!body) { console.log('❌ dump 失敗'); process.exit(1) }
// 確認 _shift_seg_hours(s.actual_start, s.actual_end) 出現次數
const pat = 'public._shift_seg_hours(s.actual_start, s.actual_end)'
const occ = body.split(pat).length - 1
console.log('_compute 內 pattern 出現次數:', occ)
if (occ !== 3) { console.log('⚠️ 次數不是 3，中止（避免改錯）'); process.exit(1) }
// 全部改成帶 s.rest_minutes（3參數版）
body = body.split(pat).join('public._shift_seg_hours(s.actual_start, s.actual_end, s.rest_minutes)')
// pg_get_functiondef 不含結尾分號 → 補上
if (!body.trimEnd().endsWith(';')) body = body.trimEnd() + ';'
fs.writeFileSync('_compute_patched.sql', body, 'utf8')
console.log('✅ 已產出 _compute_patched.sql，改了', occ, '處')
