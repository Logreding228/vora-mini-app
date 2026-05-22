# VORA Mini App

React/Vite frontend for the VORA Telegram Mini App.

## API

The production API is configured in `public/config.js`:

```js
window.__VORA_CONFIG__ = {
  API_BASE_URL: 'https://app.vorachoice.store',
  TELEGRAM_AUTH_PATH: '/auth/auth/telegram',
  TOKEN_REFRESH_PATH: '/auth/refresh_accessToken',
  USE_MOCKS: false,
  ACCESS_TOKEN: '',
  REFRESH_TOKEN: '',
  TELEGRAM_INIT_DATA: '',
};
```

The app sends Telegram `initData` to `/auth/auth/telegram`, stores `token_access` and `token_refresh`, and refreshes access tokens through `/auth/refresh_accessToken`.

## Local Run

```bash
npm install
npm run dev
```

## GitHub Pages

This repo includes `.github/workflows/deploy-pages.yml`.

After pushing to GitHub:

1. Open repository settings.
2. Go to `Pages`.
3. Set source to `GitHub Actions`.
4. Push to `main`.
5. Open the deployed Pages URL from the workflow output.

## Telegram Mini App

In `@BotFather`:

1. Open your bot.
2. Use `Bot Settings`.
3. Use `Menu Button` or `Configure Mini App`.
4. Set the GitHub Pages URL as the Web App URL.

The backend must keep HTTPS and CORS enabled for the GitHub Pages domain.
