import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { CATEGORIES, byCategory, getAll, getNewsList, getStores, getSite, getCatMeta, catPriceFrom, catHeroImage } from './data'
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
  useEffect(() => {
    if (window.location.hash) { const el = document.querySelector(window.location.hash); if (el) setTimeout(() => el.scrollIntoView(), 60) }
  }, [])

  return (
    <div className="ws">
      <Intro />
      <Header home />
      <HeroSlider />

      {/* manifesto */}
      <section className="mani">
        <div className="wrap mani-in">
          {site.manifesto.map((m, i) => <div className="mani-cell" key={i}><div className="n">{m.n}</div><h4>{m.title}</h4><p>{m.sub}</p></div>)}
        </div>
      </section>

      {/* 分類入口 */}
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
                    <div className="entry-hd">
                      <h3>{c.label}</h3>
                      <span className="entry-count">{n} 款</span>
                    </div>
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

      {/* 一味精選 */}
      <ProductRow no="02" id="cat-red" title={H.rowTitle} en={H.rowEn} items={(cats.red || []).slice(0, 12)} tone="cream" />

      {/* spotlight */}
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

      {/* 故事預告 → 關於我們 */}
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

      {/* 消息預告 → 最新消息 */}
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

      {/* 門市預告 → 門市頁 */}
      <Reveal tag="section" className="sec sec-cream">
        <div className="wrap" id="store">
          <div className="sec-head">
            <span className="numeral">11</span>
            <div className="ht"><span className="kicker">Our Stores</span><h2>全台 11 家門市 <span className="en">/ Visit us</span></h2></div>
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

      {/* cta */}
      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2><Em>{H.ctaTitle}</Em></h2><p>{H.ctaDesc}</p></div>
          <a className="btn btn-line" href={site.contact.line} target="_blank" rel="noreferrer">{H.ctaBtn}</a>
        </div>
      </Reveal>

      <Footer />
    </div>
  )
}
