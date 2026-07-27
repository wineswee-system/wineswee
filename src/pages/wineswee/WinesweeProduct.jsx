import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './wineswee.css'
import { getProduct, related, CAT_LABEL, CAT_EN, SITE } from './data'
import { Header, ProductRow, Footer } from './parts'

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

export default function WinesweeProduct() {
  const { id } = useParams()
  useEffect(() => { window.scrollTo(0, 0) }, [id])
  const p = getProduct(Number(id))
  if (!p) return <div className="ws"><Header /><section className="masthead"><div className="wrap masthead-in"><h1>找不到商品</h1></div></section><Footer /></div>
  const rel = related(p, 12)
  const catLabel = CAT_LABEL[p.cat] || '嚴選'
  const catEn = CAT_EN[p.cat] || 'Selection'
  return (
    <div className="ws">
      <Header />
      <nav className="crumb wrap">
        <Link to="/wineswee">首頁</Link><span>/</span>
        <Link to={`/wineswee/category/${p.cat}`}>{catLabel}</Link><span>/</span>
        <em>{p.name}</em>
      </nav>
      <section className="pdp wrap">
        <div className="pdp-media">
          {p.image ? <img src={p.image} alt={p.name} /> : <span className="pdp-ph">Wineswee</span>}
          {p.sold_out && <span className="pdp-sold">SOLD OUT</span>}
        </div>
        <div className="pdp-info">
          <span className="kicker">{catLabel} / {catEn}</span>
          <h1>{p.name}</h1>
          <div className="pdp-price">{p.price ? <><span className="u">NT$</span>{p.price.toLocaleString()}</> : <span className="ask">價格洽詢</span>}</div>
          <p className="pdp-desc">{BLURB[p.cat] || BLURB.other}</p>
          <div className="pdp-cta">
            <a className="btn btn-ink" href={SITE.shop} target="_blank" rel="noreferrer">前往官網購買</a>
            <a className="btn btn-line" href={SITE.line} target="_blank" rel="noreferrer">加 LINE 洽詢</a>
          </div>
          <dl className="pdp-meta">
            <div><dt>分類</dt><dd>{catLabel}</dd></div>
            <div><dt>供應狀態</dt><dd>{p.sold_out ? '暫時售完' : '現貨供應'}</dd></div>
            <div><dt>配送</dt><dd>全台宅配・門市自取</dd></div>
          </dl>
        </div>
      </section>
      {rel.length > 0 && <ProductRow no="＋" id={`cat-${p.cat}`} title={`更多${catLabel}`} en={catEn} items={rel} tone="cream" />}
      <Footer />
    </div>
  )
}
