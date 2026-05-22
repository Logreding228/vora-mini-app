# VORA API setup

## Runtime config

The app reads backend settings from `public/config.js`.

For local work:

```js
window.__VORA_CONFIG__ = {
  API_BASE_URL: 'https://app.vorachoice.store',
  TELEGRAM_AUTH_PATH: '/auth/auth/telegram',
  TOKEN_REFRESH_PATH: '/auth/refresh_accessToken',
  ACCESS_TOKEN: '',
  REFRESH_TOKEN: '',
  TELEGRAM_INIT_DATA: '',
};
```

For GitHub Pages set `API_BASE_URL` to the public HTTPS backend URL. Telegram Mini Apps and most browsers will block requests from HTTPS GitHub Pages to plain HTTP, so the backend should also be HTTPS.

## Telegram auth

The frontend automatically calls `window.Telegram.WebApp.ready()` and reads:

- `initData`
- `initDataUnsafe.user`

If there is no saved Bearer token, it sends:

```http
POST /auth/auth/telegram
Content-Type: application/json

{ "initData": "<Telegram initData>" }
```

Expected response:

```json
{
  "token_access": "...",
  "token_refresh": "..."
}
```

The frontend also accepts `access_token` / `refresh_token` and `access` / `refresh` field names. If the backend uses another path, change `TELEGRAM_AUTH_PATH` in `public/config.js`.

## Refresh token

If any API request returns `401`, the frontend calls:

```http
POST /auth/refresh_accessToken
Authorization: Bearer <refresh token>
```

Then it saves the returned token pair and retries the original request once. If the backend uses another path, change `TOKEN_REFRESH_PATH`.

## Token fallback

For quick testing without Telegram auth, pass tokens once in the URL:

```text
https://site/page?access_token=ACCESS&refresh_token=REFRESH
```

The app saves it to `localStorage` and uses it as:

```http
Authorization: Bearer TOKEN
```

## API endpoints already wired

- `GET /users/main_screen/`
- `GET /hwid/get_subscription_url/?client=happ|v2`
- `GET /hwid/get_subscription_qr/?client=happ|v2`
- `POST /pay/create_invoice/platega?type=BALANCE|SUBSCRIPTION|HWID`
- `POST /pay/create_invoice/heleket?type=BALANCE|SUBSCRIPTION|HWID`
- `POST /pay/create_invoice/trial/platega`
- `POST /pay/create_invoice/trial/heleket?currency=USDT|TON`
- `GET /users/history_pay_screen?type=replenishment|payments`
- `GET /users/upgrade_plan_price/`
- `POST /pay/create_invoice/upgrade/platega`
- `POST /pay/create_invoice/upgrade/heleket?currency=USDT|TON`
- `POST /users/downgrade_plan/`

Webhook endpoints are server-only and are not called by the frontend.
