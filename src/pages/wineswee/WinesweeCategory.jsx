import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import './wineswee.css'
import { CATEGORIES, byCategory } from './data'
import { Header, ProductCard, Footer, useBodyScroll } from './parts'

export default function WinesweeCategory() {
  useBodyScroll()
  const { key } = useParams()
  useEffect(() => { window.scrollTo(0, 0) }, [key])
  const c = CATEGORIES.find(x => x.key === key)
  const items = (byCategory()[key]) || []
  return (
    <div className="ws">
      <Header />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">Selection / {c?.en || 'Wineswee'}</span>
          <h1>{c?.label || '找不到分類'}</h1>
          <span className="masthead-count">{items.length} 款嚴選</span>
        </div>
      </section>
      <section className="sec sec-light">
        <div className="wrap">
          <div className="cat-grid">{items.map((p, i) => <ProductCard key={p.id} p={p} idx={i + 1} />)}</div>
        </div>
      </section>
      <Footer />
    </div>
  )
}
