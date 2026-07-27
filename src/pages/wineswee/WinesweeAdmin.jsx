import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { STATIC, applyLocal } from './content'
import { CATEGORIES, CAT_META_KEYS, getCatMeta } from './data'
import './wineswee-admin.css'

const TABS = [
  { key: 'products', label: '商品' },
  { key: 'news', label: '最新消息' },
  { key: 'stores', label: '門市' },
  { key: 'site', label: '網站文案 / Banner' },
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

export default function WinesweeAdmin() {
  const { user, profile, role } = useAuth()
  const isAdmin = ['admin', 'super_admin'].includes(profile?.role) || ['admin', 'super_admin'].includes(role?.name)
  const [tab, setTab] = useState('products')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [msg, setMsg] = useState(null)
  const [q, setQ] = useState('')

  // ERP 外殼 #root 有 zoom + body overflow:hidden,後臺要放開才能捲動
  useEffect(() => {
    const root = document.getElementById('root'), b = document.body, h = document.documentElement
    const prev = { z: root?.style.zoom, bo: b.style.overflow, ho: h.style.overflow }
    if (root) root.style.zoom = '1'; b.style.overflow = 'visible'; h.style.overflow = 'auto'
    return () => { if (root) root.style.zoom = prev.z || ''; b.style.overflow = prev.bo; h.style.overflow = prev.ho }
  }, [])

  useEffect(() => {
    (async () => {
      const { data: db } = await supabase.rpc('get_wineswee_content').catch(() => ({ data: null }))
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

  async function save(section) {
    setSaving(section)
    const { error } = await supabase.rpc('save_wineswee_content', { _section: section, _data: data[section] })
    setSaving('')
    if (error) return flash('err', '儲存失敗：' + error.message)
    applyLocal(section, data[section])
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
              <button className="wa-btn wa-btn-ghost" onClick={() => patch('products', [{ name: '新商品', price: null, image: '', sold_out: false }, ...products])}>＋ 新增商品</button>
              <button className="wa-btn wa-btn-primary" disabled={saving === 'products'} onClick={() => save('products')}>{saving === 'products' ? '儲存中…' : '儲存並上線'}</button>
            </div>
          </div>
          <div className="wa-hint">分類會依商品名稱自動判斷（例如含「紅酒」歸紅酒）。顯示 {filtered.length} 項。</div>
          <div className="wa-list">
            {filtered.map((p) => {
              const idx = products.indexOf(p)
              const set = (k, v) => { const n = [...products]; n[idx] = { ...n[idx], [k]: v }; patch('products', n) }
              return (
                <div className="wa-item" key={idx}>
                  <Img value={p.image} onChange={v => set('image', v)} upload={upload} small />
                  <div className="wa-item-fields">
                    <label className="wa-f wa-f-grow"><span>名稱</span><input className="wa-input" value={p.name || ''} onChange={e => set('name', e.target.value)} /></label>
                    <label className="wa-f"><span>售價 NT$</span><input className="wa-input" type="number" value={p.price ?? ''} onChange={e => set('price', e.target.value === '' ? null : Number(e.target.value))} /></label>
                    <label className="wa-f wa-f-chk"><input type="checkbox" checked={!!p.sold_out} onChange={e => set('sold_out', e.target.checked)} /><span>售完</span></label>
                  </div>
                  <button className="wa-del" title="刪除" onClick={() => patch('products', products.filter((_, i) => i !== idx))}>✕</button>
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
          <div className="wa-list">
            {data.news.map((nw, idx) => {
              const set = (k, v) => { const n = [...data.news]; n[idx] = { ...n[idx], [k]: v }; patch('news', n) }
              const setImg = (i, v) => { const imgs = [...(nw.images || [])]; imgs[i] = v; set('images', imgs) }
              return (
                <div className="wa-card" key={nw.id ?? idx}>
                  <div className="wa-card-head">
                    <label className="wa-f wa-f-grow"><span>標題</span><input className="wa-input" value={nw.title || ''} onChange={e => set('title', e.target.value)} /></label>
                    <label className="wa-f"><span>日期</span><input className="wa-input" value={nw.date || ''} onChange={e => set('date', e.target.value)} placeholder="2026/05/21" /></label>
                    <button className="wa-del" onClick={() => patch('news', data.news.filter((_, i) => i !== idx))}>✕</button>
                  </div>
                  <div className="wa-sub">封面圖</div>
                  <Img value={nw.cover} onChange={v => set('cover', v)} upload={upload} />
                  <div className="wa-sub">內文圖（依序顯示）</div>
                  <div className="wa-imgs">
                    {(nw.images || []).map((im, i) => (
                      <div className="wa-imgs-item" key={i}>
                        <Img value={im} onChange={v => setImg(i, v)} upload={upload} small />
                        <button className="wa-del sm" onClick={() => set('images', nw.images.filter((_, j) => j !== i))}>移除</button>
                      </div>
                    ))}
                    <button className="wa-btn wa-btn-ghost" onClick={() => set('images', [...(nw.images || []), ''])}>＋ 加一張內文圖</button>
                  </div>
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
      {tab === 'site' && (
        <section className="wa-panel">
          <div className="wa-panelhead">
            <span className="wa-count">首頁輪播圖 + 選購專區分類說明</span>
            <button className="wa-btn wa-btn-primary" disabled={saving === 'site'} onClick={() => save('site')}>{saving === 'site' ? '儲存中…' : '儲存並上線'}</button>
          </div>

          <h3 className="wa-h3">首頁 Banner 輪播</h3>
          <div className="wa-imgs">
            {(data.site.banners || []).map((im, i) => (
              <div className="wa-imgs-item" key={i}>
                <Img value={im} onChange={v => { const b = [...data.site.banners]; b[i] = v; patch('site', { ...data.site, banners: b }) }} upload={upload} />
                <button className="wa-del sm" onClick={() => patch('site', { ...data.site, banners: data.site.banners.filter((_, j) => j !== i) })}>移除</button>
              </div>
            ))}
            <button className="wa-btn wa-btn-ghost" onClick={() => patch('site', { ...data.site, banners: [...(data.site.banners || []), ''] })}>＋ 加一張 Banner</button>
          </div>
          <div className="wa-hint">留空則使用預設 4 張。</div>

          <h3 className="wa-h3">選購專區・分類說明</h3>
          <div className="wa-list">
            {CAT_META_KEYS.map(key => {
              const cat = CATEGORIES.find(c => c.key === key)
              const val = data.site.catMeta?.[key] ?? getCatMeta(key)
              return (
                <label className="wa-f wa-f-grow wa-meta" key={key}>
                  <span>{cat?.label}</span>
                  <input className="wa-input" value={val} onChange={e => patch('site', { ...data.site, catMeta: { ...(data.site.catMeta || {}), [key]: e.target.value } })} />
                </label>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function Gate({ title, body }) {
  return <div className="wa"><div className="wa-gate"><h2>{title}</h2><p>{body}</p></div></div>
}
