// 共用：新組織圖 86 人 + 部門/門市映射 + 已知綁定
// 被 build_org_reconcile.mjs 跟 build_org_migration.mjs 共用

// 部門名稱 → id 映射（DB 有重複名稱，這裡用實際在用的那組 19~28）
export const DEPT_NAME_TO_ID = {
  '總經理室': 19,
  '加盟展店事業部': 20,
  '加盟事業部': 20,           // 圖上稱呼，等同 加盟展店事業部
  '採購部': 21,
  'Mia門店': 22,
  '營運部': 23,
  '品牌行銷部': 24,
  '財務部': 25,
  '人力資源部': 26,
  '總務部': 27,
  '倉儲物流部': 28,
  // 以下 migration 會新建
  '外部接案': null,
  '稽核室': null,
}

// 門市名稱 → id 映射
export const STORE_NAME_TO_ID = {
  '南京建國': 24,
  '中信南港': 25,
  '台中英才': 26,
  '台中文心': 27,
  '高雄中正': 28,
  '中山國小': 29,
  '微風廣場': 30,
  '台北永春': 31,
  '天母百貨': 32,
  '六張犁':   33,
  '松江長安': 34,
  'Mla':      19,  // = mia門店
}

// LINE / auth 綁定（不能誤刪這些 id）
export const LINE_BOUND_IDS = new Set([10, 44, 48, 52, 58, 62, 148, 152])
export const AUTH_BOUND_IDS_PROD = new Set([10, 44, 48, 52, 58, 62, 148, 152])
export const AUTH_BOUND_IDS_TEST = new Set([204, 205])

export const LINE_BINDINGS = {
  152: { name: 'Danny',   line: 'U74898dbf233f49d44990bc3757464224' },
  48:  { name: 'Dave',    line: 'Ua9eabab39ba6daec5f0228fa8ba2c23d' },
  148: { name: 'Molly',   line: 'U951e75c74af725a46ddccca15d5f10d2' },
  44:  { name: 'Snow',    line: 'Ub261da23e4c20b180f1d283c71d4f1e2' },
  52:  { name: 'Zoey',    line: 'U420564e6a7cae7ceb6fe377585e5f781' },
  58:  { name: '尤致皓',  line: 'U6a8a5c5a7011ce5d5cd1d03c668d26fb' },
  62:  { name: '張庭瑋',  line: 'U17ad006a80fba75564d029b54f998518' },
  10:  { name: '洪伯嘉',  line: 'U5075609bee562b1ab92f41e746b98fcc' },
}

// ── 新組織圖：86 人，含明確決策 ──
// keepId       = 強制使用此 DB id（保留 LINE/auth）
// deleteIds    = 要 soft-delete 的雙胞胎 / typo row
// rename       = true 表示要 UPDATE DB row 的 name (從舊 typo 改為 chart 上)
// keepPosition = true 表示保留 DB 既有 position 欄位 (預設 true)
export const NEW_ORG = [
  // ── 外部接案部門 ──
  { zh: 'Snow',   en: 'Snow',      dept: '外部接案', position: '資深工程師', store: null, type: 'N/A', note: '外部接案 super_admin', keepId: 44 },
  { zh: '洪伯嘉', en: 'Aska Hung', dept: '外部接案', position: '資深工程師', store: null, type: 'N/A', note: '外部接案 super_admin', keepId: 10 },

  // ── 總經理室 + dept heads ──
  { zh: '韓虎',   en: 'Dave',   dept: '財務部',     position: '部門主管', store: null, type: '全職', note: '兼總經理室；DB id=48 改名韓虎，merge 創辦人 id=55', keepId: 48, deleteIds: [55], rename: true },
  { zh: '陳虹',   en: 'Zoey',   dept: '品牌行銷部', position: '部門主管', store: null, type: '全職', note: '兼總經理室；保留有 LINE 的 id=52',                  keepId: 52, deleteIds: [56] },
  { zh: '林巧玉', en: 'Cheery', dept: '加盟事業部', position: '部門主管', store: null, type: '全職', note: 'merge typo Cherry id=144',                          keepId: 60, deleteIds: [144] },
  { zh: '詹建如', en: 'Anita',  dept: '採購部',     position: '部門主管', store: null, type: '全職', note: '保留主管 id=145，刪 id=46 + typo 詹健如 id=70',     keepId: 145, deleteIds: [46, 70] },
  { zh: '張庭瑋', en: 'Vicky',  dept: '營運部',     position: '部門主管', store: null, type: '全職', note: '兼營運一課督導 + 高雄中正店長；保留有 LINE 的 id=62', keepId: 62, deleteIds: [50, 147] },
  { zh: '張啟達', en: 'Danny',  dept: '人力資源部', position: '部門主管', store: null, type: '全職', note: '保留有 LINE 的 id=152',                              keepId: 152, deleteIds: [57] },
  { zh: '劉雅玲', en: 'Fraya',  dept: '稽核室',     position: '部門主管', store: null, type: '全職', note: '',                                                  keepId: 68 },
  { zh: '楊家謙', en: '',       dept: '倉儲物流部', position: '部門主管', store: null, type: '全職', note: '',                                                  keepId: 72 },
  { zh: '楊學文', en: '',       dept: '總務部',     position: '部門主管', store: null, type: '全職', note: '保留主管 id=153，刪 typo 學文 id=53 + 專員 id=69',   keepId: 153, deleteIds: [53, 69] },

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

  // ── 店員 ──
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
