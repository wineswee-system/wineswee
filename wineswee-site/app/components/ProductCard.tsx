import Link from 'next/link'
import type { Product } from '../lib/products'

export default function ProductCard({ p, idx }: { p: Product; idx?: number }) {
  return (
    <Link className={'card' + (p.sold_out ? ' sold' : '')} href={`/product/${p.id}`}>
      <div className="card-frame">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.name} loading="lazy" />
        ) : (
          <span className="card-ph">Wineswee</span>
        )}
        {idx != null && <span className="card-idx">{String(idx).padStart(2, '0')}</span>}
        {p.sold_out && <span className="card-sold">SOLD OUT</span>}
        <span className="card-cta">VIEW</span>
      </div>
      <div className="card-body">
        <h3 title={p.name}>{p.name}</h3>
        {p.price ? (
          <span className="price"><span className="u">NT$</span>{p.price.toLocaleString()}</span>
        ) : (
          <span className="price ask">價格洽詢</span>
        )}
      </div>
    </Link>
  )
}
