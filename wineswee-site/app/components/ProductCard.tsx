import Image from 'next/image'
import type { Product } from '../lib/products'
import { SITE } from '../lib/site'

export default function ProductCard({ p }: { p: Product }) {
  return (
    <a className={'card' + (p.sold_out ? ' sold' : '')} href={SITE.shop} target="_blank" rel="noreferrer">
      <div className="card-img">
        {p.image ? (
          <Image
            src={p.image}
            alt={p.name}
            fill
            sizes="(max-width:520px) 44vw, 236px"
            style={{ objectFit: 'cover' }}
            unoptimized={false}
          />
        ) : (
          <span className="card-ph">WINESWEE</span>
        )}
        {p.sold_out && <span className="tag-sold">SOLD OUT</span>}
        <span className="card-shop">立即選購</span>
      </div>
      <div className="card-body">
        <h3 title={p.name}>{p.name}</h3>
        {p.price ? (
          <span className="price"><span className="u">NT$</span>{p.price.toLocaleString()}</span>
        ) : (
          <span className="price ask">價格洽詢</span>
        )}
      </div>
    </a>
  )
}
