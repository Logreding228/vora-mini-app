const runtimeConfig = window.__VORA_CONFIG__ || {};
const apiBaseUrl = (runtimeConfig.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const telegramAuthPath = runtimeConfig.TELEGRAM_AUTH_PATH || import.meta.env.VITE_TELEGRAM_AUTH_PATH || '/auth/auth/telegram';
const tokenRefreshPath = runtimeConfig.TOKEN_REFRESH_PATH || import.meta.env.VITE_TOKEN_REFRESH_PATH || '/auth/refresh_accessToken';
let telegramInitData = runtimeConfig.TELEGRAM_INIT_DATA || import.meta.env.VITE_TELEGRAM_INIT_DATA || '';
let refreshPromise = null;
const memoryStorage = new Map();

function readStorage(key) {
  try {
    return typeof localStorage === 'undefined' ? memoryStorage.get(key) || '' : localStorage.getItem(key) || memoryStorage.get(key) || '';
  } catch {
    return memoryStorage.get(key) || '';
  }
}

function writeStorage(key, value) {
  memoryStorage.set(key, value);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
  }
}

function removeStorage(key) {
  memoryStorage.delete(key);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
  }
}

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
    writeStorage('access_token', token);
    params.delete('access_token');
    params.delete('token');
  }

  if (refreshToken) {
    writeStorage('refresh_token', refreshToken);
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
  return getTokenFromUrl() || readStorage('access_token') || runtimeConfig.ACCESS_TOKEN || import.meta.env.VITE_ACCESS_TOKEN || '';
}

export function getRefreshToken() {
  return readStorage('refresh_token') || runtimeConfig.REFRESH_TOKEN || import.meta.env.VITE_REFRESH_TOKEN || '';
}

export function saveTokenPair(payload) {
  const accessToken = payload?.token_access || payload?.access_token || payload?.access || payload?.token;
  const refreshToken = payload?.token_refresh || payload?.refresh_token || payload?.refresh;
  const isAdmin = payload?.is_admin ?? payload?.user?.is_admin;

  if (accessToken) {
    writeStorage('access_token', accessToken);
  }

  if (refreshToken) {
    writeStorage('refresh_token', refreshToken);
  }

  if (isAdmin !== undefined && isAdmin !== null) {
    writeStorage('is_admin', isAdmin ? 'true' : 'false');
  }

  return accessToken || '';
}

export function isAdminUser() {
  return readStorage('is_admin') === 'true';
}

function clearTokenPair() {
  removeStorage('access_token');
  removeStorage('refresh_token');
}

function getJwtPayload(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function isTokenExpiring(token, windowSeconds = 10) {
  const payload = getJwtPayload(token);

  if (!payload?.exp) {
    return false;
  }

  return payload.exp * 1000 <= Date.now() + windowSeconds * 1000;
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
  const contentType = response.headers.get('content-type') || '';

  if (/^image\//i.test(contentType)) {
    return URL.createObjectURL(await response.blob());
  }

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

function getErrorMessage(payload) {
  if (Array.isArray(payload?.detail)) {
    return payload.detail.map((item) => item.msg).filter(Boolean).join(', ') || 'Запрос не выполнен';
  }

  return payload?.detail || payload?.message || (typeof payload === 'string' ? payload : 'Запрос не выполнен');
}

function normalizePaymentType(type) {
  const values = {
    BALANCE: 'balance',
    SUBSCRIPTION: 'subscription',
    HWID: 'hwid',
    TRIAL: 'trial',
    PLAN_UPGRADE: 'plan_upgrade',
  };

  return values[type] || String(type || '').toLowerCase();
}

function uppercasePaymentType(type) {
  const values = {
    balance: 'BALANCE',
    subscription: 'SUBSCRIPTION',
    hwid: 'HWID',
    trial: 'TRIAL',
    plan_upgrade: 'PLAN_UPGRADE',
  };
  const normalizedType = normalizePaymentType(type);

  return values[normalizedType] || String(type || '').toUpperCase();
}

async function createTypedInvoice({ provider, type, payload }) {
  const path = `/pay/create_invoice/${provider}`;

  try {
    return await request(path, {
      method: 'POST',
      query: { type: normalizePaymentType(type) },
      body: payload,
    });
  } catch (error) {
    if (error instanceof ApiError && [400, 422, 500].includes(error.status)) {
      return request(path, {
        method: 'POST',
        query: { type: uppercasePaymentType(type) },
        body: payload,
        retry: false,
      });
    }

    throw error;
  }
}

function isTelegramAuthError(error) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403) && /hash|auth|token|signature/i.test(error.message);
}

function telegramAuthMessage() {
  return 'Не удалось подтвердить Telegram. Закройте мини-приложение и откройте его через кнопку бота заново.';
}

async function rawRequest(path, { method = 'GET', query, body, token = getAccessToken(), initData } = {}) {
  if (!apiBaseUrl) {
    throw new ApiError('Сервис временно недоступен', 0);
  }

  const headers = {};
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }

  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? isFormData ? body : JSON.stringify(body) : undefined,
  });
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError(getErrorMessage(payload), response.status, payload);
  }

  return payload;
}

async function refreshTokens() {
  const refreshToken = getRefreshToken();

  if (!apiBaseUrl || !refreshToken) {
    return '';
  }

  try {
    const payload = await rawRequest(tokenRefreshPath, {
      method: 'POST',
      token: refreshToken,
    });

    const accessToken = payload?.access_token || payload?.token_access || payload?.access || payload?.token;

    if (accessToken) {
      writeStorage('access_token', accessToken);
    }

    return accessToken || '';
  } catch {
    clearTokenPair();
    return '';
  }
}

async function runRefreshTokens() {
  if (!refreshPromise) {
    refreshPromise = refreshTokens().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function authenticateWithInitData() {
  if (!apiBaseUrl || !telegramInitData) {
    return '';
  }

  let payload;

  try {
    payload = await rawRequest(telegramAuthPath, {
      method: 'POST',
      body: { initData: telegramInitData },
      token: '',
    });
  } catch (error) {
    if (isTelegramAuthError(error)) {
      clearTokenPair();
      throw new ApiError(telegramAuthMessage(), error.status, error.payload);
    }

    throw error;
  }

  if (typeof payload === 'string') {
    writeStorage('access_token', payload);
    return payload;
  }

  return saveTokenPair(payload);
}

async function ensureAccessToken() {
  const token = getAccessToken();

  if (token && !isTokenExpiring(token)) {
    return token;
  }

  const refreshedToken = await runRefreshTokens();

  if (refreshedToken) {
    return refreshedToken;
  }

  return authenticateWithInitData();
}

async function request(path, options = {}) {
  try {
    const token = options.token === undefined ? await ensureAccessToken() : options.token;
    return await rawRequest(path, { ...options, token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.retry !== false) {
      const token = await runRefreshTokens() || await authenticateWithInitData();

      if (token) {
        return rawRequest(path, { ...options, token });
      }
    }

    throw error;
  }
}

function buildTicketForm({ subject, text, files } = {}) {
  const form = new FormData();

  if (subject) {
    form.append('subject', subject);
  }

  if (text) {
    form.append('text', text);
  }

  Array.from(files || []).forEach((file) => {
    form.append('files', file);
  });

  return form;
}

export async function authenticateTelegram(initData) {
  telegramInitData = initData || telegramInitData;

  if (!apiBaseUrl || !telegramInitData) {
    return null;
  }

  return authenticateWithInitData();
}

export const api = {
  mainScreen: () => request('/users/main_screen/'),
  referralData: () => request('/users/referral_data'),
  plan: (plan) => request('/pay/plans', { query: { plan } }),
  subscriptionUrl: (client) => request('/hwid/get_subscription_url/', { query: { client } }),
  subscriptionQr: (client) => request('/hwid/get_subscription_qr/', { query: { client } }),
  getHwid: () => request('/hwid/get_hwid/'),
  deleteDevice: (hwid) => request('/hwid/delete_devic/', { method: 'POST', query: { hwid } }),
  history: (type) => request('/users/history_pay_screen', { query: { type } }),
  validatePromo: (code, amount) => request('/pay/promo/validate', { method: 'POST', query: { code, amount } }),
  upgradePrice: () => request('/users/upgrade_plan_price/'),
  downgradePlan: () => request('/users/downgrade_plan/', { method: 'POST' }),
  tickets: () => request('/tickets'),
  adminTickets: () => request('/tickets/admin/all'),
  ticket: (id) => request(`/tickets/${id}`),
  createTicket: ({ subject, text, files }) => request('/tickets', { method: 'POST', body: buildTicketForm({ subject, text, files }) }),
  sendTicketMessage: (id, { text, files }) => request(`/tickets/${id}/messages`, {
    method: 'POST',
    body: buildTicketForm({ text, files }),
  }),
  closeTicket: (id) => request(`/tickets/${id}/close`, { method: 'POST' }),
  createInvoice: createTypedInvoice,
  createTrialInvoice: ({ provider, currency, amount }) => createTypedInvoice({
    provider,
    type: 'trial',
    payload: { plan: 'trial', amount, currency: currency || 'RUB' },
  }),
  createUpgradeInvoice: ({ provider, currency }) => request(`/pay/create_invoice/upgrade/${provider}`, {
    method: 'POST',
    query: provider === 'heleket' ? { currency } : undefined,
  }),
};
