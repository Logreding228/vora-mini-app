import { readFileSync, existsSync } from 'node:fs';

const localEnvPath = '.env.bot';

if (existsSync(localEnvPath)) {
  const lines = readFileSync(localEnvPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL || 'https://logreding228.github.io/vora-mini-app/';
const menuText = process.env.TELEGRAM_MENU_TEXT || 'Открыть VORA';

if (!token) {
  throw new Error('Set TELEGRAM_BOT_TOKEN in .env.bot or environment');
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(`${method}: ${data.description || 'Telegram API error'}`);
  }

  return data.result;
}

const bot = await telegram('getMe');

await telegram('setMyCommands', {
  commands: [
    {
      command: 'start',
      description: 'Открыть VORA',
    },
  ],
});

await telegram('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: menuText,
    web_app: {
      url: miniAppUrl,
    },
  },
});

await telegram('setMyShortDescription', {
  short_description: 'VORA mini app',
});

console.log(`Bot @${bot.username} is connected to ${miniAppUrl}`);
