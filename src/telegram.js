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
    user: webApp.initDataUnsafe?.user || null,
    initData: webApp.initData || '',
  };
}

export function getDisplayName(user) {
  if (!user) {
    return 'Имя';
  }

  return user.first_name || user.username || 'Имя';
}
