// Wineswee 威士威酒食超市 — 品牌形象頁（公開頁 /wineswee）
// ──────────────────────────────────────────────────────────────────────────
// 說明：這是「對外行銷」頁，非 ERP 後台，故刻意用【自成一格的品牌配色】(酒紅/金/米白)，
//   全部樣式 scope 在 .ws 命名空間下、不動 src/index.css 的全域 token，也不用 Tailwind 色階，
//   以符合 CLAUDE.md「不污染全域色票」的精神。商品資料為官網公開商品爬取結果(src/data)，
//   圖片直接連官網 CDN(不佔 repo)。
import { useMemo, useState } from 'react'
import PRODUCTS from '../data/wineswee-products.json'

const LINE_URL  = 'https://page.line.me/wineswee'
const MAP_URL   = 'https://maps.app.goo.gl/'
const FB_URL    = 'https://www.facebook.com/'
const IG_URL    = 'https://www.instagram.com/'
const SHOP_URL  = 'https://www.wineswee.com/'

// ── 依商品名稱關鍵字分類（順序有意義：先判斷較具體者）──
const CATS = [
  { key: 'red',     label: '紅酒',      test: n => /紅葡萄酒|紅酒/.test(n) },
  { key: 'white',   label: '白酒',      test: n => /白葡萄酒|白酒/.test(n) },
  { key: 'sparkling', label: '氣泡・香檳', test: n => /氣泡|香檳/.test(n) },
  { key: 'rose',    label: '粉紅酒',    test: n => /粉紅|玫瑰(?!堡)/.test(n) },
  { key: 'whisky',  label: '威士忌',    test: n => /威士忌|whisky|whiskey/i.test(n) },
  { key: 'sake',    label: '清酒',      test: n => /吟釀|吟醸|純米|冷酒|原酒|清酒|日本酒/.test(n) },
  { key: 'spirit',  label: '烈酒',      test: n => /龍舌蘭|白蘭地|蘭姆|grappa|琴酒|伏特加|威迪|利口|橘子酒|梅酒|水果酒|芒果酒/i.test(n) },
  { key: 'cheese',  label: '乳酪',      test: n => /乳酪|起司|高達|cheese/i.test(n) },
  { key: 'ham',     label: '肉品・火腿', test: n => /火腿|伊比利|黑豬|肉|臘腸|香腸/.test(n) },
  { key: 'ware',    label: '酒器・禮盒', test: n => /酒器|酒杯|水晶杯|杯|禮盒|開瓶|醒酒/.test(n) },
]
function classify(name) {
  for (const c of CATS) if (c.test(name)) return c.key
  return 'other'
}

const HERO_TAGS = ['紅・白葡萄酒', '威士忌・清酒', '伊比利火腿', '歐陸乳酪', '海鮮肉品', '酒器・禮盒']

export default function Wineswee() {
  const products = useMemo(
    () => PRODUCTS.filter(p => p.name).map(p => ({ ...p, cat: classify(p.name) })),
    []
  )
  const catCounts = useMemo(() => {
    const m = {}
    products.forEach(p => { m[p.cat] = (m[p.cat] || 0) + 1 })
    return m
  }, [products])
  const cats = useMemo(
    () => [{ key: 'all', label: '全部' }, ...CATS.filter(c => catCounts[c.key])],
    [catCounts]
  )

  const [active, setActive] = useState('all')
  const [limit, setLimit] = useState(24)

  const filtered = useMemo(() => {
    const list = active === 'all' ? products : products.filter(p => p.cat === active)
    // 有圖優先、非售完優先
    return [...list].sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || (a.sold_out ? 1 : 0) - (b.sold_out ? 1 : 0))
  }, [products, active])

  const shown = filtered.slice(0, limit)

  const pick = (key) => { setActive(key); setLimit(24) }

  return (
    <div className="ws">
      <style>{CSS}</style>

      {/* ── 導覽列 ── */}
      <header className="ws-nav">
        <a href="#top" className="ws-logo">
          <span className="ws-logo-mark">W</span>
          <span className="ws-logo-txt">Wineswee<em>威士威酒食超市</em></span>
        </a>
        <nav className="ws-nav-links">
          <a href="#products">選購</a>
          <a href="#story">關於我們</a>
          <a href="#store">門市</a>
          <a className="ws-btn ws-btn-line" href={LINE_URL} target="_blank" rel="noreferrer">LINE 訂購</a>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section id="top" className="ws-hero">
        <div className="ws-hero-inner">
          <p className="ws-eyebrow">WINE ・ WHISKY ・ GOURMET</p>
          <h1 className="ws-hero-title">為每一次相聚<br />斟一杯剛剛好的<span className="ws-gold">講究</span></h1>
          <p className="ws-hero-sub">
            嚴選世界各地紅白葡萄酒、威士忌與清酒，佐以伊比利火腿、歐陸乳酪與新鮮肉品海鮮——
            威士威，把餐桌上的美好一次備齊。
          </p>
          <div className="ws-hero-cta">
            <a className="ws-btn ws-btn-gold" href="#products">開始選購</a>
            <a className="ws-btn ws-btn-ghost" href={SHOP_URL} target="_blank" rel="noreferrer">前往官網商城 →</a>
          </div>
          <div className="ws-hero-tags">
            {HERO_TAGS.map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
        <div className="ws-hero-stat">
          <div><b>{products.length}+</b><span>嚴選品項</span></div>
          <div><b>NT$79</b><span>入手價起</span></div>
          <div><b>全台</b><span>宅配到府</span></div>
        </div>
      </section>

      {/* ── 分類 + 商品 ── */}
      <section id="products" className="ws-section">
        <div className="ws-sec-head">
          <p className="ws-eyebrow ws-center">OUR SELECTION</p>
          <h2>精選商品</h2>
          <p className="ws-sec-sub">從日常餐酒到節慶珍藏，總有一支對味。</p>
        </div>

        <div className="ws-cats">
          {cats.map(c => (
            <button key={c.key}
              className={'ws-chip' + (active === c.key ? ' is-active' : '')}
              onClick={() => pick(c.key)}>
              {c.label}
              {c.key !== 'all' && <i>{catCounts[c.key]}</i>}
            </button>
          ))}
        </div>

        <div className="ws-grid">
          {shown.map((p, i) => (
            <article key={p.name + i} className={'ws-card' + (p.sold_out ? ' is-sold' : '')}>
              <div className="ws-card-img">
                {p.image
                  ? <img src={p.image} alt={p.name} loading="lazy"
                      onError={e => { e.currentTarget.style.display = 'none' }} />
                  : <div className="ws-card-ph">W</div>}
                {p.sold_out && <span className="ws-sold">售完</span>}
              </div>
              <div className="ws-card-body">
                <h3 title={p.name}>{p.name}</h3>
                <div className="ws-card-foot">
                  {p.price
                    ? <span className="ws-price">NT$ {p.price.toLocaleString()}</span>
                    : <span className="ws-price ws-price-ask">價格洽詢</span>}
                  <a className="ws-card-go" href={SHOP_URL} target="_blank" rel="noreferrer">選購</a>
                </div>
              </div>
            </article>
          ))}
        </div>

        {shown.length < filtered.length && (
          <div className="ws-more">
            <button className="ws-btn ws-btn-ghost" onClick={() => setLimit(l => l + 24)}>
              看更多（{filtered.length - shown.length}）
            </button>
          </div>
        )}
      </section>

      {/* ── 品牌故事 ── */}
      <section id="story" className="ws-story">
        <div className="ws-story-inner">
          <p className="ws-eyebrow ws-gold-eye">WHY WINESWEE</p>
          <h2>不只是賣酒，<br />是幫你把餐桌準備好</h2>
          <div className="ws-values">
            <div className="ws-value">
              <span className="ws-value-ic">🍷</span>
              <h4>全球直選</h4>
              <p>法國波爾多、西班牙里奧哈、義大利、南非到紐西蘭，一站買齊世界餐酒。</p>
            </div>
            <div className="ws-value">
              <span className="ws-value-ic">🧀</span>
              <h4>酒食一次備齊</h4>
              <p>伊比利火腿、荷蘭高達乳酪、肉品海鮮——佐酒的一切都在同一個超市。</p>
            </div>
            <div className="ws-value">
              <span className="ws-value-ic">🎁</span>
              <h4>送禮體面</h4>
              <p>酒器水晶杯與禮盒組，逢年過節、宴客送禮都拿得出手。</p>
            </div>
            <div className="ws-value">
              <span className="ws-value-ic">🚚</span>
              <h4>宅配到府</h4>
              <p>線上下單、全台配送，或加 LINE 直接訂購，服務更貼近。</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 門市 / 聯絡 ── */}
      <section id="store" className="ws-store">
        <div className="ws-store-info">
          <p className="ws-eyebrow ws-gold-eye">VISIT US</p>
          <h2>來門市，讓我們為你選一支酒</h2>
          <p className="ws-store-desc">
            親臨威士威，現場試味、聊聊你的餐桌與場合，我們幫你配到剛剛好的那一支。
          </p>
          <div className="ws-store-links">
            <a className="ws-btn ws-btn-line" href={LINE_URL} target="_blank" rel="noreferrer">加 LINE 訂購・諮詢</a>
            <a className="ws-btn ws-btn-ghost-d" href={MAP_URL} target="_blank" rel="noreferrer">Google 地圖導航</a>
          </div>
          <div className="ws-socials">
            <a href={FB_URL} target="_blank" rel="noreferrer" aria-label="Facebook">Facebook</a>
            <a href={IG_URL} target="_blank" rel="noreferrer" aria-label="Instagram">Instagram</a>
            <a href={SHOP_URL} target="_blank" rel="noreferrer" aria-label="官網">官網商城</a>
          </div>
        </div>
        <div className="ws-store-card">
          <div className="ws-store-emoji">🏪</div>
          <p>Wineswee 威士威酒食超市</p>
          <span>紅白葡萄酒・威士忌・清酒・肉品・乳酪・海鮮・酒器</span>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="ws-foot">
        <div className="ws-foot-brand">Wineswee<em>威士威酒食超市</em></div>
        <p>© {2026} Wineswee. 未滿十八歲禁止飲酒・飲酒過量有害健康。</p>
      </footer>
    </div>
  )
}

const CSS = `
.ws{--wine:#6b1f38;--wine-d:#4a1526;--wine-dd:#320d19;--gold:#c6a15b;--gold-l:#d8bd85;
  --cream:#faf6ef;--paper:#fffdf9;--ink:#2a1c20;--muted:#8a7670;--line:#eaddce;
  font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
  color:var(--ink);background:var(--cream);line-height:1.7;-webkit-font-smoothing:antialiased;}
.ws *{box-sizing:border-box;margin:0;padding:0}
.ws h1,.ws h2,.ws h3,.ws h4{font-family:"Noto Serif TC","Songti TC",Georgia,serif;font-weight:700;line-height:1.25;letter-spacing:.01em}
.ws a{color:inherit;text-decoration:none}
.ws .ws-gold{color:var(--gold)}
.ws .ws-eyebrow{font-size:12px;letter-spacing:.28em;color:var(--gold);font-weight:700;margin-bottom:14px}
.ws .ws-center{text-align:center}

/* nav */
.ws-nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;
  padding:14px clamp(16px,5vw,56px);background:rgba(50,13,25,.82);backdrop-filter:blur(10px);
  border-bottom:1px solid rgba(198,161,91,.25)}
.ws-logo{display:flex;align-items:center;gap:12px}
.ws-logo-mark{width:38px;height:38px;border:1.5px solid var(--gold);color:var(--gold);border-radius:50%;
  display:grid;place-items:center;font-family:Georgia,serif;font-size:20px;font-weight:700}
.ws-logo-txt{color:var(--cream);font-family:"Noto Serif TC",serif;font-weight:700;font-size:19px;letter-spacing:.04em;display:flex;flex-direction:column;line-height:1.1}
.ws-logo-txt em{font-style:normal;font-size:10.5px;letter-spacing:.18em;color:var(--gold-l);font-family:"Noto Sans TC",sans-serif;font-weight:400}
.ws-nav-links{display:flex;align-items:center;gap:clamp(14px,3vw,32px)}
.ws-nav-links>a{color:var(--cream);font-size:14.5px;font-weight:500;opacity:.9}
.ws-nav-links>a:hover{opacity:1;color:var(--gold-l)}

/* buttons */
.ws-btn{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;border-radius:999px;font-size:14px;
  font-weight:600;cursor:pointer;border:1px solid transparent;transition:.2s;white-space:nowrap}
.ws-btn-gold{background:var(--gold);color:var(--wine-dd);font-weight:700}
.ws-btn-gold:hover{background:var(--gold-l);transform:translateY(-1px)}
.ws-btn-line{background:#06c755;color:#fff}
.ws-btn-line:hover{filter:brightness(1.06);transform:translateY(-1px)}
.ws-btn-ghost{border-color:rgba(255,255,255,.4);color:var(--cream)}
.ws-btn-ghost:hover{border-color:var(--gold);color:var(--gold-l)}
.ws-btn-ghost-d{border-color:var(--wine);color:var(--wine)}
.ws-btn-ghost-d:hover{background:var(--wine);color:var(--cream)}

/* hero */
.ws-hero{position:relative;background:
  radial-gradient(120% 90% at 80% -10%,rgba(198,161,91,.18),transparent 55%),
  linear-gradient(160deg,var(--wine-dd),var(--wine-d) 55%,var(--wine));
  color:var(--cream);padding:clamp(56px,10vw,120px) clamp(16px,5vw,56px) 0;overflow:hidden}
.ws-hero:before{content:"";position:absolute;right:-8%;top:-10%;width:520px;height:520px;
  background:radial-gradient(circle,rgba(198,161,91,.16),transparent 70%);border-radius:50%}
.ws-hero-inner{position:relative;max-width:880px}
.ws-hero-title{font-size:clamp(34px,6vw,64px);line-height:1.18;margin-bottom:22px;letter-spacing:.02em}
.ws-hero-sub{font-size:clamp(15px,1.8vw,18px);max-width:620px;color:#f0e6da;opacity:.92}
.ws-hero-cta{display:flex;flex-wrap:wrap;gap:14px;margin:34px 0 26px}
.ws-hero-tags{display:flex;flex-wrap:wrap;gap:10px}
.ws-hero-tags span{font-size:12.5px;padding:6px 14px;border:1px solid rgba(216,189,133,.4);
  border-radius:999px;color:var(--gold-l);letter-spacing:.05em}
.ws-hero-stat{position:relative;display:flex;gap:clamp(24px,6vw,72px);flex-wrap:wrap;
  margin-top:clamp(40px,7vw,72px);padding:26px 0;border-top:1px solid rgba(216,189,133,.25)}
.ws-hero-stat>div{display:flex;flex-direction:column}
.ws-hero-stat b{font-family:"Noto Serif TC",serif;font-size:clamp(24px,3vw,34px);color:var(--gold)}
.ws-hero-stat span{font-size:12.5px;color:#e6d9c9;letter-spacing:.06em}

/* section */
.ws-section{max-width:1180px;margin:0 auto;padding:clamp(56px,8vw,100px) clamp(16px,5vw,40px)}
.ws-sec-head{text-align:center;margin-bottom:38px}
.ws-sec-head h2{font-size:clamp(28px,4vw,42px)}
.ws-sec-sub{color:var(--muted);margin-top:10px;font-size:15px}

/* cat chips */
.ws-cats{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:40px}
.ws-chip{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:999px;
  border:1px solid var(--line);background:var(--paper);color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;transition:.18s}
.ws-chip:hover{border-color:var(--gold)}
.ws-chip.is-active{background:var(--wine);color:var(--cream);border-color:var(--wine)}
.ws-chip i{font-style:normal;font-size:11px;opacity:.7;font-weight:500}
.ws-chip.is-active i{opacity:.85}

/* grid + card */
.ws-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:clamp(16px,2vw,26px)}
.ws-card{background:var(--paper);border:1px solid var(--line);border-radius:16px;overflow:hidden;
  display:flex;flex-direction:column;transition:.22s}
.ws-card:hover{transform:translateY(-4px);box-shadow:0 18px 40px -22px rgba(74,21,38,.5);border-color:var(--gold)}
.ws-card-img{position:relative;aspect-ratio:1/1;background:#f3ece1;display:grid;place-items:center;overflow:hidden}
.ws-card-img img{width:100%;height:100%;object-fit:cover;transition:.4s}
.ws-card:hover .ws-card-img img{transform:scale(1.05)}
.ws-card-ph{font-family:Georgia,serif;font-size:40px;color:var(--gold);opacity:.5}
.ws-sold{position:absolute;top:10px;left:10px;background:rgba(50,13,25,.85);color:var(--gold-l);
  font-size:11px;padding:4px 10px;border-radius:999px;letter-spacing:.08em}
.ws-card.is-sold .ws-card-img img{filter:grayscale(.5) opacity(.7)}
.ws-card-body{padding:14px 15px 16px;display:flex;flex-direction:column;gap:12px;flex:1}
.ws-card-body h3{font-size:14.5px;font-weight:600;line-height:1.45;font-family:"Noto Sans TC",sans-serif;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.9em}
.ws-card-foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto}
.ws-price{color:var(--wine);font-weight:700;font-size:16px;font-family:"Noto Serif TC",serif}
.ws-price-ask{font-size:13px;color:var(--muted);font-weight:500}
.ws-card-go{font-size:12.5px;color:var(--gold);border:1px solid var(--gold);padding:5px 13px;border-radius:999px;transition:.18s}
.ws-card-go:hover{background:var(--gold);color:var(--wine-dd)}
.ws-more{text-align:center;margin-top:40px}
.ws-more .ws-btn-ghost{border-color:var(--wine);color:var(--wine)}
.ws-more .ws-btn-ghost:hover{background:var(--wine);color:var(--cream)}

/* story */
.ws-story{background:linear-gradient(180deg,var(--paper),var(--cream));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.ws-story-inner{max-width:1120px;margin:0 auto;padding:clamp(56px,8vw,100px) clamp(16px,5vw,40px);text-align:center}
.ws-gold-eye{color:var(--gold)}
.ws-story-inner>h2{font-size:clamp(26px,3.6vw,40px);margin-bottom:44px}
.ws-values{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:clamp(18px,2vw,28px);text-align:left}
.ws-value{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:26px 22px;transition:.2s}
.ws-value:hover{transform:translateY(-3px);border-color:var(--gold);box-shadow:0 16px 36px -24px rgba(74,21,38,.4)}
.ws-value-ic{font-size:30px;display:block;margin-bottom:14px}
.ws-value h4{font-size:18px;margin-bottom:8px}
.ws-value p{font-size:14px;color:var(--muted)}

/* store */
.ws-store{max-width:1180px;margin:0 auto;padding:clamp(56px,8vw,100px) clamp(16px,5vw,40px);
  display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(28px,4vw,56px);align-items:center}
.ws-store-info>h2{font-size:clamp(26px,3.4vw,38px);margin-bottom:16px}
.ws-store-desc{color:var(--muted);font-size:16px;max-width:480px;margin-bottom:26px}
.ws-store-links{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:26px}
.ws-socials{display:flex;gap:22px}
.ws-socials a{font-size:13.5px;color:var(--wine);font-weight:600;border-bottom:1px solid var(--gold);padding-bottom:2px}
.ws-socials a:hover{color:var(--gold)}
.ws-store-card{background:linear-gradient(155deg,var(--wine-d),var(--wine-dd));color:var(--cream);
  border-radius:22px;padding:clamp(32px,4vw,48px);text-align:center;border:1px solid rgba(198,161,91,.3)}
.ws-store-emoji{font-size:52px;margin-bottom:18px}
.ws-store-card>p{font-family:"Noto Serif TC",serif;font-size:22px;font-weight:700;margin-bottom:10px;color:var(--gold-l)}
.ws-store-card>span{font-size:13px;color:#e6d9c9;letter-spacing:.04em}

/* footer */
.ws-foot{background:var(--wine-dd);color:#e6d9c9;text-align:center;padding:40px 20px}
.ws-foot-brand{font-family:"Noto Serif TC",serif;font-size:20px;font-weight:700;color:var(--cream);display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.ws-foot-brand em{font-style:normal;font-size:11px;letter-spacing:.2em;color:var(--gold)}
.ws-foot p{font-size:12px;opacity:.7}

@media(max-width:720px){
  .ws-nav-links>a:not(.ws-btn){display:none}
  .ws-store{grid-template-columns:1fr}
  .ws-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
}
`
