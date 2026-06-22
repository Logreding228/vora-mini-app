import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Copy,
  Download,
  Headphones,
  Home,
  Link,
  Lock,
  Menu,
  MessageCircle,
  Monitor,
  Minus,
  MoreVertical,
  Paperclip,
  Plus,
  QrCode,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { api, ApiError, authenticateTelegram, isAdminUser } from './api.js';
import { getDisplayName, initTelegramApp } from './telegram.js';
import './styles.css';

const asset = (name) => `${import.meta.env.BASE_URL}assets/${name}.png`;
const money = (value, fallback = '0') => `${Number(value ?? fallback).toLocaleString('ru-RU')} ₽`;
let trialPrice = null;
let devicePrice = 75;
let planPricingDebug = {};
let telegramVerticalSwipeLocks = 0;
const compactMoney = (value) => `${Number(value).toLocaleString('ru-RU')}₽`;
const trialPriceText = () => (trialPrice === null ? '...' : compactMoney(trialPrice));
const trialMoneyText = () => (trialPrice === null ? 'Цена загружается' : money(trialPrice));
const pluralRu = (value, one, few, many) => {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }

  return many;
};
const tariffCatalog = {
  lite: {
    name: 'Lite',
    description: 'Для привычных зарубежных сервисов',
    devices: 1,
    extraDevices: 2,
    monthPrice: 300,
    route: 'tariff-lite',
  },
  plus: {
    name: 'Plus',
    description: 'VORA Flow для привычных сервисов без лишних действий',
    devices: 3,
    extraDevices: 3,
    monthPrice: 550,
    route: 'tariff-plus',
  },
  home: {
    name: 'Home',
    description: 'Для тех, кто за границей',
    devices: 1,
    extraDevices: 2,
    monthPrice: 450,
    route: 'tariff-home',
  },
};
const periodDiscounts = {
  1: 1,
  6: 0.9,
  12: 0.85,
};
const dateRu = (value, fallback = '—') => {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
};
const formatDateTime = (value) => {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};
const valueDeepByKeys = (payload, keys, fallback = '') => {
  const queue = [payload];
  const seen = new Set();

  while (queue.length) {
    const source = queue.shift();

    if (!source || typeof source !== 'object' || seen.has(source)) {
      continue;
    }

    seen.add(source);

    for (const key of keys) {
      const value = source[key];

      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }

    Object.values(source).forEach((value) => {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    });
  }

  return fallback;
};
const numberDeepByKeys = (payload, keys, fallback) => {
  const value = valueDeepByKeys(payload, keys, fallback);
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};
const nullableNumberDeepByKeys = (payload, keys) => {
  const value = valueDeepByKeys(payload, keys, null);

  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};
const applyPlanPricing = (plan, payload) => {
  if (plan === 'trial') {
    trialPrice = nullableNumberDeepByKeys(payload, ['price', 'amount', 'total', 'month_price', 'monthly_price']);
    return;
  }

  const tariff = tariffCatalog[plan];

  if (!tariff) {
    return;
  }

  tariff.monthPrice = numberDeepByKeys(payload, ['price', 'amount', 'total', 'month_price', 'monthly_price'], tariff.monthPrice);
  tariff.devices = numberDeepByKeys(payload, ['devices', 'device_limit', 'hwid_base', 'base_devices', 'hwid_limit', 'limit'], numberDeepByKeys(payload?.hwid, ['base'], tariff.devices));
  const maxDevices = numberDeepByKeys(payload, ['max_devices', 'max_hwid', 'hwid_max'], numberDeepByKeys(payload?.hwid, ['max'], tariff.devices + tariff.extraDevices));
  tariff.extraDevices = Math.max(0, numberDeepByKeys(payload, ['extra_devices', 'additional_devices', 'max_extra_devices', 'extra_hwid'], maxDevices - tariff.devices));
  devicePrice = numberDeepByKeys(payload, ['device_price', 'extra_device_price', 'additional_device_price', 'hwid_price'], devicePrice);
};
const loadPlanPricing = async () => {
  const plans = ['trial', 'lite', 'home', 'plus'];
  const results = await Promise.allSettled(plans.map((plan) => api.plan(plan)));
  const debug = {};

  results.forEach((result, index) => {
    const plan = plans[index];

    if (result.status === 'fulfilled') {
      debug[plan] = {
        status: 'fulfilled',
        payload: result.value,
      };
      applyPlanPricing(plan, result.value);
    } else {
      debug[plan] = {
        status: 'rejected',
        error: result.reason instanceof ApiError
          ? { status: result.reason.status, message: result.reason.message, payload: result.reason.payload }
          : { message: result.reason?.message || String(result.reason) },
      };
    }
  });

  planPricingDebug = debug;
};
const extractUrl = (payload) => {
  if (typeof payload === 'string') {
    return payload.trim();
  }

  const keyedUrl = valueDeepByKeys(payload, [
    'url',
    'link',
    'deeplink',
    'deep_link',
    'deepLink',
    'app_url',
    'appUrl',
    'client_url',
    'clientUrl',
    'subscription_url',
    'subscriptionUrl',
    'connect_url',
    'connectUrl',
    'connection_url',
    'connectionUrl',
    'redirect_url',
    'redirectUrl',
    'payment_url',
    'invoice_url',
  ], '');

  if (keyedUrl) {
    return String(keyedUrl).trim();
  }

  const queue = [payload];
  const seen = new Set();

  while (queue.length) {
    const source = queue.shift();

    if (!source || typeof source !== 'object' || seen.has(source)) {
      continue;
    }

    seen.add(source);

    for (const value of Object.values(source)) {
      if (typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim())) {
        return value.trim();
      }

      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return '';
};
const extractQrImage = (payload) => {
  const raw = typeof payload === 'string' ? payload.trim() : valueDeepByKeys(payload, [
    'qr',
    'qrcode',
    'qr_code',
    'qrCode',
    'image',
    'image_base64',
    'base64',
    'data',
    'url',
    'link',
  ], '');

  if (!raw) {
    return '';
  }

  if (/^(data:image\/|blob:)/i.test(raw) || /^https?:\/\/.+\.(png|jpe?g|webp|svg)(\?|#|$)/i.test(raw)) {
    return raw;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return '';
  }

  if (/^<svg[\s>]/i.test(raw)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  }

  return `data:image/png;base64,${raw.replace(/^data:image\/\w+;base64,/, '')}`;
};
const openPaymentUrl = (url) => {
  const targetUrl = extractUrl(url);

  if (targetUrl) {
    window.location.href = targetUrl;
    return;
  }
};
const openExternalUrl = (url) => {
  const targetUrl = extractUrl(url);

  if (!targetUrl) {
    return false;
  }

  const link = document.createElement('a');
  link.href = targetUrl;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  try {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  } catch {
  }

  window.setTimeout(() => {
    try {
      window.location.assign(targetUrl);
    } catch {
      window.location.href = targetUrl;
    }
  }, 50);

  window.setTimeout(() => {
    link.remove();
  }, 250);

  return true;
};
const mapClient = (connection) => (connection === 'v2RayTun' ? 'v2ray' : 'happ');
const buildClientDeepLink = (connection, url) => {
  const targetUrl = extractUrl(url);

  if (!targetUrl) {
    return '';
  }

  if (connection === 'v2RayTun' && !/^v2raytun:\/\//i.test(targetUrl)) {
    return `v2raytun://import/${encodeURIComponent(targetUrl)}`;
  }

  return targetUrl;
};
const normalizeDeviceKind = (...values) => {
  const name = values.map((value) => String(value || '').toLowerCase()).join(' ');

  if (name.includes('android')) {
    return name.includes('tv') ? 'androidtv' : 'android';
  }

  if (name.includes('mac') || name.includes('ios') || name.includes('iphone') || name.includes('ipad') || name.includes('apple') || name.includes('tvos')) {
    return 'apple';
  }

  if (name.includes('win')) {
    return 'windows';
  }

  return 'generic';
};
const emptyMainData = {
  loaded: false,
  status: '',
  balance: '0.00',
  ref_balance: '0.00',
  expired_at: '',
  plan: '',
  screen: '',
  stage: '',
  isTrial: false,
  trialUsed: false,
  subscription_month: 1,
  hwid: {
    used: 0,
    limit: 2,
    devices: [],
  },
};

const booleanFromApi = (value) => value === true || value === 1 || String(value).toLowerCase() === 'true';
const valueOrEmpty = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
const deviceValue = (...values) => values.find((value) => {
  const text = String(value ?? '').trim();
  return text && !['string', 'unknown', 'null', 'undefined'].includes(text.toLowerCase());
}) || '';

function normalizeMainData(data = emptyMainData) {
  const hwid = data.hwid || {};
  const hwidResponse = hwid.response || {};
  const plan = String(data.plan || data.tariff || data.subscription_plan || emptyMainData.plan).toLowerCase();
  const screen = String(data.screen || emptyMainData.screen).toLowerCase();
  const stage = String(data.stage || data.stage_notification || data.subscription_stage || '').toLowerCase();
  const subscriptionKind = String(data.subscription_type || data.access_type || data.type || data.kind || '').toLowerCase();
  const trialUsed = booleanFromApi(data.trial_used ?? data.is_trial_used ?? data.trialUsed ?? data.had_trial ?? data.has_trial);
  const isTrialFlag = booleanFromApi(data.trial ?? data.is_trial ?? data.trial_active ?? data.is_trial_active);
  const isTrial = Boolean(
    isTrialFlag ||
    plan === 'trial' ||
    stage === 'trial' ||
    subscriptionKind === 'trial' ||
    (trialUsed && !['lite', 'plus', 'home'].includes(plan))
  );
  const planDeviceLimit = tariffCatalog[plan]?.devices || (plan === 'trial' ? tariffCatalog.plus.devices : emptyMainData.hwid.limit);
  const rawDevices = Array.isArray(hwid.devices) ? hwid.devices : Array.isArray(hwidResponse.devices) ? hwidResponse.devices : Array.isArray(hwid) ? hwid : [];
  const devices = rawDevices.length ? rawDevices.map((device, index) => {
    const platform = deviceValue(device.platform, device.os, device.kind, device.type);
    const osVersion = deviceValue(device.osVersion, device.os_version);
    const deviceModel = deviceValue(device.deviceModel, device.device_model, device.model);
    const kind = normalizeDeviceKind(platform, deviceModel, device.userAgent, device.user_agent, osVersion);
    const title = deviceValue(device.title, device.deviceName, device.device_name, device.name, deviceModel, platform) || 'Устройство';
    const model = [deviceModel !== title ? deviceModel : '', platform !== title ? platform : '', osVersion]
      .filter((value, itemIndex, items) => value && items.indexOf(value) === itemIndex)
      .join(' • ');

    return {
      id: device.hwid || device.id || device.uuid || device.userUuid || `device-${index}`,
      kind,
      title,
      model,
      lastSeen: device.lastSeen || device.last_seen || device.updatedAt || device.updated_at || device.onlineAt || device.online_at || device.createdAt || device.created_at || '',
    };
  }) : [];

  return {
    loaded: Boolean(data && Object.keys(data).length),
    status: String(data.status || emptyMainData.status).toLowerCase(),
    balance: data.balance ?? emptyMainData.balance,
    refBalance: data.ref_balance ?? emptyMainData.ref_balance,
    expiredAt: data.expired_at || emptyMainData.expired_at,
    plan,
    screen,
    stage,
    isTrial,
    trialUsed,
    subscriptionMonth: data.subscription_month || data.last_subscription_month || 1,
    usedDevices: Number(hwid.used ?? hwid.current ?? hwid.count ?? hwidResponse.used ?? hwidResponse.count ?? devices.length ?? 0),
    maxDevices: Number(data.device_limit ?? data.hwid_limit ?? hwid.limit ?? hwid.max ?? hwid.device_limit ?? hwidResponse.limit ?? hwidResponse.max ?? planDeviceLimit),
    devices,
  };
}

const valueByKeys = (sources, keys, fallback = '') => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    for (const key of keys) {
      const value = source[key];

      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
  }

  return fallback;
};

function normalizeReferralData(payload, mainData) {
  const stringPayload = typeof payload === 'string' ? payload.trim() : '';
  const sources = [
    payload,
    payload?.data,
    payload?.response,
    payload?.referral,
    payload?.referral_data,
    payload?.stats,
  ];
  const linkKeys = [
    'referral_link',
    'ref_link',
    'referral_url',
    'ref_url',
    'invite_link',
    'invite_url',
    'start_link',
    'telegram_link',
    'link',
    'url',
  ];
  const link = stringPayload || valueByKeys(sources, linkKeys) || valueDeepByKeys(payload, linkKeys);
  const invitedFriends = Number(valueByKeys(sources, [
    'referrals',
    'invited_friends',
    'invited_count',
    'invites_count',
    'referrals_count',
    'ref_count',
    'friends_invited',
    'first_level_count',
  ], valueDeepByKeys(payload, [
    'referrals',
    'invited_friends',
    'invited_count',
    'invites_count',
    'referrals_count',
    'ref_count',
    'friends_invited',
    'first_level_count',
  ], 0)));
  const totalFriends = Number(valueByKeys(sources, [
    'active_referrals',
    'total_friends',
    'friends_total',
    'friends_count',
    'total_referrals',
    'all_friends',
    'active_friends',
    'active_count',
  ], valueDeepByKeys(payload, [
    'active_referrals',
    'total_friends',
    'friends_total',
    'friends_count',
    'total_referrals',
    'all_friends',
    'active_friends',
    'active_count',
  ], invitedFriends)));
  const earned = Number(valueByKeys(sources, [
    'total_balance',
    'total_earned',
    'earned_total',
    'earned',
    'ref_balance',
    'referral_balance',
    'balance',
    'amount',
    'total_amount',
  ], valueDeepByKeys(payload, [
    'total_balance',
    'total_earned',
    'earned_total',
    'earned',
    'ref_balance',
    'referral_balance',
    'balance',
    'amount',
    'total_amount',
  ], mainData.refBalance || 0)));

  return {
    link: link || '',
    invitedFriends: Number.isFinite(invitedFriends) ? invitedFriends : 0,
    totalFriends: Number.isFinite(totalFriends) ? totalFriends : 0,
    earned: Number.isFinite(earned) ? earned : 0,
  };
}

function isPastDate(value) {
  if (!value) {
    return false;
  }

  const date = parseApiDate(value, true);

  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function parseApiDate(value, endOfDay = false) {
  if (!value) {
    return new Date(NaN);
  }

  if (value instanceof Date) {
    return value;
  }

  const text = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);

  return new Date(dateOnly && endOfDay ? `${text}T23:59:59` : text);
}

function getRemainingTimeParts(targetDate) {
  const targetTime = parseApiDate(targetDate, true).getTime();
  const remainingMs = Number.isFinite(targetTime) ? Math.max(0, targetTime - Date.now()) : 0;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { remainingMs, hours, minutes, seconds };
}

function useCountdown(targetDate) {
  const [time, setTime] = useState(() => getRemainingTimeParts(targetDate));

  useEffect(() => {
    const updateTime = () => setTime(getRemainingTimeParts(targetDate));

    updateTime();
    const timer = window.setInterval(updateTime, 1000);

    return () => window.clearInterval(timer);
  }, [targetDate]);

  return time;
}

function getSubscriptionState(mainData) {
  if (!mainData.loaded) {
    return { label: 'Загрузка', tone: 'purple', description: 'Загружаем данные подписки' };
  }

  if (mainData.expiredAt && isPastDate(mainData.expiredAt)) {
    return { label: 'Истекла', tone: 'purple', description: `Закончилась ${dateRu(mainData.expiredAt)}` };
  }

  if (mainData.status === 'active') {
    return { label: 'Активна', tone: 'green', description: mainData.expiredAt ? `Действует до ${dateRu(mainData.expiredAt)}` : 'Подписка активна' };
  }

  if (mainData.status === 'pending') {
    return { label: 'Ожидает оплаты', tone: 'purple', description: 'Платеж еще не подтвержден' };
  }

  if (mainData.status === 'frozen') {
    return { label: 'Заморожена', tone: 'purple', description: 'Доступ временно приостановлен' };
  }

  return { label: 'Нет подписки', tone: 'red', description: 'Оформите подписку для доступа' };
}

function hasActiveSubscription(mainData) {
  return mainData.status === 'active' && !isPastDate(mainData.expiredAt);
}

function hasActiveTrial(mainData) {
  return hasActiveSubscription(mainData) && mainData.isTrial;
}

function hasExpiredAccess(mainData) {
  return Boolean(
    mainData.trialUsed ||
    mainData.plan === 'trial' ||
    mainData.stage === 'trial' ||
    ['expired', 'ended', 'finish', 'finished'].includes(mainData.status) ||
    (mainData.expiredAt && isPastDate(mainData.expiredAt))
  );
}

function getBackendHomeScreen(mainData) {
  const screenMap = {
    first: 'trial-start',
    second: 'trial-active',
    buy: 'trial-expired',
    main: 'home-active',
  };

  return screenMap[mainData.screen] || '';
}

function getDefaultHomeScreen(mainData) {
  const backendScreen = getBackendHomeScreen(mainData);

  if (backendScreen) {
    return backendScreen;
  }

  if (hasActiveTrial(mainData)) {
    return 'trial-active';
  }

  if (hasActiveSubscription(mainData)) {
    return 'home-active';
  }

  if (mainData.loaded && hasExpiredAccess(mainData)) {
    return 'trial-expired';
  }

  return 'trial-start';
}

function getUiError(error) {
  const message = error instanceof ApiError ? error.message : error?.message || '';

  if (/hash|not authenticated|unauthorized|token|telegram/i.test(message)) {
    return 'Не удалось подтвердить Telegram. Закройте мини-приложение и откройте его через кнопку бота заново.';
  }

  if (/internal server error/i.test(message)) {
    return 'Сервер вернул внутреннюю ошибку. Попробуйте еще раз позже.';
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Не удалось связаться с сервером. Проверьте соединение и попробуйте еще раз.';
  }

  return message || 'Запрос не выполнен. Попробуйте еще раз.';
}

function getPaymentUiError(error) {
  const message = error instanceof ApiError ? error.message : error?.message || '';

  if (/internal server error|failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Платежный сервис не создал счет. Попробуйте позже или выберите другой способ оплаты.';
  }

  return getUiError(error);
}

function getTicketStatusMeta(status) {
  const normalized = String(status || 'open').toLowerCase();
  const values = {
    open: ['Открыт', 'orange'],
    answered: ['Отвечен', 'blue'],
    closed: ['Закрыт', 'gray'],
  };

  return values[normalized] || [status || 'Открыт', 'purple'];
}

function saveSelectedTicket(id, isAdmin = false) {
  try {
    sessionStorage.setItem('selected_ticket_id', id);
    sessionStorage.setItem('selected_ticket_admin', isAdmin ? '1' : '');
  } catch {
  }
}

function readSelectedTicket() {
  try {
    return {
      id: sessionStorage.getItem('selected_ticket_id') || '',
      isAdmin: sessionStorage.getItem('selected_ticket_admin') === '1',
    };
  } catch {
    return { id: '', isAdmin: false };
  }
}

function keepFocusedFieldVisible(event) {
  const element = event.currentTarget;

  window.setTimeout(() => {
    element.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, 80);
}

const screens = [
  { id: 'home-active', label: 'Главный экран', component: HomeActive },
  { id: 'home-popup', label: 'Поп-ап', component: HomePopup },
  { id: 'trial-start', label: 'Первый экран', component: TrialStart },
  { id: 'trial-active', label: 'Активный тест', component: TrialActive },
  { id: 'trial-expired', label: 'Тест истек', component: TrialExpired },
  { id: 'change-plan', label: 'Смена тарифа', component: ChangePlan },
  { id: 'balance-topup', label: 'Пополнение', component: BalanceTopup },
  { id: 'balance-history', label: 'История баланса', component: BalanceHistory },
  { id: 'referral', label: 'Реферальная', component: ReferralScreen },
  { id: 'support', label: 'Поддержка', component: SupportScreen },
  { id: 'tickets', label: 'Обращения', component: TicketsScreen },
  { id: 'ticket-create', label: 'Создать обращение', component: CreateTicket },
  { id: 'ticket-thread', label: 'Переписка', component: TicketThread },
  { id: 'tariff-lite', label: 'Тариф Lite', component: TariffLite },
  { id: 'tariff-plus', label: 'Тариф Plus', component: TariffPlus },
  { id: 'tariff-home', label: 'Тариф Home', component: TariffHome },
  { id: 'profile', label: 'Профиль', component: ProfileScreen },
  { id: 'security', label: 'Безопасность', component: SecurityScreen },
];
const screenIds = new Set(screens.map((item) => item.id));

function getScreenFromHash() {
  const hash = window.location.hash.slice(1);

  if (hash === 'referral-info') {
    return 'referral';
  }

  if (screenIds.has(hash)) {
    return hash;
  }

  return hash ? 'trial-start' : 'home-active';
}

function hasExplicitScreenHash() {
  return screenIds.has(window.location.hash.slice(1));
}

function App() {
  const [activeScreen, setActiveScreen] = useState(getScreenFromHash);
  const [screenHistory, setScreenHistory] = useState([]);
  const [telegramUser, setTelegramUser] = useState(null);
  const [mainData, setMainData] = useState(() => normalizeMainData(emptyMainData));
  const [isAdmin, setIsAdmin] = useState(false);
  const [apiNotice, setApiNotice] = useState('');
  const [isInitialDataReady, setInitialDataReady] = useState(false);
  const [, setPricingVersion] = useState(0);
  const activeScreenRef = useRef(activeScreen);
  const screen = useMemo(() => screens.find((item) => item.id === activeScreen) || screens[0], [activeScreen]);
  const Screen = screen.component;

  useEffect(() => {
    activeScreenRef.current = activeScreen;
  }, [activeScreen]);

  useEffect(() => {
    const syncScreen = () => {
      setActiveScreen(getScreenFromHash());
    };

    window.addEventListener('hashchange', syncScreen);
    return () => window.removeEventListener('hashchange', syncScreen);
  }, []);

  useEffect(() => {
    const telegram = initTelegramApp();
    let isMounted = true;
    let didAuthenticate = false;
    let refreshTimer = 0;
    let refreshInProgress = false;
    setTelegramUser(telegram.user);

    const syncScreenWithData = (normalizedData, force = false) => {
      const currentScreen = activeScreenRef.current;
      const canSyncCurrentScreen = ['trial-start', 'trial-active', 'trial-expired', 'home-active'].includes(currentScreen);

      if (!force && !canSyncCurrentScreen && hasExplicitScreenHash()) {
        return;
      }

      const nextScreen = getDefaultHomeScreen(normalizedData);

      if (nextScreen !== currentScreen) {
        setActiveScreen(nextScreen);
        window.history.replaceState(null, '', `#${nextScreen}`);
      }
    };

    const loadData = async ({ forceScreenSync = false, silent = false } = {}) => {
      if (refreshInProgress) {
        return;
      }

      refreshInProgress = true;

      try {
        if (!didAuthenticate) {
          await authenticateTelegram(telegram.initData);
          setIsAdmin(isAdminUser());
          await loadPlanPricing();
          setPricingVersion((version) => version + 1);
          didAuthenticate = true;
        }

        const data = await api.mainScreen();
        const normalizedData = normalizeMainData(data);

        if (!isMounted) {
          return;
        }

        setMainData(normalizedData);
        syncScreenWithData(normalizedData, forceScreenSync || !hasExplicitScreenHash());
        setApiNotice('');
        setInitialDataReady(true);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (!silent) {
          setApiNotice(getUiError(error));
        }

        if (!hasExplicitScreenHash() && !silent) {
          setActiveScreen('trial-start');
          window.history.replaceState(null, '', '#trial-start');
        }

        if (!silent) {
          setInitialDataReady(true);
        }
      } finally {
        refreshInProgress = false;
      }
    };

    const refreshVisibleData = () => {
      if (document.visibilityState !== 'hidden') {
        loadData({ silent: true });
      }
    };
    const listenTelegramEvent = (eventName) => {
      try {
        window.Telegram?.WebApp?.onEvent?.(eventName, refreshVisibleData);
        return () => window.Telegram?.WebApp?.offEvent?.(eventName, refreshVisibleData);
      } catch {
        return () => {};
      }
    };
    const removeViewportListener = listenTelegramEvent('viewportChanged');
    const removeActivatedListener = listenTelegramEvent('activated');

    loadData();
    refreshTimer = window.setInterval(refreshVisibleData, 15000);
    window.addEventListener('focus', refreshVisibleData);
    window.addEventListener('pageshow', refreshVisibleData);
    document.addEventListener('visibilitychange', refreshVisibleData);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshVisibleData);
      window.removeEventListener('pageshow', refreshVisibleData);
      document.removeEventListener('visibilitychange', refreshVisibleData);
      removeViewportListener();
      removeActivatedListener();
    };
  }, []);

  const navigate = (id, options = {}) => {
    const keepsTariffContext = activeScreen.startsWith('tariff-') && id.startsWith('tariff-');

    if (id !== activeScreen && !options.replace) {
      setScreenHistory((items) => [...items.slice(-12), activeScreen]);
    }

    setActiveScreen(id);
    window.history.replaceState(null, '', `#${id}`);
    if (!keepsTariffContext) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goBack = () => {
    setScreenHistory((items) => {
      const previous = items[items.length - 1] || 'home-active';
      setActiveScreen(previous);
      window.history.replaceState(null, '', `#${previous}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return items.slice(0, -1);
    });
  };

  window.__voraGoBack = goBack;
  window.__voraCanGoBack = screenHistory.length > 0;

  return (
    <div className="workspace">
      <main className="phone">
        {isInitialDataReady ? (
          <>
            <div className={activeScreen.startsWith('tariff-') ? 'page-transition no-page-animation' : 'page-transition'} key={activeScreen}>
              <Screen navigate={navigate} activeScreen={activeScreen} mainData={mainData} telegramUser={telegramUser} isAdmin={isAdmin} apiNotice={apiNotice} />
            </div>
            <BottomNav navigate={navigate} activeScreen={activeScreen} mainData={mainData} />
          </>
        ) : (
          <div className="initial-loader">
            <img src={asset('logo')} alt="VORA" />
          </div>
        )}
      </main>
    </div>
  );
}

function AppFrame({ children, className = '', navigate, activeScreen }) {
  return (
    <div className={`screen ${className}`}>
      <AppHeader navigate={navigate} activeScreen={activeScreen} goBack={window.__voraGoBack || null} />
      <div className="content">{children}</div>
    </div>
  );
}

function AppHeader({ navigate, activeScreen }) {
  // Скрываем стрелку на главной, всех экранах триала и всех экранах подписки
  const isSubscriptionScreen = activeScreen?.startsWith('trial-') || activeScreen?.startsWith('tariff-');
  const canClose = activeScreen && !['home-active'].includes(activeScreen) && !isSubscriptionScreen;
  const canGoBack = canClose;

  return (
    <header className="app-header">
      {canGoBack && (
        <button className="back-screen" onClick={() => window.__voraGoBack?.()} aria-label="Назад">
          <ArrowLeft size={22} />
        </button>
      )}
      <Logo />
    </header>
  );
}

function Logo() {
  return (
    <div className="brand">
      <img className="brand-logo" src={`${asset('logo')}?v=3`} alt="VORA" />
    </div>
  );
}

function BottomNav({ navigate, activeScreen, mainData }) {
  const navRef = useRef(null);
  const itemRefs = useRef([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, transform: 'translate3d(0, 0, 0)' });
  const [isKeyboardActive, setIsKeyboardActive] = useState(false);

  const activeSectionByScreen = {
    'home-active': 'home',
    'home-popup': 'home',
    'trial-start': 'home',
    'trial-active': 'home',
    'trial-expired': 'home',
    'change-plan': 'subscription',
    'tariff-lite': 'subscription',
    'tariff-plus': 'subscription',
    'tariff-home': 'subscription',
    'balance-topup': 'bonus',
    'balance-history': 'bonus',
    referral: 'bonus',
    support: 'support',
    tickets: 'support',
    'ticket-create': 'support',
    'ticket-thread': 'support',
    profile: 'profile',
    security: 'profile',
  };

  const nav = [
    { icon: Users, label: 'Бонусы', route: 'referral', section: 'bonus' },
    { icon: BookOpen, label: 'Подписка', route: 'tariff-plus', section: 'subscription' },
    { icon: Home, label: 'Главная', route: getDefaultHomeScreen(mainData), section: 'home' },
    { icon: Headphones, label: 'Поддержка', route: 'support', section: 'support' },
    { icon: UserGlyph, label: 'Профиль', route: 'profile', section: 'profile' },
  ];
  const activeSection = activeSectionByScreen[activeScreen] || 'home';
  const activeIndex = Math.max(0, nav.findIndex((item) => item.section === activeSection));

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const activeItem = itemRefs.current[activeIndex];

      if (!activeItem) {
        return;
      }

      setIndicatorStyle({
        width: activeItem.offsetWidth,
        transform: `translate3d(${activeItem.offsetLeft}px, 0, 0)`,
      });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeIndex]);

  useEffect(() => {
    const isTextField = (element) => {
      if (!element) {
        return false;
      }

      const tagName = element.tagName?.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || element.isContentEditable;
    };
    const canOpenMobileKeyboard = () => {
      const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
      const isSmallViewport = window.matchMedia?.('(max-width: 720px)').matches;
      const webAppPlatform = window.Telegram?.WebApp?.platform || '';
      const isTelegramMobile = /ios|android|iphone|ipad/i.test(webAppPlatform);

      return Boolean((hasCoarsePointer && isSmallViewport) || isTelegramMobile);
    };
    let blurTimer = 0;

    const handleFocusIn = (event) => {
      window.clearTimeout(blurTimer);
      setIsKeyboardActive(canOpenMobileKeyboard() && isTextField(event.target));
    };

    const handleFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        setIsKeyboardActive(canOpenMobileKeyboard() && isTextField(document.activeElement));
      }, 80);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return (
    <nav className={isKeyboardActive ? 'bottom-nav keyboard-open' : 'bottom-nav'} ref={navRef}>
      <span className="nav-indicator" style={indicatorStyle} />
      {nav.map(({ icon: Icon, label, route, section }, index) => (
        <button
          className={section === activeSection ? 'nav-item active' : 'nav-item'}
          key={label}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          onClick={() => navigate(route)}
        >
          <Icon size={26} strokeWidth={2.4} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function UserGlyph({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="currentColor" aria-hidden="true">
      <path d="M13 13.2c3.2 0 5.8-2.6 5.8-5.8S16.2 1.6 13 1.6 7.2 4.2 7.2 7.4s2.6 5.8 5.8 5.8Zm0 2.4c-5.2 0-9.4 3-9.4 6.7 0 1 .8 1.8 1.8 1.8h15.2c1 0 1.8-.8 1.8-1.8 0-3.7-4.2-6.7-9.4-6.7Z" />
    </svg>
  );
}

function Card({ children, className = '' }) {
  return <section className={`card ${className}`}>{children}</section>;
}

function PrimaryButton({ children, className = '', onClick }) {
  return <button className={`primary-button ${className}`} onClick={onClick}>{children}</button>;
}

function PageTitle({ title, subtitle, action }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function IconTile({ children, tone = 'orange', className = '', style }) {
  return <span className={`icon-tile ${tone} ${className}`} style={style}>{children}</span>;
}

function AssetIcon({ name, className = '' }) {
  return <img className={`asset-icon ${className}`} src={asset(name)} alt="" />;
}

function SectionDivider({ children }) {
  return (
    <div className="section-divider">
      <span />
      <p>{children}</p>
      <span />
    </div>
  );
}

function PlanCard({ name, description, devices, extra, price, selected, popular, current, iconName, onClick }) {
  return (
    <button className={`plan-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="plan-heading">
        {iconName && <IconTile tone={`tariff-image ${name.toLowerCase()}`}><AssetIcon name={iconName} /></IconTile>}
        <h3>{name}</h3>
        {popular && <span className="popular"><Sparkles size={12} />Популярный</span>}
        {current && <span className="current-pill">Текущий</span>}
      </div>
      <p className="plan-description">{description}</p>
      {price && (
        <div className="plan-price compact-price">
          <strong>{price} ₽</strong>
          <span>/мес</span>
        </div>
      )}
      <div className="plan-devices">
        <Monitor size={28} />
        <div>
          <strong>{devices}</strong>
          <span>{extra}</span>
        </div>
      </div>
    </button>
  );
}

function HomePlanCard({ selected, onClick, onInfo }) {
  const plan = tariffCatalog.home;

  return (
    <button className={selected ? 'home-plan-card selected' : 'home-plan-card'} onClick={onClick}>
      <img src={asset('home-city')} alt="" />
      <div>
        <h3><span>VORA</span> <span className="home-info-link" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onInfo?.(); }} onKeyDown={(event) => { if (event.key === 'Enter') onInfo?.(); }}>Home</span></h3>
        <p>{plan.description}</p>
      </div>
      <div className="home-plan-bottom">
        <div className="plan-devices">
          <Monitor size={27} />
          <div>
            <strong>{plan.devices} устройство</strong>
            <span>+ еще {plan.extraDevices}</span>
          </div>
        </div>
        <div className="plan-price compact-price">
          <strong>{plan.monthPrice} ₽</strong>
          <span>/мес</span>
        </div>
      </div>
    </button>
  );
}

function PlansPair({ currentLite = false, selected = 'plus', onSelect, includeHome = false, hideIcons = false, onHomeInfo, onFlowInfo }) {
  return (
    <>
      <div className="plans-pair">
        <PlanCard
          name="Lite"
          description="Для привычных зарубежных сервисов"
          devices="1 устройство"
          extra="+ еще 2"
          price={tariffCatalog.lite.monthPrice}
          selected={selected === 'lite'}
          current={currentLite}
          iconName={hideIcons ? '' : 'plan-lite'}
          onClick={() => onSelect?.('lite')}
        />
        <PlanCard
          name="Plus"
          description={<><span className={onFlowInfo ? 'link-text clickable' : 'link-text'} role={onFlowInfo ? 'button' : undefined} tabIndex={onFlowInfo ? 0 : undefined} onClick={(event) => { event.stopPropagation(); onFlowInfo?.(); }} onKeyDown={(event) => { if (event.key === 'Enter') onFlowInfo?.(); }}>VORA Flow</span> — для привычных сервисов без лишних действий</>}
          devices="3 устройства"
          extra="+ еще 3"
          price={tariffCatalog.plus.monthPrice}
          selected={selected === 'plus'}
          popular
          iconName={hideIcons ? '' : 'plan-plus'}
          onClick={() => onSelect?.('plus')}
        />
      </div>
      {includeHome && <HomePlanCard selected={selected === 'home'} onClick={() => onSelect?.('home')} onInfo={onHomeInfo} />}
    </>
  );
}

function FlowSparkleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path
        d="M14 2.5l1.7 5.1 5.1 1.8-5.1 1.8-1.7 5.1-1.8-5.1-5.1-1.8 5.1-1.8L14 2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M5.3 12.8l.8 2.1 2 .8-2 .8-.8 2.1-.8-2.1-2-.8 2-.8.8-2.1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeaturePhoneIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="7" y="2.5" width="8" height="17" rx="1.9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M11 16.4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function FeatureUsersIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M8.8 10.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 18.2v-1.3c0-2.6 2.2-4.7 5.3-4.7s5.3 2.1 5.3 4.7v1.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14.2 4.6a2.8 2.8 0 0 1 0 5.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.1 12.6c1.8.7 2.9 2.2 2.9 4.1v1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function FeatureDevicesIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M3 4.8c0-.9.7-1.6 1.6-1.6h10.8c.9 0 1.6.7 1.6 1.6v7.4c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6V4.8Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.2 17.4h4.9M10.6 13.8v3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="15.4" y="10.3" width="4.1" height="8.3" rx="1.2" fill="#ffffff" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function TariffFeatherIcon({ variant = 'lite', size = 30 }) {
  const isPlus = variant === 'plus';

  return (
    <svg className={`tariff-feather-icon ${variant}`} width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <path
        d={isPlus ? 'M21.8 2.8C12.2 5.5 6.4 12.1 4.8 25.4C11.9 21.3 18.4 15.1 24.2 5.2C24.9 4 23.3 2.4 21.8 2.8Z' : 'M22.1 3.1C12.8 6.7 7.1 13.4 4.8 25.2C11.7 20.6 18.4 13.7 24.1 5.6C25 4.3 23.8 2.4 22.1 3.1Z'}
        fill="#ffffff"
        stroke="#ff7a31"
        strokeWidth="1.2"
      />
      <path d="M5 25.2C10.8 18.9 16.5 12.7 23.4 4.5" stroke="#ff7a31" strokeWidth="1.6" strokeLinecap="round" />
      {isPlus ? (
        <>
          <path d="M13.8 12.4l8.4-1.2M11.5 15.7l6.6-.8M9.2 19l4.8-.7" stroke="#ff7a31" strokeWidth="1.15" strokeLinecap="round" />
          <path d="M13.4 12.8l-1.3-4.5M11.1 16.1l-1.5-4.2M8.9 19.4l-1.5-3.3" stroke="#ff7a31" strokeWidth="1.15" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M13.6 13.2l6.4-.8M10.8 17.1l4.2-.5" stroke="#ff7a31" strokeWidth="1.15" strokeLinecap="round" />
          <path d="M13.2 13.6l-1.1-3.5M10.5 17.5l-1.1-2.7" stroke="#ff7a31" strokeWidth="1.15" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function FeatureList() {
  const items = [
    [FlowSparkleIcon, 'VORA Flow для привычных сервисов', 'feature-orange'],
    [FeaturePhoneIcon, '3 устройства одновременно', 'feature-blue'],
    [FeatureUsersIcon, 'Работает без лишних действий', 'feature-gray'],
    [FeatureDevicesIcon, 'Поддержка всех устройств', 'feature-green'],
  ];

  return (
    <Card className="features-card">
      <h2>Возможности тарифа Plus</h2>
      <p>Одно подключение — для всех привычных сервисов</p>
      {items.map(([Icon, text, tone]) => (
        <div className="feature-row" key={text}>
          <IconTile tone={tone}><Icon size={22} /></IconTile>
          <span>{text}</span>
        </div>
      ))}
    </Card>
  );
}

function TrialStart({ navigate, activeScreen }) {
  const [selectedMethod, setSelectedMethod] = useState('card');
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const provider = selectedMethod === 'crypto' ? 'heleket' : 'platega';

  const applyPromo = () => {
    if (promoApplied) {
      setPromoCode('');
      setPromoApplied(false);
      return;
    }

    setPromoApplied(Boolean(promoCode.trim()));
  };

  const submitPromoWithEnter = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPromo();
      event.currentTarget.blur();
    }
  };

  const startTrial = async () => {
    try {
      setPaymentError('');

      if (trialPrice === null) {
        setPaymentError('Цена пробного периода еще не пришла от сервера');
        return;
      }

      const url = await api.createTrialInvoice({
        provider,
        currency: selectedMethod === 'crypto' ? 'USDT' : undefined,
        amount: trialPrice,
      });
      openPaymentUrl(url);
    } catch (error) {
      setPaymentError(getPaymentUiError(error));
    }
  };

  return (
    <AppFrame className="trial-screen" navigate={navigate} activeScreen={activeScreen}>
      <HeroOffer
        title="Попробуйте VORA"
        accent={`24 часа за ${trialPriceText()}`}
        subtitle="Полный доступ ко всем возможностям тарифа"
        image="trial-check"
      />
      <FeatureList />
      <Card className="renew-card">
        <Lock size={34} />
        <div>
          <h3>Автопродление отключено</h3>
          <p>После окончания доступа списаний не будет</p>
        </div>
      </Card>
      <div className="payment-methods trial-methods">
        <MethodCard title="Банковская карта" subtitle="Visa, Mastercard, Мир" checked={selectedMethod === 'card'} onClick={() => setSelectedMethod('card')} />
        <MethodCard title="Криптовалюта" subtitle="USDT, BTC, ETH и др." checked={selectedMethod === 'crypto'} onClick={() => setSelectedMethod('crypto')} />
      </div>
      <div className="promo trial-promo">
        <p>{promoApplied ? 'Промокод применен' : 'Есть промокод?'}</p>
        <div>
          <input value={promoCode} onFocus={keepFocusedFieldVisible} onKeyDown={submitPromoWithEnter} onChange={(event) => { setPromoCode(event.target.value); setPromoApplied(false); }} placeholder="Введите промокод" enterKeyHint="done" />
          <button onClick={applyPromo} disabled={!promoApplied && !promoCode.trim()}>{promoApplied ? 'Убрать' : 'Применить'}</button>
        </div>
      </div>
      {paymentError && <p className="inline-error">{paymentError}</p>}
      <PrimaryButton onClick={startTrial}>Начать за <span>{trialMoneyText()}</span></PrimaryButton>
      <SectionDivider>или оформите подписку сразу</SectionDivider>
      <TrialPlanList navigate={navigate} />
    </AppFrame>
  );
}

function TrialPlanList({ navigate }) {
  return (
    <Card className="trial-plan-list">
      <button onClick={() => navigate('tariff-lite')}>
        <IconTile tone="tariff-image lite"><AssetIcon name="plan-lite" /></IconTile>
        <div>
          <strong>Lite</strong>
          <p>от {money(tariffCatalog.lite.monthPrice)}</p>
        </div>
      </button>
      <button onClick={() => navigate('tariff-plus')}>
        <IconTile tone="tariff-image plus"><AssetIcon name="plan-plus" /></IconTile>
        <div>
          <strong>Plus</strong>
          <p>от {money(tariffCatalog.plus.monthPrice)}</p>
        </div>
        <span className="popular"><Sparkles size={12} />Популярный</span>
      </button>
      <button className="choose-plan-row" onClick={() => navigate('tariff-plus')}>
        <strong>Выбрать подписку</strong>
        <ChevronRight size={24} />
      </button>
    </Card>
  );
}

function TrialActive({ navigate, activeScreen, mainData }) {
  const countdown = useCountdown(mainData.expiredAt);
  const timerProgress = Math.max(0, Math.min(100, (countdown.remainingMs / 86400000) * 100));
  const padTime = (value) => String(value).padStart(2, '0');

  return (
    <AppFrame className="trial-screen compact trial-active-screen" navigate={navigate} activeScreen={activeScreen}>
      <HeroOffer
        title="Доступ активен"
        accent={`24 часа за ${trialPriceText()}`}
        subtitle="Полный доступ ко всем возможностям тарифа"
        image="trial-clock"
      />
      <Card className="timer-card">
        <p>Осталось времени</p>
        <strong className="timer-value" aria-label={`${padTime(countdown.hours)} часов ${padTime(countdown.minutes)} минут ${padTime(countdown.seconds)} секунд`}>
          <span className="timer-unit">{padTime(countdown.hours)}</span>
          <span className="timer-separator">:</span>
          <span className="timer-unit">{padTime(countdown.minutes)}</span>
          <span className="timer-separator">:</span>
          <span className="timer-unit timer-seconds">{padTime(countdown.seconds)}</span>
        </strong>
        <div className="timer-labels">
          <span>Часов</span>
          <span>Минут</span>
          <span>Секунд</span>
        </div>
        <div className="progress"><i style={{ width: `${timerProgress}%` }} /></div>
      </Card>
      <PrimaryButton onClick={() => navigate('home-popup')}>Подключить устройство</PrimaryButton>
      <SectionDivider>доступные тарифы</SectionDivider>
      <TrialPlanList navigate={navigate} />
    </AppFrame>
  );
}

function TrialExpired({ navigate, activeScreen }) {
  return (
    <AppFrame className="trial-screen compact" navigate={navigate} activeScreen={activeScreen}>
      <HeroOffer
        title="Подписка"
        accent="Закончилась"
        subtitle="Выберите комфортный для вас тариф"
        image="trial-expired"
      />
      <SectionDivider>выберите тариф для продолжения</SectionDivider>
      <TrialPlanList navigate={navigate} />
    </AppFrame>
  );
}

function HeroOffer({ title, accent, subtitle, image }) {
  return (
    <section className="hero-offer">
      <h1>{title}</h1>
      <strong>{accent}</strong>
      <p>{subtitle}</p>
      <img src={asset(image)} alt="" />
    </section>
  );
}

function HomeActive({ navigate, activeScreen, mainData, telegramUser, apiNotice }) {
  const displayName = getDisplayName(telegramUser);
  const [infoSheet, setInfoSheet] = useState('');

  return (
    <AppFrame className="home-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title={`Привет, ${displayName}!`} subtitle={apiNotice} action={<button className="square-action" onClick={() => navigate('balance-history')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <SubscriptionSummary navigate={navigate} mainData={mainData} />
      <Card className="link-list">
        <ActionRow icon={SlidersHorizontal} title="Управление тарифом" subtitle="Сменить тариф или период" onClick={() => navigate('change-plan')} />
        <ActionRow icon={CircleHelp} title="Вопросы и ответы" subtitle="Инструкции и частые вопросы" onClick={() => navigate('support')} />
        <ActionRow
          icon={Sparkles}
          title="Не работает нужный сервис?"
          subtitle={<><span>Добавьте его в </span><span className="link-text clickable" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); setInfoSheet('flow'); }} onKeyDown={(event) => { if (event.key === 'Enter') setInfoSheet('flow'); }}>VORA Flow</span></>}
          onClick={() => navigate('ticket-create')}
        />
      </Card>
      <DevicesCard mainData={mainData} />
      {infoSheet === 'flow' && <ImageInfoSheet src={asset('vora-flow-popup')} alt="Что такое VORA Flow" onClose={() => setInfoSheet('')} />}
    </AppFrame>
  );
}

function HomePopup({ navigate, activeScreen, mainData, telegramUser }) {
  const displayName = getDisplayName(telegramUser);
  const isDeviceLimitReached = mainData.maxDevices > 0 && mainData.usedDevices >= mainData.maxDevices;

  return (
    <AppFrame className="home-screen has-sheet" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title={`Привет, ${displayName}!`} action={<button className="square-action" onClick={() => navigate('balance-history')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <SubscriptionSummary muted navigate={navigate} mainData={mainData} />
      <DeviceSheet navigate={navigate} limitReached={isDeviceLimitReached} mainData={mainData} closeRoute={getDefaultHomeScreen(mainData)} />
    </AppFrame>
  );
}

function SubscriptionSummary({ muted: sheetMuted = false, navigate, mainData }) {
  const planName = mainData.plan ? (mainData.plan === 'plus' ? 'Plus' : mainData.plan === 'lite' ? 'Lite' : mainData.plan) : 'Подписка';
  const progress = Math.min(100, Math.max(0, (mainData.usedDevices / mainData.maxDevices) * 100));
  const subscriptionState = getSubscriptionState(mainData);
  const isDeviceLimitReached = mainData.maxDevices > 0 && mainData.usedDevices >= mainData.maxDevices;

  return (
    <Card className={`subscription-card subscription-${subscriptionState.tone} ${sheetMuted ? 'under-sheet' : ''}`}>
      <div>
        <span className={`status-pill ${subscriptionState.tone}`}><i />{subscriptionState.label}</span>
        <h2>{planName}</h2>
        <p>{subscriptionState.description}</p>
      </div>
      <img src={asset('shield-card')} alt="" />
      <div className="metrics">
        <div className="metric-card device-metric">
          <IconTile tone="plain"><Monitor size={22} /></IconTile>
          <div className="metric-content">
            <span>Устройства</span>
            <strong>{mainData.usedDevices} из {mainData.maxDevices}</strong>
            <div className="mini-progress"><i style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
        <div className="metric-card date-metric">
          <span>Следующее списание</span>
          <strong>{dateRu(mainData.expiredAt)}</strong>
        </div>
      </div>
      <PrimaryButton onClick={() => navigate(isDeviceLimitReached ? 'balance-topup' : 'home-popup')}>
        {isDeviceLimitReached ? 'Докупить устройство' : 'Добавить устройство'}
      </PrimaryButton>
      <div className="balance-strip">
        <BalanceMini title="Основной баланс" value={money(mainData.balance)} tone="green" onClick={() => navigate('balance-topup')} />
        <BalanceMini title="Реферальный баланс" value={money(mainData.refBalance)} tone="orange" onClick={() => navigate('referral')} />
      </div>
    </Card>
  );
}

function BalanceMini({ title, value, tone, onClick }) {
  return (
    <button className="balance-mini" onClick={onClick}>
      <p><i className={tone} />{title}</p>
      <strong>{value}</strong>
      <ChevronRight size={22} />
    </button>
  );
}

function ActionRow({ icon: Icon, title, subtitle, onClick }) {
  return (
    <button className="action-row" onClick={onClick}>
      <IconTile tone="transparent"><Icon size={22} /></IconTile>
      <div>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>
      <ChevronRight size={24} />
    </button>
  );
}

function DevicesCard({ mainData }) {
  const [expanded, setExpanded] = useState(true);
  const [devices, setDevices] = useState(mainData.devices);
  const [deviceError, setDeviceError] = useState('');
  const [deviceDebug, setDeviceDebug] = useState({
    request: { method: 'GET', endpoint: '/hwid/get_hwid/' },
    status: 'loading',
    response: null,
    error: null,
  });

  useEffect(() => {
    setDevices(mainData.devices);
  }, [mainData.devices]);

  useEffect(() => {
    let isMounted = true;

    const loadDeviceDebug = async () => {
      try {
        const response = await api.getHwid();

        if (isMounted) {
          setDeviceDebug({
            request: { method: 'GET', endpoint: '/hwid/get_hwid/' },
            status: 'success',
            response,
            error: null,
          });
        }
      } catch (error) {
        if (isMounted) {
          setDeviceDebug({
            request: { method: 'GET', endpoint: '/hwid/get_hwid/' },
            status: 'error',
            response: null,
            error: {
              message: getUiError(error),
              status: error instanceof ApiError ? error.status : null,
              payload: error instanceof ApiError ? error.payload : null,
            },
          });
        }
      }
    };

    loadDeviceDebug();
    return () => {
      isMounted = false;
    };
  }, []);

  const deleteDevice = async (id) => {
    try {
      setDeviceError('');
      await api.deleteDevice(id);
      setDevices((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      setDeviceError(getUiError(error));
    }
  };

  return (
    <Card className="devices-card">
      <div className="card-title-row">
        <h2>Устройства</h2>
        <button onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Свернуть устройства' : 'Развернуть устройства'}>
          {expanded ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
        </button>
      </div>
      <div className={expanded ? 'collapsible-list expanded' : 'collapsible-list'}>
        <div className="device-list">
          {deviceError && <p className="inline-error">{deviceError}</p>}
          {devices.map(({ id, kind, title, model, lastSeen }) => (
            <div className="device-row" key={id}>
              <span className={`platform ${kind}`}><PlatformIcon type={kind} /></span>
              <div>
                <strong>{title}</strong>
                {model && <span>•</span>}
                {model && <p>{model}</p>}
                <small>Онлайн • {formatDateTime(lastSeen)}</small>
              </div>
              <button className="delete-device" onClick={() => deleteDevice(id)} aria-label={`Удалить ${title}`}>
                <Trash2 size={24} />
              </button>
            </div>
          ))}
          {devices.length === 0 && <p className="empty-state">Устройства не подключены</p>}
        </div>
      </div>
      {expanded && (
        <div className="device-debug">
          <strong>Debug: устройства API</strong>
          <pre>{JSON.stringify(deviceDebug, null, 2)}</pre>
        </div>
      )}
    </Card>
  );
}

function DeviceSheet({ navigate, limitReached = false, mainData, closeRoute = 'home-active' }) {
  useBodyScrollLock(true);

  const closeSheet = () => navigate(closeRoute);
  const swipeDismiss = useSwipeDismiss(closeSheet);
  const [selectedConnection, setSelectedConnection] = useState('Happ');
  const [connectError, setConnectError] = useState('');
  const [connectUrl, setConnectUrl] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [qrImage, setQrImage] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [isQrOpen, setQrOpen] = useState(false);
  const client = mapClient(selectedConnection);

  useEffect(() => {
    if (limitReached) {
      return undefined;
    }

    let isMounted = true;

    const loadConnectUrl = async () => {
      try {
        setConnectError('');
        setConnectUrl('');
        setConnectLoading(true);
        const payload = await api.subscriptionUrl(client);
        const url = buildClientDeepLink(selectedConnection, payload);

        if (isMounted) {
          setConnectUrl(url);
          if (!url) {
            setConnectError('Ссылка для подключения не пришла от сервера');
          }
        }
      } catch (error) {
        if (isMounted) {
          setConnectUrl('');
          setConnectError(getUiError(error));
        }
      } finally {
        if (isMounted) {
          setConnectLoading(false);
        }
      }
    };

    loadConnectUrl();

    return () => {
      isMounted = false;
    };
  }, [client, limitReached, selectedConnection]);

  if (limitReached) {
    return (
      <div className="modal-layer" onClick={closeSheet}>
        <div className="bottom-sheet" ref={swipeDismiss.sheetRef} onClick={(event) => event.stopPropagation()}>
          <div className="sheet-drag-zone" {...swipeDismiss.handleProps}>
            <span className="sheet-grip" />
          </div>
          <h2>Лимит устройств набран</h2>
          <Card className="limit-sheet-card">
            <IconTile tone="soft-orange"><Monitor size={24} /></IconTile>
            <div>
              <strong>{mainData.usedDevices} из {mainData.maxDevices} устройств</strong>
              <p>Чтобы подключить новое устройство, докупите дополнительный слот или удалите одно из текущих устройств.</p>
            </div>
          </Card>
          <PrimaryButton onClick={() => navigate('balance-topup')}>Докупить устройство</PrimaryButton>
        </div>
      </div>
    );
  }

  const connectDevice = () => {
    try {
      setConnectError('');

      if (connectLoading) {
        throw new Error('Ссылка еще загружается, нажмите еще раз через секунду');
      }

      if (!connectUrl) {
        throw new Error('Ссылка для подключения не пришла от сервера');
      }

      if (!openExternalUrl(connectUrl)) {
        throw new Error('Не удалось открыть приложение клиента');
      }
    } catch (error) {
      setConnectError(getUiError(error));
    }
  };

  const showQr = async () => {
    try {
      setConnectError('');
      setQrImage('');
      setQrOpen(true);
      setQrLoading(true);
      const qrPayload = await api.subscriptionQr(client);
      const qrSource = extractQrImage(qrPayload);

      if (qrSource && !/^data:image\/png;base64,https?:/i.test(qrSource)) {
        setQrImage(qrSource);
        return;
      }

      const url = connectUrl || buildClientDeepLink(selectedConnection, qrPayload);

      if (!url) {
        throw new Error('QR-код не пришел от сервера');
      }

      setQrImage(await QRCode.toDataURL(url, { margin: 1, width: 280 }));
    } catch (error) {
      setQrOpen(false);
      setConnectError(getUiError(error));
    } finally {
      setQrLoading(false);
    }
  };

  return (
    <div className="modal-layer" onClick={closeSheet}>
      <div className="bottom-sheet" ref={swipeDismiss.sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-drag-zone" {...swipeDismiss.handleProps}>
          <span className="sheet-grip" />
        </div>
        <h2>Подключить новое устройство</h2>
        <StepTitle number="1" title="Клиент для подключения" />
        <Card className="option-list">
          <RadioRow title="Рекомендуемый - Happ" subtitle="Простая настройка в один клик" checked={selectedConnection === 'Happ'} icon="happ" onClick={() => setSelectedConnection('Happ')} />
          <RadioRow title="v2RayTun" subtitle="Ручная настройка" checked={selectedConnection === 'v2RayTun'} icon="v2ray" onClick={() => setSelectedConnection('v2RayTun')} />
        </Card>
        {connectError && <p className="inline-error">{connectError}</p>}
        <ActionRow icon={CircleHelp} title="Нужна помощь?" subtitle="Краткая инструкция здесь" onClick={() => navigate('support')} />
        <PrimaryButton onClick={connectDevice}>{connectLoading ? 'Готовим подключение' : 'Подключить'}</PrimaryButton>
        <SectionDivider>или</SectionDivider>
        <ActionRow icon={QrCode} title="Подключить на другом устройстве" subtitle="Отсканируйте QR-код камерой устройства" onClick={showQr} />
      </div>
      {isQrOpen && (
        <div className="qr-modal-overlay" onClick={(event) => { event.stopPropagation(); setQrOpen(false); }}>
          <div className="qr-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setQrOpen(false)} aria-label="Закрыть QR-код"><ArrowLeft size={20} /></button>
            <h3>QR-код подключения</h3>
            <p>Откройте камеру на другом устройстве и отсканируйте код</p>
            <div className="qr-modal-box">
              {qrLoading ? <span>Готовим QR-код</span> : <img src={qrImage} alt="QR-код подключения" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepTitle({ number, title }) {
  return (
    <div className="step-title">
      <span>{number}</span>
      <strong>{title}</strong>
    </div>
  );
}

function RadioRow({ title, subtitle, checked, icon, onClick }) {
  return (
    <button className="radio-row" onClick={onClick}>
      <span className={`brand-mark ${icon}`}><PlatformIcon type={icon} /></span>
      <div>
        <strong>{title}</strong>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <span className={checked ? 'radio checked' : 'radio'} />
    </button>
  );
}

function PlatformIcon({ type }) {
  if (type === 'windows') {
    return <WindowsGlyph />;
  }

  if (type === 'windowsLegacy') {
    return (
      <svg className="os-icon windows-glyph" width="14" height="17" viewBox="0 0 14 17" fill="none" aria-hidden="true">
        <path d="M9.204 1.51464L9.924 0.215637C9.93321 0.198992 9.93905 0.180696 9.94119 0.161794C9.94333 0.142892 9.94172 0.123754 9.93646 0.105472C9.9312 0.0871909 9.9224 0.0701241 9.91054 0.0552463C9.89869 0.0403686 9.88402 0.0279713 9.86737 0.0187624C9.85073 0.00955344 9.83243 0.00371314 9.81353 0.00157497C9.79463 -0.000563206 9.77549 0.00104263 9.75721 0.00630075C9.73893 0.0115589 9.72186 0.0203663 9.70698 0.0322202C9.69211 0.0440741 9.67971 0.0587423 9.6705 0.0753874L8.943 1.38789C8.32198 1.11555 7.65123 0.974949 6.97312 0.974949C6.29501 0.974949 5.62427 1.11555 5.00325 1.38789L4.27575 0.0753874C4.25715 0.0415723 4.22588 0.0165303 4.18882 0.00577039C4.15176 -0.00498951 4.11194 -0.000585958 4.07813 0.0180123C4.04431 0.0366107 4.01927 0.0678802 4.00851 0.104942C3.99775 0.142004 4.00215 0.181822 4.02075 0.215637L4.74075 1.51464C4.0559 1.85278 3.47729 2.37282 3.06827 3.01784C2.65925 3.66286 2.43558 4.40799 2.42175 5.17164H11.5245C11.5105 4.40783 11.2866 3.6626 10.8773 3.01756C10.468 2.37253 9.88913 1.85257 9.204 1.51464ZM4.87275 3.50589C4.79751 3.50589 4.72397 3.48357 4.66142 3.44175C4.59887 3.39994 4.55013 3.3405 4.52137 3.27098C4.49262 3.20145 4.48513 3.12496 4.49986 3.05118C4.5146 2.9774 4.55089 2.90964 4.60414 2.85649C4.65739 2.80335 4.72522 2.76719 4.79903 2.7526C4.87284 2.73802 4.94932 2.74565 5.01879 2.77455C5.08825 2.80344 5.14759 2.8523 5.18928 2.91493C5.23097 2.97756 5.25315 3.05115 5.253 3.12639C5.2528 3.22711 5.21265 3.32363 5.14136 3.39478C5.07007 3.46593 4.97347 3.50589 4.87275 3.50589ZM9.07425 3.50589C8.99901 3.50589 8.92546 3.48357 8.86292 3.44175C8.80037 3.39994 8.75163 3.3405 8.72287 3.27098C8.69412 3.20145 8.68663 3.12496 8.70136 3.05118C8.71609 2.9774 8.75238 2.90964 8.80564 2.85649C8.85889 2.80335 8.92672 2.76719 9.00053 2.7526C9.07434 2.73802 9.15082 2.74565 9.22029 2.77455C9.28975 2.80344 9.34909 2.8523 9.39078 2.91493C9.43247 2.97756 9.45465 3.05115 9.4545 3.12639C9.4543 3.22711 9.41415 3.32363 9.34286 3.39478C9.27157 3.46593 9.17497 3.50589 9.07425 3.50589ZM2.42025 12.1286C2.42005 12.2734 2.44844 12.4169 2.50379 12.5507C2.55913 12.6845 2.64034 12.806 2.74277 12.9084C2.8452 13.0108 2.96682 13.0919 3.10066 13.1471C3.23451 13.2024 3.37795 13.2307 3.52275 13.2304H4.2525V15.4804C4.2525 15.751 4.36 16.0105 4.55136 16.2019C4.74272 16.3933 5.00225 16.5008 5.27287 16.5008C5.5435 16.5008 5.80303 16.3933 5.99439 16.2019C6.18575 16.0105 6.29325 15.751 6.29325 15.4804V13.2304H7.65375V15.4804C7.65375 15.7509 7.76121 16.0103 7.9525 16.2016C8.14379 16.3929 8.40323 16.5004 8.67375 16.5004C8.94427 16.5004 9.20371 16.3929 9.395 16.2016C9.58629 16.0103 9.69375 15.7509 9.69375 15.4804V13.2304H10.4242C10.5689 13.2305 10.7121 13.2021 10.8457 13.1468C10.9793 13.0915 11.1007 13.0104 11.203 12.9081C11.3053 12.8059 11.3863 12.6845 11.4416 12.5508C11.4969 12.4172 11.5253 12.274 11.5252 12.1294V5.53164H2.42025V12.1286ZM1.02 5.35614C0.885989 5.35614 0.753291 5.38254 0.62949 5.43385C0.505689 5.48516 0.393212 5.56036 0.298486 5.65515C0.20376 5.74995 0.128643 5.86248 0.0774278 5.98632C0.0262121 6.11016 -9.82621e-05 6.24288 2.75761e-07 6.37689V10.6286C2.73765e-07 10.7626 0.0263833 10.8952 0.0776431 11.019C0.128903 11.1427 0.204036 11.2552 0.298751 11.3499C0.393467 11.4446 0.505911 11.5197 0.629663 11.571C0.753415 11.6223 0.886052 11.6486 1.02 11.6486C1.15395 11.6486 1.28659 11.6223 1.41034 11.571C1.53409 11.5197 1.64653 11.4446 1.74125 11.3499C1.83597 11.2552 1.9111 11.1427 1.96236 11.019C2.01362 10.8952 2.04 10.7626 2.04 10.6286V6.37689C2.04 6.24294 2.01362 6.1103 1.96236 5.98655C1.9111 5.8628 1.83597 5.75035 1.74125 5.65564C1.64653 5.56092 1.53409 5.48579 1.41034 5.43453C1.28659 5.38327 1.15395 5.35689 1.02 5.35689M12.924 5.35689C12.79 5.35689 12.6573 5.3833 12.5335 5.4346C12.4097 5.48591 12.2972 5.56111 12.2025 5.6559C12.1078 5.7507 12.0326 5.86323 11.9814 5.98707C11.9302 6.11091 11.9039 6.24363 11.904 6.37764V10.6294C11.904 10.7633 11.9304 10.896 11.9816 11.0197C12.0329 11.1435 12.108 11.2559 12.2028 11.3506C12.2975 11.4454 12.4099 11.5205 12.5337 11.5717C12.6574 11.623 12.7901 11.6494 12.924 11.6494C13.0579 11.6494 13.1906 11.623 13.3143 11.5717C13.4381 11.5205 13.5505 11.4454 13.6453 11.3506C13.74 11.2559 13.8151 11.1435 13.8664 11.0197C13.9176 10.896 13.944 10.7633 13.944 10.6294V6.37689C13.944 6.10637 13.8365 5.84693 13.6453 5.65564C13.454 5.46435 13.1945 5.35689 12.924 5.35689Z" fill="#021227" />
      </svg>
    );
  }

  if (type === 'android' || type === 'androidtv') {
    return (
      <svg className="os-icon android-glyph" width="14" height="17" viewBox="0 0 14 17" fill="none" aria-hidden="true">
        <path d="M9.204 1.51464L9.924 0.215637C9.93321 0.198992 9.93905 0.180696 9.94119 0.161794C9.94333 0.142892 9.94172 0.123754 9.93646 0.105472C9.9312 0.0871909 9.9224 0.0701241 9.91054 0.0552463C9.89869 0.0403686 9.88402 0.0279713 9.86737 0.0187624C9.85073 0.00955344 9.83243 0.00371314 9.81353 0.00157497C9.79463 -0.000563206 9.77549 0.00104263 9.75721 0.00630075C9.73893 0.0115589 9.72186 0.0203663 9.70698 0.0322202C9.69211 0.0440741 9.67971 0.0587423 9.6705 0.0753874L8.943 1.38789C8.32198 1.11555 7.65123 0.974949 6.97312 0.974949C6.29501 0.974949 5.62427 1.11555 5.00325 1.38789L4.27575 0.0753874C4.25715 0.0415723 4.22588 0.0165303 4.18882 0.00577039C4.15176 -0.00498951 4.11194 -0.000585958 4.07813 0.0180123C4.04431 0.0366107 4.01927 0.0678802 4.00851 0.104942C3.99775 0.142004 4.00215 0.181822 4.02075 0.215637L4.74075 1.51464C4.0559 1.85278 3.47729 2.37282 3.06827 3.01784C2.65925 3.66286 2.43558 4.40799 2.42175 5.17164H11.5245C11.5105 4.40783 11.2866 3.6626 10.8773 3.01756C10.468 2.37253 9.88913 1.85257 9.204 1.51464ZM4.87275 3.50589C4.79751 3.50589 4.72397 3.48357 4.66142 3.44175C4.59887 3.39994 4.55013 3.3405 4.52137 3.27098C4.49262 3.20145 4.48513 3.12496 4.49986 3.05118C4.5146 2.9774 4.55089 2.90964 4.60414 2.85649C4.65739 2.80335 4.72522 2.76719 4.79903 2.7526C4.87284 2.73802 4.94932 2.74565 5.01879 2.77455C5.08825 2.80344 5.14759 2.8523 5.18928 2.91493C5.23097 2.97756 5.25315 3.05115 5.253 3.12639C5.2528 3.22711 5.21265 3.32363 5.14136 3.39478C5.07007 3.46593 4.97347 3.50589 4.87275 3.50589ZM9.07425 3.50589C8.99901 3.50589 8.92546 3.48357 8.86292 3.44175C8.80037 3.39994 8.75163 3.3405 8.72287 3.27098C8.69412 3.20145 8.68663 3.12496 8.70136 3.05118C8.71609 2.9774 8.75238 2.90964 8.80564 2.85649C8.85889 2.80335 8.92672 2.76719 9.00053 2.7526C9.07434 2.73802 9.15082 2.74565 9.22029 2.77455C9.28975 2.80344 9.34909 2.8523 9.39078 2.91493C9.43247 2.97756 9.45465 3.05115 9.4545 3.12639C9.4543 3.22711 9.41415 3.32363 9.34286 3.39478C9.27157 3.46593 9.17497 3.50589 9.07425 3.50589ZM2.42025 12.1286C2.42005 12.2734 2.44844 12.4169 2.50379 12.5507C2.55913 12.6845 2.64034 12.806 2.74277 12.9084C2.8452 13.0108 2.96682 13.0919 3.10066 13.1471C3.23451 13.2024 3.37795 13.2307 3.52275 13.2304H4.2525V15.4804C4.2525 15.751 4.36 16.0105 4.55136 16.2019C4.74272 16.3933 5.00225 16.5008 5.27287 16.5008C5.5435 16.5008 5.80303 16.3933 5.99439 16.2019C6.18575 16.0105 6.29325 15.751 6.29325 15.4804V13.2304H7.65375V15.4804C7.65375 15.7509 7.76121 16.0103 7.9525 16.2016C8.14379 16.3929 8.40323 16.5004 8.67375 16.5004C8.94427 16.5004 9.20371 16.3929 9.395 16.2016C9.58629 16.0103 9.69375 15.7509 9.69375 15.4804V13.2304H10.4242C10.5689 13.2305 10.7121 13.2021 10.8457 13.1468C10.9793 13.0915 11.1007 13.0104 11.203 12.9081C11.3053 12.8059 11.3863 12.6845 11.4416 12.5508C11.4969 12.4172 11.5253 12.274 11.5252 12.1294V5.53164H2.42025V12.1286ZM1.02 5.35614C0.885989 5.35614 0.753291 5.38254 0.62949 5.43385C0.505689 5.48516 0.393212 5.56036 0.298486 5.65515C0.20376 5.74995 0.128643 5.86248 0.0774278 5.98632C0.0262121 6.11016 -9.82621e-05 6.24288 2.75761e-07 6.37689V10.6286C2.73765e-07 10.7626 0.0263833 10.8952 0.0776431 11.019C0.128903 11.1427 0.204036 11.2552 0.298751 11.3499C0.393467 11.4446 0.505911 11.5197 0.629663 11.571C0.753415 11.6223 0.886052 11.6486 1.02 11.6486C1.15395 11.6486 1.28659 11.6223 1.41034 11.571C1.53409 11.5197 1.64653 11.4446 1.74125 11.3499C1.83597 11.2552 1.9111 11.1427 1.96236 11.019C2.01362 10.8952 2.04 10.7626 2.04 10.6286V6.37689C2.04 6.24294 2.01362 6.1103 1.96236 5.98655C1.9111 5.8628 1.83597 5.75035 1.74125 5.65564C1.64653 5.56092 1.53409 5.48579 1.41034 5.43453C1.28659 5.38327 1.15395 5.35689 1.02 5.35689M12.924 5.35689C12.79 5.35689 12.6573 5.3833 12.5335 5.4346C12.4097 5.48591 12.2972 5.56111 12.2025 5.6559C12.1078 5.7507 12.0326 5.86323 11.9814 5.98707C11.9302 6.11091 11.9039 6.24363 11.904 6.37764V10.6294C11.904 10.7633 11.9304 10.896 11.9816 11.0197C12.0329 11.1435 12.108 11.2559 12.2028 11.3506C12.2975 11.4454 12.4099 11.5205 12.5337 11.5717C12.6574 11.623 12.7901 11.6494 12.924 11.6494C13.0579 11.6494 13.1906 11.623 13.3143 11.5717C13.4381 11.5205 13.5505 11.4454 13.6453 11.3506C13.74 11.2559 13.8151 11.1435 13.8664 11.0197C13.9176 10.896 13.944 10.7633 13.944 10.6294V6.37689C13.944 6.10637 13.8365 5.84693 13.6453 5.65564C13.454 5.46435 13.1945 5.35689 12.924 5.35689Z" fill="#021227" />
      </svg>
    );
  }

  if (type === 'apple') {
    return (
      <svg className="os-icon apple-glyph" width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
        <path d="M9.47781 12.96C8.74281 13.6725 7.94031 13.56 7.16781 13.2225C6.35031 12.8775 5.60031 12.8625 4.73781 13.2225C3.65781 13.6875 3.08781 13.5525 2.44281 12.96C-1.21719 9.1875 -0.677191 3.4425 3.47781 3.2325C4.49031 3.285 5.19531 3.7875 5.78781 3.8325C6.67281 3.6525 7.52031 3.135 8.46531 3.2025C9.59781 3.2925 10.4528 3.7425 11.0153 4.5525C8.67531 5.955 9.23031 9.0375 11.3753 9.9C10.9478 11.025 10.3928 12.1425 9.47031 12.9675L9.47781 12.96ZM5.71281 3.1875C5.60031 1.515 6.95781 0.135 8.51781 0C8.73531 1.935 6.76281 3.375 5.71281 3.1875Z" fill="#021227" />
      </svg>
    );
  }

  if (type === 'happ') {
    return (
      <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.2 4.2h4.6v6h6.4v-6h4.6v15.6h-4.6v-6H8.8v6H4.2V4.2Zm6.5 7.1h2.6v1.4h-2.6v-1.4Z" />
      </svg>
    );
  }

  if (type === 'v2ray') {
    return (
      <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5.2" />
        <path d="M6.2 9.7h3.2l2.6 4.8 2.6-4.8h3.2l-4.4 7.3h-2.8L6.2 9.7Z" fill="#fff" />
        <path d="M16.8 6.7h-3.7v2.1h1.7v1.3h-1.7v2.1h4v-2.1h-1.7V8.8h1.4V6.7Z" fill="#fff" />
      </svg>
    );
  }

  return <Monitor size={22} />;
}

function WindowsGlyph() {
  return (
    <svg className="os-icon windows-glyph" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M0.000749946 1.85925L5.5335 1.09725V6.4425H0L0.000749946 1.85925ZM0.000749946 11.6407L5.5335 12.4035V7.1235H0L0.000749946 11.6407ZM6.14175 12.4845L13.5007 13.5V7.1235H6.14175V12.4845ZM6.14175 1.0155V6.4425H13.5007V0L6.14175 1.0155Z" fill="#021227" />
    </svg>
  );
}

function ChangePlan({ navigate, activeScreen, mainData }) {
  const [upgradeAmount, setUpgradeAmount] = useState('0');
  const [changeError, setChangeError] = useState('');
  const [upgradeUnavailable, setUpgradeUnavailable] = useState(false);
  const currentPlan = mainData.plan || '';
  const [selectedPlan, setSelectedPlan] = useState(() => (currentPlan === 'plus' ? 'lite' : 'plus'));
  const showUpgrade = selectedPlan === 'plus';
  const showDowngrade = selectedPlan === 'lite';
  const currentPrice = tariffCatalog[currentPlan]?.monthPrice || tariffCatalog.lite.monthPrice;
  const selectedPrice = tariffCatalog[selectedPlan]?.monthPrice || tariffCatalog.plus.monthPrice;
  const currentDevices = tariffCatalog[currentPlan]?.devices || tariffCatalog.lite.devices;
  const selectedDevices = tariffCatalog[selectedPlan]?.devices || tariffCatalog.plus.devices;
  const remainingDays = mainData.expiredAt ? Math.max(0, Math.ceil((new Date(mainData.expiredAt).getTime() - Date.now()) / 86400000)) : 20;
  const downgradeDate = dateRu(mainData.expiredAt, 'после окончания периода');

  useEffect(() => {
    setSelectedPlan(currentPlan === 'plus' ? 'lite' : 'plus');
  }, [currentPlan]);

  useEffect(() => {
    if (currentPlan === 'plus') {
      setChangeError('');
      return;
    }

    const loadUpgradePrice = async () => {
      try {
        setUpgradeUnavailable(false);
        const response = await api.upgradePrice();
        setUpgradeAmount(response?.amount || response || '0');
      } catch (error) {
        if (error.status === 422) {
          setUpgradeUnavailable(true);
          setChangeError('');
          return;
        }

        setChangeError('Не удалось загрузить условия перехода');
      }
    };

    loadUpgradePrice();
  }, [currentPlan]);

  const upgradePlan = async () => {
    if (upgradeUnavailable) {
      return;
    }

    try {
      setChangeError('');
      const url = await api.createUpgradeInvoice({ provider: 'platega' });
      openPaymentUrl(url);
    } catch (error) {
      setChangeError(getUiError(error));
    }
  };

  const downgradePlan = async () => {
    try {
      setChangeError('');
      await api.downgradePlan();
      navigate('home-active');
    } catch (error) {
      setChangeError(getUiError(error));
    }
  };

  return (
    <AppFrame className="change-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Смена тарифа" />
      <PlansPair selected={selectedPlan} currentLite={currentPlan === 'lite'} hideIcons onSelect={setSelectedPlan} />
      <SectionDivider>выберите действие</SectionDivider>
      {showUpgrade && (
        <Card className="change-card upgrade">
            <span className="status-pill green">Апгрейд</span>
            <h2>Вы переходите на <span>Plus</span></h2>
            <ChangeRow title="Цена" from={money(currentPrice)} to={money(selectedPrice)} />
            <ChangeRow title="Устройства" from={currentDevices} to={selectedDevices} />
            <p className="limit-text">Можно докупить до 6 устройств</p>
            <div className="thin-line" />
            <h3>Расчет платежа</h3>
            <SummaryLine label="Осталось по текущему тарифу" value={`${remainingDays} ${pluralRu(remainingDays, 'день', 'дня', 'дней')}`} />
            <SummaryLine label="Стоимость в месяц" value={money(selectedPrice)} />
            <SummaryLine label={`С учетом остатка (${remainingDays} ${pluralRu(remainingDays, 'день', 'дня', 'дней')})`} value={`~${money(upgradeAmount)}`} />
            {changeError && <p className="inline-error">{changeError}</p>}
            <PrimaryButton onClick={upgradePlan}>Перейти на Plus <span>{money(upgradeAmount)}</span></PrimaryButton>
          </Card>
      )}
      {showDowngrade && (
        <Card className="change-card downgrade">
          <span className="status-pill purple">Даунгрейд</span>
          <h2>Вы переходите на <span>Lite</span></h2>
          <div className="notice-box">
            <CalendarDays size={24} />
            <div>
              <p>Смена тарифа будет запланирована</p>
              <strong>{downgradeDate}</strong>
              <span>До этой даты у вас останется тариф Plus со всеми его преимуществами.</span>
            </div>
          </div>
          <ChangeRow title="Цена" from={money(currentPrice)} to={money(selectedPrice)} />
          <ChangeRow title="Устройства" from={currentDevices} to={selectedDevices} />
          <p className="limit-text">Можно докупить до 3 устройств</p>
          {changeError && <p className="inline-error">{changeError}</p>}
          <button className="secondary-button purple" onClick={downgradePlan}>Запланировать переход на Lite</button>
        </Card>
      )}
    </AppFrame>
  );
}

function ChangeRow({ title, from, to }) {
  return (
    <div className="change-row">
      <span>{title}</span>
      <strong>{from}</strong>
      <MoveRightIcon />
      <strong>{to}</strong>
    </div>
  );
}

function MoveRightIcon() {
  return (
    <svg className="move-right" width="16" height="7" viewBox="0 0 16 7" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12.5 6.5L15.5 3.5L12.5 0.5M15.5 3.5H0.5" stroke="#021227" strokeOpacity="0.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SummaryLine({ label, value }) {
  return (
    <div className="summary-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BalanceTopup({ navigate, activeScreen, mainData }) {
  const [selectedPayment, setSelectedPayment] = useState('device');
  const [selectedMethod, setSelectedMethod] = useState('card');
  const [hwidLimit, setHwidLimit] = useState(() => Math.min(9, Math.max(1, Number(mainData.maxDevices || 0) + 1)));
  const [customAmount, setCustomAmount] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoPrices, setPromoPrices] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const provider = selectedMethod === 'crypto' ? 'heleket' : 'platega';
  const planPayment = ['lite', 'home', 'plus'].includes(selectedPayment) ? selectedPayment : '';
  const paymentType = selectedPayment === 'device' ? 'HWID' : selectedPayment === 'balance' ? 'BALANCE' : 'SUBSCRIPTION';
  const basePrices = {
    device: devicePrice,
    lite: tariffCatalog.lite.monthPrice,
    home: tariffCatalog.home.monthPrice,
    plus: tariffCatalog.plus.monthPrice,
  };
  const getPaymentPrice = (key) => promoApplied && Number.isFinite(promoPrices?.[key]) ? promoPrices[key] : basePrices[key];
  const selectedAmount = selectedPayment === 'device'
    ? getPaymentPrice('device')
    : selectedPayment === 'balance'
      ? promoApplied && Number.isFinite(promoPrices?.balance) ? promoPrices.balance : Number(customAmount || 0)
      : getPaymentPrice(planPayment) || 0;

  const applyPromo = async () => {
    if (promoApplied) {
      setPromoCode('');
      setPromoApplied(false);
      setPromoPrices(null);
      return;
    }

    const code = promoCode.trim();
    if (!code) {
      return;
    }

    try {
      setPromoLoading(true);
      setPaymentError('');
      const entries = Object.entries({
        ...basePrices,
        ...(Number(customAmount || 0) > 0 ? { balance: Number(customAmount) } : {}),
      });
      const results = await Promise.all(entries.map(async ([key, amount]) => {
        const response = await api.validatePromo(code, amount);
        const total = Number(response?.total);

        if (!Number.isFinite(total)) {
          throw new Error('Сервис не вернул цену с учетом промокода');
        }

        return [key, total];
      }));

      setPromoPrices(Object.fromEntries(results));
      setPromoApplied(true);
    } catch (error) {
      setPromoPrices(null);
      setPromoApplied(false);
      setPaymentError(getPaymentUiError(error));
    } finally {
      setPromoLoading(false);
    }
  };

  const submitPromoWithEnter = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPromo();
      event.currentTarget.blur();
    }
  };

  useEffect(() => {
    if (selectedPayment === 'device') {
      setHwidLimit((value) => Math.max(value, Math.min(9, Number(mainData.maxDevices || 0) + 1)));
    }
  }, [mainData.maxDevices, selectedPayment]);

  const createPayment = async () => {
    if (paymentType === 'BALANCE' && Number(customAmount || 0) <= 0) {
      setPaymentError('Введите сумму пополнения');
      return;
    }

    if (paymentType === 'HWID' && hwidLimit <= Number(mainData.maxDevices || 0)) {
      setPaymentError('Выберите лимит больше текущего');
      return;
    }

    const payload = paymentType === 'BALANCE'
      ? { amount: Number(customAmount || 0), currency: selectedMethod === 'crypto' ? 'USDT' : 'RUB', promo_code: promoApplied ? promoCode.trim() : undefined }
      : paymentType === 'HWID'
        ? { hwid: hwidLimit, currency: selectedMethod === 'crypto' ? 'USDT' : 'RUB', promo_code: promoApplied ? promoCode.trim() : undefined }
        : {
            plan: planPayment || 'plus',
            subscription_month: 1,
            hwid: tariffCatalog[planPayment]?.devices || 3,
            currency: selectedMethod === 'crypto' ? 'USDT' : 'RUB',
            promo_code: promoApplied ? promoCode.trim() : undefined,
          };

    try {
      setPaymentError('');
      const url = await api.createInvoice({ provider, type: paymentType, payload });
      openPaymentUrl(url);
    } catch (error) {
      setPaymentError(getPaymentUiError(error));
    }
  };

  return (
    <AppFrame className="balance-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Баланс" action={<button className="history-button" onClick={() => navigate('balance-history')}>История</button>} />
      <button className="balance-hero card" onClick={() => setSelectedPayment('balance')}>
        <div>
          <p>Основной баланс</p>
          <strong>{Number(mainData.balance || 0).toLocaleString('ru-RU')} <span>₽</span></strong>
        </div>
        <img src={asset('wallet')} alt="" />
        <i />
        <small><span aria-hidden="true">✓</span>Если баланса хватит, подписка продлится автоматически</small>
      </button>
      <Card className="payment-card">
        <h2>Выберите, что хотите оплатить</h2>
        <PaymentOption iconName="device-add" title="Докупить устройство" subtitle="Активация 1 устройства" price={money(getPaymentPrice('device'))} checked={selectedPayment === 'device'} onClick={() => setSelectedPayment('device')} />
        <PaymentOption iconName="plan-lite" title="Lite - 1 месяц" subtitle="Базовые возможности" price={money(getPaymentPrice('lite'))} checked={selectedPayment === 'lite'} onClick={() => setSelectedPayment('lite')} />
        <PaymentOption iconName="plan-home" title="Home - 1 месяц" subtitle="Для тех, кто за границей" price={money(getPaymentPrice('home'))} checked={selectedPayment === 'home'} onClick={() => setSelectedPayment('home')} />
        <PaymentOption iconName="plan-plus" title="Plus - 1 месяц" subtitle="Максимум возможностей" price={money(getPaymentPrice('plus'))} checked={selectedPayment === 'plus'} onClick={() => setSelectedPayment('plus')} divider={false} />
        <SectionDivider>или ввести сумму вручную</SectionDivider>
        <div className={selectedPayment === 'balance' ? 'input-box selected' : 'input-box'} onClick={() => setSelectedPayment('balance')}>
          <span>Сумма пополнения</span>
          <input value={customAmount} onChange={(event) => { setCustomAmount(event.target.value); setPromoApplied(false); setPromoPrices(null); }} placeholder="Введите сумму" inputMode="decimal" />
          <p>₽</p>
        </div>
      </Card>
      <div className="payment-methods">
        <MethodCard title="Банковская карта" subtitle="Visa, Mastercard, Мир" checked={selectedMethod === 'card'} onClick={() => setSelectedMethod('card')} />
        <MethodCard title="Криптовалюта" subtitle="USDT, BTC, ETH и др." checked={selectedMethod === 'crypto'} onClick={() => setSelectedMethod('crypto')} />
      </div>
      <div className="promo">
        <p>{promoApplied ? 'Промокод применен' : 'Есть промокод?'}</p>
        <div>
          <input value={promoCode} onFocus={keepFocusedFieldVisible} onKeyDown={submitPromoWithEnter} onChange={(event) => { setPromoCode(event.target.value); setPromoApplied(false); setPromoPrices(null); }} placeholder="Введите промокод" enterKeyHint="done" />
          <button onClick={applyPromo} disabled={promoLoading || (!promoApplied && !promoCode.trim())}>{promoLoading ? 'Проверяем' : promoApplied ? 'Убрать' : 'Применить'}</button>
        </div>
      </div>
      {paymentError && <p className="inline-error">{paymentError}</p>}
      <PrimaryButton onClick={createPayment}>Оплатить <span>{selectedAmount ? money(selectedAmount) : ''}</span></PrimaryButton>
    </AppFrame>
  );
}

function PaymentOption({ iconName, title, subtitle, price, checked, onClick, divider = true }) {
  return (
    <button className={`payment-option${checked ? ' checked' : ''}${divider ? ' has-divider' : ''}`} onClick={onClick}>
      <IconTile tone="payment-image"><AssetIcon name={iconName} /></IconTile>
      <div>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>
      {price && <b>{price}</b>}
      <span className={checked ? 'radio checked' : 'radio'} />
    </button>
  );
}

function MethodCard({ title, subtitle, checked, onClick }) {
  return (
    <button className={checked ? 'method-card checked' : 'method-card'} onClick={onClick}>
      <div>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>
      <span className={checked ? 'radio checked' : 'radio'} />
    </button>
  );
}

function ReferralScreen({ navigate, activeScreen, mainData, telegramUser }) {
  const [referralData, setReferralData] = useState(null);
  const [referralLoaded, setReferralLoaded] = useState(false);
  const [referralError, setReferralError] = useState('');
  const referralInfo = useMemo(() => normalizeReferralData(referralData, mainData), [referralData, mainData]);
  const earned = Number(referralInfo.earned || 0);
  const [amount, setAmount] = useState(earned ? String(Math.floor(earned)) : '');
  const [notice, setNotice] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [isBonusInfoOpen, setBonusInfoOpen] = useState(false);
  const [isBonusInfoClosing, setBonusInfoClosing] = useState(false);
  const days = Math.max(0, Math.floor(Number(amount || 0) / 10));
  const displayedLink = referralInfo.link || (referralLoaded ? referralError || 'Ссылка недоступна' : 'Загружаем ссылку');

  useEffect(() => {
    setAmount(earned ? String(Math.floor(earned)) : '');
  }, [earned]);

  useEffect(() => {
    let isMounted = true;

    api.referralData()
      .then((payload) => {
        if (isMounted) {
          setReferralData(payload);
          setReferralLoaded(true);
          setReferralError('');
        }
      })
      .catch((error) => {
        if (isMounted) {
          setReferralData(null);
          setReferralLoaded(true);
          setReferralError(getUiError(error));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const copyReferralLink = async () => {
    if (!referralInfo.link) {
      setCopyNotice(referralLoaded ? 'Ссылка недоступна' : 'Ссылка загружается');
      return;
    }

    try {
      await navigator.clipboard.writeText(referralInfo.link);
      setCopyNotice('Ссылка скопирована');
    } catch {
      setCopyNotice(referralInfo.link);
    }
  };

  const showApiNotice = () => {
    setNotice('Функция скоро будет доступна');
  };

  const openPartnerTicket = () => {
    try {
      sessionStorage.setItem('ticket_subject', 'Заявка на партнерку');
    } catch {
    }

    navigate('ticket-create');
  };

  const openBonusInfo = () => {
    setBonusInfoClosing(false);
    setBonusInfoOpen(true);
  };

  const closeBonusInfo = () => {
    setBonusInfoClosing(true);
    window.setTimeout(() => {
      setBonusInfoOpen(false);
      setBonusInfoClosing(false);
    }, 180);
  };

  return (
    <AppFrame className="referral-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Реферальная программа" />
      <Card className="referral-earn-card">
        <div className="referral-earn-head">
          <div>
            <p>Вы заработали</p>
            <strong>{Number(earned || 0).toLocaleString('ru-RU')} <span>₽</span></strong>
            <span>= {Math.floor(earned / 10)} дней подписки</span>
          </div>
          <img src={asset('referral-gift')} alt="" />
        </div>
        <div className="thin-line" />
        <h2>Конвертация в дни</h2>
        <p className="referral-rate-text">1 день = 10 ₽</p>
        <div className="referral-convert">
          <label>
            <span>Сумма</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="0" />
            <b>₽</b>
          </label>
          <MoveRightIcon />
          <label>
            <span>К подписке</span>
            <input value={days} readOnly />
            <b><CalendarDays size={15} /></b>
          </label>
        </div>
        <PrimaryButton onClick={showApiNotice}>Добавить {days || 0} дней</PrimaryButton>
        <SectionDivider>или</SectionDivider>
        <button className="withdraw-row" onClick={showApiNotice}>
          <Wallet size={25} />
          <div>
            <strong>Вывести средства</strong>
            <p>Минимум от 1 000 ₽</p>
          </div>
          <ChevronRight size={23} />
        </button>
        {notice && <p className="inline-error neutral">{notice}</p>}
      </Card>
      <Card className="invite-card">
        <h2>Приглашайте друзей <button onClick={openBonusInfo} aria-label="Как работают бонусы"><BonusQuestionIcon /></button></h2>
        <p>и продлевайте подписку бонусами</p>
        <div className="bonus-grid">
          <div>
            <SingleUserIcon />
            <strong>до 561 ₽</strong>
            <p>с оплаты друга</p>
          </div>
          <div className="second-level">
            <Users size={22} />
            <strong>до 56 ₽</strong>
            <p>с оплат его друзей</p>
          </div>
        </div>
        <div className="referral-link-box">
          <ReferralLinkIcon />
          <span>{displayedLink}</span>
          <button onClick={copyReferralLink} aria-label="Скопировать ссылку"><Copy size={19} /></button>
          {copyNotice && <small>{copyNotice}</small>}
        </div>
        <p>Поделитесь ссылкой и начните зарабатывать</p>
        <div className="recurring-box">
          <span>∞</span>
          <div>
            <strong>Рекуррентные выплаты</strong>
            <p>Бонусы начисляются с каждого продления подписки</p>
          </div>
        </div>
      </Card>
      <Card className="referral-stats-card">
        <h2>Статистика</h2>
        <div className="referral-stat-row"><Users size={20} /><span>Приглашено друзей</span><strong>{referralInfo.invitedFriends}</strong></div>
        <div className="referral-stat-row active-friends"><GrowthArrowIcon /><span>Активных друзей</span><strong>{referralInfo.totalFriends}</strong></div>
        <div className="referral-stat-row earned-total"><Wallet size={20} /><span>Всего заработано</span><strong>{money(earned)}</strong></div>
      </Card>
      <div className="partner-card">
        <div className="partner-card-main">
          <IconTile tone="soft-purple"><PartnerUsersIcon /></IconTile>
          <div>
            <strong>Партнерская программа</strong>
            <p>Особые условия для крупных партнеров</p>
          </div>
          <button onClick={openPartnerTicket}>Оставить заявку</button>
        </div>
        <div className="partner-fit">
          <i />
          <span>подходит</span>
          <i />
        </div>
        <div className="partner-audience">
          <span>Блогерам</span>
          <b />
          <span>Сообществам</span>
          <b />
          <span>Партнерам</span>
        </div>
      </div>
      {isBonusInfoOpen && <BonusInfoSheet closing={isBonusInfoClosing} onClose={closeBonusInfo} />}
    </AppFrame>
  );
}

function BonusInfoSheet({ closing, onClose }) {
  useBodyScrollLock(true);
  const swipeDismiss = useSwipeDismiss(onClose);

  return (
    <div className={closing ? 'bonus-sheet-overlay closing' : 'bonus-sheet-overlay'} role="dialog" aria-modal="true" aria-label="Как работают бонусы" onClick={onClose}>
      <div className="bonus-popup" ref={swipeDismiss.sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-drag-zone" {...swipeDismiss.handleProps}>
          <span className="sheet-grip" />
        </div>
        <img className="bonus-popup-image" src={asset('bonus-info-popup')} alt="Как работают бонусы" />
      </div>
    </div>
  );
}

function ImageInfoSheet({ src, alt, onClose }) {
  useBodyScrollLock(true);
  const swipeDismiss = useSwipeDismiss(onClose);

  return (
    <div className="image-sheet-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-sheet" ref={swipeDismiss.sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-drag-zone" {...swipeDismiss.handleProps}>
          <span className="sheet-grip" />
        </div>
        <img src={src} alt={alt} />
      </div>
    </div>
  );
}

function BonusStep({ icon: Icon, label }) {
  return (
    <div>
      <IconTile><Icon size={22} /></IconTile>
      <span>{label}</span>
    </div>
  );
}

function GiftIcon({ size = 22 }) {
  return <img className="gift-step-icon" src={asset('referral-gift')} alt="" style={{ width: size, height: size }} />;
}

function BonusQuestionIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 3.55556V3.86111M6 6V8.44444M6 11.5C9.03759 11.5 11.5 9.03759 11.5 6C11.5 2.96244 9.03759 0.5 6 0.5C2.96244 0.5 0.5 2.96244 0.5 6C0.5 9.03759 2.96244 11.5 6 11.5Z" stroke="#FF7A2F" strokeOpacity="0.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const scrollY = window.scrollY;
    const { style } = document.body;
    const webApp = window.Telegram?.WebApp;
    const previous = {
      position: style.position,
      top: style.top,
      left: style.left,
      right: style.right,
      width: style.width,
      overflow: style.overflow,
    };

    telegramVerticalSwipeLocks += 1;
    if (telegramVerticalSwipeLocks === 1) {
      webApp?.disableVerticalSwipes?.();
    }

    style.position = 'fixed';
    style.top = `-${scrollY}px`;
    style.left = '0';
    style.right = '0';
    style.width = '100%';
    style.overflow = 'hidden';

    return () => {
      telegramVerticalSwipeLocks = Math.max(0, telegramVerticalSwipeLocks - 1);
      if (telegramVerticalSwipeLocks === 0) {
        webApp?.enableVerticalSwipes?.();
      }
      style.position = previous.position;
      style.top = previous.top;
      style.left = previous.left;
      style.right = previous.right;
      style.width = previous.width;
      style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}

function useSwipeDismiss(onClose) {
  const sheetRef = useRef(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const pointerIdRef = useRef(null);
  const isDraggingRef = useRef(false);

  const beginDrag = (clientY, pointerId = null) => {
    isDraggingRef.current = true;
    pointerIdRef.current = pointerId;
    startYRef.current = clientY;
    currentYRef.current = 0;

    const sheet = sheetRef.current;

    if (sheet) {
      sheet.style.transition = 'none';
    }
  };

  const moveDrag = (clientY) => {
    if (!isDraggingRef.current) {
      return;
    }

    const deltaY = Math.max(0, clientY - startYRef.current);
    const sheet = sheetRef.current;
    currentYRef.current = deltaY;

    if (sheet) {
      sheet.style.transform = `translate3d(0, ${deltaY}px, 0)`;
      sheet.style.opacity = String(Math.max(0.76, 1 - deltaY / 360));
    }
  };

  const resetSheet = () => {
    const sheet = sheetRef.current;

    if (!sheet) {
      return;
    }

    sheet.style.transition = 'transform 180ms ease, opacity 180ms ease';
    sheet.style.transform = 'translate3d(0, 0, 0)';
    sheet.style.opacity = '1';
    window.setTimeout(() => {
      if (sheetRef.current === sheet) {
        sheet.style.transition = '';
        sheet.style.transform = '';
        sheet.style.opacity = '';
      }
    }, 190);
  };

  const clearSheet = () => {
    const sheet = sheetRef.current;

    if (!sheet) {
      return;
    }

    sheet.style.transition = '';
    sheet.style.transform = '';
    sheet.style.opacity = '';
  };

  const finishDrag = () => {
    if (!isDraggingRef.current) {
      return;
    }

    const shouldClose = currentYRef.current > 72;
    isDraggingRef.current = false;
    pointerIdRef.current = null;

    if (shouldClose) {
      clearSheet();
      onClose();
      return;
    }

    resetSheet();
  };

  return {
    sheetRef,
    handleProps: {
      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        beginDrag(event.clientY, event.pointerId);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event) => {
        if (!isDraggingRef.current || pointerIdRef.current !== event.pointerId) {
          return;
        }

        moveDrag(event.clientY);
        event.preventDefault();
        event.stopPropagation();
      },
      onPointerUp: (event) => {
        event.preventDefault();
        event.stopPropagation();
        finishDrag();
      },
      onPointerCancel: (event) => {
        event.preventDefault();
        event.stopPropagation();
        finishDrag();
      },
      onTouchStart: (event) => {
        event.stopPropagation();
        beginDrag(event.touches[0]?.clientY || 0);
      },
      onTouchMove: (event) => {
        moveDrag(event.touches[0]?.clientY || 0);
        event.preventDefault();
        event.stopPropagation();
      },
      onTouchEnd: (event) => {
        event.stopPropagation();
        finishDrag();
      },
      onTouchCancel: (event) => {
        event.stopPropagation();
        finishDrag();
      },
    },
  };
}

function ReferralLinkIcon() {
  return (
    <svg className="referral-link-icon" width="21" height="12" viewBox="0 0 21 12" fill="none" aria-hidden="true">
      <path d="M7.43324 10.2334H5.56657C4.32889 10.2334 3.14191 9.74169 2.26674 8.86652C1.39157 7.99135 0.899902 6.80437 0.899902 5.56669C0.899902 4.32901 1.39157 3.14203 2.26674 2.26686C3.14191 1.39169 4.32889 0.900024 5.56657 0.900024H7.43324M13.0332 0.900024H14.8999C16.1376 0.900024 17.3246 1.39169 18.1997 2.26686C19.0749 3.14203 19.5666 4.32901 19.5666 5.56669C19.5666 6.80437 19.0749 7.99135 18.1997 8.86652C17.3246 9.74169 16.1376 10.2334 14.8999 10.2334H13.0332M6.4999 5.56669H13.9666" stroke="#021227" strokeOpacity="0.5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PartnerUsersIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M23 20.9999V18.9999C22.9993 18.1136 22.7044 17.2527 22.1614 16.5522C21.6184 15.8517 20.8581 15.3515 20 15.1299" stroke="#8B5CF6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="#8B5CF6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 3.12988C16.8604 3.35018 17.623 3.85058 18.1676 4.55219C18.7122 5.2538 19.0078 6.11671 19.0078 7.00488C19.0078 7.89305 18.7122 8.75596 18.1676 9.45757C17.623 10.1592 16.8604 10.6596 16 10.8799" stroke="#8B5CF6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 11C11.2091 11 13 9.20914 13 7C13 4.79086 11.2091 3 9 3C6.79086 3 5 4.79086 5 7C5 9.20914 6.79086 11 9 11Z" stroke="#8B5CF6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GrowthArrowIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M23.3125 10.9375L16.5625 17.6875L13.75 14.875L8.6875 19.9375" stroke="#2BB673" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.3125 15.4375V10.9375H18.8125" stroke="#2BB673" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SingleUserIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="#FF7A2F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="#FF7A2F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BalanceHistory({ navigate, activeScreen }) {
  const [selectedType, setSelectedType] = useState('income');
  const [history, setHistory] = useState({
    sum_pay: 0,
    sym_trac: 0,
    payments: [],
  });
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    const loadHistory = async () => {
      const type = selectedType === 'income' ? 'replenishment' : 'payments';

      try {
        const payload = await api.history(type);

        setHistory(payload && typeof payload === 'object' ? payload : {
          sum_pay: 0,
          sym_trac: 0,
          payments: [],
        });
        setHistoryError('');
      } catch (error) {
        setHistoryError(getUiError(error));
      }
    };

    loadHistory();
  }, [selectedType]);

  const renderedTransactions = (history.payments || []).map((item, index) => ({
    title: selectedType === 'income' ? 'Пополнение баланса' : 'Оплата VORA',
    date: formatDateTime(item.data),
    amount: `${selectedType === 'income' ? '+' : '-'}${money(item.amount)}`,
    icon: selectedType === 'income' ? 'wallet' : 'feather',
    status: item.status || 'paid',
    index,
  }));

  return (
    <AppFrame className="history-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="История баланса" subtitle="Все ваши транзакции" action={<button className="square-action" onClick={() => navigate('balance-history')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <div className="segmented-control">
        <button className={selectedType === 'income' ? 'active' : ''} onClick={() => setSelectedType('income')}><ArrowDown size={22} />Пополнения</button>
        <button className={selectedType === 'outcome' ? 'active' : ''} onClick={() => setSelectedType('outcome')}><ArrowUp size={22} />Списания</button>
      </div>
      {historyError && <p className="inline-error">{historyError}</p>}
      {renderedTransactions.map(({ title, date, amount, icon, status, index }) => (
        <Card className="transaction-card" key={`${title}-${index}`}>
          <IconTile tone={icon === 'wallet' ? 'soft-green' : 'feather'}>{icon === 'wallet' ? <Wallet size={24} /> : <span className="feather-mark" />}</IconTile>
          <div>
            <strong>{title}</strong>
            <p>{date}</p>
          </div>
          <div>
            <b>{amount}</b>
            <span>{status === 'paid' ? 'Успешно' : status}</span>
          </div>
        </Card>
      ))}
      {!renderedTransactions.length && !historyError && <p className="empty-state">Операций пока нет</p>}
      <h2 className="muted-heading">Сводка</h2>
      <Card className="stats-card">
        <Stat icon={Wallet} label="Всего потрачено" value={money(history.sum_pay)} />
        <Stat icon={ArrowLeftRight} label="Всего транзакций" value={String(history.sym_trac ?? renderedTransactions.length)} tone="green" />
      </Card>
      <Card className="help-card">
        <IconTile><HeadphonesGlyph /></IconTile>
        <div>
          <h3>Нужна помощь?</h3>
          <p>Напишите нам, мы всегда на связи</p>
        </div>
        <button onClick={() => navigate('tickets')}>Написать</button>
      </Card>
    </AppFrame>
  );
}

function Stat({ icon: Icon, label, value, tone = 'orange' }) {
  return (
    <div className={`stat ${tone}`}>
      <Icon size={25} />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function SupportScreen({ navigate, activeScreen }) {
  const [topicsExpanded, setTopicsExpanded] = useState(true);
  const quick = [
    [AlertTriangle, 'VPN не работает - что делать?', 'Решение за 2 минуты', 'soft-orange'],
    [Download, 'Почему не скачивается приложение?', 'Доступ и установка', 'soft-blue'],
    [Link, 'Как подключить устройство?', 'Пошаговая инструкция', 'soft-green'],
  ];
  const topics = [
    [Settings, 'Подключение и настройка', 'topic-blue'],
    [Link, 'Подписка и оплата', 'topic-green'],
    [Monitor, 'Устройства', 'topic-green'],
    [Users, 'Реферальная программа', 'topic-orange'],
    [Shield, 'Безопасность и конфиденциальность', 'topic-blue'],
    [Menu, 'Прочее', 'topic-blue'],
  ];

  return (
    <AppFrame className="support-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Поддержка" subtitle="Мы всегда на связи и готовы помочь" />
      <div className="support-cards">
        <button className="support-card" onClick={() => navigate('tickets')}><MessageCircle size={30} /><strong>Написать в чат</strong><p>Ответим в течение 5 минут</p><ChevronRight /></button>
        <button className="support-card" onClick={() => navigate('home-popup')}><BookOpen size={30} /><strong>Инструкции</strong><p>Пошаговые гайды по подключению</p><ChevronRight /></button>
      </div>
      <Card className="topic-list">
        {quick.map(([Icon, title, subtitle, tone]) => <TopicRow key={title} icon={Icon} title={title} subtitle={subtitle} tone={tone} onClick={() => navigate('tickets')} />)}
      </Card>
      <Card className="topic-list">
        <div className="topic-header">
          <h2>Все темы</h2>
          <button onClick={() => setTopicsExpanded((value) => !value)}>
            {topicsExpanded ? 'Свернуть' : 'Развернуть'} {topicsExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>
        {topicsExpanded && topics.map(([Icon, title, tone]) => <TopicRow key={title} icon={Icon} title={title} tone={tone} onClick={() => navigate('tickets')} />)}
      </Card>
      <Card className="help-card">
        <IconTile><HeadphonesGlyph /></IconTile>
        <div>
          <h3>Нужна помощь?</h3>
          <p>Напишите нам, мы всегда на связи</p>
        </div>
        <button onClick={() => navigate('tickets')}>Написать</button>
      </Card>
    </AppFrame>
  );
}

function TopicRow({ icon: Icon, title, subtitle, tone, onClick }) {
  return (
    <button className="topic-row" onClick={onClick}>
      <IconTile tone={tone}><Icon size={22} /></IconTile>
      <div>
        <strong>{title}</strong>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <ChevronRight size={22} />
    </button>
  );
}

function HeadphonesGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M0.900024 11.9H3.90002C4.43046 11.9 4.93917 12.1107 5.31424 12.4858C5.68931 12.8609 5.90002 13.3696 5.90002 13.9V16.9C5.90002 17.4305 5.68931 17.9392 5.31424 18.3142C4.93917 18.6893 4.43046 18.9 3.90002 18.9H2.90002C2.36959 18.9 1.86088 18.6893 1.48581 18.3142C1.11074 17.9392 0.900024 17.4305 0.900024 16.9V9.90002C0.900024 7.51308 1.84824 5.22389 3.53606 3.53606C5.22389 1.84824 7.51308 0.900024 9.90002 0.900024C12.287 0.900024 14.5762 1.84824 16.264 3.53606C17.9518 5.22389 18.9 7.51308 18.9 9.90002V16.9C18.9 17.4305 18.6893 17.9392 18.3142 18.3142C17.9392 18.6893 17.4305 18.9 16.9 18.9H15.9C15.3696 18.9 14.8609 18.6893 14.4858 18.3142C14.1107 17.9392 13.9 17.4305 13.9 16.9V13.9C13.9 13.3696 14.1107 12.8609 14.4858 12.4858C14.8609 12.1107 15.3696 11.9 15.9 11.9H18.9" stroke="#FF7A2F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TicketsScreen({ navigate, activeScreen, isAdmin }) {
  const [selectedTab, setSelectedTab] = useState('all');
  const [mode, setMode] = useState('user');
  const [tickets, setTickets] = useState([]);
  const [ticketsError, setTicketsError] = useState('');
  const [isLoadingTickets, setLoadingTickets] = useState(false);

  const loadTickets = async () => {
    try {
      setLoadingTickets(true);
      setTicketsError('');
      const payload = mode === 'admin' ? await api.adminTickets() : await api.tickets();
      setTickets(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setTickets([]);
      setTicketsError(getUiError(error));
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    if (mode === 'admin' && !isAdmin) {
      setMode('user');
      return undefined;
    }

    loadTickets();
  }, [isAdmin, mode]);

  const visibleTickets = tickets.filter((ticket) => selectedTab === 'all' || String(ticket.status || 'open').toLowerCase() === selectedTab);
  const counts = {
    all: tickets.length,
    open: tickets.filter((ticket) => String(ticket.status || 'open').toLowerCase() === 'open').length,
    answered: tickets.filter((ticket) => String(ticket.status || '').toLowerCase() === 'answered').length,
    closed: tickets.filter((ticket) => String(ticket.status || '').toLowerCase() === 'closed').length,
  };
  const openTicket = (ticket) => {
    saveSelectedTicket(ticket.id, mode === 'admin');
    navigate('ticket-thread');
  };

  return (
    <AppFrame className="tickets-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Обращения" subtitle="Круглосуточно" />
      <div className={isAdmin ? 'ticket-mode' : 'ticket-mode user-only'}>
        <button className={mode === 'user' ? 'active' : ''} onClick={() => setMode('user')}>Мои</button>
        {isAdmin && <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>Админ</button>}
      </div>
      <div className="ticket-tabs">
        {[
          ['all', 'Все'],
          ['open', 'Новые'],
          ['answered', 'Ответ'],
          ['closed', 'Закрыты'],
        ].map(([id, label]) => (
          <button key={id} className={selectedTab === id ? 'active' : ''} onClick={() => setSelectedTab(id)}>{label} <span>{counts[id]}</span></button>
        ))}
      </div>
      {ticketsError && <p className="inline-error">{ticketsError}</p>}
      {isLoadingTickets && <p className="empty-state">Загружаем обращения...</p>}
      {visibleTickets.map((ticket) => {
        const [statusLabel, tone] = getTicketStatusMeta(ticket.status);

        return (
          <button className="ticket-card" key={ticket.id} onClick={() => openTicket(ticket)}>
            <div>
              <strong>{ticket.subject || 'Без темы'}</strong>
              <p>{mode === 'admin' ? `TG ${ticket.tg_id || '-'}` : ticket.id}</p>
            </div>
            <div>
              <span className={`ticket-status ${tone}`}>{statusLabel}</span>
              <p>{formatDateTime(ticket.updated_at || ticket.created_at)}</p>
            </div>
          </button>
        );
      })}
      {!isLoadingTickets && !visibleTickets.length && !ticketsError && <p className="empty-state">Обращений пока нет</p>}
      <PrimaryButton onClick={() => navigate('ticket-create')}>Новое обращение</PrimaryButton>
    </AppFrame>
  );
}

function CreateTicket({ navigate, activeScreen }) {
  const [subject, setSubject] = useState(() => {
    try {
      return sessionStorage.getItem('ticket_subject') || '';
    } catch {
      return '';
    }
  });
  const [description, setDescription] = useState('');
  const [fileName, setFileName] = useState('');
  const [files, setFiles] = useState([]);
  const [ticketError, setTicketError] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.removeItem('ticket_subject');
    } catch {
    }
  }, []);

  const submitTicket = async () => {
    if (!subject.trim()) {
      setTicketError('Введите тему обращения');
      return;
    }

    try {
      setSubmitting(true);
      setTicketError('');
      await api.createTicket({ subject: subject.trim(), text: description.trim(), files });
      navigate('tickets');
    } catch (error) {
      setTicketError(getUiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppFrame className="create-ticket" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Создать обращение" subtitle="Опишите вашу проблему, и мы поможем" />
      <Card className="field-card">
        <label htmlFor="ticket-subject">Тема обращения</label>
        <input id="ticket-subject" value={subject} onChange={(event) => setSubject(event.target.value.slice(0, 100))} placeholder="Кратко опишите проблему" maxLength={100} />
        <span>{subject.length}/100</span>
      </Card>
      <Card className="textarea-card">
        <label htmlFor="ticket-description">Описание проблемы</label>
        <textarea id="ticket-description" value={description} onChange={(event) => setDescription(event.target.value.slice(0, 1000))} placeholder="Подробно опишите вашу проблему" maxLength={1000} />
        <span>{description.length}/1000</span>
        <div className="hint-box"><Sparkles size={21} />Чем подробнее вы опишите ситуацию, тем быстрее мы сможем помочь</div>
      </Card>
      <Card className="attach-card">
        <p>Прикрепить файлы</p>
        <label className="attach-drop">
          <input type="file" multiple onChange={(event) => { const selectedFiles = Array.from(event.target.files || []); setFiles(selectedFiles); setFileName(selectedFiles.map((file) => file.name).join(', ')); }} />
          <Paperclip size={30} />
          <span>
            <strong>{fileName || 'Нажмите чтобы прикрепить файл'}</strong>
            <small>Размер файла не более 10 МБ</small>
          </span>
        </label>
      </Card>
      {ticketError && <p className="inline-error">{ticketError}</p>}
      <PrimaryButton onClick={submitTicket}>{isSubmitting ? 'Создаем обращение' : 'Создать обращение'}</PrimaryButton>
    </AppFrame>
  );
}

function TicketThread({ navigate, activeScreen }) {
  const selectedTicket = useMemo(() => readSelectedTicket(), []);
  const [ticket, setTicket] = useState(null);
  const [threadError, setThreadError] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messageFiles, setMessageFiles] = useState([]);
  const [isSending, setSending] = useState(false);

  const loadTicket = async () => {
    if (!selectedTicket.id) {
      setThreadError('Обращение не выбрано');
      return;
    }

    try {
      setThreadError('');
      setTicket(await api.ticket(selectedTicket.id));
    } catch (error) {
      setThreadError(getUiError(error));
    }
  };

  useEffect(() => {
    loadTicket();
  }, [selectedTicket.id, selectedTicket.isAdmin]);

  const sendMessage = async () => {
    if (!messageText.trim() && !messageFiles.length) {
      setThreadError('Введите сообщение или прикрепите файл');
      return;
    }

    try {
      setSending(true);
      setThreadError('');
      await api.sendTicketMessage(selectedTicket.id, {
        text: messageText.trim(),
        files: messageFiles,
      });
      setMessageText('');
      setMessageFiles([]);
      await loadTicket();
    } catch (error) {
      setThreadError(getUiError(error));
    } finally {
      setSending(false);
    }
  };

  const [statusLabel, statusTone] = getTicketStatusMeta(ticket?.status);
  const messages = ticket?.messages || [];

  return (
    <AppFrame className="thread-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title={ticket?.subject || 'Обращение'} subtitle={<><span>{ticket?.id || selectedTicket.id || 'Не выбрано'}</span><Copy size={12} /></>} />
      {selectedTicket.isAdmin && <p className="admin-thread-note">Админ-режим: ответ уйдет от поддержки</p>}
      {threadError && <p className="inline-error">{threadError}</p>}
      <Card className="ticket-info">
        <InfoLine icon={Headphones} title="Статус" value={statusLabel} tone={statusTone === 'orange' ? 'orange' : statusTone === 'green' ? 'green' : ''} />
        <InfoLine icon={MoreVertical} title="Пользователь" value={ticket?.tg_id ? String(ticket.tg_id) : 'Недоступно'} />
        <InfoLine icon={CalendarDays} title="Обновлен" value={formatDateTime(ticket?.updated_at || ticket?.created_at)} />
      </Card>
      <div className="date-pill">{ticket?.created_at ? dateRu(ticket.created_at) : 'Нет данных'}</div>
      {!messages.length && <ThreadMarker>Переписка пока пуста</ThreadMarker>}
      {messages.map((message) => (
        <MessageBubble
          key={message.id || `${message.created_at}-${message.text}`}
          author={message.is_admin ? 'Поддержка' : `Пользователь ${message.tg_id || ticket?.tg_id || ''}`}
          time={formatDateTime(message.created_at)}
          text={message.text}
          files={message.files || []}
          support={message.is_admin}
        />
      ))}
      <div className="message-input">
        <label aria-label="Прикрепить файл">
          <input type="file" multiple onChange={(event) => setMessageFiles(Array.from(event.target.files || []))} />
          <Paperclip size={23} />
        </label>
        <input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder={messageFiles.length ? `${messageFiles.length} файл(а) выбрано` : 'Напишите сообщение...'} />
        <button onClick={sendMessage} aria-label="Отправить" disabled={isSending}><Send size={23} /></button>
      </div>
    </AppFrame>
  );
}

function InfoLine({ icon: Icon, title, value, tone }) {
  return (
    <div className="info-line">
      <IconTile tone="gray"><Icon size={18} /></IconTile>
      <strong>{title}</strong>
      <span className={tone || ''}>{value}</span>
    </div>
  );
}

function ThreadMarker({ children }) {
  return (
    <div className="thread-marker">
      <span />
      <p>{children}</p>
      <span />
    </div>
  );
}

function MessageBubble({ author, time, text, files = [], support }) {
  return (
    <div className={support ? 'message-bubble support' : 'message-bubble'}>
      <p><span>{author}</span> • {time}</p>
      <div>{text || 'Файл без текста'}</div>
      {files.map((file, index) => (
        <div className="attachment" key={`${file}-${index}`}>
          <Paperclip size={24} />
          <span><strong>{typeof file === 'string' ? file.split('/').pop() || `file-${index + 1}` : `file-${index + 1}`}</strong><small>{typeof file === 'string' ? file : 'Вложение'}</small></span>
        </div>
      ))}
    </div>
  );
}

function TariffLite({ navigate, activeScreen }) {
  return <TariffScreen selected="lite" navigate={navigate} activeScreen={activeScreen} />;
}

function TariffPlus({ navigate, activeScreen }) {
  return <TariffScreen selected="plus" navigate={navigate} activeScreen={activeScreen} />;
}

function TariffHome({ navigate, activeScreen }) {
  return <TariffScreen selected="home" navigate={navigate} activeScreen={activeScreen} />;
}

function TariffScreen({ selected, navigate, activeScreen }) {
  const tariff = tariffCatalog[selected] || tariffCatalog.plus;
  const [infoSheet, setInfoSheet] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('1');
  const [deviceCount, setDeviceCount] = useState(tariff.devices);
  const [selectedMethod, setSelectedMethod] = useState('card');
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoTotals, setPromoTotals] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const getBasePlanTotal = (period) => Math.floor(tariff.monthPrice * periodDiscounts[period]) * Number(period);
  const getDisplayedPlanTotal = (period) => promoApplied && Number.isFinite(promoTotals?.[period])
    ? promoTotals[period]
    : getBasePlanTotal(period);
  const periodMonths = Number(selectedPeriod);
  const planTotal = getDisplayedPlanTotal(selectedPeriod);
  const extraDevices = Math.max(0, deviceCount - tariff.devices);
  const extraDevicesTotal = extraDevices * devicePrice * periodMonths;
  const total = planTotal + extraDevicesTotal;
  const originalTotal = tariff.monthPrice * periodMonths + extraDevicesTotal;
  const savings = originalTotal - total;
  const maxDeviceCount = tariff.devices + tariff.extraDevices;
  const provider = selectedMethod === 'crypto' ? 'heleket' : 'platega';

  const applyPromo = async () => {
    if (promoApplied) {
      setPromoCode('');
      setPromoApplied(false);
      setPromoTotals(null);
      return;
    }

    const code = promoCode.trim();
    if (!code) {
      return;
    }

    try {
      setPromoLoading(true);
      setPaymentError('');
      const entries = await Promise.all(['1', '6', '12'].map(async (period) => {
        const response = await api.calculatePlan(selected, Number(period), code);
        const calculatedTotal = Number(response?.total);

        if (!Number.isFinite(calculatedTotal)) {
          throw new Error('Сервис не вернул цену с учетом промокода');
        }

        return [period, calculatedTotal];
      }));

      setPromoTotals(Object.fromEntries(entries));
      setPromoApplied(true);
    } catch (error) {
      setPromoTotals(null);
      setPromoApplied(false);
      setPaymentError(getPaymentUiError(error));
    } finally {
      setPromoLoading(false);
    }
  };

  const submitPromoWithEnter = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPromo();
      event.currentTarget.blur();
    }
  };

  useEffect(() => {
    setDeviceCount(tariff.devices);
  }, [selected]);

  const buySubscription = async () => {
    try {
      setPaymentError('');
      const url = await api.createInvoice({
        provider,
        type: 'SUBSCRIPTION',
        payload: {
          plan: selected,
          subscription_month: Number(selectedPeriod),
          hwid: deviceCount,
          currency: selectedMethod === 'crypto' ? 'USDT' : 'RUB',
          promo_code: promoApplied ? promoCode.trim() : undefined,
        },
      });
      openPaymentUrl(url);
    } catch (error) {
      setPaymentError(getPaymentUiError(error));
    }
  };

  return (
    <AppFrame className="tariff-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Подписка" />
      <PlansPair selected={selected} includeHome onSelect={(plan) => navigate(tariffCatalog[plan].route)} onHomeInfo={() => setInfoSheet('home')} onFlowInfo={() => setInfoSheet('flow')} />
      <SectionDivider>выберите подходящий срок</SectionDivider>
      <div className="periods">
        {['1', '6', '12'].map((period) => (
          <PeriodCard
            key={period}
            amount={period}
            unit={period === '1' ? 'месяц' : 'месяцев'}
            price={Math.round(getDisplayedPlanTotal(period) / Number(period))}
            discount={tariff.monthPrice * Number(period) - getDisplayedPlanTotal(period)}
            selected={selectedPeriod === period}
            onClick={() => setSelectedPeriod(period)}
          />
        ))}
      </div>
      <Card className="devices-counter">
        <div>
          <h2>Устройства</h2>
          <p>Включено в тариф: {tariff.devices} {pluralRu(tariff.devices, 'устройство', 'устройства', 'устройств')}</p>
          <span>+{money(devicePrice)} за дополнительное устройство</span>
        </div>
        <div className="stepper">
          <button disabled={deviceCount <= tariff.devices} onClick={() => setDeviceCount((value) => Math.max(tariff.devices, value - 1))} aria-label="Уменьшить количество устройств">
            <Minus size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <strong>{deviceCount}</strong>
          <button disabled={deviceCount >= maxDeviceCount} onClick={() => setDeviceCount((value) => Math.min(maxDeviceCount, value + 1))} aria-label="Увеличить количество устройств">
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </Card>
      <div className="payment-methods tariff-methods">
        <MethodCard title="Банковская карта" subtitle="Visa, Mastercard, Мир" checked={selectedMethod === 'card'} onClick={() => setSelectedMethod('card')} />
        <MethodCard title="Криптовалюта" subtitle="USDT" checked={selectedMethod === 'crypto'} onClick={() => setSelectedMethod('crypto')} />
      </div>
      <div className="promo">
        <p>{promoApplied ? 'Промокод применен' : 'Есть промокод?'}</p>
        <div>
          <input value={promoCode} onFocus={keepFocusedFieldVisible} onKeyDown={submitPromoWithEnter} onChange={(event) => { setPromoCode(event.target.value); setPromoApplied(false); setPromoTotals(null); }} placeholder="Введите промокод" enterKeyHint="done" />
          <button onClick={applyPromo} disabled={promoLoading || (!promoApplied && !promoCode.trim())}>{promoLoading ? 'Проверяем' : promoApplied ? 'Убрать' : 'Применить'}</button>
        </div>
      </div>
      <Card className="checkout-card">
        <div className="checkout-total">
          <div>
            <p>Итого к оплате</p>
            <strong>{money(total)}</strong>
          </div>
          {savings > 0 && (
            <div className="checkout-saving">
              <del>{money(originalTotal)}</del>
              <span>Экономия {money(savings)}</span>
            </div>
          )}
        </div>
        {paymentError && <p className="inline-error">{paymentError}</p>}
        <PrimaryButton className="checkout-submit" onClick={buySubscription}>Подключить за <span>{money(total)}</span></PrimaryButton>
        <small><Lock size={15} />Безопасная оплата. Отмена в любой момент</small>
      </Card>
      {infoSheet === 'flow' && <ImageInfoSheet src={asset('vora-flow-popup')} alt="Что такое VORA Flow" onClose={() => setInfoSheet('')} />}
      {infoSheet === 'home' && <ImageInfoSheet src={asset('vora-home-popup')} alt="Что такое VORA Home" onClose={() => setInfoSheet('')} />}
    </AppFrame>
  );
}

function PeriodCard({ amount, unit, price, discount, selected, onClick }) {
  return (
    <button className={selected ? 'period-card selected' : 'period-card'} onClick={onClick}>
      <h3>{amount} {unit}</h3>
      {discount > 0 ? <span>Экономия {money(discount)}</span> : <p>Стандартный тариф</p>}
      <div className="thin-line" />
      <div className="period-price">
        <strong>{price} ₽</strong>
        <small>/ мес</small>
      </div>
    </button>
  );
}

function ProfileScreen({ navigate, activeScreen, mainData, telegramUser }) {
  const displayName = getDisplayName(telegramUser);
  const devicesRoute = getDefaultHomeScreen(mainData);

  return (
    <AppFrame className="profile-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Профиль" subtitle="Аккаунт и настройки" action={<button className="square-action" onClick={() => navigate('balance-history')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <Card className="profile-card">
        <ProfileAvatar user={telegramUser} />
        <div>
          <h2>{displayName}</h2>
          <p>{telegramUser?.username ? `@${telegramUser.username}` : telegramUser?.id ? `VORA ID ${telegramUser.id}` : 'Откройте через Telegram'}</p>
        </div>
      </Card>
      <Card className="link-list">
        <ActionRow icon={Wallet} title="Баланс" subtitle="Пополнения и история платежей" onClick={() => navigate('balance-topup')} />
        <ActionRow icon={Monitor} title="Устройства" subtitle="Подключенные устройства" onClick={() => navigate(devicesRoute)} />
        <ActionRow icon={Headphones} title="Поддержка" subtitle="Обращения и помощь" onClick={() => navigate('support')} />
      </Card>
    </AppFrame>
  );
}

function ProfileAvatar({ user }) {
  const [imageFailed, setImageFailed] = useState(false);
  const photoUrl = user?.photo_url;

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl]);

  if (photoUrl && !imageFailed) {
    return (
      <div className="profile-avatar has-photo">
        <img src={photoUrl} alt="" onError={() => setImageFailed(true)} />
      </div>
    );
  }

  return <div className="profile-avatar"><UserGlyph size={30} /></div>;
}

function SecurityScreen({ navigate, activeScreen, mainData, telegramUser }) {
  const devicesRoute = getDefaultHomeScreen(mainData);

  return (
    <AppFrame className="security-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Безопасность" subtitle="Данные аккаунта и устройства" />
      <Card className="link-list">
        <ActionRow icon={Shield} title="Telegram авторизация" subtitle={telegramUser?.username ? `Подключен @${telegramUser.username}` : 'Откройте мини-приложение через Telegram'} onClick={() => navigate('profile')} />
        <ActionRow icon={Monitor} title="Устройства" subtitle="Посмотреть подключенные устройства" onClick={() => navigate(devicesRoute)} />
        <ActionRow icon={Headphones} title="Нужна помощь?" subtitle="Написать в поддержку" onClick={() => navigate('support')} />
      </Card>
    </AppFrame>
  );
}

createRoot(document.getElementById('root')).render(<App />);
