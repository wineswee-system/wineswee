import { useEffect } from 'react'
import './wineswee.css'
import { STORES, SITE } from './data'
import { Header, Footer, Reveal, useBodyScroll } from './parts'

const REGIONS = ['台北', '新北', '台中', '高雄']

export default function WinesweeStores() {
  useBodyScroll()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const mapUrl = s => `https://www.google.com/maps/search/${encodeURIComponent('威士威酒食超市 ' + s.full + ' ' + s.addr)}`
  return (
    <div className="ws">
      <Header />
      <section className="masthead">
        <div className="wrap masthead-in">
          <span className="kicker on-dark">Our Stores</span>
          <h1>全台 11 家門市</h1>
          <p className="page-lead">親臨威士威，現場試味、聊聊你的餐桌與場合，我們幫你配到剛剛好的那一支。點擊門市可開啟 Google 地圖導航。</p>
        </div>
      </section>

      {REGIONS.map(rg => {
        const list = STORES.filter(s => s.region === rg)
        if (!list.length) return null
        return (
          <Reveal key={rg} tag="section" className="sec sec-light">
            <div className="wrap">
              <div className="sec-head">
                <span className="numeral">{list.length}</span>
                <div className="ht"><span className="kicker">{rg}</span><h2>{rg}門市</h2></div>
              </div>
              <div className="storefull-grid">
                {list.map((s, i) => (
                  <a key={i} className="storefull" href={mapUrl(s)} target="_blank" rel="noreferrer">
                    <div className="storefull-top"><span className="storefull-rg">{s.region}</span><h3>{s.name}</h3></div>
                    <div className="storefull-row"><span className="lb">電話</span><span>{s.tel}</span></div>
                    <div className="storefull-row"><span className="lb">地址</span><span>{s.addr}</span></div>
                    <span className="storefull-map">在 Google 地圖開啟 →</span>
                  </a>
                ))}
              </div>
            </div>
          </Reveal>
        )
      })}

      <Reveal tag="section" className="cta">
        <div className="wrap cta-in">
          <div><h2>找不到附近門市？<em>線上也能買</em></h2><p>全台宅配到府，或加 LINE 由專人為你選酒。</p></div>
          <a className="btn btn-line" href={SITE.line} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>
        </div>
      </Reveal>
      <Footer />
    </div>
  )
}
