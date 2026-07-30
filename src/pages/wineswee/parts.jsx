import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaFacebookF, FaInstagram, FaYoutube, FaLine } from 'react-icons/fa'
import { CATEGORIES, WINE_KEYS, FOOD_KEYS, getBanners, getStores, getSite } from './data'
import { loadContent, subscribe } from './content'

// 把 *文字* 轉成金色斜體 <em>(讓後台可用純文字標重點)
export function Em({ children }) {
  const parts = String(children ?? '').split(/(\*[^*]+\*)/g)
  return <>{parts.map((p, i) => (p.startsWith('*') && p.endsWith('*') && p.length > 2) ? <em key={i}>{p.slice(1, -1)}</em> : p)}</>
}

// CJK 斷行控制 — 詞句只在標點/分隔處換行,永不腰斬（避免「門/市」被拆兩行）
// 用法:<Balance>把餐桌上的美好，一次備齊</Balance>;可含 <br/> 與 <em>,字串節點自動分段
const SEP = /(?<=[，。、；：！？·・／·]|——|—| )/
function wrapCJK(node, key) {
  if (typeof node !== 'string') return node
  return node.split(SEP).filter(Boolean).map((s, i) => <span className="cw" key={key + '-' + i}>{s}</span>)
}
export function Balance({ children, tag: Tag = 'span', className = '', ...rest }) {
  const kids = Array.isArray(children) ? children : [children]
  return <Tag className={'ws-balance ' + className} {...rest}>{kids.map((c, i) => wrapCJK(c, i))}</Tag>
}

// 開場過場動畫(cinematic intro)— 只在首頁進場播一次
export function Intro() {
  const [phase, setPhase] = useState('in')
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('out'), 1200)
    const t2 = setTimeout(() => setPhase('done'), 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])
  if (phase === 'done') return null
  return (
    <div className={'ws-intro' + (phase === 'out' ? ' out' : '')}>
      <div className="ws-intro-in">
        <img className="ws-intro-logo" src={getSite().logo} alt="WINESWEE" />
        <span className="ws-intro-line" />
        <span className="ws-intro-sub">威 士 威 酒 食 超 市</span>
      </div>
    </div>
  )
}

// ERP body 是 overflow:hidden(儀表板外殼),wine 頁掛載時放開原生捲動,離開還原
// wine 頁全螢幕接管:把 ERP #root 的 zoom 設回 1(避免縮放破壞滾動)+ 放開 body 原生捲動。離開還原。
export function useBodyScroll() {
  const [, setTick] = useState(0)
  useEffect(() => {
    // 載入後臺內容(讀不到用靜態墊底),到貨後重繪整頁
    loadContent()
    const unsub = subscribe(() => setTick(t => t + 1))
    const root = document.getElementById('root'), b = document.body, h = document.documentElement
    const prev = { z: root?.style.zoom, bo: b.style.overflow, ho: h.style.overflow }
    if (root) root.style.zoom = '1'
    b.style.overflow = 'visible'
    b.style.overflowX = 'hidden'
    h.style.overflow = 'auto'
    return () => {
      unsub()
      if (root) root.style.zoom = prev.z || ''
      b.style.overflow = prev.bo; b.style.overflowX = ''; h.style.overflow = prev.ho
    }
  }, [])
}

export function Reveal({ children, className = '', tag = 'div', ...rest }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { threshold: 0.08 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const Tag = tag
  // 轉發其餘 props(style / dangerouslySetInnerHTML 等)給真正的 DOM;
  // 有 dangerouslySetInnerHTML 時不可同時給 children,故擇一。
  return rest.dangerouslySetInnerHTML
    ? <Tag ref={ref} className={`${className} reveal${shown ? ' in' : ''}`} {...rest} />
    : <Tag ref={ref} className={`${className} reveal${shown ? ' in' : ''}`} {...rest}>{children}</Tag>
}

export function ProductCard({ p, idx }) {
  // 會員價:優先用後台填的 member,否則以售價 9 折估;卡片外顯會員價,hover 才露原價
  const member = p.member != null ? Math.round(p.member) : (p.price != null ? Math.round(p.price * 0.9) : null)
  const hasMember = p.price != null && member != null && member < p.price
  return (
    <Link className={'card' + (p.sold_out ? ' sold' : '')} to={`/wineswee/product/${p.id}`}>
      <div className="card-frame">
        {p.image ? <img src={p.image} alt={p.name} loading="lazy" /> : <span className="card-ph">Wineswee</span>}
        {idx != null && <span className="card-idx">{String(idx).padStart(2, '0')}</span>}
        {p.sold_out && <span className="card-sold">SOLD OUT</span>}
        <span className="card-cta">VIEW</span>
      </div>
      <div className="card-body">
        <h3 title={p.name}>{p.name}</h3>
        {p.price ? (
          hasMember ? (
            <span className="price price-mem">
              <span className="u">NT$</span>{member.toLocaleString()}
              <em className="mem-tag">會員價</em>
              <span className="mem-orig">原價 <s>NT${p.price.toLocaleString()}</s></span>
            </span>
          ) : (
            <span className="price"><span className="u">NT$</span>{p.price.toLocaleString()}</span>
          )
        ) : <span className="price ask">價格洽詢</span>}
      </div>
    </Link>
  )
}

export function ProductRow({ no, id, title, en, items, tone = 'light' }) {
  const track = useRef(null)
  const [ref, shown] = useRevealRef()
  const scroll = d => track.current?.scrollBy({ left: d * track.current.clientWidth * 0.82, behavior: 'smooth' })
  if (!items.length) return null
  return (
    <section id={id} ref={ref} className={`sec sec-${tone} reveal${shown ? ' in' : ''}`}>
      <div className="wrap">
        <div className="sec-head">
          <span className="numeral">{no}</span>
          <div className="ht"><span className="kicker">Selection</span><h2>{title} <span className="en">/ {en}</span></h2></div>
        </div>
        <div className="track-wrap">
          <button className="track-side prev" onClick={() => scroll(-1)} aria-label="上一批">‹</button>
          <div className="track" ref={track}>{items.map((p, i) => <ProductCard key={p.id} p={p} idx={i + 1} />)}</div>
          <button className="track-side next" onClick={() => scroll(1)} aria-label="下一批">›</button>
        </div>
        <div className="rowmore"><Link to={`/wineswee/category/${id.replace('cat-', '')}`}>看全部 {title}</Link></div>
      </div>
    </section>
  )
}

function useRevealRef() {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { threshold: 0.08 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, shown]
}

export function HeroSlider() {
  const [i, setI] = useState(0)
  const banners = getBanners()
  const n = banners.length
  const go = d => setI(v => (v + d + n) % n)
  useEffect(() => { const t = setInterval(() => setI(v => (v + 1) % n), 6000); return () => clearInterval(t) }, [n])
  const h = getSite().hero
  return (
    <section className="hero" id="top">
      <div className="hero-left">
        <span className="hero-est">EST. — 威士威酒食超市</span>
        <div className="hero-copy">
          <span className="kicker on-dark">{h.kicker}</span>
          <h1><span className="r1">{h.title1}</span><span className="r2"><Em>{h.title2}</Em></span></h1>
          <p className="hero-sub">{h.sub}</p>
          <div className="hero-cta">
            <a className="btn btn-gold" href="#cat-red">{h.cta1}</a>
            <a className="btn btn-outline" href="#shop">{h.cta2}</a>
          </div>
        </div>
      </div>
      <div className="hero-right">
        {banners.map((b, idx) => (
          <div key={b} className={'hero-slide' + (idx === i ? ' on' : '')} aria-hidden={idx !== i}><img src={b} alt="" /></div>
        ))}
        <div className="hero-rt-veil" />
        <div className="hero-nav">
          <span className="hero-count"><b>{String(i + 1).padStart(2, '0')}</b> / {String(n).padStart(2, '0')}</span>
          <button className="harw" onClick={() => go(-1)} aria-label="上一張">‹</button>
          <button className="harw" onClick={() => go(1)} aria-label="下一張">›</button>
        </div>
      </div>
    </section>
  )
}

export function Header() {
  const [open, setOpen] = useState(false)
  const site = getSite()
  const C = site.contact
  const nav = site.nav || []
  const wine = CATEGORIES.filter(c => WINE_KEYS.includes(c.key))
  const food = CATEGORIES.filter(c => FOOD_KEYS.includes(c.key))
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [open])
  const close = () => setOpen(false)
  // 解析 nav 連結:@line / @email / http / 站內路徑
  const ext = to => to === '@line' ? { href: C.line, target: '_blank', rel: 'noreferrer' }
    : to === '@email' ? { href: `mailto:${C.email}` }
      : /^https?:/.test(to) ? { href: to, target: '_blank', rel: 'noreferrer' } : null
  const Drop = ({ label, items }) => (
    <div className="nav-drop">
      <span className="nav-top">{label}<i className="caret" /></span>
      <div className="drop"><div className="drop-grid">
        {items.map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`}><span>{c.label}</span><em>{c.en}</em></Link>)}
      </div></div>
    </div>
  )
  return (
    <>
    <header className="header">
      <div className="header-ann">{site.announce}</div>
      <div className="wrap header-in">
        <Link className="logo" to="/wineswee" aria-label="Wineswee 威士威酒食超市" onClick={close}><img src={site.logo} alt="Wineswee 威士威酒食超市" /></Link>
        <nav className="nav">
          {nav.map((it, i) => {
            if (it.drop) return <Drop key={i} label={it.label} items={it.drop === 'wine' ? wine : food} />
            const e = ext(it.to)
            return e ? <a key={i} className="nav-top" {...e}>{it.label}</a>
              : <Link key={i} className="nav-top" to={it.to || '/wineswee'}>{it.label}</Link>
          })}
        </nav>
        <div className="header-cta">
          <a className="chip chip-line" href={C.line} target="_blank" rel="noreferrer">LINE 訂購</a>
          <button className={'burger' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-label="選單" aria-expanded={open}><span /><span /><span /></button>
        </div>
      </div>
    </header>

      {/* 手機/平板選單(置於 header 外,避免 backdrop-filter 造成 fixed containing block) */}
      <div className={'navmob' + (open ? ' open' : '')} onClick={close}>
        <div className="navmob-in" onClick={e => e.stopPropagation()}>
          {nav.map((it, i) => {
            if (it.drop) return <div className="nm-grp" key={i}><h5>{it.label}</h5><div className="nm-cats">{(it.drop === 'wine' ? wine : food).map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`} onClick={close}>{c.label}<em>{c.en}</em></Link>)}</div></div>
            const e = ext(it.to)
            return e ? <a key={i} className="nm-lead" {...e} onClick={close}>{it.label}</a>
              : <Link key={i} className="nm-lead" to={it.to || '/wineswee'} onClick={close}>{it.label}</Link>
          })}
          <a className="btn btn-line nm-line" href={C.line} target="_blank" rel="noreferrer">加入 LINE 訂購</a>
        </div>
      </div>
    </>
  )
}

// 右側懸浮社群列 + 回到頂端
export function SideRail() {
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 480)
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const C = getSite().contact
  return (
    <div className="siderail">
      <a className="rail-ic" href={C.fb} target="_blank" rel="noreferrer" aria-label="Facebook"><FaFacebookF /></a>
      <a className="rail-ic" href={C.ig} target="_blank" rel="noreferrer" aria-label="Instagram"><FaInstagram /></a>
      <a className="rail-ic" href={C.yt} target="_blank" rel="noreferrer" aria-label="YouTube"><FaYoutube /></a>
      <a className="rail-ic rail-line" href={C.line} target="_blank" rel="noreferrer" aria-label="LINE"><FaLine /></a>
      <button className={'rail-top' + (showTop ? ' on' : '')} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="回到頂端">
        <span>▲</span>TOP
      </button>
    </div>
  )
}

export function Footer() {
  const site = getSite()
  const C = site.contact
  const mapUrl = s => `https://www.google.com/maps/search/${encodeURIComponent('威士威酒食超市 ' + s.full + ' ' + s.addr)}`
  return (
    <>
      <SideRail />
      <footer className="footer">
        <div className="wrap footer-grid">
          {/* 品牌 + 客服 */}
          <div className="footer-brand">
            <img className="footer-logo" src={site.logo} alt="Wineswee 威士威酒食超市" />
            <a className="footer-mail" href={`mailto:${C.email}`}>客服信箱：{C.email}</a>
            <div className="footer-social">
              <a href={C.fb} target="_blank" rel="noreferrer">Facebook</a>
              <a href={C.ig} target="_blank" rel="noreferrer">Instagram</a>
              <a href={C.line} target="_blank" rel="noreferrer">LINE</a>
            </div>
          </div>
          {/* 全台門市名錄 */}
          <div className="footer-stores">
            {getStores().map((s, i) => (
              <a key={i} className="fstore" href={mapUrl(s)} target="_blank" rel="noreferrer">
                <span className="fs-name">{s.full}</span>
                <span className="fs-tel">{s.tel}</span>
                <span className="fs-addr">{s.addr}</span>
              </a>
            ))}
          </div>
          {/* 導覽 */}
          <div className="footer-nav">
            <Link to="/wineswee/about">關於我們</Link>
            <Link to="/wineswee/news">最新消息</Link>
            <Link to="/wineswee/stores">門市據點</Link>
            <a href={`mailto:${C.email}`}>聯繫我們</a>
          </div>
        </div>
        <div className="footer-copy">Copyright © 2026 WINESWEE 威士威酒食超市. All Rights Reserved.</div>
      </footer>
      <div className="ws-legalbar">{site.legal}</div>
    </>
  )
}
