import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './wineswee.css'
import { getNews, getNewsDetails, getSite } from './data'
import { Header, Footer, Reveal, useBodyScroll } from './parts'

export default function WinesweeNewsDetail() {
  useBodyScroll()
  const { id, sub } = useParams()
  useEffect(() => { window.scrollTo(0, 0) }, [id, sub])
  const n = getNews(id)
  if (!n) return <div className="ws"><Header /><section className="masthead"><div className="wrap masthead-in"><h1>找不到消息</h1></div></section><Footer /></div>

  const subs = n.subs || []
  const subIdx = sub != null ? Number(sub) : null
  const article = subIdx != null ? subs[subIdx] : (subs.length === 1 ? subs[0] : null)
  const isCategory = subIdx == null && subs.length >= 2   // 多篇 → 列出讓人選
  const images = article?.images || n.images || []
  const heading = subIdx != null ? (article?.title || n.title) : n.title
  const headDate = subIdx != null ? article?.date : n.date
  const more = getNewsDetails().filter(x => String(x.id) !== String(id)).slice(0, 6)

  return (
    <div className="ws">
      <Header />
      <nav className="crumb wrap">
        <Link to="/wineswee">首頁</Link><span>/</span>
        <Link to="/wineswee/news">最新消息</Link><span>/</span>
        {subIdx != null
          ? <><Link to={`/wineswee/news/${id}`}>{n.title}</Link><span>/</span><em>{article?.title}</em></>
          : <em>{n.title}</em>}
      </nav>

      <section className="newspage wrap">
        <header className="newspage-head">
          <span className="kicker">Journal</span>
          <h1>{heading}</h1>
          {headDate && <time>{headDate}</time>}
          {isCategory && <p className="newspage-sub">共 {subs.length} 篇，點選閱讀</p>}
        </header>

        {isCategory ? (
          <div className="news-grid">
            {subs.map((s, i) => (
              <Link key={i} className="news-card" to={`/wineswee/news/${id}/${i}`}>
                <div className="news-img">{s.cover && <img src={s.cover} alt={s.title} loading="lazy" />}<span className="news-go">閱讀更多</span></div>
                <div className="news-body"><span className="news-tag">{s.date || 'Journal'}</span><h3>{s.title}</h3></div>
              </Link>
            ))}
          </div>
        ) : article?.board?.items?.length ? (
          <Reveal tag="article" className="newspage-board" style={{ '--ah': article.board.ah || 1.3 }}>
            <div className="newspage-board-in">
              {article.board.items.map((im, i) => im.src ? <img key={i} src={im.src} alt={`${heading} ${i + 1}`} loading={i < 3 ? 'eager' : 'lazy'} style={{ left: `${im.x}%`, top: `${im.y}%`, width: `${im.w}%` }} /> : null)}
            </div>
          </Reveal>
        ) : (
          <Reveal tag="article" className="newspage-gallery">
            {images.map((im, i) => {
              const src = typeof im === 'string' ? im : im?.src
              const w = (typeof im === 'object' && im?.w) ? im.w : 100
              return src ? <img key={i} src={src} alt={`${heading} ${i + 1}`} loading={i < 2 ? 'eager' : 'lazy'} style={{ width: `calc(${w}% - ${w < 100 ? 8 : 0}px)` }} /> : null
            })}
          </Reveal>
        )}

        <div className="newspage-cta">
          <p>想收到第一手活動與新品消息？</p>
          <a className="btn btn-line" href={getSite().contact.line} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>
        </div>
      </section>

      {subIdx == null && more.length > 0 && (
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
