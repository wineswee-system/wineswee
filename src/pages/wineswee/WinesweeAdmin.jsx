import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { STATIC, applyLocal, backfillNews, ensureNews, ensureDetails } from './content'
import { CATEGORIES, CAT_LABEL, CAT_META_KEYS, getCatMeta, mergeSite, SECTION_LABELS, classifyName, BANNERS_DEFAULT } from './data'
import RichEditor from './RichEditor'
import './wineswee-admin.css'

const getIn = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
function setIn(obj, path, val) {
  const keys = path.split('.'); const out = Array.isArray(obj) ? [...obj] : { ...(obj || {}) }
  let cur = out
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    cur[k] = (cur[k] && typeof cur[k] === 'object') ? (Array.isArray(cur[k]) ? [...cur[k]] : { ...cur[k] }) : {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = val
  return out
}
const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)))

const NAV = [
  { key: 'dashboard', label: '儀表板' },
  { key: 'products', label: '商品', sec: ['products', 'details'] },
  { key: 'news', label: '最新消息', sec: ['news'] },
  { key: 'stores', label: '門市', sec: ['stores'] },
  { key: 'appearance', label: '首頁・外觀', sec: ['site'] },
  { key: 'layout', label: '版面設計', sec: ['site'] },
  { key: 'media', label: '媒體庫' },
  { key: 'settings', label: '設定', sec: ['site'] },
]
const REGIONS = ['台北', '新北', '台中', '高雄', '桃園', '台南', '其他']
const bucket = () => supabase.storage.from('wineswee-media')

// 圖片欄位:上傳到 Storage 或貼網址
function Img({ value, onChange, upload, small }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className={'wa-img' + (small ? ' sm' : '')}>
      <div className="wa-img-thumb">{value ? <img src={value} alt="" /> : <span>無圖</span>}</div>
      <div className="wa-img-ctl">
        <label className="wa-btn wa-btn-ghost">
          {busy ? '上傳中…' : '＋ 上傳'}
          <input type="file" accept="image/*" hidden onChange={async e => {
            const f = e.target.files?.[0]; if (!f) return; setBusy(true)
            const url = await upload(f); setBusy(false); if (url) onChange(url); e.target.value = ''
          }} />
        </label>
        <input className="wa-input" placeholder="或貼圖片網址" value={value || ''} onChange={e => onChange(e.target.value)} />
      </div>
    </div>
  )
}

// 版面編輯:每張圖是一個框,拖右邊調寬度、即時預覽版面,可上傳/排序/刪
function GalleryEditor({ images, onChange, upload }) {
  const gridRef = useRef(null)
  const list = (images || []).map(x => typeof x === 'string' ? { src: x, w: 100 } : { src: x?.src || '', w: x?.w || 100 })
  const commit = arr => onChange(arr.map(x => (x.w >= 100 ? x.src : { src: x.src, w: x.w })))
  const setAt = (i, patch) => commit(list.map((x, j) => j === i ? { ...x, ...patch } : x))
  const move = (i, d) => { const L = [...list]; const j = i + d; if (j < 0 || j >= L.length) return;[L[i], L[j]] = [L[j], L[i]]; commit(L) }
  const startResize = (i, e) => {
    e.preventDefault()
    const gw = gridRef.current?.offsetWidth || 800
    const startX = e.clientX, startW = list[i].w
    const onMove = ev => { let w = Math.round((startW + (ev.clientX - startX) / gw * 100) / 5) * 5; w = Math.max(20, Math.min(100, w)); setAt(i, { w }) }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  return (
    <div className="ge">
      <div className="ge-grid" ref={gridRef}>
        {list.map((im, i) => (
          <div className="ge-item" style={{ width: `calc(${im.w}% - ${im.w < 100 ? 6 : 0}px)` }} key={i}>
            <div className="ge-frame">
              {im.src
                ? <img src={im.src} alt="" />
                : <label className="ge-empty ge-up">＋ 點此選圖<input type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await upload(f); if (url) setAt(i, { src: url }); e.target.value = '' }} /></label>}
              <span className="ge-handle" onMouseDown={e => startResize(i, e)} title="拖曳調整寬度" />
            </div>
            <div className="ge-bar">
              <span className="ge-badge">{im.w}%</span>
              <div className="ge-wbtns">
                <button type="button" className={im.w >= 100 ? 'on' : ''} onClick={() => setAt(i, { w: 100 })}>全寬</button>
                <button type="button" className={im.w === 50 ? 'on' : ''} title="兩張並排" onClick={() => setAt(i, { w: 50 })}>½ 並排</button>
                <button type="button" className={im.w === 33 ? 'on' : ''} title="三張一排" onClick={() => setAt(i, { w: 33 })}>⅓</button>
              </div>
              <span className="ge-sp" />
              <label className="ge-mini ge-upbtn" title="上傳/更換圖片">選圖<input type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await upload(f); if (url) setAt(i, { src: url }); e.target.value = '' }} /></label>
              <button type="button" className="ge-mini" title="左移" onClick={() => move(i, -1)} disabled={i === 0}>←</button>
              <button type="button" className="ge-mini" title="右移" onClick={() => move(i, 1)} disabled={i === list.length - 1}>→</button>
              <button type="button" className="ge-mini ge-del" title="刪除" onClick={() => commit(list.filter((_, j) => j !== i))}>✕</button>
            </div>
            <input className="wa-input ge-url" placeholder="圖片網址" value={im.src} onChange={e => setAt(i, { src: e.target.value })} />
          </div>
        ))}
      </div>
      <button className="wa-btn wa-btn-ghost" onClick={() => commit([...list, { src: '', w: 100 }])}>＋ 加一張圖</button>
    </div>
  )
}

// 自由畫布:圖片絕對定位,可拖曳移動、拖右下角縮放
function CanvasEditor({ board, onChange, upload }) {
  const ref = useRef(null)
  const [sel, setSel] = useState(null)
  const ah = board?.ah || 1.3
  const items = board?.items || []
  const setItems = its => onChange({ ah, items: its })
  const setAt = (i, patch) => setItems(items.map((x, j) => j === i ? { ...x, ...patch } : x))
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const drag = (i, e, mode) => {
    e.preventDefault(); e.stopPropagation(); setSel(i)
    const rect = ref.current.getBoundingClientRect()
    const s = { mx: e.clientX, my: e.clientY, x: items[i].x, y: items[i].y, w: items[i].w }
    const onMove = ev => {
      const dxp = (ev.clientX - s.mx) / rect.width * 100, dyp = (ev.clientY - s.my) / rect.height * 100
      if (mode === 'move') setAt(i, { x: clamp(s.x + dxp, 0, 99), y: clamp(s.y + dyp, 0, 99) })
      else setAt(i, { w: clamp(s.w + dxp, 5, 100) })
    }
    const up = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', up)
  }
  // 緊排:保留每張的 X/寬,把「列」由上而下貼齊(消白縫),並自動把畫布高調到剛好包住內容
  const pack = () => {
    const box = ref.current; if (!box) return
    const rect = box.getBoundingClientRect()
    const nodes = [...box.querySelectorAll('.cv-item')]
    if (!nodes.length || nodes.some(n => !n.offsetHeight)) { alert('圖片還在載入,等圖都出來再按一次「緊排」'); return }
    const order = [...items.keys()].sort((a, b) => (items[a].y - items[b].y) || (items[a].x - items[b].x))
    const rows = []
    for (const idx of order) {
      const last = rows[rows.length - 1]
      if (!last || items[idx].y - last.y0 > 8) rows.push({ y0: items[idx].y, idxs: [idx] })   // 差 8% 內視為同一列
      else last.idxs.push(idx)
    }
    const GAP = 10, yPx = {}; let top = 0
    for (const row of rows) {
      let rowH = 0
      for (const idx of row.idxs) { yPx[idx] = top; rowH = Math.max(rowH, nodes[idx].offsetHeight) }
      top += rowH + GAP
    }
    const totalH = Math.max(1, top - GAP)
    const newAh = Math.max(0.3, Math.round(totalH / rect.width * 100) / 100)
    const newItems = items.map((it, idx) => ({ ...it, y: Math.round(yPx[idx] / totalH * 1000) / 10 }))
    onChange({ ah: newAh, items: newItems }); setSel(null)
  }
  return (
    <div className="cv-wrap">
      <div className="cv-toolbar">
        <button className="wa-btn wa-btn-ghost" onClick={() => { setItems([...items, { src: '', x: 4, y: 4, w: 40 }]); setSel(items.length) }}>＋ 加圖</button>
        <button className="wa-btn wa-btn-ghost" onClick={pack} title="每一列往上貼齊、消掉白縫,並自動調整畫布高">緊排（消白縫）</button>
        <label className="cv-h">畫布高（寬的<input type="number" step="0.1" min="0.3" max="12" value={ah} onChange={e => onChange({ ah: Math.max(0.3, +e.target.value || 1), items })} style={{ width: 58 }} />倍）</label>
        {sel != null && items[sel] && (() => {
          const it = items[sel]
          const setN = (k, v) => setAt(sel, { [k]: clamp(+v || 0, k === 'w' ? 5 : 0, 100) })
          return (
            <span className="cv-selbar">
              <b>選取的圖：</b>
              <label className="cv-num">X<input type="number" value={Math.round(it.x)} onChange={e => setN('x', e.target.value)} />%</label>
              <label className="cv-num">Y<input type="number" value={Math.round(it.y)} onChange={e => setN('y', e.target.value)} />%</label>
              <label className="cv-num">寬<input type="number" value={Math.round(it.w)} onChange={e => setN('w', e.target.value)} />%</label>
              <label className="wa-btn wa-btn-ghost">換圖<input type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const u = await upload(f); if (u) setAt(sel, { src: u }); e.target.value = '' }} /></label>
              <input className="wa-input" style={{ maxWidth: 160 }} placeholder="或貼網址" value={it.src} onChange={e => setAt(sel, { src: e.target.value })} />
              <button className="wa-del sm" onClick={() => { setItems(items.filter((_, j) => j !== sel)); setSel(null) }}>刪除</button>
            </span>
          )
        })()}
      </div>
      <div className="cv" ref={ref} style={{ aspectRatio: '1 / ' + ah }} onMouseDown={() => setSel(null)}>
        <div className="cv-inner">
          {items.map((im, i) => (
            <div className={'cv-item' + (sel === i ? ' sel' : '')} style={{ left: im.x + '%', top: im.y + '%', width: im.w + '%' }} key={i} onMouseDown={e => drag(i, e, 'move')}>
              {im.src ? <img src={im.src} alt="" draggable="false" /> : <div className="cv-empty">空框（選取後按上方「換圖」）</div>}
              <span className="cv-resize" onMouseDown={e => drag(i, e, 'resize')} title="拖曳縮放" />
            </div>
          ))}
        </div>
      </div>
      <div className="wa-hint">拖圖移動、拖右下角 ◢ 縮放；點空白處取消選取。滑桿調整整體畫布高低。手機會等比例縮放顯示。</div>
    </div>
  )
}

const toBoard = imgs => {
  const arr = imgs || []
  const n = arr.length || 1
  const rows = Math.ceil(n / 2)
  const ah = Math.max(0.9, rows * 0.62)          // 依列數估畫布高,避免溢出
  const items = arr.map((im, i) => ({
    src: typeof im === 'string' ? im : im?.src || '',
    x: (i % 2) * 49 + 1, y: Math.round((Math.floor(i / 2) / rows) * 100) + 1, w: 47,
  }))
  return { ah, items }
}

export default function WinesweeAdmin() {
  const { user, profile, role } = useAuth()
  const isAdmin = ['admin', 'super_admin'].includes(profile?.role) || ['admin', 'super_admin'].includes(role?.name)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [dirty, setDirty] = useState(() => new Set())
  const [publishing, setPublishing] = useState(false)
  const [view, setView] = useState('dashboard')
  const saved = useRef(null)
  // 商品檢視狀態
  const [q, setQ] = useState(''); const [catF, setCatF] = useState('全部'); const [statF, setStatF] = useState('全部')
  const [page, setPage] = useState(0); const [sel, setSel] = useState(() => new Set()); const [editIdx, setEditIdx] = useState(null)

  useEffect(() => {
    const root = document.getElementById('root'), b = document.body, h = document.documentElement
    const prev = { z: root?.style.zoom, bo: b.style.overflow, ho: h.style.overflow }
    if (root) root.style.zoom = '1'; b.style.overflow = 'visible'; h.style.overflow = 'auto'
    return () => { if (root) root.style.zoom = prev.z || ''; b.style.overflow = prev.bo; h.style.overflow = prev.ho }
  }, [])

  useEffect(() => {
    (async () => {
      let db = null
      // 後台需要完整墊底(details/news 範本)—動態載入後再組資料
      const [, ] = await Promise.all([ensureDetails(), ensureNews()])
      try { const r = await supabase.rpc('get_wineswee_content'); db = r?.data || null } catch { db = null }
      const d = {
        products: db?.products?.length ? db.products : STATIC.products,
        details: db?.details && Object.keys(db.details).length ? db.details : STATIC.details,
        news: backfillNews(db?.news?.length ? db.news : STATIC.news, STATIC.news),
        stores: db?.stores?.length ? db.stores : STATIC.stores,
        site: db?.site || {},
      }
      setData(d); saved.current = clone(d); setLoading(false)
    })()
  }, [])

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500) }
  const patch = (section, value) => { setData(d => ({ ...d, [section]: value })); setDirty(s => new Set(s).add(section)) }

  async function publish() {
    if (!dirty.size) return
    setPublishing(true)
    for (const section of dirty) {
      const { error } = await supabase.rpc('save_wineswee_content', { _section: section, _data: data[section] })
      if (error) { setPublishing(false); return flash('err', '發布失敗：' + error.message) }
      applyLocal(section, data[section])
    }
    saved.current = clone(data); setDirty(new Set()); setPublishing(false)
    flash('ok', '已發布上線 ✓')
  }
  function discard() { setData(clone(saved.current)); setDirty(new Set()); setEditIdx(null); flash('ok', '已還原未發布的變更') }

  async function upload(file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${new Date().toISOString().slice(0, 10)}/${Math.random().toString(36).slice(2, 10)}.${ext}`
    const { error } = await bucket().upload(path, file, { cacheControl: '31536000', upsert: false })
    if (error) { flash('err', '上傳失敗：' + error.message); return null }
    return bucket().getPublicUrl(path).data.publicUrl
  }

  if (!user) return <Gate title="請先登入" body={<>後臺需登入公司系統帳號。<Link to="/" className="wa-link">前往登入 →</Link></>} />
  if (!isAdmin) return <Gate title="沒有權限" body="此頁僅限管理員（admin / super_admin）使用。" />
  if (loading || !data) return <Gate title="載入中…" body="正在讀取官網內容" />

  const products = data.products
  const topCount = products.filter(p => p.top).length
  const navTitle = NAV.find(n => n.key === view)?.label || ''

  return (
    <div className="wa2">
      <aside className="wa2-side">
        <div className="wa2-brand"><b>WINESWEE</b><span>官網後臺</span></div>
        <nav className="wa2-nav">
          {NAV.map(n => (
            <button key={n.key} className={view === n.key ? 'on' : ''} onClick={() => setView(n.key)}>
              {n.label}
              {n.sec && n.sec.some(s => dirty.has(s)) && <i className="wa2-dot" />}
            </button>
          ))}
        </nav>
        <div className="wa2-side-foot">
          <a className="wa-link" href="/wineswee" target="_blank" rel="noreferrer">預覽官網 ↗</a>
          <span className="wa-user">{profile?.name}</span>
        </div>
      </aside>

      <div className="wa2-main">
        <header className="wa2-top">
          <h1>{navTitle}</h1>
          <div className="wa2-pub">
            {dirty.size > 0
              ? <><span className="wa2-dirty">{dirty.size} 項未發布</span>
                <button className="wa-btn wa-btn-ghost" onClick={discard}>捨棄</button>
                <button className="wa-btn wa-btn-primary" disabled={publishing} onClick={publish}>{publishing ? '發布中…' : '發布上線'}</button></>
              : <span className="wa2-clean">已是最新</span>}
          </div>
        </header>
        {msg && <div className={'wa-flash ' + msg.type}>{msg.text}</div>}
        <div className="wa2-body">

          {/* ── 儀表板 ── */}
          {view === 'dashboard' && (
            <div>
              <div className="wa2-stats">
                <button className="wa2-stat" onClick={() => setView('products')}><b>{products.length}</b><span>商品</span></button>
                <button className="wa2-stat" onClick={() => setView('products')}><b>{topCount}</b><span>置頂商品</span></button>
                <button className="wa2-stat" onClick={() => setView('news')}><b>{data.news.length}</b><span>消息分類</span></button>
                <button className="wa2-stat" onClick={() => setView('stores')}><b>{data.stores.length}</b><span>門市</span></button>
              </div>
              <h3 className="wa-h3">快捷</h3>
              <div className="wa2-quick">
                <button className="wa-btn wa-btn-ghost" onClick={() => { setView('products'); patch('products', [{ name: '新商品', price: null, member: null, image: '', sold_out: false }, ...products]); setEditIdx(0) }}>＋ 新增商品</button>
                <button className="wa-btn wa-btn-ghost" onClick={() => setView('news')}>發布消息</button>
                <button className="wa-btn wa-btn-ghost" onClick={() => setView('appearance')}>改首頁文案</button>
                <button className="wa-btn wa-btn-ghost" onClick={() => setView('layout')}>調整版面</button>
                <button className="wa-btn wa-btn-ghost" onClick={() => setView('media')}>媒體庫</button>
              </div>
              <div className="wa-hint" style={{ marginTop: 20 }}>提醒：改動不會立刻上線，改好後按右上角「發布上線」才會更新官網。需先在 Supabase Studio 跑過 migration。</div>
            </div>
          )}

          {/* ── 商品(表格/篩選/批次/獨立編輯) ── */}
          {view === 'products' && (() => {
            const match = p => {
              if (q.trim() && !(p.name || '').toLowerCase().includes(q.trim().toLowerCase())) return false
              if (catF !== '全部' && classifyName(p.name) !== catF) return false
              if (statF === '上架' && p.sold_out) return false
              if (statF === '售完' && !p.sold_out) return false
              if (statF === '置頂' && !p.top) return false
              return true
            }
            const idxs = products.map((p, i) => i).filter(i => match(products[i]))
            const PER = 30, totalPages = Math.max(1, Math.ceil(idxs.length / PER)), pg = Math.min(page, totalPages - 1)
            const shownIdx = idxs.slice(pg * PER, pg * PER + PER)
            const setP = (i, k, v) => patch('products', products.map((p, j) => j === i ? { ...p, [k]: v } : p))
            const bulk = fn => { patch('products', products.map((p, i) => sel.has(i) ? fn(p) : p)); setSel(new Set()) }
            const allSel = shownIdx.length > 0 && shownIdx.every(i => sel.has(i))
            return (
              <div>
                <div className="wa2-toolbar">
                  <input className="wa-input wa-search" placeholder={`搜尋（共 ${products.length}）`} value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
                  <select className="wa-input" value={catF} onChange={e => { setCatF(e.target.value); setPage(0) }}>
                    <option>全部</option>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select className="wa-input" value={statF} onChange={e => { setStatF(e.target.value); setPage(0) }}>
                    <option>全部</option><option>上架</option><option>售完</option><option>置頂</option>
                  </select>
                  <button className="wa-btn wa-btn-ghost" onClick={() => { patch('products', [{ name: '新商品', price: null, member: null, image: '', sold_out: false }, ...products]); setEditIdx(0); setPage(0) }}>＋ 新增商品</button>
                </div>

                {sel.size > 0 && (
                  <div className="wa2-bulk">
                    <span>已選 {sel.size} 筆</span>
                    <button className="wa-btn wa-btn-ghost" onClick={() => bulk(p => ({ ...p, sold_out: true }))}>標售完</button>
                    <button className="wa-btn wa-btn-ghost" onClick={() => bulk(p => ({ ...p, sold_out: false }))}>取消售完</button>
                    <button className="wa-btn wa-btn-ghost" onClick={() => bulk(p => ({ ...p, top: true }))}>設置頂</button>
                    <button className="wa-btn wa-btn-ghost" onClick={() => bulk(p => ({ ...p, top: false }))}>取消置頂</button>
                    <button className="wa-btn wa-btn-ghost wa2-danger" onClick={() => { if (confirm(`確定刪除 ${sel.size} 筆商品？`)) { patch('products', products.filter((_, i) => !sel.has(i))); setSel(new Set()) } }}>刪除</button>
                    <button className="wa-btn wa-btn-ghost" onClick={() => setSel(new Set())}>取消選取</button>
                  </div>
                )}

                <div className="wa-hint">共 {idxs.length} 項，第 {pg + 1}/{totalPages} 頁。點「編輯」改詳情/會員價/介紹。</div>
                <div className="wa2-tablewrap">
                  <table className="wa2-table">
                    <thead><tr>
                      <th><input type="checkbox" checked={allSel} onChange={e => { const s = new Set(sel); shownIdx.forEach(i => e.target.checked ? s.add(i) : s.delete(i)); setSel(s) }} /></th>
                      <th>圖</th><th>名稱</th><th>分類</th><th>售價</th><th>會員價</th><th>狀態</th><th></th>
                    </tr></thead>
                    <tbody>
                      {shownIdx.map(i => { const p = products[i]; return (
                        <tr key={i} className={sel.has(i) ? 'sel' : ''}>
                          <td><input type="checkbox" checked={sel.has(i)} onChange={e => { const s = new Set(sel); e.target.checked ? s.add(i) : s.delete(i); setSel(s) }} /></td>
                          <td><div className="wa2-th">{p.image ? <img src={p.image} alt="" /> : <span>—</span>}</div></td>
                          <td className="wa2-name" onClick={() => setEditIdx(i)}>{p.name || <em>未命名</em>}</td>
                          <td>{CAT_LABEL[classifyName(p.name)] || '其他'}</td>
                          <td>{p.price != null ? 'NT$ ' + Number(p.price).toLocaleString() : '—'}</td>
                          <td>{p.member != null ? 'NT$ ' + Number(p.member).toLocaleString() : '—'}</td>
                          <td>{p.top && <span className="wa2-badge top">置頂</span>}{p.sold_out ? <span className="wa2-badge out">售完</span> : <span className="wa2-badge on">上架</span>}</td>
                          <td><button className="wa-btn wa-btn-ghost" onClick={() => setEditIdx(i)}>編輯</button></td>
                        </tr>
                      ) })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="wa-pager">
                    <button className="wa-btn wa-btn-ghost" disabled={pg === 0} onClick={() => { setPage(pg - 1); window.scrollTo(0, 0) }}>← 上一頁</button>
                    <span className="wa-pager-info">{pg + 1} / {totalPages}</span>
                    <button className="wa-btn wa-btn-ghost" disabled={pg >= totalPages - 1} onClick={() => { setPage(pg + 1); window.scrollTo(0, 0) }}>下一頁 →</button>
                  </div>
                )}

                {editIdx != null && products[editIdx] && (() => {
                  const p = products[editIdx]
                  const set = (k, v) => setP(editIdx, k, v)
                  const det = data.details[p.name] || {}
                  // 改名時把「產品詳情/成本表」一起搬到新名字下,避免詳情跟商品脫鉤不見
                  const renameProduct = newName => {
                    const old = p.name
                    set('name', newName)
                    if (old && old !== newName && data.details[old] != null) {
                      const nd = { ...data.details }; nd[newName] = nd[old]; delete nd[old]
                      patch('details', nd)
                    }
                  }
                  return (
                    <div className="wa2-drawer" onClick={() => setEditIdx(null)}>
                      <div className="wa2-drawer-in" onClick={e => e.stopPropagation()}>
                        <div className="wa2-drawer-top"><h3>編輯商品</h3><button className="wa-del" onClick={() => setEditIdx(null)}>✕</button></div>
                        <div className="wa2-drawer-body">
                          <div className="wa-sub">主圖</div>
                          <Img value={p.image} onChange={v => set('image', v)} upload={upload} />
                          <div className="wa-fgrid" style={{ marginTop: 12 }}>
                            <label className="wa-f wa-f-grow wa-f-full"><span>名稱</span><input className="wa-input" value={p.name || ''} onChange={e => renameProduct(e.target.value)} /></label>
                            <label className="wa-f"><span>售價 NT$</span><input className="wa-input" type="number" value={p.price ?? ''} onChange={e => set('price', e.target.value === '' ? null : Number(e.target.value))} /></label>
                            <label className="wa-f"><span>會員價 NT$（選填）</span><input className="wa-input" type="number" value={p.member ?? ''} onChange={e => set('member', e.target.value === '' ? null : Number(e.target.value))} /></label>
                          </div>
                          <div className="wa2-chks">
                            <label><input type="checkbox" checked={!!p.top} onChange={e => set('top', e.target.checked)} /> 置頂（排最前）</label>
                            <label><input type="checkbox" checked={!!p.sold_out} onChange={e => set('sold_out', e.target.checked)} /> 售完</label>
                            <span className="wa2-hintinline">分類：{CAT_LABEL[classifyName(p.name)] || '其他'}（依名稱自動）</span>
                          </div>
                          <div className="wa-sub" style={{ marginTop: 8 }}><b>產品詳情</b></div>
                          <DetailEditor detail={det} onChange={v => patch('details', { ...data.details, [p.name]: v })} upload={upload} />
                        </div>
                        <div className="wa2-drawer-foot"><button className="wa-btn wa-btn-primary" onClick={() => setEditIdx(null)}>完成</button></div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {/* ── 最新消息 ── */}
          {view === 'news' && (
            <section>
              <div className="wa2-toolbar">
                <span className="wa-count">共 {data.news.length} 則消息</span>
                <button className="wa-btn wa-btn-ghost" onClick={() => patch('news', [{ id: Date.now(), title: '新消息', date: new Date().toISOString().slice(0, 10).replace(/-/g, '/'), cover: '', images: [], subs: [] }, ...data.news])}>＋ 新增消息</button>
              </div>
              <div className="wa-hint">每則消息可含多篇「子文章」（像 MENU 菜單有兩份、酒品知識有多篇）。每篇的圖可拖曳調寬度/排序/刪。</div>
              <div className="wa-list">
                {data.news.map((nw, idx) => {
                  const set = (k, v) => patch('news', data.news.map((x, j) => j === idx ? { ...x, [k]: v } : x))
                  const subs = nw.subs && nw.subs.length ? nw.subs : [{ title: nw.title, date: nw.date, cover: nw.cover, images: nw.images || [] }]
                  const setSub = (si, k, v) => set('subs', subs.map((s, j) => j === si ? { ...s, [k]: v } : s))
                  return (
                    <div className="wa-card" key={nw.id ?? idx}>
                      <div className="wa-card-head">
                        <label className="wa-f wa-f-grow"><span>分類名稱</span><input className="wa-input" value={nw.title || ''} onChange={e => set('title', e.target.value)} /></label>
                        <label className="wa-f"><span>日期</span><input className="wa-input" value={nw.date || ''} onChange={e => set('date', e.target.value)} placeholder="2026/05/21" /></label>
                        <button className="wa-del" onClick={() => patch('news', data.news.filter((_, i) => i !== idx))}>✕</button>
                      </div>
                      <div className="wa-sub">分類封面</div>
                      <Img value={nw.cover} onChange={v => set('cover', v)} upload={upload} />
                      <div className="wa-sub"><b>子文章</b>（{subs.length} 篇）</div>
                      {subs.map((s, si) => (
                        <div className="wa-secedit" key={si}>
                          <div className="wa-secedit-h">
                            <input className="wa-input" placeholder="子文章標題" value={s.title || ''} onChange={e => setSub(si, 'title', e.target.value)} />
                            <input className="wa-input" placeholder="日期" value={s.date || ''} onChange={e => setSub(si, 'date', e.target.value)} style={{ flex: '0 0 130px' }} />
                            <button className="wa-del sm" onClick={() => set('subs', subs.filter((_, j) => j !== si))}>移除此篇</button>
                          </div>
                          <div className="wa-sub">封面</div>
                          <Img value={s.cover} onChange={v => setSub(si, 'cover', v)} upload={upload} small />
                          {(() => {
                            const setSubAll = patch => set('subs', subs.map((x, j) => j === si ? { ...x, ...patch } : x))
                            // 用 mode 欄位決定版面,切換時「不刪」其他模式的內容(html/board/images 都留著)
                            const mode = s.mode || (s.html != null ? 'rich' : s.board ? 'canvas' : 'flow')
                            return (
                              <>
                                <div className="wa-sub">版面模式：
                                  <span className="wa-modebtns">
                                    <button className={mode === 'rich' ? 'on' : ''} onClick={() => setSubAll({ mode: 'rich', html: s.html || '' })}>圖文編輯（打字＋插圖）</button>
                                    <button className={mode === 'flow' ? 'on' : ''} onClick={() => setSubAll({ mode: 'flow' })}>流式（上下／並排）</button>
                                    <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setSubAll({ mode: 'canvas', board: s.board || toBoard(s.images) })}>自由畫布（拖拉擺放）</button>
                                  </span>
                                </div>
                                {mode === 'rich'
                                  ? <RichEditor value={s.html} onChange={v => setSub(si, 'html', v)} upload={upload} />
                                  : mode === 'canvas'
                                    ? <CanvasEditor board={s.board} onChange={b => setSub(si, 'board', b)} upload={upload} />
                                    : <GalleryEditor images={s.images} onChange={imgs => setSub(si, 'images', imgs)} upload={upload} />}
                              </>
                            )
                          })()}
                        </div>
                      ))}
                      <button className="wa-btn wa-btn-ghost" onClick={() => set('subs', [...subs, { title: '新的一篇', date: nw.date || '', cover: '', images: [] }])}>＋ 新增一篇子文章</button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── 門市 ── */}
          {view === 'stores' && (
            <section>
              <div className="wa2-toolbar">
                <span className="wa-count">共 {data.stores.length} 家門市</span>
                <button className="wa-btn wa-btn-ghost" onClick={() => patch('stores', [...data.stores, { name: '新門市', full: '', region: '台北', tel: '', addr: '' }])}>＋ 新增門市</button>
              </div>
              <div className="wa-list">
                {data.stores.map((s, idx) => {
                  const set = (k, v) => patch('stores', data.stores.map((x, j) => j === idx ? { ...x, [k]: v } : x))
                  return (
                    <div className="wa-item wa-item-store" key={idx}>
                      <label className="wa-f"><span>地區</span><select className="wa-input" value={s.region || '台北'} onChange={e => set('region', e.target.value)}>{REGIONS.map(r => <option key={r}>{r}</option>)}</select></label>
                      <label className="wa-f"><span>店名</span><input className="wa-input" value={s.name || ''} onChange={e => set('name', e.target.value)} /></label>
                      <label className="wa-f"><span>完整名</span><input className="wa-input" value={s.full || ''} onChange={e => set('full', e.target.value)} placeholder="台北中山國小店" /></label>
                      <label className="wa-f"><span>電話</span><input className="wa-input" value={s.tel || ''} onChange={e => set('tel', e.target.value)} /></label>
                      <label className="wa-f wa-f-grow"><span>地址</span><input className="wa-input" value={s.addr || ''} onChange={e => set('addr', e.target.value)} /></label>
                      <button className="wa-del" onClick={() => patch('stores', data.stores.filter((_, i) => i !== idx))}>✕</button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── 外觀文案 ── */}
          {view === 'appearance' && <AppearanceView data={data} patch={patch} upload={upload} />}

          {/* ── 版面設計 ── */}
          {view === 'layout' && (() => {
            const merged = mergeSite(data.site)
            const setSite = (path, val) => patch('site', setIn(data.site || {}, path, val))
            const layout = merged.layout || []
            const move = (i, dir) => { const L = [...layout]; const j = i + dir; if (j < 0 || j >= L.length) return;[L[i], L[j]] = [L[j], L[i]]; setSite('layout', L) }
            const toggle = i => setSite('layout', layout.map((s, j) => j === i ? { ...s, on: s.on === false } : s))
            return (
              <section>
                <div className="wa-hint">↑↓ 排序、開關首頁各區塊（英雄大圖固定最上、頁尾固定最下）。關掉就不顯示。</div>
                <div className="wa-list">
                  {layout.map((s, i) => (
                    <div className={'wa-lay' + (s.on === false ? ' off' : '')} key={s.key}>
                      <span className="wa-lay-n">{i + 1}</span>
                      <span className="wa-lay-name">{SECTION_LABELS[s.key] || s.key}</span>
                      <label className="wa-switch"><input type="checkbox" checked={s.on !== false} onChange={() => toggle(i)} /><span>{s.on === false ? '隱藏中' : '顯示中'}</span></label>
                      <div className="wa-lay-move"><button className="wa-btn wa-btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="wa-btn wa-btn-ghost" disabled={i === layout.length - 1} onClick={() => move(i, 1)}>↓</button></div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })()}

          {/* ── 媒體庫 ── */}
          {view === 'media' && <MediaLibrary upload={upload} flash={flash} />}

          {/* ── 設定 ── */}
          {view === 'settings' && <SettingsView data={data} patch={patch} upload={upload} />}
        </div>
      </div>
    </div>
  )
}

// ── 外觀文案(首頁/關於/情境/專人/banner/分類說明) ──
function AppearanceView({ data, patch, upload }) {
  const merged = mergeSite(data.site)
  const setSite = (path, val) => patch('site', setIn(data.site || {}, path, val))
  const mani = merged.manifesto, vals = merged.about.values
  const banners = data.site.banners?.length ? data.site.banners : BANNERS_DEFAULT   // 沒存過就帶出預設,避免看起來「沒圖」
  const groups = SITE_GROUPS.filter(g => g.title !== '品牌・社群・公告')
  return (
    <section>
      <h3 className="wa-h3">首頁 Banner 輪播（最上方 Hero 首圖）</h3>
      <div className="wa-hint" style={{ marginTop: -4, marginBottom: 10 }}>這就是首頁最上方輪播的大圖；可加／換／移除，順序即輪播順序。留空用預設 4 張。</div>
      <div className="wa-imgs">
        {banners.map((im, i) => (<div className="wa-imgs-item" key={i}><Img value={im} onChange={v => setSite('banners', banners.map((x, j) => j === i ? v : x))} upload={upload} /><button className="wa-del sm" onClick={() => setSite('banners', banners.filter((_, j) => j !== i))}>移除</button></div>))}
        <button className="wa-btn wa-btn-ghost" onClick={() => setSite('banners', [...banners, ''])}>＋ 加一張 Banner</button>
      </div>
      {groups.map(g => (
        <div key={g.title}><h3 className="wa-h3">{g.title}</h3>
          <div className="wa-fgrid">{g.fields.map(f => <SiteField key={f.path} label={f.label} value={getIn(merged, f.path) ?? ''} onChange={v => setSite(f.path, v)} ta={f.ta} />)}</div>
        </div>
      ))}
      <h3 className="wa-h3">首頁・四大特點</h3>
      <div className="wa-list">{mani.map((m, i) => (
        <div className="wa-item wa-item-store" key={i}>
          <label className="wa-f"><span>編號</span><input className="wa-input" value={m.n} onChange={e => setSite('manifesto', mani.map((x, j) => j === i ? { ...x, n: e.target.value } : x))} /></label>
          <label className="wa-f wa-f-grow"><span>標題</span><input className="wa-input" value={m.title} onChange={e => setSite('manifesto', mani.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} /></label>
          <label className="wa-f wa-f-grow"><span>說明</span><input className="wa-input" value={m.sub} onChange={e => setSite('manifesto', mani.map((x, j) => j === i ? { ...x, sub: e.target.value } : x))} /></label>
        </div>
      ))}</div>
      <h3 className="wa-h3">首頁・情境選酒（4 格）</h3>
      <div className="wa-list">{(merged.occasions?.items || []).map((o, i) => {
        const setOcc = (k, v) => setSite('occasions.items', merged.occasions.items.map((x, j) => j === i ? { ...x, [k]: v } : x))
        return (
          <div className="wa-card" key={i}>
            <div className="wa-card-head">
              <label className="wa-f"><span>標題</span><input className="wa-input" value={o.title || ''} onChange={e => setOcc('title', e.target.value)} /></label>
              <label className="wa-f"><span>英文</span><input className="wa-input" value={o.en || ''} onChange={e => setOcc('en', e.target.value)} /></label>
              <label className="wa-f wa-f-grow"><span>連結</span><input className="wa-input" value={o.to || ''} onChange={e => setOcc('to', e.target.value)} /></label>
            </div>
            <label className="wa-f wa-f-grow" style={{ marginTop: 8 }}><span>說明</span><input className="wa-input" value={o.desc || ''} onChange={e => setOcc('desc', e.target.value)} /></label>
            <div className="wa-sub">情境圖（留空＝自動用分類代表圖）</div><Img value={o.image} onChange={v => setOcc('image', v)} upload={upload} />
          </div>
        )
      })}</div>
      <h3 className="wa-h3">關於我們・四個堅持</h3>
      <div className="wa-list">{vals.map((v, i) => (
        <div className="wa-item wa-item-store" key={i}>
          <label className="wa-f"><span>編號</span><input className="wa-input" value={v[0]} onChange={e => setSite('about.values', vals.map((r, j) => j === i ? [e.target.value, r[1], r[2]] : r))} /></label>
          <label className="wa-f wa-f-grow"><span>標題</span><input className="wa-input" value={v[1]} onChange={e => setSite('about.values', vals.map((r, j) => j === i ? [r[0], e.target.value, r[2]] : r))} /></label>
          <label className="wa-f wa-f-grow"><span>說明</span><input className="wa-input" value={v[2]} onChange={e => setSite('about.values', vals.map((r, j) => j === i ? [r[0], r[1], e.target.value] : r))} /></label>
        </div>
      ))}</div>
      <h3 className="wa-h3">選購專區・分類說明</h3>
      <div className="wa-list">{CAT_META_KEYS.map(key => {
        const cat = CATEGORIES.find(c => c.key === key)
        return <label className="wa-f wa-f-grow wa-meta" key={key}><span>{cat?.label}</span><input className="wa-input" value={getIn(merged, `catMeta.${key}`) ?? getCatMeta(key)} onChange={e => setSite(`catMeta.${key}`, e.target.value)} /></label>
      })}</div>
    </section>
  )
}

// ── 設定(logo/社群/公告/法規/導覽) ──
function SettingsView({ data, patch, upload }) {
  const merged = mergeSite(data.site)
  const setSite = (path, val) => patch('site', setIn(data.site || {}, path, val))
  const g0 = SITE_GROUPS.find(g => g.title === '品牌・社群・公告')
  return (
    <section>
      <h3 className="wa-h3">品牌 Logo</h3>
      <Img value={merged.logo} onChange={v => setSite('logo', v)} upload={upload} />
      <h3 className="wa-h3">{g0.title}</h3>
      <div className="wa-fgrid">{g0.fields.map(f => <SiteField key={f.path} label={f.label} value={getIn(merged, f.path) ?? ''} onChange={v => setSite(f.path, v)} ta={f.ta} />)}</div>
      <h3 className="wa-h3">導覽選單</h3>
      <div className="wa-hint">連結可填：站內路徑、@line、@email、或完整網址。分類下拉僅能改名稱。</div>
      <div className="wa-list">
        {(merged.nav || []).map((it, i) => {
          const setNav = (k, v) => setSite('nav', merged.nav.map((x, j) => j === i ? { ...x, [k]: v } : x))
          return (
            <div className="wa-item wa-item-store" key={i}>
              <label className="wa-f wa-f-grow"><span>名稱</span><input className="wa-input" value={it.label || ''} onChange={e => setNav('label', e.target.value)} /></label>
              {it.drop ? <span className="wa-navbadge">分類下拉（{it.drop === 'wine' ? '酒類' : '美食'}）</span>
                : <label className="wa-f wa-f-grow"><span>連結</span><input className="wa-input" value={it.to || ''} onChange={e => setNav('to', e.target.value)} placeholder="/wineswee/… 或 @line" /></label>}
              <button className="wa-del" onClick={() => setSite('nav', merged.nav.filter((_, j) => j !== i))}>✕</button>
            </div>
          )
        })}
        <button className="wa-btn wa-btn-ghost" onClick={() => setSite('nav', [...(merged.nav || []), { label: '新項目', to: '/wineswee' }])}>＋ 新增選單項目</button>
      </div>
    </section>
  )
}

// ── 媒體庫 ──
function MediaLibrary({ upload, flash }) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const pub = p => bucket().getPublicUrl(p).data.publicUrl
  const load = async () => {
    setBusy(true)
    try {
      const acc = []
      const { data: root } = await bucket().list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } })
      const folders = (root || []).filter(x => !x.metadata)
      for (const f of (root || []).filter(x => x.metadata)) acc.push({ path: f.name, url: pub(f.name) })
      for (const fo of folders.slice(0, 20)) {
        const { data: sub } = await bucket().list(fo.name, { limit: 200, sortBy: { column: 'name', order: 'desc' } })
        for (const f of (sub || [])) if (f.metadata) acc.push({ path: fo.name + '/' + f.name, url: pub(fo.name + '/' + f.name) })
      }
      setItems(acc)
    } catch { setItems([]) }
    setBusy(false)
  }
  useEffect(() => { load() }, [])
  return (
    <section>
      <div className="wa2-toolbar">
        <span className="wa-count">{items ? `${items.length} 張圖` : '載入中…'}</span>
        <label className="wa-btn wa-btn-primary">＋ 上傳圖片<input type="file" accept="image/*" multiple hidden onChange={async e => {
          const fs = [...(e.target.files || [])]; if (!fs.length) return; setBusy(true)
          for (const f of fs) await upload(f); e.target.value = ''; await load()
        }} /></label>
        <button className="wa-btn wa-btn-ghost" onClick={load}>重新整理</button>
      </div>
      <div className="wa-hint">上傳的圖都在這；點「複製網址」到各編輯欄位貼上即可重複使用。</div>
      {items && items.length === 0 && <div className="wa-hint">還沒有圖，先上傳或到各處上傳後會出現在這。</div>}
      <div className="wa2-media">
        {(items || []).map((it, i) => (
          <div className="wa2-media-item" key={i}>
            <div className="wa2-media-thumb"><img src={it.url} alt="" loading="lazy" /></div>
            <div className="wa2-media-btns">
              <button className="wa-btn wa-btn-ghost" onClick={() => { navigator.clipboard?.writeText(it.url); flash('ok', '已複製網址') }}>複製網址</button>
              <button className="wa-del sm" onClick={async () => { if (confirm('刪除這張圖？')) { await bucket().remove([it.path]); load() } }}>刪</button>
            </div>
          </div>
        ))}
      </div>
      {busy && <div className="wa-hint">處理中…</div>}
    </section>
  )
}

function Gate({ title, body }) {
  return <div className="wa"><div className="wa-gate"><h2>{title}</h2><p>{body}</p></div></div>
}

// 穩定的文案欄位(定義在元件外,避免每次 render 重建造成輸入失焦)
function SiteField({ label, value, onChange, ta }) {
  return (
    <label className={'wa-f wa-f-grow' + (ta ? ' wa-f-full' : '')}>
      <span>{label}</span>
      {ta
        ? <textarea className="wa-input wa-ta" rows={2} value={value} onChange={e => onChange(e.target.value)} />
        : <input className="wa-input" value={value} onChange={e => onChange(e.target.value)} />}
    </label>
  )
}

const SITE_GROUPS = [
  { title: '品牌・社群・公告', fields: [
    { label: 'LINE 連結', path: 'contact.line' }, { label: 'Facebook', path: 'contact.fb' }, { label: 'Instagram', path: 'contact.ig' },
    { label: 'YouTube 頻道', path: 'contact.yt' }, { label: '客服信箱', path: 'contact.email' }, { label: '關於頁影片 embed 網址', path: 'contact.ytEmbed' },
    { label: '頂部跑馬燈', path: 'announce', ta: 1 }, { label: '底部法規列', path: 'legal' },
  ] },
  { title: '首頁・英雄大圖', fields: [
    { label: '小標(英文)', path: 'hero.kicker' }, { label: '大標第一行', path: 'hero.title1' }, { label: '大標第二行(可用*字*)', path: 'hero.title2' },
    { label: '副標', path: 'hero.sub', ta: 1 }, { label: '按鈕一', path: 'hero.cta1' }, { label: '按鈕二', path: 'hero.cta2' },
  ] },
  { title: '首頁・各區塊文案', fields: [
    { label: '選購專區 小標', path: 'home.shopKicker' }, { label: '選購專區 標題', path: 'home.shopTitle' },
    { label: '精選列 標題', path: 'home.rowTitle' }, { label: '精選列 英文', path: 'home.rowEn' },
    { label: '本季精選 小標', path: 'home.spotKicker' }, { label: '本季精選 標題(可用*字*)', path: 'home.spotTitle' }, { label: '本季精選 說明', path: 'home.spotDesc', ta: 1 }, { label: '本季精選 按鈕', path: 'home.spotCta' },
    { label: '故事 小標', path: 'home.storyKicker' }, { label: '故事 標題(可用*字*)', path: 'home.storyTitle' }, { label: '故事 內文', path: 'home.storyBody', ta: 1 },
    { label: '入手價(數字)', path: 'home.statPrice' }, { label: '入手價 標籤', path: 'home.statPriceLabel' }, { label: '故事 連結字', path: 'home.storyLink' },
    { label: 'LINE區 標題(可用*字*)', path: 'home.ctaTitle' }, { label: 'LINE區 說明', path: 'home.ctaDesc', ta: 1 }, { label: 'LINE區 按鈕', path: 'home.ctaBtn' },
  ] },
  { title: '關於我們', fields: [
    { label: '小標', path: 'about.kicker' }, { label: '主標題', path: 'about.title' }, { label: '導言', path: 'about.lead', ta: 1 },
    { label: '故事標題(可用*字*)', path: 'about.storyTitle' }, { label: '故事內文', path: 'about.storyBody', ta: 1 },
    { label: '影片區 標題', path: 'about.filmTitle' }, { label: '影片區 說明', path: 'about.filmBody', ta: 1 }, { label: '影片區 按鈕', path: 'about.filmCta' },
    { label: '結尾 標題(可用*字*)', path: 'about.ctaTitle' }, { label: '結尾 說明', path: 'about.ctaBody' }, { label: '結尾 按鈕', path: 'about.ctaBtn' },
  ] },
  { title: '首頁・情境選酒（區塊標題）', fields: [
    { label: '小標(英)', path: 'occasions.kicker' }, { label: '標題(可用*字*)', path: 'occasions.title' }, { label: '前言', path: 'occasions.lead', ta: 1 },
  ] },
  { title: '首頁・專人選酒服務', fields: [
    { label: '小標(英)', path: 'concierge.kicker' }, { label: '標題(可用*字*)', path: 'concierge.title' }, { label: '說明', path: 'concierge.desc', ta: 1 },
    { label: '按鈕', path: 'concierge.btn' }, { label: '入會誘因小字', path: 'concierge.perk', ta: 1 },
  ] },
  { title: '最新消息頁・LINE 區', fields: [
    { label: '標題', path: 'newsCta.title' }, { label: '說明', path: 'newsCta.desc' }, { label: '按鈕', path: 'newsCta.btn' },
  ] },
]

const SPEC_FIELDS = ['年份', '產區', '葡萄品種', '酒精濃度', 'ml數', '建議試飲溫度']
const numv = v => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0

// 單一商品的詳情編輯
function DetailEditor({ detail, onChange, upload }) {
  const d = detail || {}
  const set = (k, v) => onChange({ ...d, [k]: v })
  const setSpec = (k, v) => set('spec', { ...(d.spec || {}), [k]: v })
  const cost = d.cost || []
  const setCost = (i, j, v) => { const c = cost.map(r => [...r]); c[i][j] = v; set('cost', c) }
  const memberPreview = Math.round(cost.reduce((a, [, v]) => a + numv(v), 0))
  const sections = d.sections || []
  const setSec = (i, k, v) => { const s = sections.map(x => ({ ...x })); s[i][k] = v; set('sections', s) }
  return (
    <div className="wa-detail">
      <label className="wa-f wa-f-grow"><span>英文名</span><input className="wa-input" value={d.en || ''} onChange={e => set('en', e.target.value)} placeholder="Château …" /></label>
      <div className="wa-sub">規格</div>
      <div className="wa-grid5">{SPEC_FIELDS.map(k => <label className="wa-f" key={k}><span>{k}</span><input className="wa-input" value={d.spec?.[k] || ''} onChange={e => setSpec(k, e.target.value)} /></label>)}</div>
      <div className="wa-sub">定價成本表 ·　<b>會員價 = 各列加總 = NT$ {memberPreview.toLocaleString()}</b>（也可在上方填「會員價」覆寫）</div>
      <div className="wa-cost">
        {cost.map((r, i) => (
          <div className="wa-cost-row" key={i}>
            <input className="wa-input" placeholder="項目（如 到岸成本）" value={r[0] || ''} onChange={e => setCost(i, 0, e.target.value)} />
            <input className="wa-input wa-cost-v" placeholder="$金額" value={r[1] || ''} onChange={e => setCost(i, 1, e.target.value)} />
            <button className="wa-del sm" onClick={() => set('cost', cost.filter((_, j) => j !== i))}>移除</button>
          </div>
        ))}
        <button className="wa-btn wa-btn-ghost" onClick={() => set('cost', [...cost, ['', '']])}>＋ 加一列成本</button>
      </div>
      <div className="wa-sub">摘要（商品頁最上方一段）</div>
      <textarea className="wa-input wa-ta" rows={2} value={d.summary || ''} onChange={e => set('summary', e.target.value)} />
      <div className="wa-sub">產品段落（酒莊介紹 / 釀造 / 風味 / 餐酒搭配…）</div>
      {sections.map((s, i) => (
        <div className="wa-secedit" key={i}>
          <div className="wa-secedit-h">
            <input className="wa-input" placeholder="標題（如 釀造）" value={s.title || ''} onChange={e => setSec(i, 'title', e.target.value)} />
            <input className="wa-input" placeholder="英文（選填）" value={s.en || ''} onChange={e => setSec(i, 'en', e.target.value)} />
            <button className="wa-del sm" onClick={() => set('sections', sections.filter((_, j) => j !== i))}>移除</button>
          </div>
          <textarea className="wa-input wa-ta" rows={2} value={s.body || ''} onChange={e => setSec(i, 'body', e.target.value)} />
        </div>
      ))}
      <button className="wa-btn wa-btn-ghost" onClick={() => set('sections', [...sections, { title: '', en: '', body: '' }])}>＋ 加一段介紹</button>
    </div>
  )
}
