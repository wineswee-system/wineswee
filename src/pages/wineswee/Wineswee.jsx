import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './wineswee.css'
import { CATEGORIES, byCategory, ALL, NEWS, STORES, SITE, CAT_META, catPriceFrom, catHeroImage } from './data'
import { Header, HeroSlider, ProductRow, Reveal, Footer, useBodyScroll, Intro } from './parts'

const MANIFESTO = [
  ['01', '全球嚴選', '法國・西班牙・義大利・南非・紐西蘭'],
  ['02', '酒食一次備齊', '火腿・乳酪・肉品・海鮮'],
  ['03', '宅配到府', '線上下單・全台配送'],
  ['04', '十一家門市', '現場試味・專人選酒'],
]
function spotlight() {
  const cats = byCategory()
  const out = []
  for (const k of ['red', 'whisky', 'cheese', 'sparkling']) { const h = (cats[k] || []).find(p => p.image && !p.sold_out); if (h) out.push(h) }
  while (out.length < 4) { const e = ALL.find(p => p.image && !p.sold_out && !out.includes(p)); if (!e) break; out.push(e) }
  return out.slice(0, 4)
}

export default function Wineswee() {
  useBodyScroll()
  const cats = byCategory()
  const spot = spotlight()
  useEffect(() => {
    if (window.location.hash) { const el = document.querySelector(window.location.hash); if (el) setTimeout(() => el.scrollIntoView(), 60) }
  }, [])

  return (
    <div className="ws">
      <Intro />
      <div className="announce">全台十一家門市・線上商城宅配到府　—　滿額免運・當日出貨　—　未滿十八歲禁止飲酒</div>
      <Header home />
      <HeroSlider />

      {/* manifesto */}
      <section className="mani">
        <div className="wrap mani-in">
          {MANIFESTO.map(([n, t, s]) => <div className="mani-cell" key={n}><div className="n">{n}</div><h4>{t}</h4><p>{s}</p></div>)}
        </div>
      </section>

      {/* 分類入口 */}
      <Reveal tag="section" className="sec sec-light">
        <div className="wrap" id="shop">
          <div className="sec-head">
            <span className="numeral">01</span>
            <div className="ht"><span className="kicker">Shop by Category</span><h2>選購專區 <span className="en">/ Explore</span></h2></div>
          </div>
          <div className="entry-grid">
            {CATEGORIES.filter(c => (cats[c.key] || []).length).map(c => {
              const n = (cats[c.key] || []).length
              const from = catPriceFrom(c.key)
              const cover = ['ham'].includes(c.key)
              const img = catHeroImage(c.key)
              return (
                <Link key={c.key} className={'entry' + (cover ? ' cover' : '')} to={`/wineswee/category/${c.key}`}>
                  <div className="entry-media">
                    {img && <img src={img} alt={c.label} loading="lazy" />}
                    <span className="entry-tag">{c.en}</span>
                  </div>
                  <div className="entry-body">
                    <div className="entry-hd">
                      <h3>{c.label}</h3>
                      <span className="entry-count">{n} 款</span>
                    </div>
                    <p className="entry-desc">{CAT_META[c.key]}</p>
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
      <ProductRow no="02" id="cat-red" title="本季紅酒精選" en="Red Wine" items={(cats.red || []).slice(0, 12)} tone="cream" />

      {/* spotlight */}
      <Reveal tag="section" className="spot">
        <div className="wrap spot-in">
          <div className="spot-txt">
            <span className="kicker on-dark">Curated Nº 01</span>
            <h2>本季精選，<br />值得為它<em>開一瓶</em></h2>
            <p>從波爾多列級酒莊到單一麥芽威士忌、荷蘭陳年高達乳酪——這幾支是我們最想與你分享的味道。</p>
            <Link className="btn btn-gold" to="/wineswee/category/red">看全部選品</Link>
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
          <span className="kicker on-dark">The House of Wineswee</span>
          <h2>把餐桌上的美好，<br /><em>一次備齊</em></h2>
          <p>從法國波爾多、西班牙里奧哈到南非與紐西蘭，我們嚴選世界各地的紅白葡萄酒、威士忌與清酒，再備上伊比利火腿與歐陸乳酪——佐酒的一切，都在同一個超市。</p>
          <div className="story-stats">
            <div><b>{ALL.length}</b><span>嚴選品項</span></div>
            <div><b>11</b><span>全台門市</span></div>
            <div><b>NT$79</b><span>入手價起</span></div>
          </div>
          <div className="teaser-more"><Link to="/wineswee/about">認識威士威 →</Link></div>
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
            {NEWS.slice(0, 4).map(n => (
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
            {STORES.map((s, i) => (
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
          <div><h2>加入 LINE，<br /><em>讓我們為你選酒</em></h2><p>新品到貨、限時優惠與選酒建議，第一手都在 LINE。</p></div>
          <a className="btn btn-line" href={SITE.line} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>
        </div>
      </Reveal>

      <Footer />
    </div>
  )
}
