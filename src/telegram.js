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
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(search);

  return hashParams.get('tgWebAppData') || searchParams.get('tgWebAppData') || searchParams.get('initData') || '';
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
