import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, WINE_KEYS, FOOD_KEYS, BANNERS, SITE } from './data'

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
          <div className="arrows"><button onClick={() => scroll(-1)} aria-label="上一批">‹</button><button onClick={() => scroll(1)} aria-label="下一批">›</button></div>
        </div>
        <div className="track" ref={track}>{items.map((p, i) => <ProductCard key={p.id} p={p} idx={i + 1} />)}</div>
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
            <a className="btn btn-outline" href={SITE.shop} target="_blank" rel="noreferrer">官網商城</a>
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

export function Header({ home = false }) {
  const sec = a => (home ? a : '/wineswee' + a)
  const wine = CATEGORIES.filter(c => WINE_KEYS.includes(c.key))
  const food = CATEGORIES.filter(c => FOOD_KEYS.includes(c.key))
  const Drop = ({ label, items }) => (
    <div className="nav-drop">
      <span className="nav-top">{label}<i className="caret" /></span>
      <div className="drop"><div className="drop-grid">
        {items.map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`}><span>{c.label}</span><em>{c.en}</em></Link>)}
      </div></div>
    </div>
  )
  return (
    <header className="header">
      <div className="wrap header-in">
        <Link className="logo" to="/wineswee" aria-label="Wineswee 威士威酒食超市"><img src={SITE.logo} alt="Wineswee 威士威酒食超市" /></Link>
        <nav className="nav">
          <a className="nav-top" href={sec('#story')}>關於我們</a>
          <Drop label="酒類專區" items={wine} />
          <Drop label="美食／酒器" items={food} />
          <a className="nav-top" href={sec('#news')}>主題活動</a>
          <a className="nav-top" href={sec('#story')}>酒品知識</a>
          <a className="nav-top" href={sec('#store')}>門市資訊</a>
          <a className="nav-top" href={SITE.shop} target="_blank" rel="noreferrer">加入會員</a>
          <a className="nav-top" href={SITE.shop} target="_blank" rel="noreferrer">訂單查詢</a>
          <a className="nav-top" href={SITE.shop} target="_blank" rel="noreferrer">加盟專區</a>
        </nav>
        <div className="header-cta"><a className="chip chip-line" href={SITE.line} target="_blank" rel="noreferrer">LINE 訂購</a></div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-top">
        <div className="footer-brand">
          <div className="footer-word">WINESWEE<em>威士威酒食超市</em></div>
          <p>紅白葡萄酒・威士忌・清酒・肉品・乳酪・海鮮・酒器禮盒——一站備齊你的餐桌。</p>
        </div>
        <div className="footer-col"><h4>選購</h4>{CATEGORIES.slice(0, 6).map(c => <Link key={c.key} to={`/wineswee/category/${c.key}`}>{c.label}</Link>)}</div>
        <div className="footer-col"><h4>Contact</h4>
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
          <a href={SITE.shop} target="_blank" rel="noreferrer">官網商城</a>
          <a href={SITE.line} target="_blank" rel="noreferrer">LINE 官方帳號</a>
        </div>
        <div className="footer-col"><h4>Follow</h4>
          <a href={SITE.fb} target="_blank" rel="noreferrer">Facebook</a>
          <a href={SITE.ig} target="_blank" rel="noreferrer">Instagram</a>
        </div>
      </div>
      <div className="wrap footer-bar"><span>© 2026 Wineswee 威士威酒食超市</span><span>未滿十八歲禁止飲酒・飲酒過量有害健康・禁止酒駕</span></div>
    </footer>
  )
}
