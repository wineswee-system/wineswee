'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { BANNERS, SITE } from '../lib/site'

export default function HeroSlider() {
  const [i, setI] = useState(0)
  const n = BANNERS.length
  const go = (d: number) => setI(v => (v + d + n) % n)

  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % n), 5500)
    return () => clearInterval(t)
  }, [n])

  return (
    <section className="hero" id="top">
      <div className="hero-track">
        {BANNERS.map((b, idx) => (
          <div key={b} className={'hero-slide' + (idx === i ? ' on' : '')} aria-hidden={idx !== i}>
            <Image src={b} alt="" fill priority={idx === 0} sizes="100vw" style={{ objectFit: 'cover' }} />
          </div>
        ))}
        <div className="hero-veil" />
        <div className="hero-copy">
          <div className="wrap">
            <span className="eyebrow">Wine · Whisky · Gourmet</span>
            <h1>為每一次相聚，斟一杯剛剛好的講究。</h1>
            <p>嚴選世界餐酒與佐餐美食，從波爾多到里奧哈、伊比利火腿到歐陸乳酪，一站備齊你的餐桌。</p>
            <div className="btns">
              <a className="btn btn-gold" href="#cat-red">開始選購</a>
              <a className="btn btn-ghost" href={SITE.shop} target="_blank" rel="noreferrer">前往官網商城</a>
            </div>
          </div>
        </div>
        <button className="hero-arw l" onClick={() => go(-1)} aria-label="上一張">‹</button>
        <button className="hero-arw r" onClick={() => go(1)} aria-label="下一張">›</button>
        <div className="hero-dots">
          {BANNERS.map((_, idx) => (
            <button key={idx} className={idx === i ? 'on' : ''} onClick={() => setI(idx)} aria-label={`第 ${idx + 1} 張`} />
          ))}
        </div>
      </div>
    </section>
  )
}
