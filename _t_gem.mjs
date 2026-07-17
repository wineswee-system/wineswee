import fs from 'fs'
const KEY = process.env.KEY
const sample = ['團隊在班','今日請假','待我簽核','排班管理','希望休','換班申請','工時/假別單位','假日管理','排班總表匯入','薪資與福利']
const prompt = `You are translating Traditional Chinese UI strings from an ERP system into concise, professional English (UI labels/buttons — keep short, Title Case where natural). Return ONLY a JSON object mapping each EXACT original string to its English translation, no extra text.\nStrings:\n${JSON.stringify(sample, null, 0)}`
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`, {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{responseMimeType:'application/json', temperature:0.2} })
})
const j = await r.json()
if(!r.ok){ console.log('❌', r.status, JSON.stringify(j).slice(0,300)); process.exit(1) }
const txt = j.candidates?.[0]?.content?.parts?.[0]?.text
console.log('回應:', txt)
