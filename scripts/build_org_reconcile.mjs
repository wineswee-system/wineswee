// 把新組織圖的 86 人 vs DB 既有 104 人對照，輸出最終決策表
// 不動 role / permission，純粹做「人」資料對照
//
// 產出：docs/ORG_RECONCILE_2026-05-04.md
//   - Section A: 86 人最終決策（INSERT / UPDATE-keep / UPDATE-rename）
//   - Section B: 要刪的 DB row（雙胞胎多餘 / typo 同人 / 真離職 / 測試帳號）
//   - Section C: 影響 LINE/auth 綁定的 id 清單

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 1. 載入 DB 既有員工 ──
const raw = readFileSync(join(ROOT, '.tmp_db_employees.json'), 'utf8')
const dbEmployees = JSON.parse(raw.slice(raw.indexOf('{'))).rows.map(r => r.row)
const dbById = new Map(dbEmployees.map(e => [e.id, e]))

// 建索引：name → row(s)
const byName = new Map()
for (const e of dbEmployees) {
  if (!byName.has(e.name)) byName.set(e.name, [])
  byName.get(e.name).push(e)
}

// ── 2. 已知 LINE/auth 綁定 (來自 SYSTEM_SNAPSHOT_2026-05-04_pre_rebuild.md) ──
const LINE_BOUND_IDS = new Set([10, 44, 48, 52, 58, 62, 148, 152])
const AUTH_BOUND_IDS = new Set([10, 44, 48, 52, 58, 62, 148, 152, 204, 205])

// ── 3. 新組織圖：86 人，含明確決策 ──
// keepId = 強制使用此 DB id（保留 LINE/auth）
// deleteIds = 要刪的雙胞胎 / typo row
// rename = true 表示要 UPDATE DB row 的 name
const newOrg = [
  // ── 外部接案部門 ──
  { zh: 'Snow',   en: 'Snow',      dept: '外部接案', position: '資深工程師', store: null, type: 'N/A', note: '外部接案 super_admin', keepId: 44 },
  { zh: '洪伯嘉', en: 'Aska Hung', dept: '外部接案', position: '資深工程師', store: null, type: 'N/A', note: '外部接案 super_admin', keepId: 10 },

  // ── 總經理室 + dept heads ──
  { zh: '韓虎',   en: 'Dave',   dept: '財務部',     position: '部門主管', store: null, type: '全職', note: '兼總經理室；DB id=48 改名韓虎，merge 創辦人 id=55', keepId: 48, deleteIds: [55], rename: true },
  { zh: '陳虹',   en: 'Zoey',   dept: '品牌行銷部', position: '部門主管', store: null, type: '全職', note: '兼總經理室；保留有 LINE 的 id=52', keepId: 52, deleteIds: [56] },
  { zh: '林巧玉', en: 'Cheery', dept: '加盟事業部', position: '部門主管', store: null, type: '全職', note: 'merge typo Cherry id=144',                          keepId: 60, deleteIds: [144] },
  { zh: '詹建如', en: 'Anita',  dept: '採購部',     position: '部門主管', store: null, type: '全職', note: '保留主管 id=145，刪 id=46 + typo 詹健如 id=70',  keepId: 145, deleteIds: [46, 70] },
  { zh: '張庭瑋', en: 'Vicky',  dept: '營運部',     position: '部門主管', store: null, type: '全職', note: '兼營運一課督導 + 高雄中正店長；保留有 LINE 的 id=62', keepId: 62, deleteIds: [50, 147] },
  { zh: '張啟達', en: 'Danny',  dept: '人力資源部', position: '部門主管', store: null, type: '全職', note: '保留有 LINE 的 id=152', keepId: 152, deleteIds: [57] },
  { zh: '劉雅玲', en: 'Fraya',  dept: '稽核室',     position: '部門主管', store: null, type: '全職', note: '',                                            keepId: 68 },
  { zh: '楊家謙', en: '',       dept: '倉儲物流部', position: '部門主管', store: null, type: '全職', note: '',                                            keepId: 72 },
  { zh: '楊學文', en: '',       dept: '總務部',     position: '部門主管', store: null, type: '全職', note: '保留主管 id=153，刪 typo 學文 id=53 + 專員 id=69', keepId: 153, deleteIds: [53, 69] },

  // ── 部門員工 ──
  { zh: '張開翔', en: 'Ken',   dept: '品牌行銷部', position: '部員', store: null, type: '全職', note: '保留中文 id=65，刪另一個 Ken id=49 (門市人員)', keepId: 65, deleteIds: [49] },
  { zh: '林襄',   en: 'Sunny', dept: '品牌行銷部', position: '部員', store: null, type: '全職', note: '' },
  { zh: '徐其祥', en: 'Mark',  dept: '品牌行銷部', position: '部員', store: null, type: '全職', note: '',                                          keepId: 64 },
  { zh: '陳佩璇', en: 'Alica', dept: '財務部',     position: '部員', store: null, type: '全職', note: '注意：DB 拼 Alicia, 圖上 Alica',           keepId: 71 },
  { zh: '游如梅', en: 'Grace', dept: '財務部',     position: '部員', store: null, type: '全職', note: '保留有英文 Grace 的 id=151',              keepId: 151 },
  { zh: '尤致皓', en: 'Max',   dept: '人力資源部', position: '部員', store: null, type: '全職', note: '保留有 LINE 的 id=58',                    keepId: 58 },
  { zh: '陳楷仁', en: 'Kevin', dept: '人力資源部', position: '部員', store: null, type: '全職', note: '' },
  { zh: '李英顯', en: 'Ivan',  dept: '倉儲物流部', position: '部員', store: null, type: '全職', note: 'rename from 李英穎 id=59 + 補英文 Ivan',  keepId: 59,  rename: true },
  { zh: '朱紹蕾', en: '',      dept: '倉儲物流部', position: '部員', store: null, type: '全職', note: 'rename from 朱紹蓉 id=73',                keepId: 73,  rename: true },

  // ── 營運部督導 / 區域店長 ──
  { zh: '黃蘊珊', en: 'Molly', dept: '營運部', position: '督導',     store: null, type: '全職', note: '保留有 LINE 的 id=148，刪 typo 黃瑀珊 id=63', keepId: 148, deleteIds: [63] },
  { zh: '陳嘉益', en: 'Tako',  dept: '營運部', position: '區域店長', store: null, type: '全職', note: '營運三課',                                  keepId: 141 },
  { zh: '羅紹輝', en: 'Jack',  dept: '營運部', position: '督導',     store: null, type: '全職', note: '研發暨品管課' },
  { zh: '趙亭威', en: 'Willy', dept: '營運部', position: '店長',     store: '台中英才', type: '全職', note: '同時兼台中文心店長',              keepId: 134 },

  // ── 店長 ──
  { zh: '周佳霖', en: '', dept: '營運部', position: '店長', store: '南京建國', type: '全職', note: '', keepId: 113 },
  { zh: '鍾喬',   en: '', dept: '營運部', position: '店長', store: '中信南港', type: '全職', note: '', keepId: 107 },
  { zh: '劉家君', en: '', dept: '營運部', position: '店長', store: '中山國小', type: '全職', note: '', keepId: 75 },
  { zh: '高承揚', en: '', dept: '營運部', position: '店長', store: '微風廣場', type: '全職', note: '', keepId: 94 },

  // ── 店員 (29 全職 + 29 兼職) ──
  // 台中英才
  { zh: '馮千瑜', en: '', dept: '營運部', position: '店員', store: '台中英才', type: '全職', note: '', keepId: 84 },
  { zh: '楊朝鈞', en: '', dept: '營運部', position: '店員', store: '台中英才', type: '全職', note: 'rename from 楊昭鈞 id=83', keepId: 83, rename: true },
  { zh: '潘琦',   en: '', dept: '營運部', position: '店員', store: '台中英才', type: '兼職', note: '', keepId: 86 },
  { zh: '柯雨晶', en: '', dept: '營運部', position: '店員', store: '台中英才', type: '兼職', note: '', keepId: 87 },
  // 台中文心
  { zh: '張惠萍', en: '', dept: '營運部', position: '店員', store: '台中文心', type: '全職', note: '', keepId: 136 },
  { zh: '廖晉呈', en: '', dept: '營運部', position: '店員', store: '台中文心', type: '全職', note: '', keepId: 135 },
  { zh: '張家禎', en: '', dept: '營運部', position: '店員', store: '台中文心', type: '全職', note: '', keepId: 74 },
  { zh: '廖庭樟', en: '', dept: '營運部', position: '店員', store: '台中文心', type: '兼職', note: '', keepId: 140 },
  // 高雄中正
  { zh: '張耀',   en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '全職', note: '', keepId: 119 },
  { zh: '林家民', en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '全職', note: '', keepId: 120 },
  { zh: '許育瑄', en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '全職', note: '', keepId: 123 },
  { zh: '温子杰', en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '全職', note: 'rename from 溫子杰 id=122 (unicode 異體)', keepId: 122, rename: true },
  { zh: '陳涵妮', en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '兼職', note: '', keepId: 124 },
  { zh: '陳富琦', en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '兼職', note: '', keepId: 125 },
  { zh: '江建賦', en: '', dept: '營運部', position: '店員', store: '高雄中正', type: '兼職', note: '', keepId: 121 },
  // Mla
  { zh: '蘇東俞', en: '', dept: '營運部', position: '店員', store: 'Mla', type: '全職', note: '刪 typo 蘇東瑜 id=146', keepId: 139, deleteIds: [146] },
  // 南京建國
  { zh: '詹怡理', en: '', dept: '營運部', position: '店員', store: '南京建國', type: '全職', note: '', keepId: 116 },
  { zh: '王竣禾', en: '', dept: '營運部', position: '店員', store: '南京建國', type: '全職', note: '', keepId: 114 },
  { zh: '施怡廷', en: '', dept: '營運部', position: '店員', store: '南京建國', type: '全職', note: '', keepId: 115 },
  { zh: '阮玉安', en: '', dept: '營運部', position: '店員', store: '南京建國', type: '兼職', note: '', keepId: 118 },
  // 中信南港
  { zh: '陳芮葵', en: '', dept: '營運部', position: '店員', store: '中信南港', type: '全職', note: '', keepId: 109 },
  { zh: '王育晨', en: '', dept: '營運部', position: '店員', store: '中信南港', type: '全職', note: '', keepId: 108 },
  { zh: '黃瑋晴', en: '', dept: '營運部', position: '店員', store: '中信南港', type: '兼職', note: '', keepId: 110 },
  { zh: '王萱之', en: '', dept: '營運部', position: '店員', store: '中信南港', type: '兼職', note: '', keepId: 111 },
  { zh: '邱翊瑄', en: '', dept: '營運部', position: '店員', store: '中信南港', type: '兼職', note: '', keepId: 112 },
  { zh: '莫徐浩', en: '', dept: '營運部', position: '店員', store: '中信南港', type: '兼職', note: '' },
  // 中山國小
  { zh: '黃為燁', en: '', dept: '營運部', position: '店員', store: '中山國小', type: '全職', note: '', keepId: 80 },
  { zh: '邱婕涵', en: '', dept: '營運部', position: '店員', store: '中山國小', type: '全職', note: '' },
  { zh: '許辰',   en: '', dept: '營運部', position: '店員', store: '中山國小', type: '兼職', note: '', keepId: 81 },
  { zh: '莊浩隆', en: '', dept: '營運部', position: '店員', store: '中山國小', type: '兼職', note: '', keepId: 79 },
  { zh: '王澤昇', en: '', dept: '營運部', position: '店員', store: '中山國小', type: '兼職', note: '', keepId: 78 },
  { zh: '林則宇', en: '', dept: '營運部', position: '店員', store: '中山國小', type: '兼職', note: '', keepId: 77 },
  // 微風廣場
  { zh: '林孟豪', en: '', dept: '營運部', position: '店員', store: '微風廣場', type: '全職', note: '圖標全職、DB 為兼職 → 改全職', keepId: 99 },
  { zh: '沈怡臻', en: '', dept: '營運部', position: '店員', store: '微風廣場', type: '全職', note: '' },
  { zh: '吳承祐', en: '', dept: '營運部', position: '店員', store: '微風廣場', type: '全職', note: '', keepId: 95 },
  { zh: '李欣霏', en: '', dept: '營運部', position: '店員', store: '微風廣場', type: '兼職', note: '', keepId: 98 },
  { zh: '林豫賢', en: '', dept: '營運部', position: '店員', store: '微風廣場', type: '兼職', note: '', keepId: 100 },
  // 松江長安
  { zh: '陳羽庭', en: '', dept: '營運部', position: '店員', store: '松江長安', type: '全職', note: '圖標全職、DB 為兼職 → 改全職', keepId: 133 },
  { zh: '呂柏毅', en: '', dept: '營運部', position: '店員', store: '松江長安', type: '全職', note: '', keepId: 130 },
  { zh: '蕭佑庭', en: '', dept: '營運部', position: '店員', store: '松江長安', type: '全職', note: '', keepId: 129 },
  { zh: '孫嘉澤', en: '', dept: '營運部', position: '店員', store: '松江長安', type: '全職', note: '', keepId: 131 },
  { zh: '王莉庭', en: '', dept: '營運部', position: '店員', store: '松江長安', type: '兼職', note: '', keepId: 132 },
  { zh: '張彥婷', en: '', dept: '營運部', position: '店員', store: '松江長安', type: '兼職', note: '' },
  // 天母百貨
  { zh: '潘胤傑', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '全職', note: '', keepId: 101 },
  { zh: '戴羿弘', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '全職', note: '', keepId: 102 },
  { zh: '曲相澐', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '兼職', note: '', keepId: 104 },
  { zh: '李建廷', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '兼職', note: '', keepId: 105 },
  { zh: '李忠霖', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '兼職', note: '', keepId: 106 },
  { zh: '余盈軒', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '兼職', note: '', keepId: 143 },
  { zh: '黃慈微', en: '', dept: '營運部', position: '店員', store: '天母百貨', type: '兼職', note: '' },
  // 六張犁
  { zh: '郭芷如', en: '', dept: '營運部', position: '店員', store: '六張犁', type: '全職', note: '', keepId: 127 },
  { zh: '劉萱',   en: '', dept: '營運部', position: '店員', store: '六張犁', type: '兼職', note: '', keepId: 128 },
  // 台北永春
  { zh: '許亦翎', en: '', dept: '營運部', position: '店員', store: '台北永春', type: '全職', note: '', keepId: 89 },
  { zh: '徐宥芯', en: '', dept: '營運部', position: '店員', store: '台北永春', type: '全職', note: '', keepId: 90 },
  { zh: '洪瑛奴', en: '', dept: '營運部', position: '店員', store: '台北永春', type: '兼職', note: 'rename from 洪瑛妏 id=92', keepId: 92, rename: true },
  { zh: '蔡伊真', en: '', dept: '營運部', position: '店員', store: '台北永春', type: '兼職', note: '', keepId: 93 },
  { zh: '林思妤', en: '', dept: '營運部', position: '店員', store: '台北永春', type: '兼職', note: '', keepId: 142 },
  { zh: '陳姿瑩', en: '', dept: '營運部', position: '店員', store: '台北永春', type: '兼職', note: '' },
]

console.log('新組織圖總人數:', newOrg.length)

// ── 4. 計算行動 ──
// keepId 集合 = 所有 chart 上 keepId
const keepIdSet = new Set(newOrg.filter(p => p.keepId).map(p => p.keepId))

// deleteIds 集合 = 所有 chart 上明確要刪 (twin/typo)
const explicitDeleteIds = new Set(
  newOrg.flatMap(p => p.deleteIds || [])
)

// DB-only = DB 在但既不被 keep 也不被 explicitly delete
const dbOnlyIds = dbEmployees
  .filter(e => !keepIdSet.has(e.id) && !explicitDeleteIds.has(e.id))
  .map(e => e.id)

// 全部 delete = explicit + db-only
const allDeleteIds = new Set([...explicitDeleteIds, ...dbOnlyIds])

// 對 keep / 加 enrich
function enrich(p) {
  const action = !p.keepId ? 'INSERT' : (p.rename ? 'UPDATE-RENAME' : 'UPDATE')
  const dbRow = p.keepId ? dbById.get(p.keepId) : null
  return { ...p, action, dbRow }
}
const enriched = newOrg.map(enrich)

// 安全檢查：LINE_BOUND_IDS 都要保留
const lineConflicts = [...LINE_BOUND_IDS].filter(id => allDeleteIds.has(id))
const authConflicts = [...AUTH_BOUND_IDS].filter(id => allDeleteIds.has(id) && id !== 204 && id !== 205)
// 204/205 是測試帳號，特別允許刪

// ── 5. 輸出 markdown ──
let md = `# 新組織圖 vs DB 對照表（最終版）\n\n生成時間：${new Date().toISOString()}\n\n`
md += `## 📊 總覽\n\n`
md += `- 新組織總人數：${newOrg.length}\n`
md += `- DB 既有在職：${dbEmployees.length}\n`
md += `- 預計 INSERT 新人數：${enriched.filter(p => p.action === 'INSERT').length}\n`
md += `- 預計 UPDATE 既有 row：${enriched.filter(p => p.action.startsWith('UPDATE')).length}\n`
md += `- 預計 DELETE row 數：${allDeleteIds.size}\n\n`

if (lineConflicts.length > 0) {
  md += `## ⚠️ 警告：以下 LINE 綁定 id 將被刪除！\n\n`
  for (const id of lineConflicts) {
    const r = dbById.get(id)
    md += `- id=${id} ${r?.name} (${r?.dept}) ❌\n`
  }
  md += `\n`
}
if (authConflicts.length > 0) {
  md += `## ⚠️ 警告：以下 auth 綁定 id 將被刪除（非測試帳號）！\n\n`
  for (const id of authConflicts) {
    const r = dbById.get(id)
    md += `- id=${id} ${r?.name} (${r?.dept}) ❌\n`
  }
  md += `\n`
}
if (lineConflicts.length === 0 && authConflicts.length === 0) {
  md += `## ✅ 安全檢查通過\n\n`
  md += `- 所有 8 個 LINE 綁定 id (${[...LINE_BOUND_IDS].sort((a,b)=>a-b).join(', ')}) 都會保留\n`
  md += `- 8 個正式 auth 綁定 id 都會保留（測試帳號 204/205 故意刪）\n\n`
}

md += `---\n\n## 👥 Section A — 新組織 ${newOrg.length} 人最終決策\n\n`
md += `| # | 中文 | 英文 | 部門 | 職位 | 門市 | 類型 | 動作 | DB id | 備註 |\n`
md += `|---|---|---|---|---|---|---|---|---|---|\n`

const actionEmoji = {
  'INSERT': '🆕 INSERT',
  'UPDATE': '✏️ UPDATE',
  'UPDATE-RENAME': '🔄 UPDATE+改名',
}

for (let i = 0; i < enriched.length; i++) {
  const p = enriched[i]
  md += `| ${i+1} | ${p.zh} | ${p.en || '–'} | ${p.dept} | ${p.position} | ${p.store || '–'} | ${p.type} | ${actionEmoji[p.action]} | ${p.keepId || '(new)'} | ${p.note} |\n`
}

md += `\n---\n\n## 🚪 Section B — 要刪掉的 ${allDeleteIds.size} 個 DB row\n\n`
md += `### B-1. 雙胞胎 / typo merge 多餘 row (${explicitDeleteIds.size} 筆)\n\n`
md += `| id | 中文 | 英文 | 部門 | 職位 | 為何刪 |\n`
md += `|---|---|---|---|---|---|\n`
for (const id of [...explicitDeleteIds].sort((a,b)=>a-b)) {
  const r = dbById.get(id)
  if (!r) continue
  // 找出歸屬到哪個 chart 人
  const owner = newOrg.find(p => (p.deleteIds || []).includes(id))
  const reason = owner ? `合併到 ${owner.zh} (id=${owner.keepId})` : '?'
  md += `| ${id} | ${r.name} | ${r.name_en || '–'} | ${r.dept || '–'} | ${r.position || '–'} | ${reason} |\n`
}

md += `\n### B-2. 真離職 / 測試帳號 / 漏列 (${dbOnlyIds.length} 筆)\n\n`
md += `| id | 中文 | 英文 | 部門 | 職位 | 員工類型 |\n`
md += `|---|---|---|---|---|---|\n`
for (const id of dbOnlyIds.sort((a,b)=>a-b)) {
  const e = dbById.get(id)
  md += `| ${id} | ${e.name} | ${e.name_en || '–'} | ${e.dept || '–'} | ${e.position || '–'} | ${e.employment_type || '–'} |\n`
}

md += `\n---\n\n## 🔗 Section C — 重建後待重接的綁定（待你提供配對）\n\n`
md += `### C-1. LINE 綁定 8 人（id 不變，無需動作；除非更換 LINE 帳號）\n\n`
md += `| 保留 id | 員工 | line_user_id |\n`
md += `|---|---|---|\n`
const LINE_BINDINGS = {
  152: { name: 'Danny',   line: 'U74898dbf233f49d44990bc3757464224' },
  48:  { name: 'Dave',    line: 'Ua9eabab39ba6daec5f0228fa8ba2c23d' },
  148: { name: 'Molly',   line: 'U951e75c74af725a46ddccca15d5f10d2' },
  44:  { name: 'Snow',    line: 'Ub261da23e4c20b180f1d283c71d4f1e2' },
  52:  { name: 'Zoey',    line: 'U420564e6a7cae7ceb6fe377585e5f781' },
  58:  { name: '尤致皓',  line: 'U6a8a5c5a7011ce5d5cd1d03c668d26fb' },
  62:  { name: '張庭瑋',  line: 'U17ad006a80fba75564d029b54f998518' },
  10:  { name: '洪伯嘉',  line: 'U5075609bee562b1ab92f41e746b98fcc' },
}
for (const [id, info] of Object.entries(LINE_BINDINGS)) {
  md += `| ${id} | ${info.name} | \`${info.line}\` |\n`
}

md += `\n### C-2. 待你提供配對：新加入的 chart 人是否要綁 LINE\n\n`
md += `INSERT 進來的 ${enriched.filter(p => p.action === 'INSERT').length} 個新人，重建完後請告訴我:\n`
md += `1. 哪幾位需要綁 LINE → 提供他們的 line_user_id\n`
md += `2. 哪幾位需要 Supabase Auth 帳號 → 走標準 invite-employee 流程\n\n`

writeFileSync(join(ROOT, 'docs/ORG_RECONCILE_2026-05-04.md'), md)
console.log('Wrote: docs/ORG_RECONCILE_2026-05-04.md')
console.log('Action breakdown:')
const breakdown = enriched.reduce((acc, p) => {
  acc[p.action] = (acc[p.action] || 0) + 1
  return acc
}, {})
console.log(' ', breakdown)
console.log('  DELETE total:', allDeleteIds.size, `(explicit ${explicitDeleteIds.size} + db-only ${dbOnlyIds.length})`)
console.log('  LINE conflicts:', lineConflicts.length, lineConflicts.length ? '⚠️' : '✅')
console.log('  AUTH conflicts:', authConflicts.length, authConflicts.length ? '⚠️' : '✅')
