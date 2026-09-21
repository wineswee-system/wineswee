import { useEffect, Fragment } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { CATEGORIES, byCategory, getAll, getNewsList, getStores, getSite, getCatMeta, catPriceFrom, catHeroImage, DEFAULT_LAYOUT } from './data'
import { Header, HeroSlider, ProductRow, Reveal, Footer, useBodyScroll, Intro, Em } from './parts'

function spotlight() {
  const cats = byCategory()
  const out = []
  for (const k of ['red', 'whisky', 'cheese', 'sparkling']) { const h = (cats[k] || []).find(p => p.image && !p.sold_out); if (h) out.push(h) }
  while (out.length < 4) { const e = getAll().find(p => p.image && !p.sold_out && !out.includes(p)); if (!e) break; out.push(e) }
  return out.slice(0, 4)
}

export default function Wineswee() {
  useBodyScroll()
  const cats = byCategory()
  const spot = spotlight()
  const site = getSite()
  const H = site.home
  const OC = site.occasions
  const CC = site.concierge
  useEffect(() => {
    if (window.location.hash) { const el = document.querySelector(window.location.hash); if (el) setTimeout(() => el.scrollIntoView(), 60) }
  }, [])

  // 各首頁區塊(後台可排序/開關) — key 對應 site.layout
  const blocks = {
    manifesto: (
      <section className="mani">
        <div className="wrap mani-in">
          {site.manifesto.map((m, i) => <div className="mani-cell" key={i}><div className="n">{m.n}</div><h4>{m.title}</h4><p>{m.sub}</p></div>)}
        </div>
      </section>
    ),
    category: (
      <Reveal tag="section" className="sec sec-light">
        <div className="wrap" id="shop">
          <div className="sec-head">
            <span className="numeral">01</span>
            <div className="ht"><span className="kicker">{H.shopKicker}</span><h2>{H.shopTitle} <span className="en">/ Explore</span></h2></div>
          </div>
          <div className="entry-grid">
            {CATEGORIES.filter(c => (cats[c.key] || []).length).map(c => {
              const n = (cats[c.key] || []).length
              const from = catPriceFrom(c.key)
              const img = catHeroImage(c.key)
              return (
                <Link key={c.key} className="entry" to={`/wineswee/category/${c.key}`}>
                  <div className="entry-media">
                    {img && <img src={img} alt={c.label} loading="lazy" />}
                    <span className="entry-tag">{c.en}</span>
                  </div>
                  <div className="entry-body">
                    <div className="entry-hd"><h3>{c.label}</h3><span className="entry-count">{n} 款</span></div>
                    <p className="entry-desc">{getCatMeta(c.key)}</p>
                    <div className="entry-foot">
                      <span className="entry-from">{from ? <><em>NT$</em> {from.toLocaleString()} 起</> : '嚴選推薦'}</span>
                      <span className="entry-go">探索<i>→</i></span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </Reveal>
    ),
    occasions: (
      <Reveal tag="section" className="occ">
        <div className="wrap occ-in">
          <div className="sec-head">
            <span className="numeral">＊</span>
            <div className="ht"><span className="kicker on-dark">{OC.kicker}</span><h2><Em>{OC.title}</Em></h2></div>
          </div>
          <p className="occ-lead">{OC.lead}</p>
          <div className="occ-grid">
            {OC.items.map((o, i) => {
              const catKey = (o.to || '').split('/').pop()
              const img = o.image || catHeroImage(catKey)
              return (
                <Link key={i} className="occ-card" to={o.to}>
                  <div className="occ-media">{img && <img src={img} alt={o.title} loading="lazy" />}<span className="occ-idx">{String(i + 1).padStart(2, '0')}</span></div>
                  <div className="occ-body">
                    <span className="occ-en">{o.en}</span>
                    <h3>{o.title}</h3>
                    <p>{o.desc}</p>
                    <span className="occ-go">為這場合選酒<i>→</i></span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </Reveal>
    ),
    row: <ProductRow no="02" id="cat-red" title={H.rowTitle} en={H.rowEn} items={(cats.red || []).slice(0, 12)} tone="cream" />,
    spotlight: (
      <Reveal tag="section" className="spot">
        <div className="wrap spot-in">
          <div className="spot-txt">
            <span className="kicker on-dark">{H.spotKicker}</span>
            <h2><Em>{H.spotTitle}</Em></h2>
            <p>{H.spotDesc}</p>
            <Link className="btn btn-gold" to="/wineswee/category/red">{H.spotCta}</Link>
          </div>
          <div className="spot-grid">
            {spot.map((p, k) => (
              <Link key={k} className="spot-fig" to={`/wineswee/product/${p.id}`}>
                {p.image && <img src={p.image} alt={p.name} loading="lazy" />}
                <figcaption>Selection<b>{p.name}</b></figcaption>
              </Link>
            ))}
          </div>
        </div>
      </Reveal>
    ),
    concierge: (
      <Reveal tag="section" className="concierge">
        <div className="wrap conc-in">
          <div className="conc-txt">
            <span className="kicker">{CC.kicker}</span>
            <h2><Em>{CC.title}</Em></h2>
            <p>{CC.desc}</p>
            <div className="conc-cta">
              <a className="btn btn-line" href={site.contact.line} target="_blank" rel="noreferrer">{CC.btn}</a>
              <Link className="btn btn-outline-ink" to="/wineswee/stores">找門市試味</Link>
            </div>
            <span className="conc-perk">{CC.perk}</span>
          </div>
          <div className="conc-fig" aria-hidden="true">
            <svg viewBox="0 0 120 120" className="conc-glass"><path fill="none" stroke="currentColor" strokeWidth="1.4" d="M32 20h56l-6 34a22 22 0 0 1-44 0zM60 76v20M44 96h32" /><circle cx="60" cy="44" r="12" fill="currentColor" opacity=".12" /></svg>
          </div>
        </div>
      </Reveal>
    ),
    story: (
      <Reveal tag="section" className="story">
        <div className="wrap story-in" id="story">
          <span className="kicker on-dark">{H.storyKicker}</span>
          <h2><Em>{H.storyTitle}</Em></h2>
          <p>{H.storyBody}</p>
          <div className="story-stats">
            <div><b>{getAll().length}</b><span>嚴選品項</span></div>
            <div><b>{getStores().length}</b><span>全台門市</span></div>
            <div><b>{H.statPrice}</b><span>{H.statPriceLabel}</span></div>
          </div>
          <div className="teaser-more"><Link to="/wineswee/about">{H.storyLink} →</Link></div>
        </div>
      </Reveal>
    ),
    news: (
      <Reveal tag="section" className="sec sec-light">
        <div className="wrap">
          <div className="sec-head">
            <span className="numeral">＊</span>
            <div className="ht"><span className="kicker">Journal</span><h2>最新消息 <span className="en">/ News</span></h2></div>
            <Link className="rowmore-link" to="/wineswee/news">看全部消息</Link>
          </div>
          <div className="news-grid">
            {getNewsList().slice(0, 4).map(n => (
              <Link key={n.id} className="news-card" to={`/wineswee/news/${n.id}`}>
                <div className="news-img">{n.image && <img src={n.image} alt={n.title} loading="lazy" />}<span className="news-go">閱讀更多</span></div>
                <div className="news-body"><span className="news-tag">Journal</span><h3>{n.title}</h3></div>
              </Link>
            ))}
          </div>
        </div>
      </Reveal>
    ),
    stores: (
      <Reveal tag="section" className="sec sec-cream">
        <div className="wrap" id="store">
          <div className="sec-head">
            <span className="numeral">{getStores().length}</span>
            <div className="ht"><span className="kicker">Our Stores</span><h2>全台 {getStores().length} 家門市 <span className="en">/ Visit us</span></h2></div>
            <Link className="rowmore-link" to="/wineswee/stores">門市詳情</Link>
          </div>
          <div className="stores-list">
            {getStores().map((s, i) => (
              <Link key={i} className="store" to="/wineswee/stores">
                <span className="no">{String(i + 1).padStart(2, '0')}</span><span className="rg">{s.region}</span><span className="tel">{s.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </Reveal>
    ),
    cta: (
      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2><Em>{H.ctaTitle}</Em></h2><p>{H.ctaDesc}</p></div>
          <a className="btn btn-line" href={site.contact.line} target="_blank" rel="noreferrer">{H.ctaBtn}</a>
        </div>
      </Reveal>
    ),
  }

  const layout = (site.layout && site.layout.length ? site.layout : DEFAULT_LAYOUT)

  return (
    <div className="ws">
      <Intro />
      <Header home />
      <HeroSlider />
      {layout.filter(s => s.on !== false && blocks[s.key]).map(s => <Fragment key={s.key}>{blocks[s.key]}</Fragment>)}
      <Footer />
    </div>
  )
}
