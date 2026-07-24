import Image from 'next/image'
import { CATEGORIES, byCategory, ALL, type Product } from './lib/products'
import { SITE, BANNERS, STORES } from './lib/site'
import HeroSlider from './components/HeroSlider'
import ProductRow from './components/ProductRow'
import Reveal from './components/Reveal'

const FEATS: [string, string, string][] = [
  ['01', '全球嚴選餐酒', '法國・西班牙・義大利・南非・紐西蘭'],
  ['02', '酒食一次備齊', '火腿・乳酪・肉品・海鮮'],
  ['03', '全台宅配到府', '線上下單・滿額免運'],
  ['04', '七家實體門市', '現場試味・專人選酒'],
]

function pickSpotlight(): Product[] {
  const cats = byCategory()
  const wants = ['red', 'whisky', 'cheese', 'sparkling'] as const
  const out: Product[] = []
  for (const k of wants) {
    const hit = (cats[k] || []).find(p => p.image && !p.sold_out)
    if (hit) out.push(hit)
  }
  while (out.length < 4) {
    const extra = ALL.find(p => p.image && !p.sold_out && !out.includes(p))
    if (!extra) break
    out.push(extra)
  }
  return out.slice(0, 4)
}

export default function Home() {
  const cats = byCategory()
  const rows = CATEGORIES.filter(c => (cats[c.key] || []).length >= 3)
  const spotlight = pickSpotlight()

  return (
    <>
      {/* top bar */}
      <div className="topbar">全台七家門市・線上商城　｜　滿額免運・宅配到府　｜　未滿十八歲禁止飲酒</div>

      {/* header */}
      <header className="header">
        <div className="wrap header-in">
          <a className="logo" href="#top" aria-label="Wineswee 威士威酒食超市">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SITE.logo} alt="Wineswee 威士威酒食超市" />
          </a>
          <nav className="nav">
            {CATEGORIES.slice(0, 6).map(c => (
              <a key={c.key} href={`#cat-${c.key}`}>{c.label}</a>
            ))}
          </nav>
          <div className="header-cta">
            <a className="mini mini-line" href={SITE.line} target="_blank" rel="noreferrer">LINE 訂購</a>
            <a className="mini" href={SITE.shop} target="_blank" rel="noreferrer">官網商城</a>
          </div>
        </div>
      </header>

      {/* hero */}
      <HeroSlider />

      {/* feature strip */}
      <div className="feats">
        <div className="wrap feats-in">
          {FEATS.map(([n, t, s]) => (
            <div key={n} className="feat"><i>{n}</i><b>{t}</b><span>{s}</span></div>
          ))}
        </div>
      </div>

      {/* spotlight — 精選聚焦 */}
      <Reveal as="section" className="spot">
        <div className="wrap spot-in">
          <div className="spot-txt">
            <span className="eyebrow">Curated</span>
            <h2>本季精選，值得為它開一瓶</h2>
            <p>從波爾多列級酒莊到單一麥芽威士忌、荷蘭陳年高達乳酪，這幾支是我們最想推薦給你的味道。</p>
            <a className="btn btn-wine" href="#cat-red">看全部選品</a>
          </div>
          <div className="spot-figs">
            {spotlight.map((p, i) => (
              <a key={i} className="spot-fig" href={SITE.shop} target="_blank" rel="noreferrer">
                {p.image && <Image src={p.image} alt={p.name} fill sizes="(max-width:860px) 45vw, 280px" style={{ objectFit: 'cover' }} />}
                <figcaption>精選<b>{p.name}</b></figcaption>
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      {/* product carousels */}
      <main>
        {rows.map(c => (
          <ProductRow key={c.key} id={`cat-${c.key}`} title={c.label} en={c.en} items={(cats[c.key] || []).slice(0, 14)} />
        ))}
      </main>

      {/* story */}
      <Reveal as="section" className="story" >
        <div className="wrap story-in" id="story">
          <span className="eyebrow">About Wineswee</span>
          <h2>把餐桌上的美好，一次備齊</h2>
          <p>
            從法國波爾多、西班牙里奧哈到南非與紐西蘭，我們嚴選世界各地的紅白葡萄酒、威士忌與清酒；
            再備上伊比利火腿、歐陸乳酪與新鮮肉品海鮮——佐酒的一切都在同一個超市。
            無論日常小酌、宴客或送禮，威士威都幫你配到剛剛好的那一支。
          </p>
          <div className="story-stats">
            <div><b>{ALL.length}+</b><span>嚴選品項</span></div>
            <div><b>7</b><span>全台門市</span></div>
            <div><b>NT$79</b><span>入手價起</span></div>
          </div>
        </div>
      </Reveal>

      {/* video */}
      <Reveal as="section" className="sec">
        <div className="wrap video-in">
          <div className="video-txt">
            <span className="eyebrow">Story Film</span>
            <h2>看見威士威的酒食日常</h2>
            <p>一支酒、一塊乳酪、一段相聚。這就是我們想帶給你的生活風景。</p>
            <a className="btn btn-wine" href={SITE.shop} target="_blank" rel="noreferrer">探索更多</a>
          </div>
          <div className="video-frame">
            <iframe src={SITE.ytEmbed} title="Wineswee" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
          </div>
        </div>
      </Reveal>

      {/* stores */}
      <Reveal as="section" className="stores">
        <div className="wrap sec center" id="store">
          <span className="eyebrow">Our Stores</span>
          <h2>全台七家門市，來選一支酒</h2>
          <p className="stores-sub">親臨門市，現場試味、聊聊你的餐桌，我們幫你配到對的那一支。</p>
          <div className="store-grid">
            {STORES.map((s, i) => (
              <a key={i} className="store" href={`tel:${s.tel.replace(/-/g, '')}`}>
                <span className="rg">{s.region}門市</span>
                <b>{s.tel}</b>
                <em>撥打預約・選酒</em>
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      {/* CTA band */}
      <Reveal as="section" className="cta">
        <div className="wrap cta-in">
          <div>
            <h2>加入 LINE，讓我們為你選酒</h2>
            <p>新品到貨、限時優惠與選酒建議，第一手都在 LINE。</p>
          </div>
          <a className="btn btn-line" href={SITE.line} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>
        </div>
      </Reveal>

      {/* footer */}
      <footer className="footer">
        <div className="wrap footer-top">
          <div className="footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SITE.logo} alt="Wineswee" />
            <p>威士威酒食超市｜紅白葡萄酒・威士忌・清酒・肉品・乳酪・海鮮・酒器禮盒，一站備齊你的餐桌。</p>
          </div>
          <div className="footer-col">
            <h4>選購</h4>
            {CATEGORIES.slice(0, 6).map(c => <a key={c.key} href={`#cat-${c.key}`}>{c.label}</a>)}
          </div>
          <div className="footer-col">
            <h4>聯絡</h4>
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
            <a href={SITE.shop} target="_blank" rel="noreferrer">官網商城</a>
            <a href={SITE.line} target="_blank" rel="noreferrer">LINE 官方帳號</a>
          </div>
          <div className="footer-col">
            <h4>追蹤</h4>
            <a href={SITE.fb} target="_blank" rel="noreferrer">Facebook</a>
            <a href={SITE.ig} target="_blank" rel="noreferrer">Instagram</a>
          </div>
        </div>
        <div className="wrap footer-bar">
          <span>© 2026 Wineswee 威士威酒食超市</span>
          <span>未滿十八歲禁止飲酒・飲酒過量有害健康・禁止酒駕</span>
        </div>
      </footer>
    </>
  )
}
