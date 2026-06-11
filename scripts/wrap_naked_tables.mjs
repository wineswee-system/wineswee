#!/usr/bin/env node
/**
 * Wraps "naked" <table className="data-table"> with <div className="data-table-wrapper">
 *
 * 解決小螢幕被 main-content overflow-x:hidden 切掉的問題。
 * 只處理沒包 wrapper 的；已包的跳過。
 *
 * Usage: node scripts/wrap_naked_tables.mjs [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')
const ROOT = path.resolve(process.cwd(), 'src')

// 找所有 .jsx 檔
function* walkJsx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkJsx(p)
    else if (entry.name.endsWith('.jsx')) yield p
  }
}

const TABLE_RE = /<table(\s+[^>]*?\bclassName=(?:"data-table"|'data-table'|`data-table`)[^>]*?)>/g

let changedFiles = 0
let totalWraps = 0

for (const file of walkJsx(ROOT)) {
  const src = fs.readFileSync(file, 'utf-8')
  if (!src.includes('data-table')) continue

  const matches = []
  for (const m of src.matchAll(TABLE_RE)) {
    const start = m.index
    // 看前 250 字元有沒有 data-table-wrapper（已包）
    const before = src.slice(Math.max(0, start - 250), start)
    if (before.includes('data-table-wrapper')) continue
    matches.push({ start, end: start + m[0].length, full: m[0], attrs: m[1] })
  }
  if (matches.length === 0) continue

  // 從尾巴往回改（避免 offset 失效），找 matching </table>
  let next = src
  const fixes = []
  for (const mt of matches.reverse()) {
    // 取 indent — 看 <table 前面那行的空白
    const lineStart = next.lastIndexOf('\n', mt.start) + 1
    const indent = next.slice(lineStart, mt.start).match(/^[\s\t]*/)[0]

    // 找對應 </table>
    let depth = 0
    let cursor = mt.end
    let closeAt = -1
    while (cursor < next.length) {
      const open = next.indexOf('<table', cursor)
      const close = next.indexOf('</table>', cursor)
      if (close === -1) break
      if (open !== -1 && open < close) {
        depth++
        cursor = open + 6
      } else {
        if (depth === 0) { closeAt = close; break }
        depth--
        cursor = close + 8
      }
    }
    if (closeAt === -1) continue
    const closeEnd = closeAt + '</table>'.length

    // 包 wrapper
    const innerStart = mt.start
    const innerEnd = closeEnd
    const inner = next.slice(innerStart, innerEnd)
    const wrapped = `<div className="data-table-wrapper">\n${indent}  ${inner.replace(/\n/g, '\n  ')}\n${indent}</div>`
    next = next.slice(0, innerStart) + wrapped + next.slice(innerEnd)
    fixes.push({ start: innerStart })
  }

  if (fixes.length > 0) {
    if (!DRY) fs.writeFileSync(file, next, 'utf-8')
    changedFiles++
    totalWraps += fixes.length
    console.log(`${DRY ? '[DRY] ' : ''}${path.relative(process.cwd(), file)} — wrapped ${fixes.length}`)
  }
}

console.log(`\n${DRY ? '[DRY RUN] ' : ''}done: ${changedFiles} files, ${totalWraps} tables wrapped`)
