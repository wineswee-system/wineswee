import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { STATIC, applyLocal } from './content'
import { CATEGORIES, CAT_META_KEYS, getCatMeta, mergeSite, SECTION_LABELS } from './data'
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

const TABS = [
  { key: 'products', label: '商品' },
  { key: 'news', label: '最新消息' },
  { key: 'stores', label: '門市' },
  { key: 'site', label: '網站文案 / Banner' },
  { key: 'layout', label: '版面設計' },
]
const REGIONS = ['台北', '新北', '台中', '高雄', '桃園', '台南', '其他']

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

// 一組圖片:每張可上傳/貼網址/↑↓排序/刪除
function ImageList({ images, onChange, upload }) {
  const list = images || []
  const setAt = (i, v) => onChange(list.map((x, j) => j === i ? v : x))
  const move = (i, d) => { const L = [...list]; const j = i + d; if (j < 0 || j >= L.length) return;[L[i], L[j]] = [L[j], L[i]]; onChange(L) }
  return (
    <div className="wa-imglist">
      {list.map((im, i) => (
        <div className="wa-imglist-item" key={i}>
          <span className="wa-imglist-n">{i + 1}</span>
          <div className="wa-imglist-thumb">{im ? <img src={im} alt="" /> : <span>空</span>}</div>
          <div className="wa-imglist-ctl">
            <input className="wa-input" placeholder="貼圖片網址，或用右邊上傳" value={im || ''} onChange={e => setAt(i, e.target.value)} />
            <div className="wa-imglist-btns">
              <label className="wa-btn wa-btn-ghost">上傳<input type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await upload(f); if (url) setAt(i, url); e.target.value = '' }} /></label>
              <button className="wa-btn wa-btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="wa-btn wa-btn-ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="wa-del sm" onClick={() => onChange(list.filter((_, j) => j !== i))}>刪</button>
            </div>
          </div>
        </div>
      ))}
      <button className="wa-btn wa-btn-ghost" onClick={() => onChange([...list, ''])}>＋ 加一張圖</button>
    </div>
  )
}

export default function WinesweeAdmin() {
  const { user, profile, role } = useAuth()
  const isAdmin = ['admin', 'super_admin'].includes(profile?.role) || ['admin', 'super_admin'].includes(role?.name)
  const [tab, setTab] = useState('products')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [msg, setMsg] = useState(null)
  const [q, setQ] = useState('')
  const [openIdx, setOpenIdx] = useState(null)

  // ERP 外殼 #root 有 zoom + body overflow:hidden,後臺要放開才能捲動
  useEffect(() => {
    const root = document.getElementById('root'), b = document.body, h = document.documentElement
    const prev = { z: root?.style.zoom, bo: b.style.overflow, ho: h.style.overflow }
    if (root) root.style.zoom = '1'; b.style.overflow = 'visible'; h.style.overflow = 'auto'
    return () => { if (root) root.style.zoom = prev.z || ''; b.style.overflow = prev.bo; h.style.overflow = prev.ho }
  }, [])

  useEffect(() => {
    (async () => {
      let db = null
      try { const r = await supabase.rpc('get_wineswee_content'); db = r?.data || null } catch { db = null }
      setData({
        products: db?.products?.length ? db.products : STATIC.products,
        details: db?.details && Object.keys(db.details).length ? db.details : STATIC.details,
        news: db?.news?.length ? db.news : STATIC.news,
        stores: db?.stores?.length ? db.stores : STATIC.stores,
        site: db?.site || {},
      })
      setLoading(false)
    })()
  }, [])

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500) }
  const patch = (section, value) => setData(d => ({ ...d, [section]: value }))

  async function save(...sections) {
    setSaving(sections[0])
    for (const section of sections) {
      const { error } = await supabase.rpc('save_wineswee_content', { _section: section, _data: data[section] })
      if (error) { setSaving(''); return flash('err', '儲存失敗：' + error.message) }
      applyLocal(section, data[section])
    }
    setSaving('')
    flash('ok', '已儲存並上線 ✓')
  }

  async function upload(file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${new Date().toISOString().slice(0, 10)}/${Math.random().toString(36).slice(2, 10)}.${ext}`
    const { error } = await supabase.storage.from('wineswee-media').upload(path, file, { cacheControl: '31536000', upsert: false })
    if (error) { flash('err', '上傳失敗：' + error.message); return null }
    return supabase.storage.from('wineswee-media').getPublicUrl(path).data.publicUrl
  }

  if (!user) return <Gate title="請先登入" body={<>後臺需登入公司系統帳號。<Link to="/" className="wa-link">前往登入 →</Link></>} />
  if (!isAdmin) return <Gate title="沒有權限" body="此頁僅限管理員（admin / super_admin）使用。" />
  if (loading || !data) return <Gate title="載入中…" body="正在讀取官網內容" />

  const products = data.products
  const filtered = q.trim() ? products.filter(p => (p.name || '').toLowerCase().includes(q.trim().toLowerCase())) : products

  return (
    <div className="wa">
      <header className="wa-top">
        <div>
          <span className="wa-kicker">WINESWEE 官網後臺</span>
          <h1>內容管理</h1>
        </div>
        <div className="wa-top-r">
          <a className="wa-link" href="/wineswee" target="_blank" rel="noreferrer">預覽官網 ↗</a>
          <span className="wa-user">{profile?.name}</span>
        </div>
      </header>

      <nav className="wa-tabs">
        {TABS.map(t => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setQ('') }}>{t.label}</button>)}
      </nav>

      {msg && <div className={'wa-flash ' + msg.type}>{msg.text}</div>}

      {/* ── 商品 ── */}
      {tab === 'products' && (
        <section className="wa-panel">
          <div className="wa-panelhead">
            <input className="wa-input wa-search" placeholder={`搜尋商品（共 ${products.length} 項）`} value={q} onChange={e => setQ(e.target.value)} />
            <div className="wa-actions">
              <button className="wa-btn wa-btn-ghost" onClick={() => patch('products', [{ name: '新商品', price: null, member: null, image: '', sold_out: false }, ...products])}>＋ 新增商品</button>
              <button className="wa-btn wa-btn-primary" disabled={saving === 'products'} onClick={() => save('products', 'details')}>{saving === 'products' ? '儲存中…' : '儲存並上線'}</button>
            </div>
          </div>
          <div className="wa-hint">分類依商品名稱自動判斷。「詳情」可改英文名/規格/成本表/會員價/介紹。顯示 {filtered.length} 項。</div>
          <div className="wa-list">
            {filtered.map((p) => {
              const idx = products.indexOf(p)
              const set = (k, v) => { const n = [...products]; n[idx] = { ...n[idx], [k]: v }; patch('products', n) }
              const det = data.details[p.name] || {}
              const setDet = (v) => patch('details', { ...data.details, [p.name]: v })
              const open = openIdx === idx
              return (
                <div className={'wa-item wa-item-col' + (open ? ' open' : '')} key={idx}>
                  <div className="wa-item-main">
                    <Img value={p.image} onChange={v => set('image', v)} upload={upload} small />
                    <div className="wa-item-fields">
                      <label className="wa-f wa-f-grow"><span>名稱</span><input className="wa-input" value={p.name || ''} onChange={e => set('name', e.target.value)} /></label>
                      <label className="wa-f"><span>售價 NT$</span><input className="wa-input" type="number" value={p.price ?? ''} onChange={e => set('price', e.target.value === '' ? null : Number(e.target.value))} /></label>
                      <label className="wa-f"><span>會員價 NT$</span><input className="wa-input" type="number" placeholder="選填" value={p.member ?? ''} onChange={e => set('member', e.target.value === '' ? null : Number(e.target.value))} /></label>
                      <label className="wa-f wa-f-chk"><input type="checkbox" checked={!!p.top} onChange={e => set('top', e.target.checked)} /><span>置頂</span></label>
                      <label className="wa-f wa-f-chk"><input type="checkbox" checked={!!p.sold_out} onChange={e => set('sold_out', e.target.checked)} /><span>售完</span></label>
                    </div>
                    <button className={'wa-btn wa-btn-ghost wa-toggle' + (open ? ' on' : '')} onClick={() => setOpenIdx(open ? null : idx)}>詳情 {open ? '▲' : '▾'}</button>
                    <button className="wa-del" title="刪除" onClick={() => patch('products', products.filter((_, i) => i !== idx))}>✕</button>
                  </div>
                  {open && <DetailEditor detail={det} onChange={setDet} upload={upload} />}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 最新消息 ── */}
      {tab === 'news' && (
        <section className="wa-panel">
          <div className="wa-panelhead">
            <span className="wa-count">共 {data.news.length} 則消息</span>
            <div className="wa-actions">
              <button className="wa-btn wa-btn-ghost" onClick={() => patch('news', [{ id: Date.now(), title: '新消息', date: new Date().toISOString().slice(0, 10).replace(/-/g, '/'), cover: '', images: [] }, ...data.news])}>＋ 新增消息</button>
              <button className="wa-btn wa-btn-primary" disabled={saving === 'news'} onClick={() => save('news')}>{saving === 'news' ? '儲存中…' : '儲存並上線'}</button>
            </div>
          </div>
          <div className="wa-hint">每則消息可含多篇「子文章」（像 MENU 菜單有信義店/門市兩份、酒品知識有多篇）。每篇的圖可上傳、↑↓ 排序、刪除。</div>
          <div className="wa-list">
            {data.news.map((nw, idx) => {
              const set = (k, v) => { const n = [...data.news]; n[idx] = { ...n[idx], [k]: v }; patch('news', n) }
              const subs = nw.subs && nw.subs.length ? nw.subs : [{ title: nw.title, date: nw.date, cover: nw.cover, images: nw.images || [] }]
              const setSub = (si, k, v) => set('subs', subs.map((s, j) => j === si ? { ...s, [k]: v } : s))
              return (
                <div className="wa-card" key={nw.id ?? idx}>
                  <div className="wa-card-head">
                    <label className="wa-f wa-f-grow"><span>分類名稱</span><input className="wa-input" value={nw.title || ''} onChange={e => set('title', e.target.value)} /></label>
                    <label className="wa-f"><span>日期</span><input className="wa-input" value={nw.date || ''} onChange={e => set('date', e.target.value)} placeholder="2026/05/21" /></label>
                    <button className="wa-del" onClick={() => patch('news', data.news.filter((_, i) => i !== idx))}>✕</button>
                  </div>
                  <div className="wa-sub">分類封面（列表卡顯示）</div>
                  <Img value={nw.cover} onChange={v => set('cover', v)} upload={upload} />

                  <div className="wa-sub"><b>子文章</b>（{subs.length} 篇）— 一則消息可放多篇</div>
                  {subs.map((s, si) => (
                    <div className="wa-secedit" key={si}>
                      <div className="wa-secedit-h">
                        <input className="wa-input" placeholder="子文章標題（如 信義安和門市菜單）" value={s.title || ''} onChange={e => setSub(si, 'title', e.target.value)} />
                        <input className="wa-input" placeholder="日期" value={s.date || ''} onChange={e => setSub(si, 'date', e.target.value)} style={{ flex: '0 0 130px' }} />
                        <button className="wa-del sm" onClick={() => set('subs', subs.filter((_, j) => j !== si))}>移除此篇</button>
                      </div>
                      <div className="wa-sub">封面（子文章卡）</div>
                      <Img value={s.cover} onChange={v => setSub(si, 'cover', v)} upload={upload} small />
                      <div className="wa-sub">圖片（依序顯示，可上傳／排序／刪）</div>
                      <ImageList images={s.images} onChange={imgs => setSub(si, 'images', imgs)} upload={upload} />
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
      {tab === 'stores' && (
        <section className="wa-panel">
          <div className="wa-panelhead">
            <span className="wa-count">共 {data.stores.length} 家門市</span>
            <div className="wa-actions">
              <button className="wa-btn wa-btn-ghost" onClick={() => patch('stores', [...data.stores, { name: '新門市', full: '', region: '台北', tel: '', addr: '' }])}>＋ 新增門市</button>
              <button className="wa-btn wa-btn-primary" disabled={saving === 'stores'} onClick={() => save('stores')}>{saving === 'stores' ? '儲存中…' : '儲存並上線'}</button>
            </div>
          </div>
          <div className="wa-list">
            {data.stores.map((s, idx) => {
              const set = (k, v) => { const n = [...data.stores]; n[idx] = { ...n[idx], [k]: v }; patch('stores', n) }
              return (
                <div className="wa-item wa-item-store" key={idx}>
                  <label className="wa-f"><span>地區</span>
                    <select className="wa-input" value={s.region || '台北'} onChange={e => set('region', e.target.value)}>{REGIONS.map(r => <option key={r}>{r}</option>)}</select>
                  </label>
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

      {/* ── 網站文案 / Banner ── */}
      {tab === 'site' && (() => {
        const merged = mergeSite(data.site)
        const setSite = (path, val) => patch('site', setIn(data.site || {}, path, val))
        const mani = merged.manifesto
        const vals = merged.about.values
        const banners = data.site.banners || []
        return (
          <section className="wa-panel">
            <div className="wa-panelhead">
              <span className="wa-count">整站文案・社群・圖片　（用 *文字* 讓字變金色斜體）</span>
              <button className="wa-btn wa-btn-primary" disabled={saving === 'site'} onClick={() => save('site')}>{saving === 'site' ? '儲存中…' : '儲存並上線'}</button>
            </div>

            <h3 className="wa-h3">品牌 Logo</h3>
            <Img value={merged.logo} onChange={v => setSite('logo', v)} upload={upload} />

            <h3 className="wa-h3">導覽選單</h3>
            <div className="wa-hint">連結可填：站內路徑（如 /wineswee/about）、@line、@email、或完整網址。「分類下拉」為酒類/美食專區，僅能改名稱。</div>
            <div className="wa-list">
              {(merged.nav || []).map((it, i) => {
                const setNav = (k, v) => setSite('nav', merged.nav.map((x, j) => j === i ? { ...x, [k]: v } : x))
                return (
                  <div className="wa-item wa-item-store" key={i}>
                    <label className="wa-f wa-f-grow"><span>名稱</span><input className="wa-input" value={it.label || ''} onChange={e => setNav('label', e.target.value)} /></label>
                    {it.drop
                      ? <span className="wa-navbadge">分類下拉（{it.drop === 'wine' ? '酒類' : '美食'}）</span>
                      : <label className="wa-f wa-f-grow"><span>連結</span><input className="wa-input" value={it.to || ''} onChange={e => setNav('to', e.target.value)} placeholder="/wineswee/… 或 @line / @email" /></label>}
                    <button className="wa-del" onClick={() => setSite('nav', merged.nav.filter((_, j) => j !== i))}>✕</button>
                  </div>
                )
              })}
              <button className="wa-btn wa-btn-ghost" onClick={() => setSite('nav', [...(merged.nav || []), { label: '新項目', to: '/wineswee' }])}>＋ 新增選單項目</button>
            </div>

            {SITE_GROUPS.map(g => (
              <div key={g.title}>
                <h3 className="wa-h3">{g.title}</h3>
                <div className="wa-fgrid">
                  {g.fields.map(f => <SiteField key={f.path} label={f.label} value={getIn(merged, f.path) ?? ''} onChange={v => setSite(f.path, v)} ta={f.ta} />)}
                </div>
              </div>
            ))}

            <h3 className="wa-h3">首頁・四大特點</h3>
            <div className="wa-list">
              {mani.map((m, i) => (
                <div className="wa-item wa-item-store" key={i}>
                  <label className="wa-f"><span>編號</span><input className="wa-input" value={m.n} onChange={e => setSite('manifesto', mani.map((x, j) => j === i ? { ...x, n: e.target.value } : x))} /></label>
                  <label className="wa-f wa-f-grow"><span>標題</span><input className="wa-input" value={m.title} onChange={e => setSite('manifesto', mani.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} /></label>
                  <label className="wa-f wa-f-grow"><span>說明</span><input className="wa-input" value={m.sub} onChange={e => setSite('manifesto', mani.map((x, j) => j === i ? { ...x, sub: e.target.value } : x))} /></label>
                </div>
              ))}
            </div>

            <h3 className="wa-h3">關於我們・四個堅持</h3>
            <div className="wa-list">
              {vals.map((v, i) => (
                <div className="wa-item wa-item-store" key={i}>
                  <label className="wa-f"><span>編號</span><input className="wa-input" value={v[0]} onChange={e => setSite('about.values', vals.map((r, j) => j === i ? [e.target.value, r[1], r[2]] : r))} /></label>
                  <label className="wa-f wa-f-grow"><span>標題</span><input className="wa-input" value={v[1]} onChange={e => setSite('about.values', vals.map((r, j) => j === i ? [r[0], e.target.value, r[2]] : r))} /></label>
                  <label className="wa-f wa-f-grow"><span>說明</span><input className="wa-input" value={v[2]} onChange={e => setSite('about.values', vals.map((r, j) => j === i ? [r[0], r[1], e.target.value] : r))} /></label>
                </div>
              ))}
            </div>

            <h3 className="wa-h3">首頁・情境選酒（4 格）</h3>
            <div className="wa-list">
              {(merged.occasions?.items || []).map((o, i) => {
                const setOcc = (k, v) => setSite('occasions.items', merged.occasions.items.map((x, j) => j === i ? { ...x, [k]: v } : x))
                return (
                  <div className="wa-card" key={i}>
                    <div className="wa-card-head">
                      <label className="wa-f"><span>中文標題</span><input className="wa-input" value={o.title || ''} onChange={e => setOcc('title', e.target.value)} /></label>
                      <label className="wa-f"><span>英文</span><input className="wa-input" value={o.en || ''} onChange={e => setOcc('en', e.target.value)} /></label>
                      <label className="wa-f wa-f-grow"><span>連結</span><input className="wa-input" value={o.to || ''} onChange={e => setOcc('to', e.target.value)} placeholder="/wineswee/category/red" /></label>
                    </div>
                    <label className="wa-f wa-f-grow" style={{ marginTop: 8 }}><span>說明</span><input className="wa-input" value={o.desc || ''} onChange={e => setOcc('desc', e.target.value)} /></label>
                    <div className="wa-sub">情境圖（留空＝自動用該分類代表商品圖）</div>
                    <Img value={o.image} onChange={v => setOcc('image', v)} upload={upload} />
                  </div>
                )
              })}
            </div>

            <h3 className="wa-h3">首頁 Banner 輪播</h3>
            <div className="wa-imgs">
              {banners.map((im, i) => (
                <div className="wa-imgs-item" key={i}>
                  <Img value={im} onChange={v => setSite('banners', banners.map((x, j) => j === i ? v : x))} upload={upload} />
                  <button className="wa-del sm" onClick={() => setSite('banners', banners.filter((_, j) => j !== i))}>移除</button>
                </div>
              ))}
              <button className="wa-btn wa-btn-ghost" onClick={() => setSite('banners', [...banners, ''])}>＋ 加一張 Banner</button>
            </div>
            <div className="wa-hint">留空則使用預設 4 張。</div>

            <h3 className="wa-h3">選購專區・分類說明</h3>
            <div className="wa-list">
              {CAT_META_KEYS.map(key => {
                const cat = CATEGORIES.find(c => c.key === key)
                return (
                  <label className="wa-f wa-f-grow wa-meta" key={key}>
                    <span>{cat?.label}</span>
                    <input className="wa-input" value={getIn(merged, `catMeta.${key}`) ?? getCatMeta(key)} onChange={e => setSite(`catMeta.${key}`, e.target.value)} />
                  </label>
                )
              })}
            </div>
          </section>
        )
      })()}

      {/* ── 版面設計:排序/開關首頁區塊 ── */}
      {tab === 'layout' && (() => {
        const merged = mergeSite(data.site)
        const setSite = (path, val) => patch('site', setIn(data.site || {}, path, val))
        const layout = merged.layout || []
        const move = (i, dir) => { const L = [...layout]; const j = i + dir; if (j < 0 || j >= L.length) return;[L[i], L[j]] = [L[j], L[i]]; setSite('layout', L) }
        const toggle = (i) => setSite('layout', layout.map((s, j) => j === i ? { ...s, on: s.on === false } : s))
        return (
          <section className="wa-panel">
            <div className="wa-panelhead">
              <span className="wa-count">↑↓ 排序、開關首頁各區塊（英雄大圖固定最上、頁尾固定最下）</span>
              <button className="wa-btn wa-btn-primary" disabled={saving === 'site'} onClick={() => save('site')}>{saving === 'site' ? '儲存中…' : '儲存並上線'}</button>
            </div>
            <div className="wa-hint">關掉的區塊首頁就不顯示；順序由上到下對應首頁由上到下。</div>
            <div className="wa-list">
              {layout.map((s, i) => (
                <div className={'wa-lay' + (s.on === false ? ' off' : '')} key={s.key}>
                  <span className="wa-lay-n">{i + 1}</span>
                  <span className="wa-lay-name">{SECTION_LABELS[s.key] || s.key}</span>
                  <label className="wa-switch"><input type="checkbox" checked={s.on !== false} onChange={() => toggle(i)} /><span>{s.on === false ? '隱藏中' : '顯示中'}</span></label>
                  <div className="wa-lay-move">
                    <button className="wa-btn wa-btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button className="wa-btn wa-btn-ghost" disabled={i === layout.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })()}
    </div>
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

// 單一商品的詳情編輯:英文名 / 規格 / 定價成本表(→會員價) / 摘要 / 段落
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
      <div className="wa-grid5">
        {SPEC_FIELDS.map(k => (
          <label className="wa-f" key={k}><span>{k}</span><input className="wa-input" value={d.spec?.[k] || ''} onChange={e => setSpec(k, e.target.value)} /></label>
        ))}
      </div>

      <div className="wa-sub">定價成本表 ·　<b>會員價 = 各列加總 = NT$ {memberPreview.toLocaleString()}</b>（也可在上方直接填「會員價」欄覆寫）</div>
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
