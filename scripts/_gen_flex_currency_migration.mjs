import fs from 'fs'

const NEW =
  "v_currency_sym := COALESCE((SELECT c.symbol || ' ' FROM public.currencies c WHERE c.code = COALESCE(v_req.currency, 'TWD')), 'NT$ ');\n" +
  "  v_currency_fmt := COALESCE((SELECT CASE WHEN c.decimals > 0 THEN 'FM999,999,999,990.00' ELSE 'FM999,999,999,999' END FROM public.currencies c WHERE c.code = COALESCE(v_req.currency, 'TWD')), 'FM999,999,999,999');"

const re = /v_currency_sym := CASE[\s\S]*?END;\s*v_currency_fmt := CASE[\s\S]*?END;/

const files = [
  'supabase/migrations/20260523160000_expense_currency_dynamic.sql',
  'supabase/migrations/20260605000000_expense_settle_currency_dynamic.sql',
]

let out =
  '-- ============================================================================\n' +
  '-- flex 卡片幣別改查 currencies 表（取代寫死 CASE）— 之後新增幣別不用動函式\n' +
  '-- 2026-06-23  以 20260523160000 / 20260605000000 為基礎，只把 v_currency_sym/fmt 改查表\n' +
  '-- ============================================================================\n\nBEGIN;\n\n'

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const m = src.match(re)
  console.log(f, '→ CASE 命中:', m ? `是 (${m[0].length} chars)` : '❌ 沒中')
  if (!m) process.exit(1)
  const edited = src.replace(re, NEW)
  // 取 CREATE OR REPLACE FUNCTION ... 到該函式 $$; 結尾（含後面的 GRANT EXECUTE 若有）
  const ci = edited.indexOf('CREATE OR REPLACE FUNCTION')
  let tail = edited.slice(ci)
  // 砍掉原檔尾端的 COMMIT; / NOTIFY（我們在外層自己包）
  tail = tail.replace(/\nCOMMIT;[\s\S]*$/, '\n').replace(/\nNOTIFY[\s\S]*$/, '\n')
  out += `-- ===== from ${f.split('/').pop()} =====\n` + tail.trimEnd() + '\n\n'
}

out += "COMMIT;\n\nNOTIFY pgrst, 'reload schema';\n"
fs.writeFileSync('supabase/migrations/20260623130000_expense_flex_currency_from_table.sql', out)
console.log('已寫出 20260623130000，長度', out.length)
