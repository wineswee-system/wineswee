import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import './wineswee.css'
import { CATEGORIES, WINE_KEYS, FOOD_KEYS, byCategory, regionOf, PRICE_BANDS } from './data'
import { Header, ProductCard, Footer, useBodyScroll } from './parts'

export default function WinesweeCategory() {
  useBodyScroll()
  const { key } = useParams()
  useEffect(() => { window.scrollTo(0, 0) }, [key])
  const c = CATEGORIES.find(x => x.key === key)
  const cats = byCategory()
  const base = useMemo(() => (cats[key] || []).map(p => ({ ...p, region: regionOf(p.name) })), [key])

  const [region, setRegion] = useState('全部')
  const [band, setBand] = useState('全部')
  const [q, setQ] = useState('')
  useEffect(() => { setRegion('全部'); setBand('全部'); setQ('') }, [key])

  const regions = useMemo(() => {
    const m = {}
    base.forEach(p => { m[p.region] = (m[p.region] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [base])

  const filtered = useMemo(() => base.filter(p => {
    if (region !== '全部' && p.region !== region) return false
    if (band !== '全部') { const b = PRICE_BANDS.find(x => x.key === band); if (!(p.price != null && p.price >= b.min && p.price < b.max)) return false }
    if (q.trim() && !p.name.toLowerCase().includes(q.trim().toLowerCase())) return false
    return true
  }), [base, region, band, q])

  const wine = CATEGORIES.filter(x => WINE_KEYS.includes(x.key))
  const food = CATEGORIES.filter(x => FOOD_KEYS.includes(x.key))

  return (
    <div className="ws">
      <Header />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">Selection / {c?.en || 'Wineswee'}</span>
          <h1>{c?.label || '找不到分類'}</h1>
          <span className="masthead-count">{base.length} 款嚴選</span>
        </div>
      </section>

      <section className="sec sec-light">
        <div className="wrap catpage">
          {/* 左側層次分類 */}
          <aside className="catnav">
            <div className="catnav-grp">
              <h4>酒類專區</h4>
              <ul>{wine.map(x => <li key={x.key}><Link className={x.key === key ? 'on' : ''} to={`/wineswee/category/${x.key}`}>{x.label}<em>{(cats[x.key] || []).length}</em></Link></li>)}</ul>
            </div>
            <div className="catnav-grp">
              <h4>美食・酒器</h4>
              <ul>{food.map(x => <li key={x.key}><Link className={x.key === key ? 'on' : ''} to={`/wineswee/category/${x.key}`}>{x.label}<em>{(cats[x.key] || []).length}</em></Link></li>)}</ul>
            </div>
            {regions.length > 1 && (
              <div className="catnav-grp">
                <h4>產區</h4>
                <ul className="catnav-region">
                  <li><button className={region === '全部' ? 'on' : ''} onClick={() => setRegion('全部')}>全部產區</button></li>
                  {regions.map(([r, n]) => <li key={r}><button className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>{r}<em>{n}</em></button></li>)}
                </ul>
              </div>
            )}
          </aside>

          {/* 主內容 */}
          <div className="catmain">
            {/* 篩選器 */}
            <div className="filterbar">
              <select value={region} onChange={e => setRegion(e.target.value)} aria-label="產區">
                <option value="全部">全部產區</option>
                {regions.map(([r]) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={band} onChange={e => setBand(e.target.value)} aria-label="單價">
                <option value="全部">全部單價</option>
                {PRICE_BANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <div className="filter-search">
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="關鍵字搜尋商品名稱" />
              </div>
              <span className="filter-count">{filtered.length} 項</span>
            </div>

            {filtered.length ? (
              <div className="cat-grid">
                {filtered.map((p, i) => <ProductCard key={p.id} p={p} idx={i + 1} />)}
              </div>
            ) : (
              <div className="cat-empty">沒有符合條件的商品，試試其他篩選。</div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
