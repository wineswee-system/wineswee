import { toast } from './toast'

/**
 * 單張門市稽核單 → 列印 / 另存 PDF（HTML + window.print()）
 *
 * 走跟 printSignOff.js 一樣的路子：用系統中文字型輸出，不碰 jsPDF 嵌字型（中文會亂碼）。
 * 版面忠實還原 StoreAuditDetailModal：頁首 → 各類得分 → 逐大類 / 群組 / 項目（扣分 / 加分 / ✓）
 * → 稽核建議 → 當班人員簽名 → 簽核流程 → 稽核照片。
 *
 * 計分規則與 modal 完全一致（加分列 input_type='bonus' 的 deduct_score 是「回補分數」，上限=滿分）。
 *
 * @param {Object} opts
 * @param {Object} opts.audit       store_audits 單頭
 * @param {Array}  opts.items       store_audit_items
 * @param {Array}  [opts.onDuty]    store_audit_on_duty（含 signature_data_url）
 * @param {Array}  [opts.chainSteps] approval_chain_steps
 * @param {string} [opts.companyName] 公司抬頭
 * @param {Window} [opts._win]      caller 預先開好的視窗（避免 popup blocker）
 */
export function printStoreAudit(opts = {}) {
  const {
    audit = {},
    items = [],
    onDuty = [],
    chainSteps = [],
    companyName = '威耀時代股份有限公司',
    _win,
  } = opts

  const cats = buildCats(items)
  const scored = cats.filter(c => catMax(c) > 0)
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, c) => s + catScore(c), 0) / scored.length * 100) / 100
    : 0
  const deductedCount = items.filter(i => i.input_type !== 'bonus' && (i.deduct_score || 0) > 0).length
  const totalDeducted = items.reduce((s, i) => s + (i.input_type === 'bonus' ? 0 : (i.deduct_score || 0)), 0)
  const scoreColor = avgScore >= 90 ? '#0a6b2e' : avgScore >= 70 ? '#a65c00' : '#9c1f1f'

  const catsHtml = cats.map(renderCategory).join('')
  const scoreChipsHtml = scored.map(c =>
    `<span class="chip">${safe(c.name)} <b>${catScore(c)}</b></span>`).join('')
  const onDutyHtml = renderOnDuty(onDuty)
  const chainHtml = renderChain(chainSteps, audit)
  const photosHtml = renderPhotos(Array.isArray(audit.photos) ? audit.photos : [])
  const statusBadge = renderStatusBadge(audit.status)

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>稽核單 #${safe(String(audit.id ?? ''))} ${safe(audit.store_name || '')}</title>
<style>
  @page { size: A4 portrait; margin: 1.1cm 1.2cm; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 0; background: #fff; }
    .page { box-shadow: none; }
    .cat, .sign-block, .note-block, .photo-item { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; }
  html, body { background: #f4f1ea; }
  body {
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "PMingLiU", "Heiti TC", sans-serif;
    color: #1a1a1a; font-size: 11pt; line-height: 1.5; margin: 0; padding: 20px 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .toolbar {
    max-width: 19cm; margin: 0 auto 16px; background: #fff; border: 1px solid #d8cfb8;
    padding: 12px 16px; border-radius: 8px; display: flex; gap: 10px; align-items: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  }
  .toolbar button {
    padding: 7px 16px; font-size: 11pt; cursor: pointer; border-radius: 5px;
    border: 1px solid #b8a878; background: #fff; font-family: inherit;
  }
  .toolbar button:hover { background: #faf6ec; }
  .toolbar button.primary { background: #6e5a2e; color: #fff; border-color: #6e5a2e; }
  .page {
    background: #fff; max-width: 19cm; margin: 0 auto; padding: 20px 26px 24px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.1); border-radius: 2px;
  }
  .header { border-bottom: 3px solid #6e5a2e; padding-bottom: 8px; margin-bottom: 12px; }
  .header .co { font-size: 12pt; font-weight: 600; color: #6e5a2e; letter-spacing: 3px; }
  .header .row { display: flex; align-items: baseline; justify-content: space-between; margin-top: 4px; }
  .header h1 { font-size: 18pt; font-weight: 800; margin: 0; letter-spacing: 3px; }
  .header .score-big { font-size: 22pt; font-weight: 800; color: ${scoreColor}; }
  .header .score-big small { font-size: 10pt; color: #8a8270; font-weight: 500; letter-spacing: 0; }
  .status-pill { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 9.5pt; font-weight: 700; margin-left: 8px; vertical-align: middle; }
  .status-pill.applying { background: #e8eef8; color: #2f4f8a; }
  .status-pill.approved { background: #e0f0e3; color: #0a6b2e; }
  .status-pill.rejected { background: #f8e3e3; color: #9c1f1f; }
  .status-pill.draft { background: #ececec; color: #666; }

  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 10px; border: 1.2px solid #2a2a2a; }
  table.meta td { border: 0.8px solid #999; padding: 5px 10px; font-size: 10.5pt; }
  table.meta td.label { background: #efeadc; font-weight: 700; text-align: center; color: #4a3f1f; white-space: nowrap; width: 14%; }

  .summary { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 14px; font-size: 10pt; }
  .summary .stat { color: #4a3f1f; }
  .summary .stat b { color: #9c1f1f; }
  .chip { background: #f4f1ea; border: 1px solid #e0d5b0; border-radius: 4px; padding: 2px 8px; font-size: 9.5pt; color: #4a3f1f; }
  .chip b { color: #1a1a1a; }

  .cat { margin-bottom: 16px; }
  .cat-title {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 12.5pt; font-weight: 800; color: #1a1a1a;
    border-bottom: 2px solid #6e5a2e; padding: 3px 0; margin-bottom: 6px;
  }
  .cat-title .cscore { font-size: 11pt; font-weight: 700; }
  .grp { margin-bottom: 8px; }
  .grp-head {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 10pt; font-weight: 700; padding: 3px 8px; border-radius: 3px; margin-bottom: 3px;
    background: #f2eee2; color: #4a3f1f;
  }
  .grp-head.bonus { background: #e0f0e3; color: #0a6b2e; }
  .grp-note { font-size: 9.5pt; color: #4a3f1f; background: #faf6ec; border-radius: 3px; padding: 2px 8px; margin-bottom: 4px; }
  .grp-note.bonus { background: #e8f5ea; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items td { padding: 3px 6px; font-size: 10.5pt; border-bottom: 1px solid #eee; vertical-align: top; }
  table.items td.mark { width: 62px; text-align: center; white-space: nowrap; }
  table.items tr.bad td { background: #fdeeee; }
  table.items tr.plus td { background: #eef7f0; }
  .tag { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 9.5pt; font-weight: 700; }
  .tag.ok { background: #e0f0e3; color: #0a6b2e; }
  .tag.bad { background: #f8dede; color: #9c1f1f; }
  .tag.plus { background: #d8ecdd; color: #0a6b2e; }
  .star { color: #a65c00; font-weight: 700; }
  .item-remark { color: #6b6357; font-size: 9.5pt; margin-top: 1px; }

  .note-block { margin-top: 6px; margin-bottom: 6px; }
  .note-block .nt { font-size: 10pt; font-weight: 700; color: #4a3f1f; margin-bottom: 2px; }
  .note-block .nv { font-size: 10.5pt; white-space: pre-wrap; background: #faf6ec; border-radius: 4px; padding: 6px 8px; color: #1a1a1a; }

  .sec-h { font-size: 12pt; font-weight: 800; color: #1a1a1a; border-bottom: 2px solid #6e5a2e; padding: 3px 0; margin: 16px 0 8px; }
  .sign-block { display: flex; flex-wrap: wrap; gap: 10px; }
  .sign-cell { border: 1px solid #999; border-radius: 4px; width: 150px; text-align: center; }
  .sign-cell .sn { background: #efeadc; padding: 3px; font-weight: 700; font-size: 10pt; color: #4a3f1f; border-bottom: 1px solid #999; }
  .sign-cell .sig { height: 56px; display: flex; align-items: center; justify-content: center; padding: 3px; }
  .sign-cell .sig img { max-width: 100%; max-height: 52px; object-fit: contain; }
  .sign-cell .st { font-size: 9pt; color: #0a6b2e; padding-bottom: 3px; }

  .chain { display: flex; flex-wrap: wrap; gap: 6px; }
  .chain .step { border: 1px solid #cfc7b0; border-radius: 14px; padding: 3px 12px; font-size: 9.5pt; color: #4a3f1f; background: #faf6ec; }
  .chain .step.done { background: #e0f0e3; color: #0a6b2e; border-color: #b7ddc0; font-weight: 700; }
  .approver-line { margin-top: 8px; font-size: 10pt; color: #4a3f1f; }
  .reject-box { margin-top: 8px; padding: 6px 10px; background: #f8e3e3; border-radius: 4px; font-size: 10pt; color: #9c1f1f; }

  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo-item img { width: 100%; border: 1px solid #ddd; border-radius: 4px; object-fit: cover; }
  .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #c8b88a; display: flex; justify-content: space-between; font-size: 9pt; color: #8a8270; }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="primary" onclick="window.print()">🖨 列印 / 另存 PDF</button>
    <button onclick="window.close()">關閉</button>
    <span style="color:#8a8270;font-size:9.5pt;margin-left:auto">提示：列印對話框選「另存為 PDF」</span>
  </div>

  <div class="page">
    <div class="header">
      <div class="co">${safe(companyName)}</div>
      <div class="row">
        <h1>門市稽核報告${statusBadge}</h1>
        <div class="score-big">${avgScore}<small> / 100 總平均</small></div>
      </div>
    </div>

    <table class="meta">
      <tr>
        <td class="label">單號</td><td>#${safe(String(audit.id ?? ''))}</td>
        <td class="label">門市</td><td>${safe(audit.store_name || '—')}</td>
        <td class="label">稽核日</td><td>${safe(audit.audit_date || '—')}</td>
      </tr>
      <tr>
        <td class="label">班別</td><td>${safe(audit.shift || '—')}</td>
        <td class="label">稽核員</td><td>${safe(audit.auditor_name || '—')}</td>
        <td class="label">到 / 離店</td><td>${safe((audit.arrive_time || '').slice(0,5) || '—')} ~ ${safe((audit.depart_time || '').slice(0,5) || '—')}</td>
      </tr>
    </table>

    <div class="summary">
      <span class="stat">共 ${items.length} 項</span>
      <span class="stat">扣分 <b>${deductedCount}</b> 項</span>
      <span class="stat">總扣 ${totalDeducted}</span>
      <span style="margin:0 4px;color:#ccc">|</span>
      ${scoreChipsHtml}
    </div>

    ${catsHtml}

    ${renderNote('稽核人員建議', audit.notes_suggestions)}
    ${renderNote('門店同仁建議', audit.notes_feedback)}

    <div class="sec-h">當班人員簽名</div>
    <div class="sign-block">${onDutyHtml}</div>

    ${chainHtml}

    ${photosHtml}

    <div class="footer">
      <div>產製：${new Date().toLocaleString('zh-TW')}</div>
      <div>SME Ops System · 門市稽核</div>
    </div>
  </div>
</body>
</html>`

  const w = _win || window.open('', '_blank', 'width=900,height=1100')
  if (!w) { toast.error('無法開啟新視窗，請允許彈出視窗權限'); return }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

// ─── 計分 helper（與 StoreAuditDetailModal 一致）───
const CAT_ORDER = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }

function buildCats(items) {
  const cats = {}
  ;[...items].sort((a, b) => (a.item_no || 0) - (b.item_no || 0)).forEach(item => {
    const c = item.category_code || '?'
    if (!cats[c]) cats[c] = { code: c, name: item.category_name, groups: {}, order: [] }
    const g = item.relation_group || '—'
    if (!cats[c].groups[g]) { cats[c].groups[g] = { name: g, allot: item.group_allot || 0, items: [] }; cats[c].order.push(g) }
    cats[c].groups[g].items.push(item)
  })
  return Object.values(cats).sort((a, b) => (CAT_ORDER[a.code] || 99) - (CAT_ORDER[b.code] || 99))
}
const itemDeduct = (i) => i.input_type === 'bonus' ? -(i.deduct_score || 0) : (i.deduct_score || 0)
const groupDeduct = (grp) => grp.items.reduce((s, i) => s + itemDeduct(i), 0)
const catMax = (cat) => cat.order.reduce((s, g) => s + (cat.groups[g].allot || 0), 0)
const catDeduct = (cat) => cat.order.reduce((s, g) => s + groupDeduct(cat.groups[g]), 0)
const catScore = (cat) => Math.min(catMax(cat), Math.max(0, catMax(cat) - catDeduct(cat)))

// ─── 渲染 ───
function renderCategory(cat) {
  const max = catMax(cat)
  const ded = catDeduct(cat)
  const groupsHtml = cat.order.map(gName => {
    const grp = cat.groups[gName]
    // 「其他」自由填寫群組
    const otherItem = grp.items.find(i => i.input_type === 'other')
    if (otherItem) return renderOther(otherItem)
    const isBonus = grp.items.some(i => i.input_type === 'bonus')
    const gd = groupDeduct(grp)
    const bonusPts = isBonus ? grp.items.reduce((s, i) => s + (i.deduct_score || 0), 0) : 0
    const note = grp.items[0]?.group_note
    const rows = grp.items.map(renderItem).join('')
    return `
      <div class="grp">
        <div class="grp-head ${isBonus ? 'bonus' : ''}">
          <span>${isBonus ? '➕ 加分（回補分數，上限 100）' : safe(grp.name)}</span>
          <span>${isBonus
            ? (bonusPts > 0 ? `已加 ${bonusPts}` : '')
            : `配分 ${grp.allot}${gd > 0 ? ` · 已扣 ${gd}` : ''}`}</span>
        </div>
        ${note ? `<div class="grp-note ${isBonus ? 'bonus' : ''}">${isBonus ? '加分原因' : '說明'}：${safe(note)}</div>` : ''}
        <table class="items">${rows}</table>
      </div>`
  }).join('')
  return `
    <div class="cat">
      <div class="cat-title">
        <span>${safe(cat.code)}、${safe(cat.name)}</span>
        ${max > 0 ? `<span class="cscore" style="color:${ded > 0 ? '#9c1f1f' : '#0a6b2e'}">${catScore(cat)} / ${max}</span>` : ''}
      </div>
      ${groupsHtml}
    </div>`
}

function renderItem(item) {
  const isBonus = item.input_type === 'bonus'
  const val = item.deduct_score || 0
  const active = val > 0
  const rowCls = isBonus ? (active ? 'plus' : '') : (active ? 'bad' : '')
  const mark = isBonus
    ? (active ? `<span class="tag plus">加 ${val}</span>` : `<span class="tag">—</span>`)
    : (active ? `<span class="tag bad">扣 ${val}</span>` : `<span class="tag ok">✓</span>`)
  const star = item.is_star ? `<span class="star">★ </span>` : ''
  const starNote = item.is_star ? ` <span class="star">可開罰</span>` : ''
  const remark = (item.input_type === 'text' && item.remark)
    ? `<div class="item-remark">${safe(item.remark)}</div>` : ''
  return `<tr class="${rowCls}">
    <td>${star}${safe(item.item_text || '')}${starNote}${remark}</td>
    <td class="mark">${mark}</td>
  </tr>`
}

function renderOther(oItem) {
  const hasContent = oItem.item_text || (oItem.deduct_score || 0) > 0 || oItem.group_note
  if (!hasContent) return ''
  return `
    <div class="grp">
      <div class="grp-head"><span>其他（自由填寫，扣分計入本區）</span></div>
      ${(oItem.item_text || (oItem.deduct_score || 0) > 0)
        ? `<div class="grp-note">${safe(oItem.item_text || '其他')}${(oItem.deduct_score || 0) > 0 ? ` — 扣 ${oItem.deduct_score}` : ''}</div>` : ''}
      ${oItem.group_note ? `<div class="grp-note">說明：${safe(oItem.group_note)}</div>` : ''}
    </div>`
}

function renderNote(label, value) {
  if (!value || !String(value).trim()) return ''
  return `<div class="note-block"><div class="nt">${safe(label)}</div><div class="nv">${safe(value)}</div></div>`
}

function renderOnDuty(onDuty) {
  if (!onDuty || onDuty.length === 0) return '<div style="font-size:10pt;color:#8a8270">（無當班人員紀錄）</div>'
  return onDuty.map(d => `
    <div class="sign-cell">
      <div class="sn">${safe(d.employee_name || '—')}</div>
      <div class="sig">${d.signature_data_url
        ? `<img src="${safe(d.signature_data_url)}" alt="簽名" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'✓ 已簽',style:'color:#0a6b2e;font-size:10pt'}))" />`
        : '<span style="color:#aaa;font-size:9.5pt">未簽</span>'}</div>
      <div class="st">${d.signature_data_url ? '✓ 已簽名' : ''}</div>
    </div>`).join('')
}

function renderChain(chainSteps, audit) {
  let html = ''
  if (chainSteps && chainSteps.length > 0) {
    const isApproving = audit.status === '申請中'
    const stepsHtml = chainSteps.map((cs, i) => {
      const done = isApproving ? i < (audit.current_step || 0) : audit.status === '已核准'
      return `<span class="step ${done ? 'done' : ''}">${done ? '✓ ' : `${i + 1}. `}${safe(cs.label || cs.role_name || `第 ${i + 1} 關`)}</span>`
    }).join('')
    html += `<div class="sec-h">簽核流程</div><div class="chain">${stepsHtml}</div>`
  }
  if (audit.approver) {
    const label = audit.status === '已核准' ? '✓ 最終核簽人' : '退回人'
    const at = audit.approved_at ? ` · ${String(audit.approved_at).slice(0, 16).replace('T', ' ')}` : ''
    html += `<div class="approver-line">${label}：${safe(audit.approver)}${at}</div>`
  }
  if (audit.reject_reason) {
    html += `<div class="reject-box"><b>退回原因：</b>${safe(audit.reject_reason)}</div>`
  }
  return html
}

function renderPhotos(photos) {
  const imgs = (photos || []).filter(u => /\.(jpe?g|png|webp|heic|heif|gif|bmp)(\?|$)/i.test(u))
  if (imgs.length === 0) return ''
  const items = imgs.map((url, i) =>
    `<div class="photo-item"><img src="${safe(url)}" alt="照片 ${i + 1}" onerror="this.style.display='none'" /></div>`).join('')
  return `<div class="sec-h">稽核照片（${imgs.length}）</div><div class="photos">${items}</div>`
}

function renderStatusBadge(status) {
  if (!status) return ''
  const map = {
    '草稿': 'draft', '待確認': 'applying', '申請中': 'applying',
    '已核准': 'approved', '已退回': 'rejected', '已駁回': 'rejected',
  }
  const cls = map[status] || 'applying'
  return `<span class="status-pill ${cls}">${safe(status)}</span>`
}

function safe(s) {
  if (s == null) return ''
  return String(s).replace(/[<>&"']/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
