import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './wineswee.css'
import { getProduct, related, getDetail, specRows, byCategory, CATEGORIES, WINE_KEYS, FOOD_KEYS, CAT_LABEL, CAT_EN, getSite } from './data'
import { Header, ProductCard, Footer, useBodyScroll, Balance, Reveal } from './parts'

const BLURB = {
  red: '飽滿而有層次的紅葡萄酒，單寧細緻、餘韻悠長，佐紅肉、乳酪或獨飲皆宜。',
  white: '清爽明亮的白葡萄酒，果香純淨、酸度俐落，是海鮮與前菜的絕佳伴侶。',
  sparkling: '細緻氣泡在杯中躍動，適合慶祝與開胃，為每一次相聚添一分雀躍。',
  rose: '介於紅白之間的粉紅酒，果香清新、口感柔和，冰鎮後尤其迷人。',
  whisky: '個性鮮明的威士忌，從煙燻到花果，值得靜靜品味的一杯。',
  sake: '純米的細膩與甘美，冷飲或溫熱各有風味，佐和食最為相得益彰。',
  spirit: '風味濃郁的烈酒，純飲或調製，皆能展現層次與餘韻。',
  cheese: '陳年熟成的歐陸乳酪，鹹香濃郁，佐酒或入菜都令人回味。',
  ham: '慢工熟成的頂級火腿，油脂如絲、鹹香入魂，是佐酒的經典。',
  ware: '講究的酒器與禮盒，讓每一次品飲與致贈都更顯體面。',
  other: '威士威嚴選——為你的餐桌，配上剛剛好的那一味。',
}
const num = v => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0
const nt = n => 'NT$ ' + Math.round(n).toLocaleString()

export default function WinesweeProduct() {
  useBodyScroll()
  const { id } = useParams()
  useEffect(() => { window.scrollTo(0, 0) }, [id])
  const p = getProduct(Number(id))
  if (!p) return <div className="ws"><Header /><section className="masthead"><div className="wrap masthead-in"><h1>找不到商品</h1></div></section><Footer /></div>

  const rel = related(p, 12)
  const catLabel = CAT_LABEL[p.cat] || '嚴選'
  const catEn = CAT_EN[p.cat] || 'Selection'
  const detail = getDetail(p.name)
  const specs = specRows(detail, p)
  const cats = byCategory()
  const wine = CATEGORIES.filter(c => WINE_KEYS.includes(c.key) && (cats[c.key] || []).length)
  const food = CATEGORIES.filter(c => FOOD_KEYS.includes(c.key) && (cats[c.key] || []).length)

  // 成本透明:進貨成本群 / 營運群 → 成本價、售價
  const cost = detail?.cost || []
  const opIdx = cost.findIndex(r => /WINESWEE|服務費|營業稅|匯差/.test(r[0]))
  const costRows = opIdx > 0 ? cost.slice(0, opIdx) : cost
  const opRows = opIdx > 0 ? cost.slice(opIdx) : []
  const costPrice = costRows.reduce((a, [, v]) => a + num(v), 0)
  // 會員價:①後台明確欄位 ②成本表堆疊 ③售價 9 折(讓每支都有,後台可覆寫);售價=非會員零售價
  const memberPrice = p.member ? Math.round(p.member)
    : cost.length ? Math.round(cost.reduce((a, [, v]) => a + num(v), 0))
      : p.price ? Math.round(p.price * 0.9) : 0
  const hasMember = memberPrice > 0 && (!p.price || memberPrice < p.price)

  return (
    <div className="ws">
      <Header />
      <nav className="crumb wrap">
        <Link to="/wineswee">首頁</Link><span>/</span>
        <Link to={`/wineswee/category/${p.cat}`}>{catLabel}</Link><span>/</span>
        <em>{p.name}</em>
      </nav>

      <section className="pdp2 wrap">
        {/* 左側:選酒快捷導覽 */}
        <aside className="pdp-nav">
          <span className="lead">Products<b>點我選酒</b></span>
          <div className="catnav-grp">
            <h4>酒類專區</h4>
            <ul>{wine.map(c => <li key={c.key}><Link className={c.key === p.cat ? 'on' : ''} to={`/wineswee/category/${c.key}`}>{c.label}<em>{(cats[c.key] || []).length}</em></Link></li>)}</ul>
          </div>
          <div className="catnav-grp">
            <h4>美食・酒器</h4>
            <ul>{food.map(c => <li key={c.key}><Link className={c.key === p.cat ? 'on' : ''} to={`/wineswee/category/${c.key}`}>{c.label}<em>{(cats[c.key] || []).length}</em></Link></li>)}</ul>
          </div>
        </aside>

        <div className="pdp-mainwrap">
          <div className="pdp-main">
            {/* 商品圖(黏性) */}
            <div className="pdp-figure">
              <div className="pdp-media">
                {p.image ? <img src={p.image} alt={p.name} /> : <span className="pdp-ph">Wineswee</span>}
                {p.sold_out && <span className="pdp-sold">SOLD OUT</span>}
              </div>
              {detail?.en && <div className="pdp-en">{detail.en}</div>}
            </div>

            {/* 資訊面板 */}
            <div className="pdp-info">
              <span className="kicker">{catLabel} / {catEn}</span>
              <Balance tag="h1">{p.name}</Balance>
              {detail?.en && <div className="pdp-sub">{detail.en}</div>}

              {/* 成本透明表(對齊官網的定價透明) */}
              {cost.length > 0 ? (
                <div className="costcard">
                  <div className="costcard-h"><b>定價透明</b><span>Transparent Pricing</span></div>
                  {costRows.map(([k, v], i) => <div className="costrow" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>)}
                  {costRows.length > 0 && <div className="costrow sum"><span className="k">進貨成本價</span><span className="v">{nt(costPrice)}</span></div>}
                  {opRows.map(([k, v], i) => <div className="costrow" key={'o' + i}><span className="k">{k}</span><span className="v">{v}</span></div>)}
                  {hasMember && <div className="costrow member"><span className="k">會員價</span><span className="v">{nt(memberPrice)}</span></div>}
                  <div className="costrow sell"><span className="k">售價</span><span className="v">{p.price ? nt(p.price) : '洽詢'}</span></div>
                  <div className="costcard-note">＊價格已反映到岸成本、稅費、恆溫倉儲與金流成本；實際售價與庫存以門市現場為準。</div>
                </div>
              ) : (
                <div className="pdp-price">{p.price ? <><span className="u">NT$</span>{p.price.toLocaleString()}</> : <span className="ask">價格洽詢</span>}</div>
              )}

              {/* 規格 */}
              {specs.length > 0 && (
                <dl className={'specgrid' + (specs.length === 1 ? ' one' : '')}>
                  {specs.map(([k, v]) => <div className="speccell" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
              )}

              <div className="pdp-hint"><span>🍷</span>{p.sold_out ? '此品項暫時售完，可加 LINE 詢問到貨' : '現貨供應・全台宅配到府或門市自取'}</div>
              <div className="pdp-cta2">
                <Link className="btn btn-ink" to="/wineswee/stores">門市選購</Link>
                <a className="btn btn-line" href={getSite().contact.line} target="_blank" rel="noreferrer">加 LINE 詢價</a>
              </div>
            </div>
          </div>

          {/* 產品詳情(全寬) */}
          <Reveal tag="section" className="pdp-detail">
            <div className="pdp-detail-h">
              <span className="numeral">＊</span>
              <h2>產品詳情</h2>
              <span className="en">Product Details</span>
            </div>
            <p className="pdp-lede">{detail?.summary || BLURB[p.cat] || BLURB.other}</p>
            {detail?.sections?.length > 0 && (
              <div className="sects">
                {detail.sections.map((s, i) => (
                  <div className="sect" key={i}>
                    <div className="sect-h"><b>{s.title.replace(/[：:]\s*$/, '')}</b>{s.en && <em>{s.en}</em>}</div>
                    <p>{s.body}</p>
                  </div>
                ))}
              </div>
            )}
          </Reveal>

          {rel.length > 0 && (
            <section className="pdp-related">
              <div className="sec-head">
                <span className="numeral">＋</span>
                <div className="ht"><span className="kicker">You may also like</span><h2>更多{catLabel} <span className="en">/ {catEn}</span></h2></div>
              </div>
              <div className="track">{rel.map((x, i) => <ProductCard key={x.id} p={x} idx={i + 1} />)}</div>
            </section>
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
