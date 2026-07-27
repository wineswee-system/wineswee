'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Product } from '../lib/products'
import ProductCard from './ProductCard'

export default function ProductRow({
  no, id, title, en, items, tone = 'light',
}: { no: string; id: string; title: string; en: string; items: Product[]; tone?: 'light' | 'cream' | 'dark' }) {
  const track = useRef<HTMLDivElement>(null)
  const sec = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = sec.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { threshold: 0.08 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const scroll = (d: number) => track.current?.scrollBy({ left: d * track.current.clientWidth * 0.82, behavior: 'smooth' })
  if (!items.length) return null

  return (
    <section id={id} ref={sec} className={`sec sec-${tone} reveal${shown ? ' in' : ''}`}>
      <div className="wrap">
        <div className="sec-head">
          <span className="numeral">{no}</span>
          <div className="ht">
            <span className="kicker">Selection</span>
            <h2>{title} <span className="en">/ {en}</span></h2>
          </div>
          <div className="arrows">
            <button onClick={() => scroll(-1)} aria-label="上一批">‹</button>
            <button onClick={() => scroll(1)} aria-label="下一批">›</button>
          </div>
        </div>
        <div className="track" ref={track}>
          {items.map((p, i) => <ProductCard key={p.id} p={p} idx={i + 1} />)}
        </div>
        <div className="rowmore">
          <Link href={`/category/${id.replace('cat-', '')}`}>看全部 {title}</Link>
        </div>
      </div>
    </section>
  )
}
