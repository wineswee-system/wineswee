import {
  Zap, Shield, Globe, BarChart3, Users, CreditCard,
} from 'lucide-react'

export default function DemoBentoSection() {
  return (
    <div className="bento-grid">
      {/* Row 1: 3 equal cards */}
      <div className="bento-card glass">
        <div className="bento-icon" style={{ '--bcolor': '#2563eb' }}><Zap size={22} strokeWidth={1.8} /></div>
        <h3>跨模組即時串接</h3>
        <p>訂單自動檢查庫存與信用額度，出貨即時拋轉應收帳款，減少人工對帳。</p>
        <div className="bento-tags">
          {['贏單→應收', '出貨→帳款', '請假→薪資', '庫存→採購'].map(t => <span key={t} className="bento-tag">{t}</span>)}
        </div>
      </div>
      <div className="bento-card glass">
        <div className="bento-icon" style={{ '--bcolor': '#059669' }}><Shield size={22} strokeWidth={1.8} /></div>
        <h3>台灣法規合規引擎</h3>
        <p>勞基法、性平法共 50+ 條法規即時檢核，排班違規自動標示，降低勞檢風險。</p>
      </div>
      <div className="bento-card glass">
        <div className="bento-icon" style={{ '--bcolor': '#d97706' }}><Globe size={22} strokeWidth={1.8} /></div>
        <h3>LINE 行動辦公</h3>
        <p>打卡、假單、薪資、簽核，打開 LINE 就能操作，不受時間地點限制。</p>
      </div>
      {/* Row 2: 3 equal cards */}
      <div className="bento-card glass">
        <div className="bento-icon" style={{ '--bcolor': '#7c3aed' }}><BarChart3 size={22} strokeWidth={1.8} /></div>
        <h3>BI 數據看板</h3>
        <p>即時營運圖表、銷售預測、異常偵測，用數據驅動決策，不憑感覺。</p>
      </div>
      <div className="bento-card glass">
        <div className="bento-icon" style={{ '--bcolor': '#db2777' }}><Users size={22} strokeWidth={1.8} /></div>
        <h3>不限使用人數</h3>
        <p>全模組授權不按人頭計費，5 人到 200 人同一套系統，隨公司成長擴展。</p>
      </div>
      <div className="bento-card glass">
        <div className="bento-icon" style={{ '--bcolor': '#f97316' }}><CreditCard size={22} strokeWidth={1.8} /></div>
        <h3>全模組一次包含</h3>
        <p>人事、倉儲、CRM、財務、生產全部內建，不用一個一個另外買。</p>
      </div>
    </div>
  )
}
