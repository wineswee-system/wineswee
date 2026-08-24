#!/usr/bin/env node
/**
 * i18n 缺字掃描 — 偵測畫面上會顯示、但 en.js 還沒收的繁中 UI 字串。
 *
 *   npm run i18n:scan          列出缺字數量 + 分類,寫出 i18n-missing.txt
 *   npm run i18n:scan -- --all 連單字/碎片一起列(預設只列 >=2 字有意義詞句)
 *
 * 補字流程:跑本腳本 → 把 i18n-missing.txt 交給 Claude 批次翻 → 併回 src/lib/i18n/en.js。
 * (刻意不做前端即時翻譯 API:會露金鑰、有延遲與費用;字典離線查表才是前端該有的架構。)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EN = path.join(ROOT, 'src/lib/i18n/en.js')
const OUT = path.join(ROOT, 'i18n-missing.txt')
const ROOTS = ['src'] // 整個 src(walk 內排除 i18n / 測試檔)
const showAll = process.argv.includes('--all')
const SEP = String.fromCharCode(1)
const ZH = /[一-鿿]/

// 現有字典 key
const dict = (await import(pathToFileURL(EN).href)).default
const have = new Set(Object.keys(dict))

// 收集檔案
const files = []
function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) walk(p)
    else if (/\.(jsx|js)$/.test(f.name) && !/i18n|__tests__|\.test\.|[\\/]test[\\/]/.test(p)) files.push(p)
  }
}
ROOTS.forEach(r => walk(path.join(ROOT, r)))

const strs = new Set()
const add = s => {
  s = s.trim()
  if (!s || !ZH.test(s)) return
  if (/[${}<>]/.test(s) || s.includes('className') || s.includes('\\n')) return
  if (s.length > 70) return
  strs.add(s)
}
for (const file of files) {
  // 逐行:略過純註解 / console / throw / logger 行(那些不會顯示)
  const src = fs.readFileSync(file, 'utf8').split('\n').filter(l => {
    const t = l.trim()
    return !(t.startsWith('//') || t.startsWith('*') ||
      /console\.(log|error|warn|info)/.test(t) || /\bthrow\b/.test(t) || /logger\./.test(t))
  }).join('\n')
  let m
  const jsx = />([^<>]*?[一-鿿][^<>]*?)</g
  while ((m = jsx.exec(src))) m[1].replace(/\{[^{}]*\}/g, SEP).split(SEP).forEach(add)
  const q = /(['"`])([^'"`\n]*?[一-鿿][^'"`\n]*?)\1/g
  while ((m = q.exec(src))) add(m[2])
}

const zhCount = s => [...s].filter(c => ZH.test(c)).length
const missing = [...strs].filter(s => !have.has(s))
const meaningful = missing.filter(s => zhCount(s) >= 2 && !/[)）(（\][]/.test(s))
const list = showAll ? missing : meaningful

console.log(`掃 ${files.length} 檔 · en.js 現有 ${have.size} 條`)
console.log(`缺字合計 ${missing.length}(含單字/碎片)· 有意義詞句(>=2字) ${meaningful.length}`)
if (list.length) {
  list.sort((a, b) => zhCount(a) - zhCount(b))
  fs.writeFileSync(OUT, list.join('\n'))
  console.log(`→ 已寫出 ${list.length} 條至 ${path.relative(ROOT, OUT)}(交給 Claude 批次翻後併回 en.js)`)
} else {
  console.log('✓ 沒有缺字,字典已覆蓋所有會顯示的 UI 文字。')
}
