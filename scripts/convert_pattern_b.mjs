#!/usr/bin/env node
/**
 * 把舊 Pattern B 的 data-table 寫法統一改成 Pattern A：
 *   B: <div className="data-table"><table>...</table></div>
 *   A: <div className="data-table-wrapper"><table className="data-table">...</table></div>
 *
 * 為什麼必要：Pattern B 在 CSS 上有處理 (div.data-table { overflow-x: auto })，
 * 但混兩種 pattern 容易踩雷（min-width / sticky-first-col / fade chevron 等
 * CSS 規則都掛 .data-table class 上）。統一成 A 之後所有頁面行為一致。
 */
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')
const ROOT = path.resolve(process.cwd(), 'src')

function* walkJsx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkJsx(p)
    else if (entry.name.endsWith('.jsx')) yield p
  }
}

const DIV_OPEN_RE = /<div(\s+[^>]*?)?className=(["'`])data-table\2([^>]*?)>/g

let changedFiles = 0, totalSwaps = 0

for (const file of walkJsx(ROOT)) {
  let src = fs.readFileSync(file, 'utf-8')
  if (!src.includes('data-table')) continue

  let modified = false
  let result = ''
  let cursor = 0

  // 逐個 <div className="data-table"> 處理
  while (true) {
    DIV_OPEN_RE.lastIndex = cursor
    const m = DIV_OPEN_RE.exec(src)
    if (!m) {
      result += src.slice(cursor)
      break
    }
    // 把 <div className="data-table" ...> 改成 <div className="data-table-wrapper" ...>
    const before = m[1] || ''
    const after = m[3] || ''
    const newDiv = `<div${before}className="data-table-wrapper"${after}>`
    result += src.slice(cursor, m.index) + newDiv

    // 找對應的 </div>，途中找 <table> 改成 <table className="data-table">
    let depth = 1
    let i = m.index + m[0].length
    let chunk = ''
    let tablePatched = false
    while (i < src.length && depth > 0) {
      const nextDiv = src.indexOf('<div', i)
      const closeDiv = src.indexOf('</div>', i)
      const tableTag = src.indexOf('<table', i)
      // 排序：誰最近處理誰
      const candidates = [
        { pos: nextDiv,  type: 'open' },
        { pos: closeDiv, type: 'close' },
        { pos: tableTag, type: 'table' },
      ].filter(c => c.pos !== -1).sort((a, b) => a.pos - b.pos)

      if (candidates.length === 0) break
      const { pos, type } = candidates[0]
      // 把中間的內容先吃進來
      chunk += src.slice(i, pos)
      if (type === 'open') {
        depth++
        chunk += '<div'
        i = pos + 4
      } else if (type === 'close') {
        depth--
        if (depth === 0) {
          chunk += '</div>'
          i = pos + 6
          break
        }
        chunk += '</div>'
        i = pos + 6
      } else if (type === 'table') {
        // 找 <table 後第一個 > 結束
        const closeAngle = src.indexOf('>', pos)
        if (closeAngle === -1) break
        const tagInner = src.slice(pos, closeAngle + 1)  // <table ...>
        // 沒包含 className= 才加 className="data-table"
        if (!/\bclassName\s*=/.test(tagInner) && !tablePatched) {
          const insertAt = pos + '<table'.length
          // 在 <table 後面、空白或 > 之前插入 className="data-table"
          // 簡單方法：直接在 <table 後面加 ' className="data-table"'
          const before = src.slice(pos, insertAt)
          const rest = src.slice(insertAt, closeAngle + 1)
          chunk += `${before} className="data-table"${rest}`
          tablePatched = true
        } else {
          chunk += tagInner
        }
        i = closeAngle + 1
      }
    }
    result += chunk
    cursor = i
    if (tablePatched || newDiv !== m[0]) {
      modified = true
      totalSwaps++
    }
  }

  if (modified && !DRY) {
    fs.writeFileSync(file, result, 'utf-8')
    console.log(`${path.relative(process.cwd(), file)}`)
    changedFiles++
  } else if (modified && DRY) {
    console.log(`[DRY] ${path.relative(process.cwd(), file)}`)
    changedFiles++
  }
}

console.log(`\n${DRY ? '[DRY RUN] ' : ''}done: ${changedFiles} files, ${totalSwaps} swaps`)
