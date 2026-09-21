import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { getNewsList, getSite } from './data'
import { Header, Footer, Reveal, useBodyScroll } from './parts'

export default function WinesweeNews() {
  useBodyScroll()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return (
    <div className="ws">
      <Header />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">Journal</span>
          <h1>最新消息</h1>
          <p className="page-lead">最新活動、新品上架、酒品知識與主題企劃——威士威的第一手消息都在這裡。</p>
        </div>
      </section>
      <Reveal tag="section" className="sec sec-light">
        <div className="wrap">
          <div className="news-grid">
            {getNewsList().map(n => (
              <Link key={n.id} className="news-card" to={`/wineswee/news/${n.id}`}>
                <div className="news-img">{n.image && <img src={n.image} alt={n.title} loading="lazy" />}<span className="news-go">閱讀更多</span></div>
                <div className="news-body"><span className="news-tag">Journal</span><h3>{n.title}</h3></div>
              </Link>
            ))}
          </div>
        </div>
      </Reveal>
      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2>{getSite().newsCta.title}</h2><p>{getSite().newsCta.desc}</p></div>
          <a className="btn btn-line" href={getSite().contact.line} target="_blank" rel="noreferrer">{getSite().newsCta.btn}</a>
        </div>
      </Reveal>
      <Footer />
    </div>
  )
}
