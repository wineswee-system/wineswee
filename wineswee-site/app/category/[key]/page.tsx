import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CATEGORIES, byCategory, type CategoryKey } from '../../lib/products'
import Header from '../../components/Header'
import Footer from '../../components/Footer'
import ProductCard from '../../components/ProductCard'

export function generateStaticParams() {
  return CATEGORIES.map(c => ({ key: c.key }))
}

export function generateMetadata({ params }: { params: { key: string } }): Metadata {
  const c = CATEGORIES.find(x => x.key === params.key)
  if (!c) return { title: '找不到分類' }
  return { title: `${c.label} ${c.en}`, description: `Wineswee 威士威酒食超市 ${c.label}精選——嚴選世界${c.label}，線上選購・門市試味。` }
}

export default function CategoryPage({ params }: { params: { key: string } }) {
  const c = CATEGORIES.find(x => x.key === params.key)
  if (!c) notFound()
  const items = byCategory()[params.key as CategoryKey] || []

  return (
    <>
      <Header pinned />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">Selection / {c.en}</span>
          <h1>{c.label}</h1>
          <span className="masthead-count">{items.length} 款嚴選</span>
        </div>
      </section>

      <section className="sec sec-light">
        <div className="wrap">
          <div className="cat-grid">
            {items.map((p, i) => <ProductCard key={p.id} p={p} idx={i + 1} />)}
          </div>
        </div>
      </section>

      <Footer />
    </>
  )
}
