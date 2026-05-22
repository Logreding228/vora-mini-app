const runtimeConfig = window.__VORA_CONFIG__ || {};
const apiBaseUrl = (runtimeConfig.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const telegramAuthPath = runtimeConfig.TELEGRAM_AUTH_PATH || import.meta.env.VITE_TELEGRAM_AUTH_PATH || '/auth/auth/telegram';
const tokenRefreshPath = runtimeConfig.TOKEN_REFRESH_PATH || import.meta.env.VITE_TOKEN_REFRESH_PATH || '/auth/refresh_accessToken';

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('access_token') || params.get('token');
  const refreshToken = params.get('refresh_token') || params.get('refresh');

  if (token) {
    localStorage.setItem('access_token', token);
    params.delete('access_token');
    params.delete('token');
  }

  if (refreshToken) {
    localStorage.setItem('refresh_token', refreshToken);
    params.delete('refresh_token');
    params.delete('refresh');
  }

  if (token || refreshToken) {
    const cleanSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', cleanUrl);
  }

  return token;
}

export function getAccessToken() {
  return getTokenFromUrl() || localStorage.getItem('access_token') || runtimeConfig.ACCESS_TOKEN || import.meta.env.VITE_ACCESS_TOKEN || '';
}

export function getRefreshToken() {
  return localStorage.getItem('refresh_token') || runtimeConfig.REFRESH_TOKEN || import.meta.env.VITE_REFRESH_TOKEN || '';
}

export function saveTokenPair(payload) {
  const accessToken = payload?.token_access || payload?.access_token || payload?.access || payload?.token;
  const refreshToken = payload?.token_refresh || payload?.refresh_token || payload?.refresh;

  if (accessToken) {
    localStorage.setItem('access_token', accessToken);
  }

  if (refreshToken) {
    localStorage.setItem('refresh_token', refreshToken);
  }

  return accessToken || '';
}

function buildUrl(path, query) {
  const url = new URL(`${apiBaseUrl}${path}`);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function parseResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rawRequest(path, { method = 'GET', query, body, token = getAccessToken(), initData } = {}) {
  if (!apiBaseUrl) {
    throw new ApiError('API base URL is not configured', 0);
  }

  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError(payload?.detail || payload?.message || 'API request failed', response.status, payload);
  }

  return payload;
}

async function refreshTokens() {
  const refreshToken = getRefreshToken();

  if (!apiBaseUrl || !refreshToken) {
    return '';
  }

  const payload = await rawRequest(tokenRefreshPath, {
    method: 'POST',
    token: refreshToken,
  });

  const accessToken = payload?.access_token || payload?.token_access || payload?.access || payload?.token;

  if (accessToken) {
    localStorage.setItem('access_token', accessToken);
  }

  return accessToken || '';
}

async function request(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.retry !== false) {
      const token = await refreshTokens();

      if (token) {
        return rawRequest(path, { ...options, token });
      }
    }

    throw error;
  }
}

export async function authenticateTelegram(initData) {
  const telegramInitData = initData || runtimeConfig.TELEGRAM_INIT_DATA || import.meta.env.VITE_TELEGRAM_INIT_DATA || '';

  if (!apiBaseUrl || !telegramInitData || getAccessToken()) {
    return null;
  }

  const payload = await request(telegramAuthPath, {
    method: 'POST',
    body: { initData: telegramInitData },
    token: '',
    retry: false,
  });
  const token = typeof payload === 'string' ? payload : saveTokenPair(payload);

  if (typeof token === 'string') {
    if (!localStorage.getItem('access_token')) {
      localStorage.setItem('access_token', token);
    }

    return token;
  }

  return null;
}

export const api = {
  mainScreen: () => request('/users/main_screen/'),
  subscriptionUrl: (client) => request('/hwid/get_subscription_url/', { query: { client } }),
  subscriptionQr: (client) => request('/hwid/get_subscription_qr/', { query: { client } }),
  getHwid: () => request('/hwid/get_hwid/'),
  deleteDevice: (hwid) => request('/hwid/delete_devic/', { method: 'POST', query: { hwid } }),
  history: (type) => request('/users/history_pay_screen', { query: { type } }),
  upgradePrice: () => request('/users/upgrade_plan_price/'),
  downgradePlan: () => request('/users/downgrade_plan/', { method: 'POST' }),
  createInvoice: ({ provider, type, payload }) => request(`/pay/create_invoice/${provider}`, {
    method: 'POST',
    query: { type },
    body: payload,
  }),
  createTrialInvoice: ({ provider, currency }) => request(`/pay/create_invoice/trial/${provider}`, {
    method: 'POST',
    query: provider === 'heleket' ? { currency } : undefined,
  }),
  createUpgradeInvoice: ({ provider, currency }) => request(`/pay/create_invoice/upgrade/${provider}`, {
    method: 'POST',
    query: provider === 'heleket' ? { currency } : undefined,
  }),
};
