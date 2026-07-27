'use client'
import { useEffect, useState } from 'react'
import { BANNERS, SITE } from '../lib/site'

export default function HeroSlider() {
  const [i, setI] = useState(0)
  const n = BANNERS.length
  const go = (d: number) => setI(v => (v + d + n) % n)
  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % n), 6000)
    return () => clearInterval(t)
  }, [n])

  return (
    <section className="hero" id="top">
      {/* 左:文案面板 */}
      <div className="hero-left">
        <span className="hero-est">EST. — 威士威酒食超市</span>
        <div className="hero-copy">
          <span className="kicker on-dark">Wine · Whisky · Gourmet</span>
          <h1>
            <span className="r1">為每一次相聚，</span>
            <span className="r2">斟一杯剛剛好的<em>講究</em>。</span>
          </h1>
          <p className="hero-sub">
            嚴選世界餐酒與佐餐美食——從波爾多列級到里奧哈、伊比利火腿到歐陸乳酪，一站備齊你的餐桌。
          </p>
          <div className="hero-cta">
            <a className="btn btn-gold" href="#cat-red">開始選酒</a>
            <a className="btn btn-outline" href={SITE.shop} target="_blank" rel="noreferrer">官網商城</a>
          </div>
        </div>
      </div>

      {/* 右:banner 輪播(不疊字) */}
      <div className="hero-right">
        {BANNERS.map((b, idx) => (
          <div key={b} className={'hero-slide' + (idx === i ? ' on' : '')} aria-hidden={idx !== i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b} alt="" />
          </div>
        ))}
        <div className="hero-rt-veil" />
        <div className="hero-nav">
          <span className="hero-count"><b>{String(i + 1).padStart(2, '0')}</b> / {String(n).padStart(2, '0')}</span>
          <button className="harw" onClick={() => go(-1)} aria-label="上一張">‹</button>
          <button className="harw" onClick={() => go(1)} aria-label="下一張">›</button>
        </div>
      </div>
    </section>
  )
}
