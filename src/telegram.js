export function initTelegramApp() {
  const webApp = window.Telegram?.WebApp;
  const initDataFromUrl = getInitDataFromUrl();

  if (!webApp) {
    return {
      webApp: null,
      user: getUserFromInitData(initDataFromUrl),
      initData: initDataFromUrl,
    };
  }

  webApp.ready();
  webApp.expand();
  syncSafeArea(webApp);

  const initData = webApp.initData || initDataFromUrl;

  return {
    webApp,
    user: webApp.initDataUnsafe?.user || getUserFromInitData(initData) || null,
    initData,
  };
}

function syncSafeArea(webApp) {
  const applySafeArea = () => {
    const safeTop = normalizeInset(webApp.safeAreaInset?.top);
    const contentTop = normalizeInset(webApp.contentSafeAreaInset?.top);
    const activeTop = webApp.isFullscreen ? Math.max(safeTop, contentTop) : 0;

    setSafeAreaVariable('--tg-safe-area-top', safeTop);
    setSafeAreaVariable('--tg-content-safe-area-top', contentTop);
    setSafeAreaVariable('--tg-active-safe-area-top', activeTop);
  };

  applySafeArea();
  webApp.onEvent?.('safeAreaChanged', applySafeArea);
  webApp.onEvent?.('contentSafeAreaChanged', applySafeArea);
  webApp.onEvent?.('fullscreenChanged', applySafeArea);
  window.addEventListener('resize', applySafeArea);
}

function setSafeAreaVariable(name, value) {
  document.documentElement.style.setProperty(name, `${normalizeInset(value)}px`);
}

function normalizeInset(value) {
  const numberValue = Number(value || 0);
  return Math.max(0, numberValue);
}

function getInitDataFromUrl() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const search = window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search;

  return getRawParam(hash, 'tgWebAppData') || getRawParam(search, 'tgWebAppData') || getRawParam(search, 'initData') || '';
}

function getRawParam(source, name) {
  if (!source) {
    return '';
  }

  const prefix = `${name}=`;
  const part = source.split('&').find((item) => item.startsWith(prefix));

  if (!part) {
    return '';
  }

  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return part.slice(prefix.length);
  }
}

function getUserFromInitData(initData) {
  if (!initData) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const user = params.get('user');

    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}

export function getDisplayName(user) {
  if (!user) {
    return 'Имя';
  }

  return user.first_name || user.username || 'Имя';
}
