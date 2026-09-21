-- 104 離職清單對賬：補齊 28 人資料 + 設離職/離職日；柯雨晶復職；刪 6 筆殘留
-- 2026-06-17  （COALESCE 只填空欄；門市去後綴+別名對映 stores；門市人員部門=營運部）
BEGIN;

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-30', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2021099'),
  id_number=COALESCE(NULLIF(id_number,''),'B122808986'),
  birth_date=COALESCE(birth_date,'1993-01-21'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0933199379'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'try205523@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'401 台中市東區東英里3鄰 東英路642號'),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2025-04-12'),
  position=COALESCE(NULLIF(position,''),'門市人員'),
  store=COALESCE(NULLIF(store,''),'台中英才'),
  store_id=COALESCE(store_id,26),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2021099';  -- 楊朝鈞 [門市:台中英才/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2021100'),
  id_number=COALESCE(NULLIF(id_number,''),'A123031951'),
  birth_date=COALESCE(birth_date,'1977-10-06'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0937886011'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'xw@wineswee.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'111 台北市士林區明勝里9鄰承德路四段12巷57號四樓'),
  address=COALESCE(NULLIF(address,''),'111 台北市士林區明勝里9鄰承德路四段12巷57號四樓'),
  join_date=COALESCE(join_date,'2025-04-14'),
  position=COALESCE(NULLIF(position,''),NULL),
  dept=COALESCE(NULLIF(dept,''),'工務部')
WHERE employee_number = 'L2021100';  -- 楊學文 [部門:工務部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-03-15', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2021107'),
  id_number=COALESCE(NULLIF(id_number,''),'P224692621'),
  birth_date=COALESCE(birth_date,'2004-10-10'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'raaaain10@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2025-05-13'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'天母百貨'),
  store_id=COALESCE(store_id,32),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2021107';  -- 張家瑀 [門市:天母百貨/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-23', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2025051'),
  id_number=COALESCE(NULLIF(id_number,''),'H126408933'),
  birth_date=COALESCE(birth_date,'2007-01-31'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0981123546'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'a091062117502@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'328 桃園市觀音區樹林里14鄰安和街340號'),
  address=COALESCE(NULLIF(address,''),'411 台中市太平區中山路二段32巷12號3樓-1'),
  join_date=COALESCE(join_date,'2025-11-01'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'台中英才'),
  store_id=COALESCE(store_id,26),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2025051';  -- 林善智 [門市:台中英才/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-03-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2025053'),
  id_number=COALESCE(NULLIF(id_number,''),'L224566696'),
  birth_date=COALESCE(birth_date,'1994-01-25'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0288888888'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'ohhaha125@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'438 台中市外埔區馬鳴村8鄰新厝路78號之2'),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2025-11-07'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'台北永春'),
  store_id=COALESCE(store_id,31),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2025053';  -- 張惇惠 [門市:台北永春/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-18', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2025054'),
  id_number=COALESCE(NULLIF(id_number,''),'F800426988/F800426988'),
  birth_date=COALESCE(birth_date,'2003-06-14'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'越南'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),'0225063700'),
  phone=COALESCE(NULLIF(phone,''),'0910690094'),
  email=COALESCE(NULLIF(email,''),'anngoc142003@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'241 新北市三重區重陽路四段42號6樓'),
  address=COALESCE(NULLIF(address,''),'241 新北市三重區重陽路四段42號6樓'),
  join_date=COALESCE(join_date,'2025-11-07'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'南京建國'),
  store_id=COALESCE(store_id,24),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2025054';  -- 阮玉安 [門市:南京建國/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2025060'),
  id_number=COALESCE(NULLIF(id_number,''),'A131115386'),
  birth_date=COALESCE(birth_date,'2000-09-07'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0922301888'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'a26394646@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'241 新北市三重區文化里15鄰正義北路41號'),
  address=COALESCE(NULLIF(address,''),'103 台北市大同區承德路三段159巷27號'),
  join_date=COALESCE(join_date,'2025-11-13'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'中山國小'),
  store_id=COALESCE(store_id,29),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2025060';  -- 許辰 [門市:中山國小/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2025071'),
  id_number=COALESCE(NULLIF(id_number,''),'T224264069'),
  birth_date=COALESCE(birth_date,'1998-12-07'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0987931715'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'hn.091106@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'900 屏東縣屏東市德豐街190巷9弄3號'),
  address=COALESCE(NULLIF(address,''),'900 屏東縣屏東市德豐街190巷9弄3號'),
  join_date=COALESCE(join_date,'2025-12-17'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'高雄中正'),
  store_id=COALESCE(store_id,28),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2025071';  -- 陳涵妮 [門市:高雄中正/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-07', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2025072'),
  id_number=COALESCE(NULLIF(id_number,''),'F226368578'),
  birth_date=COALESCE(birth_date,'1985-12-16'),
  name_en=COALESCE(NULLIF(name_en,''),'Rebacca'),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),'0288888888'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'rebecca@wineswee.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),'rebacca741216@hotmail.com'),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2025-12-18'),
  position=COALESCE(NULLIF(position,''),'專員'),
  dept=COALESCE(NULLIF(dept,''),'業務部')
WHERE employee_number = 'L2025072';  -- 游以欣 [部門:業務部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-12', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026087'),
  id_number=COALESCE(NULLIF(id_number,''),'O100558069'),
  birth_date=COALESCE(birth_date,'2003-12-09'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'zhanhan1209@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-01-05'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'六張犁'),
  store_id=COALESCE(store_id,33),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2026087';  -- 詹程瀚 [門市:六張犁/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-30', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026093'),
  id_number=COALESCE(NULLIF(id_number,''),'A130176581'),
  birth_date=COALESCE(birth_date,'1995-11-27'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'bernie@wineswee.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-01-15'),
  position=COALESCE(NULLIF(position,''),NULL),
  dept=COALESCE(NULLIF(dept,''),'品牌行銷部')
WHERE employee_number = 'L2026093';  -- 黃品翰 [部門:品牌行銷部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-14', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026102'),
  id_number=COALESCE(NULLIF(id_number,''),'E225380499'),
  birth_date=COALESCE(birth_date,'2001-03-17'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'a5520103177@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-02-01'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'台中文心'),
  store_id=COALESCE(store_id,27),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2026102';  -- 徐宛利 [門市:台中文心/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026104'),
  id_number=COALESCE(NULLIF(id_number,''),'F131592119'),
  birth_date=COALESCE(birth_date,'2005-04-21'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0928790236'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'taiyihung0421@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'111 台北市士林區天母里6鄰天玉街73號3樓'),
  join_date=COALESCE(join_date,'2026-02-01'),
  position=COALESCE(NULLIF(position,''),'門市人員'),
  store=COALESCE(NULLIF(store,''),'天母百貨'),
  store_id=COALESCE(store_id,32),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2026104';  -- 戴羿弘 [門市:天母百貨/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-09', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026113'),
  id_number=COALESCE(NULLIF(id_number,''),'A226357856'),
  birth_date=COALESCE(birth_date,'1993-02-28'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),'0225063700'),
  phone=COALESCE(NULLIF(phone,''),'0900192079'),
  email=COALESCE(NULLIF(email,''),'qoopp190@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'247 新北市蘆洲區集賢路245號12樓'),
  join_date=COALESCE(join_date,'2026-04-01'),
  position=COALESCE(NULLIF(position,''),'門市人員'),
  store=COALESCE(NULLIF(store,''),'中山國小'),
  store_id=COALESCE(store_id,29),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2026113';  -- 邱婕涵 [門市:中山國小/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026114'),
  id_number=COALESCE(NULLIF(id_number,''),'H221319399'),
  birth_date=COALESCE(birth_date,'1971-10-17'),
  name_en=COALESCE(NULLIF(name_en,''),'Grace'),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),'0933204575'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'graceyou60@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'231 新北市新店區達觀路8巷3號9樓之二'),
  join_date=COALESCE(join_date,'2026-04-01'),
  position=COALESCE(NULLIF(position,''),NULL),
  dept=COALESCE(NULLIF(dept,''),'財務部')
WHERE employee_number = 'L2026114';  -- 游如梅 [部門:財務部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-06-12', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'L2026120'),
  id_number=COALESCE(NULLIF(id_number,''),'H224524221'),
  birth_date=COALESCE(birth_date,'1994-09-24'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'st120349@yahoo.com.tw'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-06-01'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'南京建國'),
  store_id=COALESCE(store_id,24),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'L2026120';  -- 陳苡慧 [門市:南京建國/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-08', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P2025014'),
  id_number=COALESCE(NULLIF(id_number,''),'A226386839'),
  birth_date=COALESCE(birth_date,'1995-07-11'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0908778101'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'nionmtiti@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'105 台北市松山區延壽街18巷1號4樓'),
  address=COALESCE(NULLIF(address,''),'105 台北市松山區延壽街18巷1號4樓'),
  join_date=COALESCE(join_date,'2025-07-25'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'微風廣場'),
  store_id=COALESCE(store_id,30),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P2025014';  -- 康維珊 [門市:微風廣場/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260005'),
  id_number=COALESCE(NULLIF(id_number,''),'N226651412'),
  birth_date=COALESCE(birth_date,'2003-11-12'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0979095297'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'wangzita1112@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'506 彰化縣福興鄉番社村番社街60-2號'),
  address=COALESCE(NULLIF(address,''),'506 彰化縣福興鄉番社村番社街60-2號'),
  join_date=COALESCE(join_date,'2026-01-10'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'松江長安'),
  store_id=COALESCE(store_id,34),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260005';  -- 王莉庭 [門市:松江長安/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-06', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260010'),
  id_number=COALESCE(NULLIF(id_number,''),'A130745933'),
  birth_date=COALESCE(birth_date,'2002-05-23'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'thomas.chue@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-01-15'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'南京建國'),
  store_id=COALESCE(store_id,24),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260010';  -- 朱憲暉 [門市:南京建國/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-03-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260021'),
  id_number=COALESCE(NULLIF(id_number,''),'B223450575'),
  birth_date=COALESCE(birth_date,'2003-09-18'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'mo8481991@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-02-13'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'台中文心'),
  store_id=COALESCE(store_id,27),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260021';  -- 何芯彗 [門市:台中文心/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-06-01', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260024'),
  id_number=COALESCE(NULLIF(id_number,''),'P224296807'),
  birth_date=COALESCE(birth_date,'1999-01-11'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0921350613'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'gotozhenzhenworld1625@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'115 台北市南港區福德街344號2樓'),
  address=COALESCE(NULLIF(address,''),'115 台北市南港區福德街344號2樓'),
  join_date=COALESCE(join_date,'2026-02-23'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'台北永春'),
  store_id=COALESCE(store_id,31),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260024';  -- 蔡伊真 [門市:台北永春/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-03-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260026'),
  id_number=COALESCE(NULLIF(id_number,''),'H224628617'),
  birth_date=COALESCE(birth_date,'1997-12-20'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'karene1220@yahoo.com.tw'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-03-01'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'中山國小'),
  store_id=COALESCE(store_id,29),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260026';  -- 謝馥伊 [門市:中山國小/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260028'),
  id_number=COALESCE(NULLIF(id_number,''),'D222771095'),
  birth_date=COALESCE(birth_date,'1995-10-26'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0905701311'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'ihsuanchiu1026@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),'115 台北市南港區興南街97號4樓'),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-03-18'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'中信南港'),
  store_id=COALESCE(store_id,25),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260028';  -- 邱翊瑄 [門市:中信南港/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-22', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260030'),
  id_number=COALESCE(NULLIF(id_number,''),'F231818021'),
  birth_date=COALESCE(birth_date,'2008-01-29'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),'0225063700'),
  phone=COALESCE(NULLIF(phone,''),'0933180775'),
  email=COALESCE(NULLIF(email,''),'sunday970129@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'110 台北市信義區林口街24巷34號5樓'),
  join_date=COALESCE(join_date,'2026-03-31'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'台北永春'),
  store_id=COALESCE(store_id,31),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE id = 400;  -- 林思妤 [門市:台北永春/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-04-30', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260032'),
  id_number=COALESCE(NULLIF(id_number,''),'A231497385'),
  birth_date=COALESCE(birth_date,'2006-12-16'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0900328776'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'yux061216@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'111 台北市士林區通河東街一段124巷6弄1號2樓'),
  join_date=COALESCE(join_date,'2026-03-26'),
  position=COALESCE(NULLIF(position,''),'門市人員'),
  store=COALESCE(NULLIF(store,''),'天母百貨'),
  store_id=COALESCE(store_id,32),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260032';  -- 余盈軒 [門市:天母百貨/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-31', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260033'),
  id_number=COALESCE(NULLIF(id_number,''),'N226279858'),
  birth_date=COALESCE(birth_date,'2000-08-10'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),'0978352751'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'zieen.chen@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'110 台北市信義區松山路287巷25號4樓'),
  join_date=COALESCE(join_date,'2026-04-07'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'台北永春'),
  store_id=COALESCE(store_id,31),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE id = 401;  -- 陳姿螢 [門市:台北永春/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-15', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260037'),
  id_number=COALESCE(NULLIF(id_number,''),'P124594002'),
  birth_date=COALESCE(birth_date,'2003-02-16'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'男'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),'未婚'),
  work_phone=COALESCE(NULLIF(work_phone,''),'0972987876'),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'nche.wu10644@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),'nche.wu10644@gmail.com'),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),'108 台北市萬華區富民路155巷15號4F'),
  join_date=COALESCE(join_date,'2026-05-04'),
  position=COALESCE(NULLIF(position,''),'兼職人員'),
  store=COALESCE(NULLIF(store,''),'南京建國'),
  store_id=COALESCE(store_id,24),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260037';  -- 吳恩齊 [門市:南京建國/營運部]

UPDATE public.employees SET
  status='離職',
  resign_date=COALESCE('2026-05-27', resign_date),
  employee_number=COALESCE(NULLIF(employee_number,''),'P20260040'),
  id_number=COALESCE(NULLIF(id_number,''),'A230381100'),
  birth_date=COALESCE(birth_date,'2003-12-27'),
  name_en=COALESCE(NULLIF(name_en,''),NULL),
  gender=COALESCE(NULLIF(gender,''),'女'),
  nationality=COALESCE(NULLIF(nationality,''),'臺灣，中華民國'),
  marital_status=COALESCE(NULLIF(marital_status,''),NULL),
  work_phone=COALESCE(NULLIF(work_phone,''),NULL),
  phone=COALESCE(NULLIF(phone,''),NULL),
  email=COALESCE(NULLIF(email,''),'giselle.gcying@gmail.com'),
  personal_email=COALESCE(NULLIF(personal_email,''),NULL),
  registered_address=COALESCE(NULLIF(registered_address,''),NULL),
  address=COALESCE(NULLIF(address,''),NULL),
  join_date=COALESCE(join_date,'2026-05-25'),
  position=COALESCE(NULLIF(position,''),NULL),
  store=COALESCE(NULLIF(store,''),'台北永春'),
  store_id=COALESCE(store_id,31),
  dept=COALESCE(NULLIF(dept,''),'營運部')
WHERE employee_number = 'P20260040';  -- 陳柔逸 [門市:台北永春/營運部]

-- 柯雨晶 復職
UPDATE public.employees SET status='在職', resign_date=NULL, reinstatement_date=CURRENT_DATE WHERE id=87;

-- 刪除 6 筆殘留（黃品穎67/謝駿伊82/張愷惠91/陳怡臻96/朱蕙瑾117/何芯芸138；FK 安全 DO 區塊）
DO $$
DECLARE v_ids INT[] := ARRAY[67,82,91,96,117,138]; r RECORD;
BEGIN
  FOR r IN SELECT con.conrelid::regclass::text AS tbl, att.attname AS col, att.attnotnull AS nn
    FROM pg_constraint con JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=ANY(con.conkey)
    WHERE con.confrelid='public.employees'::regclass AND con.contype='f' LOOP
    IF r.nn THEN EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col) USING v_ids;
    ELSE EXECUTE format('UPDATE %s SET %I=NULL WHERE %I = ANY($1)', r.tbl, r.col, r.col) USING v_ids; END IF;
  END LOOP;
  DELETE FROM public.employees WHERE id = ANY(v_ids);
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
