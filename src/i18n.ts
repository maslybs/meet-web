export type Locale = 'uk' | 'en';

export interface Translations {
  languageLabel: string;
  languageName: string;
  languageOptions: { value: Locale; label: string }[];
  welcome: string;
  createBroadcast: string;
  createBroadcastHelp: string;
  roomReadyTitle: string;
  roomReadyHelpWithToken: string;
  roomReadyHelpNoToken: string;
  roomReadyHelpNoName: string;
  shareLinkLabel: string;
  nameLabel: string;
  llmTokenLabel: string;
  llmTokenPlaceholder: string;
  llmTokenHint: string;
  participantFallbackName: string;
  actions: {
    createRoom: string;
    startBroadcast: string;
    joinRoom: string;
    wait: string;
    disconnect: string;
  };
  errors: {
    nameRequired: string;
    tokenHtmlResponse: string;
    tokenInvalidResponse: string;
    tokenRequestFailed: string;
    agentInviteFailed: string;
    agentStatusFailed: string;
    invalidApiKey: string;
    permissionDenied: string;
    agentStartFailed: string;
  };
  status: {
    preparing: string;
    active: string;
    disconnected: string;
  };
  agentControl: {
    inviteLabel: string;
    inviteHint: string;
    pauseLabel: string;
    pauseHint: string;
    resumeLabel: string;
    resumeHint: string;
    processingLabel: string;
  };
  toggle: {
    on: string;
    off: string;
  };
  conference: {
    demoRoomLabel: string;
    agentConnectingTitle: string;
    agentActiveTitle: string;
    leaveLabel: string;
    controlsAnnouncementPrefix: string;
    roomAriaLabel: string;
  };
  devices: {
    microphone: string;
    camera: string;
    switchCamera: string;
    switchingCamera: string;
    usingCamera: string;
    primaryCamera: string;
    otherCamera: string;
  };
}

const uk: Translations = {
  languageLabel: 'Мова',
  languageName: 'Українська',
  languageOptions: [
    { value: 'uk', label: 'Українська' },
    { value: 'en', label: 'English' },
  ],
  welcome: 'Вітаю',
  createBroadcast: 'Створити трансляцію',
  createBroadcastHelp: 'Натисніть нижче, щоб створити нову трансляцію і запросити асистента і інших учасників.',
  roomReadyTitle: 'Вашу кімнату для зустрічі створено.',
  roomReadyHelpWithToken:
    'Вкажіть своє імʼя, за бажанням додайте LLM токен і натисніть кнопку, щоб підключитися.',
  roomReadyHelpNoToken: 'Вкажіть своє імʼя і натисніть кнопку, щоб підключитися.',
  roomReadyHelpNoName: 'Натисніть кнопку, щоб підключитися.',
  shareLinkLabel: 'Посилання для асистента:',
  nameLabel: 'Ваше імʼя',
  llmTokenLabel: 'LLM API токен для ШІ асистента (необов’язково)',
  llmTokenPlaceholder: 'Вставте токен вашого асистента',
  llmTokenHint:
    'Токен збережеться в браузері і, якщо введений, передаватиметься асистенту. Без токена працюватиме звичайна відеозустріч.',
  participantFallbackName: 'Учасник',
  actions: {
    createRoom: 'Створити трансляцію',
    startBroadcast: 'Почати трансляцію',
    joinRoom: 'Підключитися',
    wait: 'Зачекайте…',
    disconnect: 'Завершити',
  },
  errors: {
    nameRequired: 'Вкажіть своє ім’я.',
    tokenHtmlResponse:
      'Не вдалося отримати токен. Переконайтесь, що запущено бекенд, який відповідає на /api/token (наприклад, wrangler pages dev).',
    tokenInvalidResponse: 'Сервер токена повернув невалідну відповідь.',
    tokenRequestFailed: 'Не вдалося отримати токен.',
    agentInviteFailed: 'Не вдалося запросити ШІ асистента. Перевірте з’єднання або токен і спробуйте ще раз.',
    agentStatusFailed: 'Не вдалося оновити статус асистента. Перевірте з’єднання і спробуйте знову.',
    invalidApiKey: 'Неправильний LLM токен. Перевірте налаштування і спробуйте ще раз.',
    permissionDenied: 'Немає дозволу на використання цього LLM. Зверніться до адміністратора.',
    agentStartFailed: 'Не вдалося запустити ШІ асистента. Спробуйте ще раз.',
  },
  status: {
    preparing: 'Готую з’єднання…',
    active: 'Трансляція активна.',
    disconnected: 'З’єднання завершено.',
  },
  agentControl: {
    inviteLabel: 'Запросити асистента',
    inviteHint: 'Запросити асистента: додає асистента, який допомагатиме користувачеві.',
    pauseLabel: 'Пауза асистента',
    pauseHint: 'Асистент тимчасово відійде.',
    resumeLabel: 'Увімкнути асистента',
    resumeHint: 'Асистент повернеться до розмови.',
    processingLabel: 'Обробка запиту...',
  },
  toggle: {
    on: 'Зараз увімкнено',
    off: 'Зараз вимкнено',
  },
  conference: {
    demoRoomLabel: 'Демо кімната',
    agentConnectingTitle: 'Асистент підключається...',
    agentActiveTitle: 'Асистент активний',
    leaveLabel: 'Завершити',
    controlsAnnouncementPrefix: 'Доступні кнопки керування:',
    roomAriaLabel: 'Кімната відеозвʼязку',
  },
  devices: {
    microphone: 'Мікрофон',
    camera: 'Камера',
    switchCamera: 'Перемкнути камеру',
    switchingCamera: 'Перемикаю…',
    usingCamera: 'Використовується',
    primaryCamera: 'Основна камера',
    otherCamera: 'Інша камера',
  },
};

const en: Translations = {
  languageLabel: 'Language',
  languageName: 'English',
  languageOptions: [
    { value: 'uk', label: 'Українська' },
    { value: 'en', label: 'English' },
  ],
  welcome: 'Welcome',
  createBroadcast: 'Create broadcast',
  createBroadcastHelp: 'Click below to create a new session and invite the assistant and other participants.',
  roomReadyTitle: 'Your meeting room is ready.',
  roomReadyHelpWithToken:
    'Enter your name, optionally add an LLM token, and press the button to connect.',
  roomReadyHelpNoToken: 'Enter your name and press the button to connect.',
  roomReadyHelpNoName: 'Press the button to connect.',
  shareLinkLabel: 'Assistant link:',
  nameLabel: 'Your name',
  llmTokenLabel: 'LLM API token for the AI assistant (optional)',
  llmTokenPlaceholder: 'Paste your assistant token',
  llmTokenHint:
    'The token is stored in your browser and, if provided, will be sent to the assistant. Without a token, it works as a regular video call.',
  participantFallbackName: 'Participant',
  actions: {
    createRoom: 'Create broadcast',
    startBroadcast: 'Start broadcast',
    joinRoom: 'Join',
    wait: 'Please wait…',
    disconnect: 'Leave',
  },
  errors: {
    nameRequired: 'Please enter your name.',
    tokenHtmlResponse:
      'Could not fetch a token. Make sure the backend responding to /api/token is running (e.g., wrangler pages dev).',
    tokenInvalidResponse: 'The token server returned an invalid response.',
    tokenRequestFailed: 'Failed to obtain token.',
    agentInviteFailed: 'Could not invite the AI assistant. Check your connection or token and try again.',
    agentStatusFailed: 'Could not refresh assistant status. Check your connection and try again.',
    invalidApiKey: 'Invalid LLM token. Check your settings and try again.',
    permissionDenied: 'You do not have permission to use this LLM. Contact your administrator.',
    agentStartFailed: 'Failed to start the AI assistant. Please try again.',
  },
  status: {
    preparing: 'Preparing connection…',
    active: 'Session is active.',
    disconnected: 'Connection ended.',
  },
  agentControl: {
    inviteLabel: 'Invite assistant',
    inviteHint: 'Invite the AI assistant to help during the call.',
    pauseLabel: 'Pause assistant',
    pauseHint: 'The assistant will step away temporarily.',
    resumeLabel: 'Resume assistant',
    resumeHint: 'The assistant will rejoin the conversation.',
    processingLabel: 'Processing request...',
  },
  toggle: {
    on: 'Currently on',
    off: 'Currently off',
  },
  conference: {
    demoRoomLabel: 'Demo room',
    agentConnectingTitle: 'Assistant connecting...',
    agentActiveTitle: 'Assistant active',
    leaveLabel: 'Leave',
    controlsAnnouncementPrefix: 'Available controls:',
    roomAriaLabel: 'Video call room',
  },
  devices: {
    microphone: 'Microphone',
    camera: 'Camera',
    switchCamera: 'Switch camera',
    switchingCamera: 'Switching…',
    usingCamera: 'Using',
    primaryCamera: 'Rear camera',
    otherCamera: 'Other camera',
  },
};

export const LOCALE_STORAGE_KEY = 'meet-web-locale';

function matchLocale(value?: string | null): Locale {
  if (!value) return 'uk';
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('uk') || normalized.startsWith('ua')) return 'uk';
  return normalized === 'en' ? 'en' : 'uk';
}

export function detectInitialLocale(): Locale {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored) {
        return matchLocale(stored);
      }
    }
  } catch (e) {
    console.warn('Failed to access localStorage for locale:', e);
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      return matchLocale(navigator.language);
    }
  } catch (e) {
    console.warn('Failed to access navigator.language:', e);
  }

  return 'uk';
}

export function getTranslations(locale: Locale): Translations {
  return locale === 'en' ? en : uk;
}
