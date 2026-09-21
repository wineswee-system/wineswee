import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.wineswee.com'),
  title: {
    default: 'Wineswee 威士威酒食超市｜世界餐酒・威士忌・肉品乳酪海鮮專賣',
    template: '%s ｜ Wineswee 威士威酒食超市',
  },
  description:
    '威士威酒食超市——嚴選世界紅白葡萄酒、威士忌、清酒，佐以伊比利火腿、歐陸乳酪與新鮮肉品海鮮、酒器禮盒。全台十一家門市・線上商城宅配到府。',
  keywords: ['紅酒', '白酒', '威士忌', '清酒', '葡萄酒', '乳酪', '伊比利火腿', '酒器', '威士威', 'Wineswee', '酒食超市'],
  openGraph: {
    type: 'website', locale: 'zh_TW', siteName: 'Wineswee 威士威酒食超市',
    title: 'Wineswee 威士威酒食超市', description: '嚴選世界餐酒與佐餐美食，一站備齊你的餐桌。',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = { themeColor: '#2a0d0f', width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..700&family=Noto+Sans+TC:wght@300;400;500;700&family=Noto+Serif+TC:wght@500;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
