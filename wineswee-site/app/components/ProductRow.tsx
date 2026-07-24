'use client'
import { useEffect, useRef, useState } from 'react'
import type { Product } from '../lib/products'
import ProductCard from './ProductCard'

export default function ProductRow({
  id, title, en, items,
}: { id: string; title: string; en: string; items: Product[] }) {
  const track = useRef<HTMLDivElement>(null)
  const sec = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = sec.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } },
      { threshold: 0.1 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const scroll = (dir: number) => {
    const t = track.current
    if (t) t.scrollBy({ left: dir * t.clientWidth * 0.85, behavior: 'smooth' })
  }

  if (!items.length) return null
  return (
    <section id={id} ref={sec} className={'sec reveal' + (shown ? ' in' : '')}>
      <div className="wrap">
        <div className="sec-head">
          <div className="t">
            <h2>{title}</h2>
            <span className="cnt">{en} · {items.length}</span>
          </div>
          <span className="rule" />
          <div className="arrows">
            <button onClick={() => scroll(-1)} aria-label="上一批">‹</button>
            <button onClick={() => scroll(1)} aria-label="下一批">›</button>
          </div>
        </div>
        <div className="track" ref={track}>
          {items.map((p, i) => <ProductCard key={p.name + i} p={p} />)}
        </div>
      </div>
    </section>
  )
}
