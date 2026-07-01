// ════════════════════════════════════════════════════════════════
// 註冊 Discord slash commands（全域指令，PUT = 整批覆蓋）
//
// 用法：
//   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=yyy node scripts/register-discord-commands.mjs
//   (Windows PowerShell: $env:DISCORD_APP_ID='xxx'; $env:DISCORD_BOT_TOKEN='yyy'; node scripts/register-discord-commands.mjs)
//
// 不需任何 npm 依賴 — 使用 Node 18+ 內建 fetch。
// 指令對應 supabase/functions/discord-bot/index.ts 的 handler。
// ════════════════════════════════════════════════════════════════

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error('缺少環境變數：DISCORD_APP_ID 和 DISCORD_BOT_TOKEN 都必須設定。');
  process.exit(1);
}

// Discord option type 3 = STRING
const commands = [
  {
    name: 'link',
    description: '綁定 ERP 員工帳號（綁定碼由 ERP 系統產生，15 分鐘有效）',
    options: [
      {
        type: 3,
        name: 'code',
        description: '8 碼綁定碼',
        required: true,
      },
    ],
  },
  {
    name: 'schedule',
    description: '查詢未來 7 天班表',
  },
  {
    name: 'leave',
    description: '查詢今年假期餘額',
  },
  {
    name: 'kpi',
    description: '今日營業額與交易筆數（僅限管理員 / 主管）',
  },
];

const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`註冊失敗 HTTP ${res.status}:\n${body}`);
  process.exit(1);
}

const registered = await res.json();
console.log(`已註冊 ${registered.length} 個指令：`);
for (const cmd of registered) {
  console.log(`  /${cmd.name} (id: ${cmd.id})`);
}
console.log('\n注意：全域指令最多可能需要 1 小時才會在所有伺服器生效。');
