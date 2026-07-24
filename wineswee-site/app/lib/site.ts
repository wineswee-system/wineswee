// 官網真實素材(連官網 CDN / 真社群連結 / 真門市)
export const CDN = 'https://www.wineswee.com'
export const SITE = {
  name: 'Wineswee 威士威酒食超市',
  shop: 'https://www.wineswee.com/',
  logo: `${CDN}/resources/_img/layout/logo.svg`,
  line: 'https://page.line.me/?accountId=wineswee01',
  fb: 'https://www.facebook.com/wineswee90370708/',
  ig: 'https://www.instagram.com/wineswee/',
  ytEmbed: 'https://www.youtube.com/embed/ZZccVDRoR2M?rel=0&loop=1&playlist=ZZccVDRoR2M&showinfo=0&controls=1',
  email: 'cs@wineswee.com',
}

export const BANNERS = [
  `${CDN}/upload/banner/image/2026-05-22/PnahdFdR82dbWjODiQmGdfEVeUbNe0xrGkYUlSZ4.jpg`,
  `${CDN}/upload/banner/image/2026-05-08/JB0jvHwOiD3VqgHu37dhNflzkjEjcwqgx8MBGsa9.jpg`,
  `${CDN}/upload/banner/image/2026-04-16/cmx82g7NBRrsOxFo0WZjFHd069ku19MWl48Ubu5A.jpg`,
  `${CDN}/upload/banner/image/2025-01-17/76YcWU0PLnHZUp8FsZlMaXN7sEbMqHXojnA0md8C.jpg`,
]

export type Store = { region: string; tel: string }
export const STORES: Store[] = [
  { region: '台北', tel: '02-2508-3225' },
  { region: '台北', tel: '02-2522-4168' },
  { region: '台北', tel: '02-2732-2568' },
  { region: '新北', tel: '02-2755-4168' },
  { region: '新北', tel: '02-2959-7968' },
  { region: '台中', tel: '04-2473-4868' },
  { region: '高雄', tel: '07-226-8168' },
]
