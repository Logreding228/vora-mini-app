export function initTelegramApp() {
  const webApp = window.Telegram?.WebApp;

  if (!webApp) {
    return {
      webApp: null,
      user: null,
      initData: '',
    };
  }

  webApp.ready();
  webApp.expand();

  return {
    webApp,
    user: webApp.initDataUnsafe?.user || getUserFromInitData(webApp.initData) || null,
    initData: webApp.initData || '',
  };
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
