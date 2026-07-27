import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './wineswee.css'
import { getNews, NEWS_DETAILS, SITE } from './data'
import { Header, Footer, Reveal, useBodyScroll } from './parts'

export default function WinesweeNewsDetail() {
  useBodyScroll()
  const { id } = useParams()
  useEffect(() => { window.scrollTo(0, 0) }, [id])
  const n = getNews(id)
  if (!n) return <div className="ws"><Header /><section className="masthead"><div className="wrap masthead-in"><h1>找不到消息</h1></div></section><Footer /></div>
  const more = NEWS_DETAILS.filter(x => String(x.id) !== String(id)).slice(0, 6)

  return (
    <div className="ws">
      <Header />
      <nav className="crumb wrap">
        <Link to="/wineswee">首頁</Link><span>/</span>
        <Link to="/wineswee/news">最新消息</Link><span>/</span>
        <em>{n.title}</em>
      </nav>

      <section className="newspage wrap">
        <header className="newspage-head">
          <span className="kicker">Journal</span>
          <h1>{n.title}</h1>
          {n.date && <time>{n.date}</time>}
        </header>

        <Reveal tag="article" className="newspage-body">
          {n.images.map((src, i) => <img key={i} src={src} alt={`${n.title} ${i + 1}`} loading={i < 2 ? 'eager' : 'lazy'} />)}
        </Reveal>

        <div className="newspage-cta">
          <p>想收到第一手活動與新品消息？</p>
          <a className="btn btn-line" href={SITE.line} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>
        </div>
      </section>

      {more.length > 0 && (
        <section className="sec sec-cream">
          <div className="wrap">
            <div className="sec-head">
              <span className="numeral">＊</span>
              <div className="ht"><span className="kicker">More Journal</span><h2>其他消息 <span className="en">/ News</span></h2></div>
              <Link className="rowmore-link" to="/wineswee/news">看全部</Link>
            </div>
            <div className="news-grid">
              {more.map(m => (
                <Link key={m.id} className="news-card" to={`/wineswee/news/${m.id}`}>
                  <div className="news-img">{m.cover && <img src={m.cover} alt={m.title} loading="lazy" />}<span className="news-go">閱讀更多</span></div>
                  <div className="news-body"><span className="news-tag">{m.date}</span><h3>{m.title}</h3></div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  )
}
