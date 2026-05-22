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

  const initData = webApp.initData || initDataFromUrl;

  return {
    webApp,
    user: webApp.initDataUnsafe?.user || getUserFromInitData(initData) || null,
    initData,
  };
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
