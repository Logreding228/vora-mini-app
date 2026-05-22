import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
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
  X,
} from 'lucide-react';
import { api, ApiError, authenticateTelegram } from './api.js';
import { getDisplayName, initTelegramApp } from './telegram.js';
import './styles.css';

const asset = (name) => `${import.meta.env.BASE_URL}assets/${name}.png`;
const money = (value, fallback = '0') => `${Number(value ?? fallback).toLocaleString('ru-RU')} ₽`;
const dateRu = (value, fallback = '20.04.2026') => {
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
const openPaymentUrl = (url) => {
  if (typeof url === 'string' && url) {
    window.location.href = url;
  }
};
const mapClient = (connection) => (connection === 'v2RayTun' ? 'v2' : 'happ');
const normalizeDeviceKind = (value) => {
  const name = String(value || '').toLowerCase();

  if (name.includes('android')) {
    return name.includes('tv') ? 'androidtv' : 'android';
  }

  if (name.includes('mac') || name.includes('ios') || name.includes('apple') || name.includes('tvos')) {
    return 'apple';
  }

  if (name.includes('win')) {
    return 'windows';
  }

  return name || 'windows';
};
const emptyMainData = {
  status: 'active',
  balance: '0.00',
  ref_balance: '0.00',
  expired_at: '',
  plan: 'lite',
  subscription_month: 1,
  hwid: {
    used: 0,
    limit: 2,
    devices: [],
  },
};

function normalizeMainData(data = emptyMainData) {
  const hwid = data.hwid || {};
  const hwidResponse = hwid.response || {};
  const rawDevices = Array.isArray(hwid.devices) ? hwid.devices : Array.isArray(hwidResponse.devices) ? hwidResponse.devices : Array.isArray(hwid) ? hwid : [];
  const devices = rawDevices.length ? rawDevices.map((device, index) => ({
    id: device.hwid || device.id || device.uuid || `device-${index}`,
    kind: normalizeDeviceKind(device.kind || device.os || device.platform || device.type || 'windows'),
    title: device.title || device.name || device.os || device.platform || 'Устройство',
    model: device.model || device.device_name || device.name || device.hwid || 'Unknown',
    lastSeen: device.last_seen || device.updated_at || device.online_at || '',
  })) : [];

  return {
    status: data.status || 'active',
    balance: data.balance ?? emptyMainData.balance,
    refBalance: data.ref_balance ?? emptyMainData.ref_balance,
    expiredAt: data.expired_at || emptyMainData.expired_at,
    plan: String(data.plan || data.tariff || emptyMainData.plan).toLowerCase(),
    subscriptionMonth: data.subscription_month || data.last_subscription_month || 1,
    usedDevices: Number(hwid.used ?? hwid.current ?? hwid.count ?? hwidResponse.total ?? devices.length ?? 0),
    maxDevices: Number(hwid.limit ?? hwid.max ?? hwid.total ?? hwidResponse.limit ?? Math.max(2, devices.length)),
    devices,
  };
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
  { id: 'support', label: 'Поддержка', component: SupportScreen },
  { id: 'tickets', label: 'Обращения', component: TicketsScreen },
  { id: 'ticket-create', label: 'Создать обращение', component: CreateTicket },
  { id: 'ticket-thread', label: 'Переписка', component: TicketThread },
  { id: 'tariff-lite', label: 'Тариф Lite', component: TariffLite },
  { id: 'tariff-plus', label: 'Тариф Plus', component: TariffPlus },
  { id: 'profile', label: 'Профиль', component: ProfileScreen },
];

function App() {
  const [activeScreen, setActiveScreen] = useState(() => window.location.hash.slice(1) || 'home-active');
  const [telegramUser, setTelegramUser] = useState(null);
  const [mainData, setMainData] = useState(() => normalizeMainData(emptyMainData));
  const [apiNotice, setApiNotice] = useState('');
  const screen = useMemo(() => screens.find((item) => item.id === activeScreen) || screens[0], [activeScreen]);
  const Screen = screen.component;

  useEffect(() => {
    const syncScreen = () => {
      setActiveScreen(window.location.hash.slice(1) || 'home-active');
    };

    window.addEventListener('hashchange', syncScreen);
    return () => window.removeEventListener('hashchange', syncScreen);
  }, []);

  useEffect(() => {
    const telegram = initTelegramApp();
    setTelegramUser(telegram.user);

    const loadData = async () => {
      try {
        await authenticateTelegram(telegram.initData);
        const data = await api.mainScreen();
        setMainData(normalizeMainData(data));
        setApiNotice('');
      } catch (error) {
        setApiNotice(error instanceof ApiError ? error.message : 'Откройте приложение через Telegram');
      }
    };

    loadData();
  }, []);

  const navigate = (id) => {
    setActiveScreen(id);
    window.history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="workspace">
      <main className="phone">
        <div className="page-transition" key={activeScreen}>
          <Screen navigate={navigate} activeScreen={activeScreen} mainData={mainData} telegramUser={telegramUser} apiNotice={apiNotice} />
        </div>
        <BottomNav navigate={navigate} activeScreen={activeScreen} />
      </main>
    </div>
  );
}

function AppFrame({ children, className = '', navigate, activeScreen }) {
  return (
    <div className={`screen ${className}`}>
      <AppHeader navigate={navigate} activeScreen={activeScreen} />
      <div className="content">{children}</div>
    </div>
  );
}

function AppHeader({ navigate, activeScreen }) {
  const canClose = activeScreen && activeScreen !== 'home-active';

  return (
    <header className="app-header">
      <Logo />
      {canClose && (
        <button className="close-screen" onClick={() => navigate('home-active')} aria-label="Закрыть">
          <X size={22} />
        </button>
      )}
    </header>
  );
}

function Logo() {
  return (
    <div className="brand">
      <div className="brand-name">VORA</div>
      <div className="brand-subtitle">SANITY IN THE DIGITAL CHAOS</div>
    </div>
  );
}

function BottomNav({ navigate, activeScreen }) {
  const navRef = useRef(null);
  const itemRefs = useRef([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, transform: 'translate3d(0, 0, 0)' });

  const activeSectionByScreen = {
    'home-active': 'home',
    'home-popup': 'home',
    'trial-start': 'subscription',
    'trial-active': 'subscription',
    'trial-expired': 'subscription',
    'change-plan': 'subscription',
    'tariff-lite': 'subscription',
    'tariff-plus': 'subscription',
    'balance-topup': 'bonus',
    'balance-history': 'bonus',
    support: 'support',
    tickets: 'support',
    'ticket-create': 'support',
    'ticket-thread': 'support',
    profile: 'profile',
  };

  const nav = [
    { icon: Home, label: 'Главная', route: 'home-active', section: 'home' },
    { icon: BookOpen, label: 'Подписка', route: 'tariff-plus', section: 'subscription' },
    { icon: Users, label: 'Бонусы', route: 'balance-history', section: 'bonus' },
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

  return (
    <nav className="bottom-nav" ref={navRef}>
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

function IconTile({ children, tone = 'orange', className = '' }) {
  return <span className={`icon-tile ${tone} ${className}`}>{children}</span>;
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

function PlanCard({ name, description, devices, extra, price, selected, popular, current, onClick }) {
  return (
    <button className={`plan-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="plan-heading">
        <h3>{name}</h3>
        {popular && <span className="popular"><Sparkles size={12} />Популярный</span>}
        {current && <span className="current-pill">Текущий</span>}
      </div>
      <p className="plan-description">{description}</p>
      <div className="plan-devices">
        <Monitor size={28} />
        <div>
          <strong>{devices}</strong>
          <span>{extra}</span>
        </div>
      </div>
      <div className="thin-line" />
      <div className="plan-price">
        <strong>{price}</strong>
        <span>/ мес</span>
      </div>
    </button>
  );
}

function PlansPair({ currentLite = false, selected = 'plus', onSelect }) {
  return (
    <div className="plans-pair">
      <PlanCard
        name="Lite"
        description="Для привычных зарубежных сервисов"
        devices="1 устройство"
        extra="+ еще 2"
        price="300 ₽"
        selected={selected === 'lite'}
        current={currentLite}
        onClick={() => onSelect?.('lite')}
      />
      <PlanCard
        name="Plus"
        description={<><span className="link-text">VORA Flow</span> — для привычных сервисов без лишних действий</>}
        devices="3 устройства"
        extra="+ еще 3"
        price="550 ₽"
        selected={selected === 'plus'}
        popular
        onClick={() => onSelect?.('plus')}
      />
    </div>
  );
}

function FeatureList() {
  const items = [
    [Sparkles, 'VORA Flow для привычных сервисов', 'soft-orange'],
    [Monitor, '3 устройства одновременно', 'soft-green'],
    [Users, 'Работает без лишних действий', 'soft-peach'],
    [Users, 'Поддержка всех устройств', 'soft-peach'],
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
  const startTrial = async () => {
    try {
      const url = await api.createTrialInvoice({ provider: 'platega' });
      openPaymentUrl(url);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : 'Не удалось создать платеж');
    }
  };

  return (
    <AppFrame className="trial-screen" navigate={navigate} activeScreen={activeScreen}>
      <HeroOffer
        title="Попробуйте VORA"
        accent="24 часа за 30₽"
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
      <PrimaryButton onClick={startTrial}>Начать за 30 ₽</PrimaryButton>
      <SectionDivider>или оформите подписку сразу</SectionDivider>
      <PlansPair selected="plus" onSelect={(plan) => navigate(plan === 'lite' ? 'tariff-lite' : 'tariff-plus')} />
      <PrimaryButton className="outline-fill" onClick={() => navigate('tariff-plus')}>Подключить за&nbsp; 550 ₽</PrimaryButton>
    </AppFrame>
  );
}

function TrialActive({ navigate, activeScreen }) {
  return (
    <AppFrame className="trial-screen compact" navigate={navigate} activeScreen={activeScreen}>
      <HeroOffer
        title="Доступ активен"
        accent="24 часа за 30₽"
        subtitle="Полный доступ ко всем возможностям тарифа"
        image="trial-clock"
      />
      <Card className="timer-card">
        <p>Осталось времени</p>
        <strong>18:36:<span>45</span></strong>
        <div className="timer-labels">
          <span>Часов</span>
          <span>Минут</span>
          <span>Секунд</span>
        </div>
        <div className="progress"><i /></div>
      </Card>
      <SectionDivider>доступные тарифы</SectionDivider>
      <PlansPair selected="plus" onSelect={(plan) => navigate(plan === 'lite' ? 'tariff-lite' : 'tariff-plus')} />
      <PrimaryButton className="outline-fill" onClick={() => navigate('tariff-plus')}>Подключить за&nbsp; 550 ₽</PrimaryButton>
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
      <PlansPair selected="plus" onSelect={(plan) => navigate(plan === 'lite' ? 'tariff-lite' : 'tariff-plus')} />
      <PrimaryButton onClick={() => navigate('tariff-plus')}>Купить за&nbsp; 550 ₽</PrimaryButton>
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

  return (
    <AppFrame className="home-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title={`Привет, ${displayName}!`} subtitle={apiNotice} action={<button className="square-action" onClick={() => navigate('tickets')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <SubscriptionSummary navigate={navigate} mainData={mainData} />
      <Card className="link-list">
        <ActionRow icon={SlidersHorizontal} title="Управление тарифом" subtitle="Сменить тариф или период" onClick={() => navigate('change-plan')} />
        <ActionRow icon={CircleHelp} title="Вопросы и ответы" subtitle="Инструкции и частые вопросы" onClick={() => navigate('support')} />
        <ActionRow icon={Sparkles} title="Не работает нужный сервис?" subtitle={<><span>Добавьте его в </span><span className="link-text">VORA Flow</span></>} onClick={() => navigate('support')} />
      </Card>
      <DevicesCard mainData={mainData} />
    </AppFrame>
  );
}

function HomePopup({ navigate, activeScreen, mainData, telegramUser }) {
  const displayName = getDisplayName(telegramUser);

  return (
    <AppFrame className="home-screen has-sheet" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title={`Привет, ${displayName}!`} action={<button className="square-action" onClick={() => navigate('tickets')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <SubscriptionSummary muted navigate={navigate} mainData={mainData} />
      <DeviceSheet navigate={navigate} />
    </AppFrame>
  );
}

function SubscriptionSummary({ muted: sheetMuted = false, navigate, mainData }) {
  const planName = mainData.plan === 'plus' ? 'Plus' : 'Lite';
  const progress = Math.min(100, Math.max(0, (mainData.usedDevices / mainData.maxDevices) * 100));

  return (
    <Card className={`subscription-card ${sheetMuted ? 'under-sheet' : ''}`}>
      <div>
        <span className="status-pill green"><i />Активен</span>
        <h2>{planName}</h2>
        <p>Подписка на {mainData.subscriptionMonth} месяц</p>
      </div>
      <img src={asset('shield-small')} alt="" />
      <div className="metrics">
        <div className="metric-card">
          <IconTile tone="plain"><Monitor size={22} /></IconTile>
          <div className="metric-content">
            <span>Устройства</span>
            <strong>{mainData.usedDevices} из {mainData.maxDevices}</strong>
            <div className="mini-progress"><i style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
        <div className="metric-card">
          <span>Следующие списание</span>
          <strong>{dateRu(mainData.expiredAt)}</strong>
        </div>
      </div>
      <PrimaryButton onClick={() => navigate('home-popup')}>Добавить устройство</PrimaryButton>
      <div className="balance-strip">
        <BalanceMini title="Основной баланс" value={money(mainData.balance)} tone="green" onClick={() => navigate('balance-topup')} />
        <BalanceMini title="Реферальный баланс" value={money(mainData.refBalance)} tone="orange" onClick={() => navigate('balance-history')} />
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

  useEffect(() => {
    setDevices(mainData.devices);
  }, [mainData.devices]);

  const deleteDevice = async (id) => {
    try {
      setDeviceError('');
      await api.deleteDevice(id);
      setDevices((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      setDeviceError(error.message);
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
      {expanded && (
        <div className="device-list">
          {deviceError && <p className="inline-error">{deviceError}</p>}
          {devices.map(({ id, kind, title, model, lastSeen }) => (
            <div className="device-row" key={id}>
              <span className={`platform ${kind}`}><PlatformIcon type={kind} /></span>
              <div>
                <strong>{title}</strong>
                <span>•</span>
                <p>{model}</p>
                <small>Онлайн • {formatDateTime(lastSeen)}</small>
              </div>
              <button className="delete-device" onClick={() => deleteDevice(id)} aria-label={`Удалить ${title}`}>
                <Trash2 size={24} />
              </button>
            </div>
          ))}
          {devices.length === 0 && <p className="empty-state">Устройства не подключены</p>}
        </div>
      )}
    </Card>
  );
}

function DeviceSheet({ navigate }) {
  const [selectedSystem, setSelectedSystem] = useState('iOS');
  const [selectedConnection, setSelectedConnection] = useState('Happ');
  const [systemsExpanded, setSystemsExpanded] = useState(true);
  const [qrImage, setQrImage] = useState('');
  const [connectError, setConnectError] = useState('');
  const systems = [
    ['iOS', 'apple'],
    ['Android', 'android'],
    ['Windows', 'windows'],
    ['MacOS', 'apple'],
    ['AndroidTV', 'androidtv'],
    ['tvOS', 'apple'],
  ];
  const visibleSystems = systemsExpanded ? systems : systems.slice(0, 3);
  const client = mapClient(selectedConnection);

  const connectDevice = async () => {
    try {
      setConnectError('');
      const url = await api.subscriptionUrl(client);
      openPaymentUrl(url);
    } catch (error) {
      setConnectError(error.message);
    }
  };

  const showQr = async () => {
    try {
      setConnectError('');
      const url = await api.subscriptionQr(client);
      setQrImage(await QRCode.toDataURL(url));
    } catch (error) {
      setConnectError(error.message);
    }
  };

  return (
    <div className="modal-layer">
      <div className="bottom-sheet">
        <span className="sheet-grip" />
        <button className="sheet-close" onClick={() => navigate('home-active')} aria-label="Закрыть">
          <X size={22} />
        </button>
        <h2>Подключить новое устройство</h2>
        <StepTitle number="1" title="Операционная система" />
        <Card className="option-list">
          {visibleSystems.map(([name, icon]) => (
            <RadioRow key={name} title={name} checked={selectedSystem === name} icon={icon} onClick={() => setSelectedSystem(name)} />
          ))}
          <button className="collapse-button" onClick={() => setSystemsExpanded((value) => !value)}>
            {systemsExpanded ? 'Свернуть' : 'Показать все'} {systemsExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </Card>
        <StepTitle number="2" title="Способ подключения" />
        <Card className="option-list">
          <RadioRow title="Рекомендуемый - Happ" subtitle="Простая настройка в один клик" checked={selectedConnection === 'Happ'} icon="happ" onClick={() => setSelectedConnection('Happ')} />
          <RadioRow title="v2RayTun" subtitle="Ручная настройка" checked={selectedConnection === 'v2RayTun'} icon="v2ray" onClick={() => setSelectedConnection('v2RayTun')} />
        </Card>
        {connectError && <p className="inline-error">{connectError}</p>}
        {qrImage && <img className="qr-preview" src={qrImage} alt="QR-код подключения" />}
        <ActionRow icon={CircleHelp} title="Нужна помощь?" subtitle="Краткая инструкция здесь" onClick={() => navigate('support')} />
        <PrimaryButton onClick={connectDevice}>Подключить</PrimaryButton>
        <SectionDivider>или</SectionDivider>
        <ActionRow icon={QrCode} title="Подключить на другом устройстве" subtitle="Отсканируйте QR-код камерой устройства" onClick={showQr} />
      </div>
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
    return (
      <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h7.1v6.4H4V5Zm8.9 0H20v6.4h-7.1V5ZM4 12.9h7.1V19H4v-6.1Zm8.9 0H20V19h-7.1v-6.1Z" />
      </svg>
    );
  }

  if (type === 'android' || type === 'androidtv') {
    return (
      <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.3 7.4 7 5.5l.9-.6 1.4 2.1a7.5 7.5 0 0 1 5.4 0l1.4-2.1.9.6-1.3 1.9A5.9 5.9 0 0 1 18.3 12H5.7a5.9 5.9 0 0 1 2.6-4.6ZM9 10a.8.8 0 1 0 0-1.6A.8.8 0 0 0 9 10Zm6 0a.8.8 0 1 0 0-1.6A.8.8 0 0 0 15 10ZM6.2 13.2h11.6v5.1a1.9 1.9 0 0 1-1.9 1.9H8.1a1.9 1.9 0 0 1-1.9-1.9v-5.1Zm-2.2.2h1.2v5.1H4v-5.1Zm14.8 0H20v5.1h-1.2v-5.1Z" />
      </svg>
    );
  }

  if (type === 'apple') {
    return (
      <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.9 3.1c.1 1.3-.4 2.4-1.2 3.2-.8.8-1.9 1.4-3 1.3-.1-1.2.5-2.3 1.2-3.1.8-.8 2-1.4 3-1.4ZM18.5 16.4c-.5 1.2-.8 1.8-1.5 2.8-1 1.5-2.4 3.2-4.1 3.2-1.5 0-1.8-1-3.8-1s-2.4.9-3.9 1c-1.7.1-3-1.6-4-3-2.7-4-3-8.8-1.3-11.3 1.2-1.8 3-2.8 4.7-2.8s2.8 1 4.3 1c1.4 0 2.3-1 4.3-1 1.5 0 3.1.8 4.3 2.2-3.8 2.1-3.1 7.5 1 8.9Z" />
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

function ChangePlan({ navigate, activeScreen }) {
  const [upgradeAmount, setUpgradeAmount] = useState('0');
  const [changeError, setChangeError] = useState('');

  useEffect(() => {
    const loadUpgradePrice = async () => {
      try {
        const response = await api.upgradePrice();
        setUpgradeAmount(response?.amount || response || '0');
      } catch (error) {
        setChangeError(error.message);
      }
    };

    loadUpgradePrice();
  }, []);

  const upgradePlan = async () => {
    try {
      setChangeError('');
      const url = await api.createUpgradeInvoice({ provider: 'platega' });
      openPaymentUrl(url);
    } catch (error) {
      setChangeError(error.message);
    }
  };

  const downgradePlan = async () => {
    try {
      setChangeError('');
      await api.downgradePlan();
      navigate('home-active');
    } catch (error) {
      setChangeError(error.message);
    }
  };

  return (
    <AppFrame className="change-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Смена тарифа" />
      <PlansPair selected="plus" currentLite onSelect={(plan) => navigate(plan === 'lite' ? 'tariff-lite' : 'tariff-plus')} />
      <SectionDivider>все тарифы для стран с самым высоким уровнем цензуры</SectionDivider>
      <Card className="change-card">
        <span className="status-pill green">Апгрейд</span>
        <h2>Вы переходите на <span>Plus</span></h2>
        <ChangeRow title="Цена" from="300 ₽" to="550 ₽" />
        <ChangeRow title="Устройства" from="1" to="3" />
        <p className="limit-text">Можно докупить до 6 устройств</p>
        <div className="thin-line" />
        <h3>Расчет платежа</h3>
        <SummaryLine label="Осталось по текущему тарифу" value="20 дней" />
        <SummaryLine label="Стоимость в месяц" value="550 ₽" />
        <SummaryLine label="С учетом остатка (20 дней)" value={`~${money(upgradeAmount)}`} />
      </Card>
      <Card className="payment-balance">
        <IconTile><Wallet size={25} /></IconTile>
        <div>
          <p>Баланс</p>
          <strong>{money(upgradeAmount)}</strong>
          <span>Выберите, чтобы списать с баланса</span>
        </div>
        <span className="radio checked" />
      </Card>
      <Card className="pay-today">
        <div>
          <h2>К оплате сегодня</h2>
          <p>С учётом баланса</p>
        </div>
        <strong>{money(upgradeAmount)}</strong>
        {changeError && <p className="inline-error">{changeError}</p>}
        <PrimaryButton onClick={upgradePlan}>Перейти на Plus&nbsp; {money(upgradeAmount)}</PrimaryButton>
      </Card>
      <Card className="change-card downgrade">
        <span className="status-pill purple">Даунгрейд</span>
        <h2>Вы переходите на <span>Lite</span></h2>
        <div className="notice-box">
          <CalendarDays size={24} />
          <div>
            <p>Смена тарифа будет запланирована</p>
            <strong>20.04.2026</strong>
            <span>До этой даты у вас останется тариф Plus со всеми его преимуществами.а</span>
          </div>
        </div>
        <ChangeRow title="Цена" from="550 ₽" to="300 ₽" />
        <ChangeRow title="Устройства" from="3" to="1" />
        <p className="limit-text">Можно докупить до 3 устройств</p>
        <button className="secondary-button purple" onClick={downgradePlan}>Запланировать переход на Lite</button>
      </Card>
    </AppFrame>
  );
}

function ChangeRow({ title, from, to }) {
  return (
    <div className="change-row">
      <span>{title}</span>
      <strong>{from}</strong>
      <ArrowRight size={24} />
      <strong>{to}</strong>
    </div>
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
  const [selectedCurrency, setSelectedCurrency] = useState('USDT');
  const [customAmount, setCustomAmount] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const paymentAmount = selectedPayment === 'device' ? '75 ₽' : selectedPayment === 'lite' ? '300 ₽' : '550 ₽';
  const provider = selectedMethod === 'crypto' ? 'heleket' : 'platega';
  const paymentType = selectedPayment === 'device' ? 'HWID' : selectedPayment === 'balance' ? 'BALANCE' : 'SUBSCRIPTION';

  const createPayment = async () => {
    const payload = paymentType === 'BALANCE'
      ? { amount: Number(customAmount || 0), currency: selectedMethod === 'crypto' ? selectedCurrency : 'RUB' }
      : paymentType === 'HWID'
        ? { hwid: 2, currency: selectedMethod === 'crypto' ? selectedCurrency : 'RUB' }
        : {
            plan: selectedPayment,
            subscription_month: 1,
            hwid: selectedPayment === 'plus' ? 3 : 1,
            currency: selectedMethod === 'crypto' ? selectedCurrency : 'RUB',
          };

    try {
      setPaymentError('');
      const url = await api.createInvoice({ provider, type: paymentType, payload });
      openPaymentUrl(url);
    } catch (error) {
      setPaymentError(error.message);
    }
  };

  return (
    <AppFrame className="balance-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Баланс" action={<button className="history-button" onClick={() => navigate('balance-history')}>История</button>} />
      <Card className="balance-hero">
        <div>
          <p>Основной баланс</p>
          <strong>{Number(mainData.balance || 0).toLocaleString('ru-RU')}<span>₽</span></strong>
        </div>
        <img src={asset('wallet')} alt="" />
        <ChevronRight size={28} />
      </Card>
      <Card className="payment-card">
        <h2>Выберите, что хотите оплатить</h2>
        <PaymentOption icon={Plus} title="Докупить устройство" subtitle="Активация 1 устройства" price="75 ₽" checked={selectedPayment === 'device'} onClick={() => setSelectedPayment('device')} />
        <PaymentOption title="Lite - 1 месяц" subtitle="Базовые возможности" price="300 ₽" feather checked={selectedPayment === 'lite'} onClick={() => setSelectedPayment('lite')} />
        <PaymentOption title="Plus - 1 месяц" subtitle="Максимум возможностей" price="550 ₽" feather checked={selectedPayment === 'plus'} onClick={() => setSelectedPayment('plus')} />
        <SectionDivider>или ввести сумму вручную</SectionDivider>
        <div className={selectedPayment === 'balance' ? 'input-box selected' : 'input-box'} onClick={() => setSelectedPayment('balance')}>
          <span>Сумма попленения</span>
          <input value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} placeholder="Введите сумму" inputMode="decimal" />
          <p>₽</p>
        </div>
      </Card>
      <div className="payment-methods">
        <MethodCard title="Банковская карта" subtitle="Visa, Mastercard, Мир" checked={selectedMethod === 'card'} onClick={() => setSelectedMethod('card')} />
        <MethodCard title="Криптовалюта" subtitle="USDT, BTC, ETH и др." checked={selectedMethod === 'crypto'} onClick={() => setSelectedMethod('crypto')} />
      </div>
      {selectedMethod === 'crypto' && (
        <div className="segmented-control compact">
          {['USDT', 'TON'].map((currency) => (
            <button key={currency} className={selectedCurrency === currency ? 'active' : ''} onClick={() => setSelectedCurrency(currency)}>{currency}</button>
          ))}
        </div>
      )}
      <div className="promo">
        <p>{promoApplied ? 'Промокод применен' : 'Есть промокод?'}</p>
        <div>
          <input placeholder="Введите промокод" />
          <button onClick={() => setPromoApplied((value) => !value)}>{promoApplied ? 'Убрать' : 'Применить'}</button>
        </div>
      </div>
      {paymentError && <p className="inline-error">{paymentError}</p>}
      <PrimaryButton onClick={createPayment}>Оплатить {selectedPayment === 'balance' && customAmount ? `${customAmount} ₽` : paymentAmount}</PrimaryButton>
    </AppFrame>
  );
}

function PaymentOption({ icon: Icon, title, subtitle, price, checked, feather, onClick }) {
  return (
    <button className={checked ? 'payment-option checked' : 'payment-option'} onClick={onClick}>
      <IconTile tone={feather ? 'feather' : 'solid'}>{Icon ? <Icon size={25} /> : <span className="feather-mark" />}</IconTile>
      <div>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>
      <b>{price}</b>
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
      try {
        const type = selectedType === 'income' ? 'replenishment' : 'payments';
        setHistory(await api.history(type));
        setHistoryError('');
      } catch (error) {
        setHistoryError(error.message);
      }
    };

    loadHistory();
  }, [selectedType]);

  const transactions = (history.payments || []).map((item, index) => [
    selectedType === 'income' ? 'Пополнение баланса' : 'Оплата VORA',
    formatDateTime(item.data),
    `${selectedType === 'income' ? '+' : '-'}${money(item.amount)}`,
    selectedType === 'income' ? 'wallet' : 'feather',
    item.status || 'paid',
    index,
  ]);

  return (
    <AppFrame className="history-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="История баланса" subtitle="Все ваши транзакции" action={<button className="square-action" onClick={() => navigate('tickets')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <div className="segmented-control">
        <button className={selectedType === 'income' ? 'active' : ''} onClick={() => setSelectedType('income')}><ArrowDown size={22} />Пополнения</button>
        <button className={selectedType === 'outcome' ? 'active' : ''} onClick={() => setSelectedType('outcome')}><ArrowUp size={22} />Списания</button>
      </div>
      {historyError && <p className="inline-error">{historyError}</p>}
      {transactions.map(([title, date, amount, type, status, index]) => (
        <Card className="transaction-card" key={`${title}-${index}`}>
          <IconTile tone={type === 'wallet' ? 'soft-green' : 'feather'}>{type === 'wallet' ? <Wallet size={24} /> : <span className="feather-mark" />}</IconTile>
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
      {!transactions.length && !historyError && <p className="empty-state">Операций пока нет</p>}
      <h2 className="muted-heading">Сводка</h2>
      <Card className="stats-card">
        <Stat icon={Wallet} label="Всего потрачено" value={money(history.sum_pay)} />
        <Stat icon={ArrowLeftRight} label="Всего транзакций" value={String(history.sym_trac ?? transactions.length)} />
      </Card>
      <Card className="help-card">
        <IconTile><Headphones size={28} /></IconTile>
        <div>
          <h3>Нужна помощь?</h3>
          <p>Напишите нам, мы всегда на связи</p>
        </div>
        <button onClick={() => navigate('tickets')}>Написать</button>
      </Card>
    </AppFrame>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <Icon size={25} />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function SupportScreen({ navigate, activeScreen }) {
  const quick = [
    [AlertTriangle, 'VPN не работает - что делать?', 'Решение за 2 минуты', 'soft-orange'],
    [Download, 'Почему не скачивается приложение?', 'Доступ и установка', 'soft-blue'],
    [Link, 'Как подключить устройство?', 'Пошаговая инструкция', 'soft-green'],
  ];
  const topics = [
    [Settings, 'Подключение и настройка', 'soft-blue'],
    [Link, 'Подписка и оплата', 'soft-green'],
    [Monitor, 'Устройства', 'soft-green'],
    [Users, 'Реферальная программа', 'soft-peach'],
    [Shield, 'Безопасность и конфиденциальность', 'soft-blue'],
    [Menu, 'Прочее', 'soft-blue'],
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
        <div className="topic-header"><h2>Все темы</h2><span>Свернуть <ChevronUp size={20} /></span></div>
        {topics.map(([Icon, title, tone]) => <TopicRow key={title} icon={Icon} title={title} tone={tone} onClick={() => navigate('tickets')} />)}
      </Card>
      <Card className="help-card">
        <IconTile><Headphones size={28} /></IconTile>
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

function TicketsScreen({ navigate, activeScreen }) {
  const [selectedTab, setSelectedTab] = useState('Все');
  const tickets = [];

  return (
    <AppFrame className="tickets-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Обращения" subtitle="Круглосуточно" />
      <div className="ticket-tabs">
        {[
          ['Все', '0'],
          ['Новый', '0'],
          ['В работе', '0'],
          ['Ждем вас', '0'],
        ].map(([label, count]) => (
          <button key={label} className={selectedTab === label ? 'active' : ''} onClick={() => setSelectedTab(label)}>{label} <span>{count}</span></button>
        ))}
      </div>
      {tickets.map(([title, id, status, time, tone]) => (
        <button className="ticket-card" key={`${status}-${time}`} onClick={() => navigate('ticket-thread')}>
          <div>
            <strong>{title}</strong>
            <p>{id}</p>
          </div>
          <div>
            <span className={`ticket-status ${tone}`}>{status}</span>
            <p>{time}</p>
          </div>
        </button>
      ))}
      <p className="empty-state">API обращений пока не описан на бэкенде</p>
      <PrimaryButton onClick={() => navigate('ticket-create')}>Новое обращение</PrimaryButton>
    </AppFrame>
  );
}

function CreateTicket({ navigate, activeScreen }) {
  return (
    <AppFrame className="create-ticket" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Создать обращение" subtitle="На бэкенде пока нет API для создания обращений" />
      <Card className="field-card">
        <label>Тема обращения</label>
        <p>Кратко опишите проблему</p>
        <span>0/100</span>
      </Card>
      <Card className="textarea-card">
        <label>Описание проблемы</label>
        <p>Подробно опишите вашу проблему</p>
        <span>0/1000</span>
        <div className="hint-box"><Sparkles size={21} />Чем подробнее вы опишите ситуацию, тем быстрее мы сможем помочь</div>
      </Card>
      <Card className="attach-card">
        <p>Прикрепить файлы</p>
        <div>
          <Paperclip size={30} />
          <span>
            <strong>Нажмите чтобы прикрепить файл</strong>
            <small>Размер файла не более 10 МБ</small>
          </span>
        </div>
      </Card>
      <PrimaryButton onClick={() => navigate('tickets')}>Вернуться к обращениям</PrimaryButton>
    </AppFrame>
  );
}

function TicketThread({ navigate, activeScreen }) {
  return (
    <AppFrame className="thread-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Обращение" subtitle={<><span>API тикетов не подключен</span><Copy size={12} /></>} />
      <Card className="ticket-info">
        <InfoLine icon={Headphones} title="Статус" value="Недоступно" />
        <InfoLine icon={MoreVertical} title="Приоритет" value="Недоступно" />
        <InfoLine icon={CalendarDays} title="Обновлен" value="Недоступно" />
      </Card>
      <div className="date-pill">Нет данных</div>
      <ThreadMarker>Эндпоинты обращений отсутствуют в OpenAPI</ThreadMarker>
      <div className="reopen-box">
        <Sparkles size={25} />
        <div><strong>Переписка недоступна</strong><p>Нужен backend endpoint для тикетов и сообщений</p></div>
      </div>
      <div className="message-input">
        <button onClick={() => navigate('ticket-create')} aria-label="Прикрепить файл"><Paperclip size={23} /></button>
        <span>Напишите сообщение...</span>
        <button onClick={() => navigate('tickets')} aria-label="Отправить"><Send size={23} /></button>
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

function MessageBubble({ author, time, support, attachment }) {
  return (
    <div className={support ? 'message-bubble support' : 'message-bubble'}>
      <p><span>{author}</span> • {time}</p>
      <div>Сообщение недоступно</div>
      {attachment && (
        <div className="attachment">
          <Paperclip size={24} />
          <span><strong>img.png</strong><small>1,4 МБ</small></span>
        </div>
      )}
    </div>
  );
}

function TariffLite({ navigate, activeScreen }) {
  return <TariffScreen selected="lite" name="Lite" price="300 ₽" discounts={['-10%', '-15%']} navigate={navigate} activeScreen={activeScreen} />;
}

function TariffPlus({ navigate, activeScreen }) {
  return <TariffScreen selected="plus" name="Plus" price="550 ₽" discounts={['-20%', '-30%']} navigate={navigate} activeScreen={activeScreen} />;
}

function TariffScreen({ selected, price, discounts, navigate, activeScreen }) {
  const periods = [
    { id: '1', title: '1 месяц', note: 'Без скидки', price, total: `${price} всего` },
    { id: '6', title: '6 месяц', discount: discounts[0], price: selected === 'plus' ? '440 ₽' : '270 ₽', total: selected === 'plus' ? '2 640 ₽ всего' : '1 620 ₽ всего' },
    { id: '12', title: '12 месяцев', discount: discounts[1], price: selected === 'plus' ? '385 ₽' : '255 ₽', total: selected === 'plus' ? '4 620 ₽ всего' : '3 060 ₽ всего' },
  ];
  const [selectedPeriod, setSelectedPeriod] = useState('1');
  const [deviceCount, setDeviceCount] = useState(3);
  const [paymentError, setPaymentError] = useState('');
  const activePeriod = periods.find((item) => item.id === selectedPeriod) || periods[0];
  const buySubscription = async () => {
    try {
      setPaymentError('');
      const url = await api.createInvoice({
        provider: 'platega',
        type: 'SUBSCRIPTION',
        payload: {
          plan: selected,
          subscription_month: Number(selectedPeriod),
          hwid: deviceCount,
          currency: 'RUB',
        },
      });
      openPaymentUrl(url);
    } catch (error) {
      setPaymentError(error.message);
    }
  };

  return (
    <AppFrame className="tariff-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Подписка" />
      <PlansPair selected={selected} onSelect={(plan) => navigate(plan === 'lite' ? 'tariff-lite' : 'tariff-plus')} />
      <SectionDivider>выберите подходящий срок</SectionDivider>
      <div className="periods">
        {periods.map((item) => (
          <PeriodCard key={item.id} {...item} selected={selectedPeriod === item.id} onClick={() => setSelectedPeriod(item.id)} />
        ))}
      </div>
      <Card className="devices-counter">
        <div>
          <h2>Устройства</h2>
          <p>Включено в тариф: 3 устройства</p>
          <span>+75 ₽ за дополнительное устройство</span>
        </div>
        <div className="stepper">
          <button onClick={() => setDeviceCount((value) => Math.max(1, value - 1))}>-</button>
          <strong>{deviceCount}</strong>
          <button onClick={() => setDeviceCount((value) => Math.min(9, value + 1))}>+</button>
        </div>
      </Card>
      <Card className="checkout-card">
        <div>
          <p>Итого к оплате</p>
          <strong>4 188 ₽</strong>
        </div>
        <div>
          <span>5 985 ₽</span>
          <b>-30%</b>
          <p>{price} / мес</p>
        </div>
        {paymentError && <p className="inline-error">{paymentError}</p>}
        <PrimaryButton onClick={buySubscription}>Подключить за&nbsp; {activePeriod.price}</PrimaryButton>
        <small><Lock size={15} />Безопасная оплата. Отмена в любой момент</small>
      </Card>
    </AppFrame>
  );
}

function PeriodCard({ title, note, discount, price, total, selected, onClick }) {
  return (
    <button className={selected ? 'period-card selected' : 'period-card'} onClick={onClick}>
      <h3>{title}</h3>
      {note && <p>{note}</p>}
      {discount && <span>{discount}</span>}
      <div className="thin-line" />
      <strong>{price} <small>/ мес</small></strong>
      <b>{total}</b>
    </button>
  );
}

function ProfileScreen({ navigate, activeScreen, telegramUser }) {
  const displayName = getDisplayName(telegramUser);

  return (
    <AppFrame className="profile-screen" navigate={navigate} activeScreen={activeScreen}>
      <PageTitle title="Профиль" subtitle="Аккаунт и настройки" action={<button className="square-action" onClick={() => navigate('tickets')} aria-label="Уведомления"><Bell size={28} /></button>} />
      <Card className="profile-card">
        <div className="profile-avatar"><UserGlyph size={30} /></div>
        <div>
          <h2>{displayName}</h2>
          <p>{telegramUser?.username ? `@${telegramUser.username}` : telegramUser?.id ? `VORA ID ${telegramUser.id}` : 'Откройте через Telegram'}</p>
        </div>
      </Card>
      <Card className="link-list">
        <ActionRow icon={Wallet} title="Баланс" subtitle="Пополнения и история платежей" onClick={() => navigate('balance-history')} />
        <ActionRow icon={Shield} title="Безопасность" subtitle="Данные аккаунта и устройства" onClick={() => navigate('home-active')} />
        <ActionRow icon={Headphones} title="Поддержка" subtitle="Обращения и помощь" onClick={() => navigate('support')} />
      </Card>
    </AppFrame>
  );
}

createRoot(document.getElementById('root')).render(<App />);
