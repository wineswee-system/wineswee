// ────────────────────────────────────────────────────────────
// 過渡期 DOM 翻譯 fallback（中→英）
// 已用 t() 轉過的頁 → i18next 已輸出英文，這裡看到英文不動。
// 還沒轉的頁 → 用同一份 en.js 字典把殘留中文字換英文。
// 逐頁升級成正規 t() 後，這層自然就碰不到那些字了。
// 切回中文用 reload 還原。
// ────────────────────────────────────────────────────────────
import dict from './en'

let active = false
let observer = null

const ZH = /[一-鿿]/
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA'])
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt']

function translate(raw) {
  const key = raw.trim()
  if (!key) return null
  const en = dict[key]
  if (en && en !== key) return raw.replace(key, en)
  return null
}

function translateTextNode(node) {
  const v = node.nodeValue
  if (!v || !ZH.test(v)) return
  const out = translate(v)
  if (out != null && out !== v) node.nodeValue = out
}

function translateAttrs(el) {
  if (!el || !el.getAttribute) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v && ZH.test(v)) {
      const out = translate(v)
      if (out != null && out !== v) el.setAttribute(a, out)
    }
  }
}

function walk(root) {
  if (!root) return
  if (root.nodeType === 1) translateAttrs(root)
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentNode && SKIP_TAGS.has(n.parentNode.tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes = []
  let cur
  while ((cur = tw.nextNode())) nodes.push(cur)
  nodes.forEach(translateTextNode)
  if (root.querySelectorAll) {
    root.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(translateAttrs)
  }
}

export function activate() {
  active = true
  walk(document.body)
  if (!observer) {
    observer = new MutationObserver((muts) => {
      if (!active) return
      for (const m of muts) {
        if (m.type === 'characterData') translateTextNode(m.target)
        else if (m.type === 'attributes') translateAttrs(m.target)
        else if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 3) translateTextNode(n)
            else if (n.nodeType === 1) walk(n)
          })
        }
      }
    })
  }
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  })
}

export function deactivate() {
  active = false
  if (observer) observer.disconnect()
}
