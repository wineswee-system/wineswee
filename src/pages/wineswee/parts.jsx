import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, WINE_KEYS, FOOD_KEYS, BANNERS, SITE, STORES } from './data'

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
        <img className="ws-intro-logo" src={SITE.logo} alt="WINESWEE" />
        <span className="ws-intro-line" />
        <span className="ws-intro-sub">威 士 威 酒 食 超 市</span>
      </div>
    </div>
  )
}

// ERP body 是 overflow:hidden(儀表板外殼),wine 頁掛載時放開原生捲動,離開還原
// wine 頁全螢幕接管:把 ERP #root 的 zoom 設回 1(避免縮放破壞滾動)+ 放開 body 原生捲動。離開還原。
export function useBodyScroll() {
  useEffect(() => {
    const root = document.getElementById('root'), b = document.body, h = document.documentElement
    const prev = { z: root?.style.zoom, bo: b.style.overflow, ho: h.style.overflow }
    if (root) root.style.zoom = '1'
    b.style.overflow = 'visible'
    b.style.overflowX = 'hidden'
    h.style.overflow = 'auto'
    return () => {
      if (root) root.style.zoom = prev.z || ''
      b.style.overflow = prev.bo; b.style.overflowX = ''; h.style.overflow = prev.ho
    }
  }, [])
}

export function Reveal({ children, className = '', tag = 'div' }) {
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
  return <Tag ref={ref} className={`${className} reveal${shown ? ' in' : ''}`}>{children}</Tag>
}

export function ProductCard({ p, idx }) {
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
        {p.price ? <span className="price"><span className="u">NT$</span>{p.price.toLocaleString()}</span>
          : <span className="price ask">價格洽詢</span>}
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
  const n = BANNERS.length
  const go = d => setI(v => (v + d + n) % n)
  useEffect(() => { const t = setInterval(() => setI(v => (v + 1) % n), 6000); return () => clearInterval(t) }, [n])
  return (
    <section className="hero" id="top">
      <div className="hero-left">
        <span className="hero-est">EST. — 威士威酒食超市</span>
        <div className="hero-copy">
          <span className="kicker on-dark">Wine · Whisky · Gourmet</span>
          <h1><span className="r1">為每一次相聚，</span><span className="r2">斟一杯剛剛好的<em>講究</em>。</span></h1>
          <p className="hero-sub">嚴選世界餐酒與佐餐美食——從波爾多列級到里奧哈、伊比利火腿到歐陸乳酪，一站備齊你的餐桌。</p>
          <div className="hero-cta">
            <a className="btn btn-gold" href="#cat-red">開始選酒</a>
            <a className="btn btn-outline" href="#shop">探索選品</a>
          </div>
        </div>
      </div>
      <div className="hero-right">
        {BANNERS.map((b, idx) => (
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
  const wine = CATEGORIES.filter(c => WINE_KEYS.includes(c.key))
  const food = CATEGORIES.filter(c => FOOD_KEYS.includes(c.key))
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [open])
  const Drop = ({ label, items }) => (
    <div className="nav-drop">
      <span className="nav-top">{label}<i className="caret" /></span>
      <div className="drop"><div className="drop-grid">
        {items.map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`}><span>{c.label}</span><em>{c.en}</em></Link>)}
      </div></div>
    </div>
  )
  const close = () => setOpen(false)
  return (
    <>
    <header className="header">
      <div className="header-ann">威士威酒食超市　·　全台 11 家門市　·　線上宅配到府　·　未滿十八歲禁止飲酒</div>
      <div className="wrap header-in">
        <Link className="logo" to="/wineswee" aria-label="Wineswee 威士威酒食超市" onClick={close}><img src={SITE.logo} alt="Wineswee 威士威酒食超市" /></Link>
        <nav className="nav">
          <Link className="nav-top" to="/wineswee/about">關於我們</Link>
          <Drop label="酒類專區" items={wine} />
          <Drop label="美食／酒器" items={food} />
          <Link className="nav-top" to="/wineswee/news">主題活動</Link>
          <Link className="nav-top" to="/wineswee/news">酒品知識</Link>
          <Link className="nav-top" to="/wineswee/stores">門市資訊</Link>
          <a className="nav-top" href={SITE.line} target="_blank" rel="noreferrer">加入會員</a>
          <a className="nav-top" href={SITE.line} target="_blank" rel="noreferrer">訂單查詢</a>
          <a className="nav-top" href={`mailto:${SITE.email}`}>加盟專區</a>
        </nav>
        <div className="header-cta">
          <a className="chip chip-line" href={SITE.line} target="_blank" rel="noreferrer">LINE 訂購</a>
          <button className={'burger' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-label="選單" aria-expanded={open}><span /><span /><span /></button>
        </div>
      </div>
    </header>

      {/* 手機/平板選單(置於 header 外,避免 backdrop-filter 造成 fixed containing block) */}
      <div className={'navmob' + (open ? ' open' : '')} onClick={close}>
        <div className="navmob-in" onClick={e => e.stopPropagation()}>
          <Link className="nm-lead" to="/wineswee/about" onClick={close}>關於我們</Link>
          <div className="nm-grp"><h5>酒類專區</h5><div className="nm-cats">{wine.map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`} onClick={close}>{c.label}<em>{c.en}</em></Link>)}</div></div>
          <div className="nm-grp"><h5>美食・酒器</h5><div className="nm-cats">{food.map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`} onClick={close}>{c.label}<em>{c.en}</em></Link>)}</div></div>
          <Link className="nm-lead" to="/wineswee/news" onClick={close}>主題活動・酒品知識</Link>
          <Link className="nm-lead" to="/wineswee/stores" onClick={close}>門市資訊</Link>
          <a className="nm-lead" href={SITE.line} target="_blank" rel="noreferrer">加入會員・訂單查詢</a>
          <a className="nm-lead" href={`mailto:${SITE.email}`}>加盟專區</a>
          <a className="btn btn-line nm-line" href={SITE.line} target="_blank" rel="noreferrer">加入 LINE 訂購</a>
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
  return (
    <div className="siderail">
      <a className="rail-ic" href={SITE.fb} target="_blank" rel="noreferrer" aria-label="Facebook">
        <svg viewBox="0 0 24 24"><path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.25-1.5 1.55-1.5H17V4.6c-.3 0-1.3-.1-2.45-.1-2.4 0-4.05 1.47-4.05 4.17v2.32H7.7V14h2.8v8z" /></svg>
      </a>
      <a className="rail-ic" href={SITE.ig} target="_blank" rel="noreferrer" aria-label="Instagram">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" /></svg>
      </a>
      <a className="rail-ic" href="https://www.youtube.com/watch?v=ZZccVDRoR2M" target="_blank" rel="noreferrer" aria-label="YouTube">
        <svg viewBox="0 0 24 24"><path d="M22 8.2s-.2-1.4-.8-2c-.75-.8-1.6-.8-2-.85C16.35 5.15 12 5.15 12 5.15h0s-4.35 0-7.2.2c-.4.05-1.25.05-2 .85-.6.6-.8 2-.8 2S1.8 9.85 1.8 11.5v.95c0 1.65.2 3.3.2 3.3s.2 1.4.8 2c.76.8 1.75.77 2.2.86 1.6.15 6.8.2 6.8.2s4.35-.01 7.2-.21c.4-.05 1.25-.05 2-.85.6-.6.8-2 .8-2s.2-1.65.2-3.3v-.95c0-1.65-.2-3.3-.2-3.3zM10.15 14.8V9.2l4.7 2.8z" /></svg>
      </a>
      <a className="rail-ic rail-line" href={SITE.line} target="_blank" rel="noreferrer" aria-label="LINE">
        <svg viewBox="0 0 24 24"><path d="M12 3.2c-5.1 0-9.3 3.35-9.3 7.48 0 3.7 3.32 6.8 7.8 7.38.3.06.72.2.83.46.1.24.06.6.03.85l-.13.8c-.04.24-.19.94.83.51 1.02-.43 5.5-3.24 7.5-5.55 1.38-1.51 2.04-3.05 2.04-4.86 0-4.13-4.2-7.48-9.3-7.48z" /></svg>
      </a>
      <button className={'rail-top' + (showTop ? ' on' : '')} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="回到頂端">
        <span>▲</span>TOP
      </button>
    </div>
  )
}

export function Footer() {
  const mapUrl = s => `https://www.google.com/maps/search/${encodeURIComponent('威士威酒食超市 ' + s.full + ' ' + s.addr)}`
  return (
    <>
      <SideRail />
      <footer className="footer">
        <div className="wrap footer-grid">
          {/* 品牌 + 客服 */}
          <div className="footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="footer-logo" src={SITE.logo} alt="Wineswee 威士威酒食超市" />
            <a className="footer-mail" href={`mailto:${SITE.email}`}>客服信箱：{SITE.email}</a>
            <div className="footer-social">
              <a href={SITE.fb} target="_blank" rel="noreferrer">Facebook</a>
              <a href={SITE.ig} target="_blank" rel="noreferrer">Instagram</a>
              <a href={SITE.line} target="_blank" rel="noreferrer">LINE</a>
            </div>
          </div>
          {/* 全台門市名錄 */}
          <div className="footer-stores">
            {STORES.map((s, i) => (
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
            <a href={`mailto:${SITE.email}`}>聯繫我們</a>
          </div>
        </div>
        <div className="footer-copy">Copyright © 2026 WINESWEE 威士威酒食超市. All Rights Reserved.</div>
      </footer>
      <div className="ws-legalbar">禁止酒駕　　未滿十八歲禁止飲酒</div>
    </>
  )
}
