// Mock data — only exports used by OrgChart.jsx are retained
export const employees = [
  { id: 1, name: '王小明', nameEn: 'Xiaoming Wang', dept: '研發部', position: '資深工程師', store: '台北總部', status: '在職', email: 'xiaoming@company.com', phone: '0912-345-678', joinDate: '2022-03-15', avatar: '#3b82f6' },
  { id: 2, name: '林美麗', nameEn: 'Meili Lin', dept: '行銷部', position: '行銷經理', store: '台北總部', status: '在職', email: 'meili@company.com', phone: '0923-456-789', joinDate: '2021-08-20', avatar: '#a78bfa' },
  { id: 3, name: '陳大偉', nameEn: 'Dawei Chen', dept: '業務部', position: '業務主管', store: '台中分店', status: '在職', email: 'dawei@company.com', phone: '0934-567-890', joinDate: '2020-11-10', avatar: '#f472b6' },
  { id: 4, name: '張雅婷', nameEn: 'Yating Zhang', dept: '人資部', position: 'HR 專員', store: '台北總部', status: '在職', email: 'yating@company.com', phone: '0945-678-901', joinDate: '2023-01-05', avatar: '#34d399' },
  { id: 5, name: '黃志強', nameEn: 'Zhiqiang Huang', dept: '研發部', position: '前端工程師', store: '台北總部', status: '在職', email: 'zhiqiang@company.com', phone: '0956-789-012', joinDate: '2023-06-12', avatar: '#fb923c' },
  { id: 6, name: '劉佳玲', nameEn: 'Jialing Liu', dept: '財務部', position: '財務主管', store: '台北總部', status: '在職', email: 'jialing@company.com', phone: '0967-890-123', joinDate: '2019-04-20', avatar: '#22d3ee' },
  { id: 7, name: '吳建宏', nameEn: 'Jianhong Wu', dept: '業務部', position: '業務代表', store: '高雄分店', status: '在職', email: 'jianhong@company.com', phone: '0978-901-234', joinDate: '2024-02-14', avatar: '#f87171' },
  { id: 8, name: '蔡心怡', nameEn: 'Xinyi Cai', dept: '客服部', position: '客服組長', store: '台中分店', status: '在職', email: 'xinyi@company.com', phone: '0989-012-345', joinDate: '2022-09-08', avatar: '#fbbf24' },
  { id: 9, name: '鄭宇翔', nameEn: 'Yuxiang Zheng', dept: '研發部', position: '後端工程師', store: '台北總部', status: '離職', email: 'yuxiang@company.com', phone: '0990-123-456', joinDate: '2021-12-01', avatar: '#64748b' },
]

export const departments = [
  { id: 1, name: '研發部', head: '王小明', memberCount: 3, description: '負責產品研發與技術創新' },
  { id: 2, name: '行銷部', head: '林美麗', memberCount: 1, description: '品牌推廣與市場策略' },
  { id: 3, name: '業務部', head: '陳大偉', memberCount: 2, description: '客戶開發與業務推展' },
  { id: 4, name: '人資部', head: '張雅婷', memberCount: 1, description: '人力資源管理與發展' },
  { id: 5, name: '財務部', head: '劉佳玲', memberCount: 1, description: '財務管理與會計作業' },
  { id: 6, name: '客服部', head: '蔡心怡', memberCount: 1, description: '客戶服務與售後支援' },
]
