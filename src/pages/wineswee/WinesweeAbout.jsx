import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { ALL, SITE } from './data'
import { Header, Footer, Reveal, useBodyScroll, Balance } from './parts'

const VALUES = [
  ['01', '全球直選', '法國波爾多、西班牙里奧哈、義大利、南非到紐西蘭——世界各地的餐酒，我們一站為你備齊。'],
  ['02', '酒食一次到位', '伊比利火腿、荷蘭高達乳酪、新鮮肉品與海鮮——佐酒的一切，都在同一個超市。'],
  ['03', '專人選酒', '11 家門市現場試味、專人推薦；不知道配什麼，交給我們就對了。'],
  ['04', '送禮體面', '酒器水晶杯與禮盒組，逢年過節、宴客送禮，都拿得出手。'],
]

export default function WinesweeAbout() {
  useBodyScroll()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return (
    <div className="ws">
      <Header />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">About Wineswee</span>
          <Balance tag="h1">把餐桌上的美好，一次備齊</Balance>
          <p className="page-lead">威士威酒食超市——不只是賣酒，而是幫你把每一次相聚、每一頓講究的餐桌，準備到剛剛好。</p>
        </div>
      </section>

      <Reveal tag="section" className="story">
        <div className="wrap story-in">
          <span className="kicker on-dark">Our Story</span>
          <h2>從一杯酒，<br />到<em>一整桌的講究</em></h2>
          <p>我們相信，好的相聚值得一支對味的酒，也值得佐它的那塊乳酪、那片火腿。於是威士威把世界各地的紅白葡萄酒、威士忌與清酒，連同歐陸的乳酪火腿、新鮮的肉品海鮮，都收進同一個超市——讓你不必東奔西跑，一站就能備齊整桌的美好。</p>
          <div className="story-stats">
            <div><b>{ALL.length}</b><span>嚴選品項</span></div>
            <div><b>11</b><span>全台門市</span></div>
            <div><b>NT$79</b><span>入手價起</span></div>
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
            {VALUES.map(([n, t, d]) => (
              <div key={n} className="storefull" style={{ aspectRatio: 'auto' }}>
                <div className="storefull-top"><span className="storefull-rg">{n}</span><h3>{t}</h3></div>
                <p style={{ color: 'var(--ink-soft)', fontSize: 15, fontWeight: 300, lineHeight: 1.7 }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="sec sec-light">
        <div className="wrap video-in">
          <div className="video-txt">
            <span className="kicker">Story Film</span>
            <h2>看見威士威的<br />酒食日常</h2>
            <p>一支酒、一塊乳酪、一段相聚——這就是我們想帶給你的生活風景。</p>
            <Link className="btn btn-ink" to="/wineswee/category/red">開始選酒</Link>
          </div>
          <div className="video-frame">
            <iframe src={SITE.ytEmbed} title="Wineswee" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2>來門市，<br /><em>讓我們為你選一支酒</em></h2><p>全台 11 家門市，或線上宅配到府。</p></div>
          <Link className="btn btn-gold" to="/wineswee/stores">查看門市</Link>
        </div>
      </Reveal>
      <Footer />
    </div>
  )
}
