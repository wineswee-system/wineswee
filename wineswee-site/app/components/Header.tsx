'use client'
import Link from 'next/link'
import { CATEGORIES } from '../lib/products'
import { SITE } from '../lib/site'

const WINE_KEYS = ['red', 'white', 'sparkling', 'rose', 'whisky', 'sake', 'spirit']
const FOOD_KEYS = ['cheese', 'ham', 'ware']

export default function Header({ pinned = false }: { pinned?: boolean }) {
  const anchor = (a: string) => (pinned ? `/${a}` : a)
  const wine = CATEGORIES.filter(c => WINE_KEYS.includes(c.key))
  const food = CATEGORIES.filter(c => FOOD_KEYS.includes(c.key))

  const Drop = ({ label, items }: { label: string; items: typeof CATEGORIES }) => (
    <div className="nav-drop">
      <span className="nav-top">{label}<i className="caret" /></span>
      <div className="drop">
        <div className="drop-grid">
          {items.map(c => (
            <Link key={c.key} href={`/category/${c.key}`}><span>{c.label}</span><em>{c.en}</em></Link>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <header className="header">
      <div className="wrap header-in">
        <a className="logo" href={pinned ? '/' : '#top'} aria-label="Wineswee 威士威酒食超市">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SITE.logo} alt="Wineswee 威士威酒食超市" />
        </a>

        <nav className="nav">
          <a className="nav-top" href={anchor('#story')}>關於我們</a>
          <Drop label="酒類專區" items={wine} />
          <Drop label="美食／酒器" items={food} />
          <a className="nav-top" href={anchor('#news')}>主題活動</a>
          <a className="nav-top" href={anchor('#story')}>酒品知識</a>
          <a className="nav-top" href={anchor('#store')}>門市資訊</a>
          <a className="nav-top" href={SITE.shop} target="_blank" rel="noreferrer">加入會員</a>
          <a className="nav-top" href={SITE.shop} target="_blank" rel="noreferrer">訂單查詢</a>
          <a className="nav-top" href={SITE.shop} target="_blank" rel="noreferrer">加盟專區</a>
        </nav>

        <div className="header-cta">
          <a className="chip chip-line" href={SITE.line} target="_blank" rel="noreferrer">LINE 訂購</a>
        </div>
      </div>
    </header>
  )
}
