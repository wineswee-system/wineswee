// 一次性 script：把 src/ 下所有 alert(...) 換成 toast.error(...)
// 並自動加 import { toast } from '<相對路徑>/lib/toast'
//
// 使用：node scripts/replace_alert_with_toast.mjs
//
// 注意：不動 src/lib/toast.js, src/lib/confirm.js, scripts/, src/__tests__
// 之後 success 訊息需手動掃描修正（例如 alert('已送出') → toast.success）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

const SKIP = new Set([
  path.join(SRC, 'lib', 'toast.js'),
  path.join(SRC, 'lib', 'confirm.js'),
])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      walk(full, out)
    } else if (/\.(jsx?|tsx?|mjs)$/.test(entry.name)) {
      if (!SKIP.has(full)) out.push(full)
    }
  }
  return out
}

function relativeToToast(filePath) {
  const fileDir = path.dirname(filePath)
  const toastFile = path.join(SRC, 'lib', 'toast.js')
  let rel = path.relative(fileDir, path.dirname(toastFile))
  if (!rel.startsWith('.')) rel = './' + rel
  return rel.replace(/\\/g, '/') + '/toast'
}

let totalFiles = 0
let totalReplacements = 0

for (const file of walk(SRC)) {
  let content = fs.readFileSync(file, 'utf8')
  if (!/\balert\s*\(/.test(content)) continue

  const before = content
  // 只替換獨立的 alert( 不動 window.alert / xxxAlert
  content = content.replace(/(^|[^.\w])alert\s*\(/g, '$1toast.error(')

  if (content === before) continue

  // 加 import（如果還沒加）
  if (!/from ['"][^'"]*\/lib\/toast['"]/.test(content)) {
    const importPath = relativeToToast(file)
    const importStmt = `import { toast } from '${importPath}'\n`

    // 找最後一個 import 行的結尾插入
    const importRegex = /^(import\s.+?from\s+['"][^'"]+['"];?\s*\n)+/m
    const m = content.match(importRegex)
    if (m) {
      content = content.slice(0, m.index + m[0].length) + importStmt + content.slice(m.index + m[0].length)
    } else {
      content = importStmt + content
    }
  }

  fs.writeFileSync(file, content, 'utf8')
  const count = (before.match(/(^|[^.\w])alert\s*\(/g) || []).length
  totalReplacements += count
  totalFiles++
  console.log(`✔ ${path.relative(ROOT, file)}  (${count})`)
}

console.log(`\nDone. ${totalReplacements} alert calls replaced across ${totalFiles} files.`)
