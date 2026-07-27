import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { CATEGORIES, byCategory, ALL, NEWS, STORES, SITE } from './data'
import { Header, HeroSlider, ProductRow, Reveal, Footer } from './parts'

const MANIFESTO = [
  ['01', '全球嚴選', '法國・西班牙・義大利・南非・紐西蘭'],
  ['02', '酒食一次備齊', '火腿・乳酪・肉品・海鮮'],
  ['03', '宅配到府', '線上下單・全台配送'],
  ['04', '十一家門市', '現場試味・專人選酒'],
]
function spotlight() {
  const cats = byCategory()
  const want = ['red', 'whisky', 'cheese', 'sparkling']
  const out = []
  for (const k of want) { const h = (cats[k] || []).find(p => p.image && !p.sold_out); if (h) out.push(h) }
  while (out.length < 4) { const e = ALL.find(p => p.image && !p.sold_out && !out.includes(p)); if (!e) break; out.push(e) }
  return out.slice(0, 4)
}

export default function Wineswee() {
  const cats = byCategory()
  const rows = CATEGORIES.filter(c => (cats[c.key] || []).length >= 3)
  const spot = spotlight()
  const tones = ['light', 'cream']
  // 若帶 #hash 進來,捲到對應區塊
  useEffect(() => {
    if (window.location.hash) {
      const el = document.querySelector(window.location.hash)
      if (el) setTimeout(() => el.scrollIntoView(), 60)
    }
  }, [])

  return (
    <div className="ws">
      <div className="announce">全台十一家門市・線上商城宅配到府　—　滿額免運・當日出貨　—　未滿十八歲禁止飲酒</div>
      <Header home />
      <HeroSlider />

      <section className="mani">
        <div className="wrap mani-in">
          {MANIFESTO.map(([n, t, s]) => (
            <div className="mani-cell" key={n}><div className="n">{n}</div><h4>{t}</h4><p>{s}</p></div>
          ))}
        </div>
      </section>

      {rows.map((c, i) => {
        const row = <ProductRow key={c.key} no={String(i + 1).padStart(2, '0')} id={`cat-${c.key}`} title={c.label} en={c.en} items={(cats[c.key] || []).slice(0, 14)} tone={tones[i % 2]} />
        if (i !== 1) return row
        return (
          <div key={c.key + '-w'}>
            {row}
            <Reveal tag="section" className="spot">
              <div className="wrap spot-in">
                <div className="spot-txt">
                  <span className="kicker on-dark">Curated Nº 01</span>
                  <h2>本季精選，<br />值得為它<em>開一瓶</em></h2>
                  <p>從波爾多列級酒莊到單一麥芽威士忌、荷蘭陳年高達乳酪——這幾支是我們最想與你分享的味道。</p>
                  <a className="btn btn-gold" href="#cat-red">看全部選品</a>
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
          </div>
        )
      })}

      <Reveal tag="section" className="story">
        <div className="wrap story-in" id="story">
          <span className="kicker on-dark">The House of Wineswee</span>
          <h2>把餐桌上的美好，<br /><em>一次備齊</em></h2>
          <p>從法國波爾多、西班牙里奧哈到南非與紐西蘭，我們嚴選世界各地的紅白葡萄酒、威士忌與清酒；再備上伊比利火腿、歐陸乳酪與新鮮肉品海鮮——佐酒的一切，都在同一個超市。無論日常小酌、宴客或送禮，威士威都幫你配到剛剛好的那一支。</p>
          <div className="story-stats">
            <div><b>{ALL.length}</b><span>嚴選品項</span></div>
            <div><b>11</b><span>全台門市</span></div>
            <div><b>NT$79</b><span>入手價起</span></div>
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="sec sec-light">
        <div className="wrap video-in">
          <div className="video-txt">
            <span className="kicker">Story Film</span>
            <h2>看見威士威的<br />酒食日常</h2>
            <p>一支酒、一塊乳酪、一段相聚——這就是我們想帶給你的生活風景。</p>
            <a className="btn btn-ink" href={SITE.shop} target="_blank" rel="noreferrer">探索更多</a>
          </div>
          <div className="video-frame">
            <iframe src={SITE.ytEmbed} title="Wineswee" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="sec sec-light">
        <div className="wrap" id="news">
          <div className="sec-head">
            <span className="numeral">＊</span>
            <div className="ht"><span className="kicker">Journal</span><h2>最新消息 <span className="en">/ News</span></h2></div>
            <a className="rowmore-link" href={SITE.shop} target="_blank" rel="noreferrer">前往官網</a>
          </div>
          <div className="news-grid">
            {NEWS.map(n => (
              <a key={n.id} className="news-card" href={n.url} target="_blank" rel="noreferrer">
                <div className="news-img">{n.image && <img src={n.image} alt={n.title} loading="lazy" />}<span className="news-go">閱讀更多</span></div>
                <div className="news-body"><span className="news-tag">Journal</span><h3>{n.title}</h3></div>
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="sec sec-cream">
        <div className="wrap" id="store">
          <div className="sec-head">
            <span className="numeral">11</span>
            <div className="ht"><span className="kicker">Our Stores</span><h2>全台 11 家門市 <span className="en">/ Visit us</span></h2></div>
          </div>
          <div className="stores-list">
            {STORES.map((s, i) => (
              <a key={i} className="store" href={`https://www.google.com/maps/search/${encodeURIComponent('威士威酒食超市 ' + s.full)}`} target="_blank" rel="noreferrer">
                <span className="no">{String(i + 1).padStart(2, '0')}</span><span className="rg">{s.region}</span><span className="tel">{s.name}</span>
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2>加入 LINE，<em>讓我們為你選酒</em></h2><p>新品到貨、限時優惠與選酒建議，第一手都在 LINE。</p></div>
          <a className="btn btn-line" href={SITE.line} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>
        </div>
      </Reveal>

      <Footer />
    </div>
  )
}
