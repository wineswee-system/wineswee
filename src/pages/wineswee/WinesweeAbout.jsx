import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { getAll, getStores, getSite } from './data'
import { Header, Footer, Reveal, useBodyScroll, Balance, Em } from './parts'

export default function WinesweeAbout() {
  useBodyScroll()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const site = getSite()
  const A = site.about
  return (
    <div className="ws">
      <Header />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">{A.kicker}</span>
          <Balance tag="h1">{A.title}</Balance>
          <p className="page-lead">{A.lead}</p>
        </div>
      </section>

      <Reveal tag="section" className="story">
        <div className="wrap story-in">
          <span className="kicker on-dark">Our Story</span>
          <h2><Em>{A.storyTitle}</Em></h2>
          <p>{A.storyBody}</p>
          <div className="story-stats">
            <div><b>{getAll().length}</b><span>嚴選品項</span></div>
            <div><b>{getStores().length}</b><span>全台門市</span></div>
            <div><b>{site.home.statPrice}</b><span>{site.home.statPriceLabel}</span></div>
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="sec sec-light">
        <div className="wrap">
          <div className="sec-head">
            <span className="numeral">＊</span>
            <div className="ht"><span className="kicker">Why Wineswee</span><h2>我們的堅持 <span className="en">/ Values</span></h2></div>
          </div>
          <div className="entry-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
            {A.values.map(([n, t, d]) => (
              <div key={n} className="storefull" style={{ aspectRatio: 'auto' }}>
                <div className="storefull-top"><span className="storefull-rg">{n}</span><h3>{t}</h3></div>
                <p style={{ color: 'var(--ink-soft)', fontSize: 17, fontWeight: 300, lineHeight: 1.7 }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="sec sec-light">
        <div className="wrap video-in">
          <div className="video-txt">
            <span className="kicker">Story Film</span>
            <Balance tag="h2">{A.filmTitle}</Balance>
            <p>{A.filmBody}</p>
            <Link className="btn btn-ink" to="/wineswee/category/red">{A.filmCta}</Link>
          </div>
          <div className="video-frame">
            <iframe src={site.contact.ytEmbed} title="Wineswee" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2><Em>{A.ctaTitle}</Em></h2><p>{A.ctaBody}</p></div>
          <Link className="btn btn-gold" to="/wineswee/stores">{A.ctaBtn}</Link>
        </div>
      </Reveal>
      <Footer />
    </div>
  )
}
