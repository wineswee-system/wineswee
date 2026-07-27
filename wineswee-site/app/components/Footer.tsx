import { CATEGORIES } from '../lib/products'
import { SITE } from '../lib/site'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-top">
        <div className="footer-brand">
          <div className="footer-word">WINESWEE<em>威士威酒食超市</em></div>
          <p>紅白葡萄酒・威士忌・清酒・肉品・乳酪・海鮮・酒器禮盒——一站備齊你的餐桌。</p>
        </div>
        <div className="footer-col">
          <h4>選購</h4>
          {CATEGORIES.slice(0, 6).map(c => <a key={c.key} href={`/category/${c.key}`}>{c.label}</a>)}
        </div>
        <div className="footer-col">
          <h4>Contact</h4>
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
          <a href={SITE.shop} target="_blank" rel="noreferrer">官網商城</a>
          <a href={SITE.line} target="_blank" rel="noreferrer">LINE 官方帳號</a>
        </div>
        <div className="footer-col">
          <h4>Follow</h4>
          <a href={SITE.fb} target="_blank" rel="noreferrer">Facebook</a>
          <a href={SITE.ig} target="_blank" rel="noreferrer">Instagram</a>
        </div>
      </div>
      <div className="wrap footer-bar">
        <span>© 2026 Wineswee 威士威酒食超市</span>
        <span>未滿十八歲禁止飲酒・飲酒過量有害健康・禁止酒駕</span>
      </div>
    </footer>
  )
}
