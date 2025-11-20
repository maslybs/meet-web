import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

import UkrainianConference from './components/UkrainianConference';
import type { AgentControlConfig, AgentStatus } from './types/agent';
import { detectInitialLocale, getTranslations, Locale, LOCALE_STORAGE_KEY } from './i18n';
import type { Translations } from './i18n';

interface TokenResponse {
  token: string;
  serverUrl: string;
  identity: string;
}

interface AgentMetadata {
  roomName: string;
  room?: string;
  participantName: string;
  gemini_api_key?: string;
  multi_participant?: boolean;
  greetingMode?: 'invite' | 'resume';
  language?: string;
}

const envValues = import.meta.env as Record<string, string | undefined>;
const storedNameKey = 'meet-web-name';
const fallbackNameKey = 'camera-mother-name';
const storedTokenMapKey = 'meet-web-llm-tokens';
const configuredRoomName = ((envValues.VITE_DEFAULT_ROOM ?? envValues.VOICE_AGENT_DEFAULT_ROOM) ?? '').trim();
const demoRoomName = ((envValues.VITE_DEMO_ROOM ?? envValues.VOICE_AGENT_DEMO_ROOM) ?? '').trim();
const configuredAgentToken = (envValues.VITE_DEFAULT_LLM_TOKEN ?? '').trim();
const configuredAgentIdentity = ((envValues.VITE_AGENT_IDENTITY ?? envValues.VOICE_AGENT_NAME) ?? '').trim();

function randomSuffix(length = 6) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  }
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function generateRoomName() {
  return `room-${randomSuffix(6).toLowerCase()}`;
}

function loadStoredTokenMap(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(storedTokenMapKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([room, value]) => {
        if (typeof room !== 'string' || typeof value !== 'string') {
          return false;
        }
        const trimmedRoom = room.trim();
        const trimmedToken = value.trim();
        if (!trimmedRoom || !trimmedToken) {
          return false;
        }
        if (isTokenOptionalRoom(trimmedRoom)) {
          return false;
        }
        return true;
      })
      .map(([room, value]) => [room.trim(), (value as string).trim()] as const);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function isTokenOptionalRoom(room: string): boolean {
  if (!room) {
    return false;
  }
  const normalized = room.trim();
  if (!normalized) {
    return false;
  }
  if (configuredRoomName && normalized === configuredRoomName) {
    return true;
  }
  if (demoRoomName && normalized === demoRoomName) {
    return true;
  }
  return false;
}

function formatAgentErrorMessage(
  translations: Translations,
  code?: string | null,
  serverMessage?: string | null,
  detail?: string | null,
): string | null {
  const trimmedServerMessage = serverMessage?.trim();
  if (trimmedServerMessage) {
    return trimmedServerMessage;
  }

  switch (code) {
    case 'invalid_api_key':
      return translations.errors.invalidApiKey;
    case 'permission_denied':
      return translations.errors.permissionDenied;
    default: {
      if (detail && detail.trim()) {
        return `${translations.errors.agentStartFailed} ${detail.trim()}`;
      }
      return translations.errors.agentStartFailed;
    }
  }
}

function loadParticipantName(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const stored = window.localStorage.getItem(storedNameKey)?.trim();
  if (stored) {
    return stored;
  }
  const fallback = window.localStorage.getItem(fallbackNameKey)?.trim();
  return fallback ?? '';
}

type DispatchResponse = {
  status?: string;
  active?: boolean;
  reused?: boolean;
  agentPresent?: boolean;
  dispatch?: { agentName?: string | null } | null;
};

async function ensureAgentDispatch(
  room: string,
  metadata?: AgentMetadata,
  translations?: Translations,
): Promise<DispatchResponse> {
  try {
    const response = await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room,
        metadata:
          metadata && Object.keys(metadata).length > 0
            ? JSON.stringify(metadata)
            : undefined,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      const fallback = translations?.errors.agentStartFailed ?? 'Failed to start the AI assistant.';
      throw new Error(text || `${fallback} (${response.status}).`);
    }
    if (!text.trim()) {
      return {};
    }
    try {
      return JSON.parse(text) as DispatchResponse;
    } catch {
      return {};
    }
  } catch (error) {
    console.warn('ensureAgentDispatch failed', error);
    throw error;
  }
}

async function requestToken(translations: Translations, room: string, name: string) {
  const url = new URL(`/api/token`, window.location.origin);
  url.searchParams.set('room', room);
  url.searchParams.set('name', name);

  const response = await fetch(url.toString());
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `${translations.errors.tokenRequestFailed} (${response.status}).`);
  }

  const trimmed = text.trim();
  if (contentType.includes('text/html') || trimmed.startsWith('<!DOCTYPE')) {
    throw new Error(
      translations.errors.tokenHtmlResponse,
    );
  }

  try {
    return JSON.parse(trimmed) as TokenResponse;
  } catch (error) {
    throw new Error(translations.errors.tokenInvalidResponse);
  }
}


function LanguageSwitcher({ locale, onLocaleChange }: { locale: Locale; onLocaleChange: (l: Locale) => void }) {
  const toggle = () => onLocaleChange(locale === 'uk' ? 'en' : 'uk');
  return (
    <button
      type="button"
      className="language-toggle"
      onClick={toggle}
      aria-hidden="true"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span className="lang-code">{locale.toUpperCase()}</span>
    </button>
  );
}

export default function App() {
  const search =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialRoom = search.get('room')?.trim() ?? '';

  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());
  const translations = useMemo(() => getTranslations(locale), [locale]);

  if (!translations) {
    return null;
  }

  const t = translations;
  const languageOptions = translations.languageOptions;

  const [roomName, setRoomName] = useState(() => initialRoom);
  const [isCreator, setIsCreator] = useState(() => !initialRoom);
  const initialParticipantNameFromStorage = useMemo(() => {
    return loadParticipantName();
  }, []);

  const [participantName, setParticipantName] = useState(initialParticipantNameFromStorage);
  const [tokenByRoom, setTokenByRoom] = useState<Record<string, string>>(() => loadStoredTokenMap());
  const [llmToken, setLlmToken] = useState(() => {
    if (!initialRoom) {
      return '';
    }
    if (configuredRoomName && initialRoom === configuredRoomName && configuredAgentToken) {
      return configuredAgentToken;
    }
    const stored = loadStoredTokenMap();
    return stored[initialRoom] ?? '';
  });
  const [credentials, setCredentials] = useState<TokenResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentIdentity, setAgentIdentity] = useState(() => configuredAgentIdentity);
  const previousAgentStatusRef = useRef<AgentStatus>('idle');
  const pauseRequestedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(storedNameKey)?.trim();
    if (stored) return;
    const fallback = window.localStorage.getItem(fallbackNameKey)?.trim();
    if (!fallback) return;
    window.localStorage.setItem(storedNameKey, fallback);
    setParticipantName((current) => (current.trim() ? current : fallback));
    window.localStorage.removeItem(fallbackNameKey);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (participantName.trim()) {
      window.localStorage.setItem(storedNameKey, participantName.trim());
    } else {
      window.localStorage.removeItem(storedNameKey);
    }
  }, [participantName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore persistence issues
    }
  }, [locale]);

  useEffect(() => {
    const ukTranslations = getTranslations('uk');
    const enTranslations = getTranslations('en');

    const remapValue = (current: string | null, mapping: Record<string, string>): string | null => {
      if (!current) return current;
      return mapping[current] ?? current;
    };

    setStatus((current) =>
      remapValue(current, {
        [ukTranslations.status.preparing]: t.status.preparing,
        [enTranslations.status.preparing]: t.status.preparing,
        [ukTranslations.status.active]: t.status.active,
        [enTranslations.status.active]: t.status.active,
        [ukTranslations.status.disconnected]: t.status.disconnected,
        [enTranslations.status.disconnected]: t.status.disconnected,
      }),
    );

    const errorMapping: Record<string, string> = {
      [ukTranslations.errors.nameRequired]: t.errors.nameRequired,
      [enTranslations.errors.nameRequired]: t.errors.nameRequired,
      [ukTranslations.errors.tokenRequestFailed]: t.errors.tokenRequestFailed,
      [enTranslations.errors.tokenRequestFailed]: t.errors.tokenRequestFailed,
      [ukTranslations.errors.tokenHtmlResponse]: t.errors.tokenHtmlResponse,
      [enTranslations.errors.tokenHtmlResponse]: t.errors.tokenHtmlResponse,
      [ukTranslations.errors.tokenInvalidResponse]: t.errors.tokenInvalidResponse,
      [enTranslations.errors.tokenInvalidResponse]: t.errors.tokenInvalidResponse,
    };
    setError((current) => remapValue(current, errorMapping));

    const agentMapping: Record<string, string> = {
      [ukTranslations.errors.agentInviteFailed]: t.errors.agentInviteFailed,
      [enTranslations.errors.agentInviteFailed]: t.errors.agentInviteFailed,
      [ukTranslations.errors.agentStatusFailed]: t.errors.agentStatusFailed,
      [enTranslations.errors.agentStatusFailed]: t.errors.agentStatusFailed,
      [ukTranslations.errors.invalidApiKey]: t.errors.invalidApiKey,
      [enTranslations.errors.invalidApiKey]: t.errors.invalidApiKey,
      [ukTranslations.errors.permissionDenied]: t.errors.permissionDenied,
      [enTranslations.errors.permissionDenied]: t.errors.permissionDenied,
      [ukTranslations.errors.agentStartFailed]: t.errors.agentStartFailed,
      [enTranslations.errors.agentStartFailed]: t.errors.agentStartFailed,
    };
    setAgentMessage((current) => remapValue(current, agentMapping));
  }, [t]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const entries = Object.entries(tokenByRoom).filter(([room, token]) => {
        if (!room || typeof token !== 'string' || token.trim() === '') {
          return false;
        }
        const normalizedRoom = room.trim();
        return normalizedRoom !== '' && !isTokenOptionalRoom(normalizedRoom);
      });
      if (entries.length === 0) {
        window.localStorage.removeItem(storedTokenMapKey);
      } else {
        window.localStorage.setItem(storedTokenMapKey, JSON.stringify(Object.fromEntries(entries)));
      }
    } catch {
      // ignore persistence errors
    }
  }, [tokenByRoom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!roomName) {
      url.searchParams.delete('room');
    } else {
      url.searchParams.set('room', roomName);
    }
    window.history.replaceState(null, '', url.toString());
  }, [roomName]);

  useEffect(() => {
    if (agentStatus !== 'error') {
      setAgentMessage(null);
    }
  }, [agentStatus]);


  const trimmedRoom = roomName.trim();
  const trimmedParticipantName = participantName.trim();
  const trimmedToken = llmToken.trim();
  const isConfiguredRoom = Boolean(configuredRoomName) && trimmedRoom === configuredRoomName;
  // Allow "demo-room" explicitly for easier local testing if env var is missing
  const isDemoRoom = (Boolean(demoRoomName) && trimmedRoom === demoRoomName) || trimmedRoom === 'demo-room';
  const isTokenlessRoom = isConfiguredRoom || isDemoRoom;
  const effectiveAgentToken = trimmedToken || (isConfiguredRoom ? configuredAgentToken : '');

  const shareLink = useMemo(() => {
    if (!roomName || typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomName);
    return url.toString();
  }, [roomName]);

  const liveKitOptions = useMemo(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { facingMode: 'environment' as const },
    }),
    [],
  );

  const fetchAgentStatus = useCallback(async (): Promise<AgentStatus> => {
    if (!trimmedRoom) {
      setAgentStatus('idle');
      setAgentMessage(null);
      return 'idle';
    }

    try {
      const response = await fetch(`/api/dispatch?room=${encodeURIComponent(trimmedRoom)}`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to fetch agent status');
      }
      const data = await response.json();
      const dispatchAgentName =
        data && typeof data === 'object' && data.dispatch && typeof data.dispatch.agentName === 'string'
          ? (data.dispatch.agentName as string).trim()
          : '';
      if (dispatchAgentName) {
        setAgentIdentity((prev: string) => (dispatchAgentName && dispatchAgentName !== prev ? dispatchAgentName : prev));
      }

      const agentPresent = Boolean(data?.agentPresent);
      const errorMessageRaw = typeof data?.error === 'string' ? data.error : null;
      const errorCode = typeof data?.errorCode === 'string' ? data.errorCode : null;
      const errorDetail = typeof data?.errorDetail === 'string' ? data.errorDetail : null;
      const formattedError =
        errorMessageRaw || errorCode ? formatAgentErrorMessage(t, errorCode, errorMessageRaw, errorDetail) : null;

      if (formattedError) {
        if (errorDetail && (!errorMessageRaw || errorDetail !== errorMessageRaw)) {
          console.warn('Agent dispatch error detail:', errorDetail);
        }
        setAgentMessage(formattedError);
        setAgentStatus('error');
        return 'error';
      }

      if (pauseRequestedRef.current && !data.active) {
        setAgentStatus('paused');
        return 'paused';
      }

      if (!data.active && !agentPresent && pauseRequestedRef.current) {
        setAgentStatus('paused');
        return 'paused';
      }

      if (agentPresent && !dispatchAgentName && configuredAgentIdentity) {
        setAgentIdentity((prev: string) => prev || configuredAgentIdentity);
      }

      const nextStatus: AgentStatus = data.active || agentPresent ? 'active' : 'idle';
      setAgentStatus(nextStatus);
      setAgentMessage(null);

      return nextStatus;
    } catch (error) {
      console.warn('fetchAgentStatus failed', error);
      setAgentStatus('error');
      setAgentMessage(t.errors.agentStatusFailed);
      return 'error';
    }
  }, [trimmedRoom, configuredAgentIdentity, t]);

  useEffect(() => {
    if (!credentials || !trimmedRoom) {
      setAgentStatus('idle');
      pauseRequestedRef.current = false;
      return;
    }
    if (agentStatus === 'paused') {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      await fetchAgentStatus();
    };

    void poll();
    const interval = window.setInterval(() => {
      void fetchAgentStatus();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [credentials, trimmedRoom, agentStatus, fetchAgentStatus, agentMessage]);

  useEffect(() => {
    const previous = previousAgentStatusRef.current;

    if (agentStatus !== 'paused' && pauseRequestedRef.current && agentStatus !== 'requesting' && agentStatus !== 'disconnecting') {
      pauseRequestedRef.current = false;
    }
    previousAgentStatusRef.current = agentStatus;
  }, [agentStatus]);

  const showLlmTokenField = isCreator || (!isConfiguredRoom && !isDemoRoom);
  const canInviteAgent = Boolean(effectiveAgentToken) || isConfiguredRoom || isDemoRoom;
  const readyToConnect = trimmedRoom !== '' && trimmedParticipantName !== '';

  const connectButtonText = connecting ? t.actions.wait : isCreator ? t.actions.startBroadcast : t.actions.joinRoom;
  const inviteDisabled = !credentials || !canInviteAgent || agentStatus === 'requesting';
  const pauseDisabled = !credentials || agentStatus === 'requesting';
  const isPausingRequest = pauseRequestedRef.current;

  const clearAgentDispatch = useCallback(async () => {
    if (!trimmedRoom) {
      return;
    }

    try {
      const response = await fetch(`/api/dispatch?room=${encodeURIComponent(trimmedRoom)}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 404) {
        const message = await response.text();
        throw new Error(message || 'Failed to clear existing agent dispatch.');
      }
      setAgentStatus('idle');
      pauseRequestedRef.current = false;
    } catch (error) {
      console.warn('clearAgentDispatch failed', error);
    }
  }, [trimmedRoom]);

  const handleLocaleChange = useCallback((value: Locale) => {
    setLocale(value);
  }, []);

  const handleCreateRoom = useCallback(() => {
    const generated = generateRoomName();
    setRoomName(generated);
    setIsCreator(true);
    setLlmToken('');
    setCredentials(null);
    setStatus(null);
    setError(null);
    setConnecting(false);
    setAgentMessage(null);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!readyToConnect) {
      setError(t.errors.nameRequired);
      return;
    }

    setAgentMessage(null);
    if (agentStatus === 'error') {
      setAgentStatus('idle');
    }

    try {
      setConnecting(true);
      setError(null);
      setStatus(t.status.preparing);
      const tokenResp = await requestToken(t, trimmedRoom, trimmedParticipantName);
      setCredentials(tokenResp);
      setStatus(t.status.active);
      if (trimmedRoom) {
        setTokenByRoom((prev) => {
          if (!isTokenlessRoom && trimmedToken) {
            if (prev[trimmedRoom] === trimmedToken) {
              return prev;
            }
            return { ...prev, [trimmedRoom]: trimmedToken };
          }
          if (prev[trimmedRoom]) {
            const next = { ...prev };
            delete next[trimmedRoom];
            return next;
          }
          return prev;
        });
      }
    } catch (err) {
      console.error(err);
      setCredentials(null);
      setStatus(null);
      setError(err instanceof Error ? err.message : t.errors.tokenRequestFailed);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = useCallback(() => {
    setCredentials(null);
    setStatus(t.status.disconnected);
    setAgentStatus('idle');
    setAgentMessage(null);
    pauseRequestedRef.current = false;
    void clearAgentDispatch();
  }, [clearAgentDispatch, t.status.disconnected]);

  const handleAgentPresenceChange = useCallback((present: boolean, identity?: string | null) => {
    if (present && identity) {
      setAgentIdentity(identity);
    }
    if (!present && identity && agentIdentity === identity) {
      setAgentIdentity(configuredAgentIdentity);
    }
    setAgentStatus((prev) => {
      if (present) {
        return 'active';
      }
      if (prev === 'active') {
        return 'idle';
      }
      return prev;
    });
  }, [agentIdentity, configuredAgentIdentity]);

  const ensureAgentActive = useCallback(
    async (mode: 'invite' | 'resume') => {
      if (!credentials) {
        return;
      }
      if (!trimmedRoom) {
        return;
      }
      if (mode === 'invite' && (agentStatus === 'active' || agentStatus === 'paused')) {
        return;
      }
      if (!effectiveAgentToken && !isTokenlessRoom) {
        return;
      }

      try {
        pauseRequestedRef.current = false;
        setAgentStatus('requesting');
        setAgentMessage(null);

        const metadata: AgentMetadata = {
          roomName: trimmedRoom,
          room: trimmedRoom,
          participantName: trimmedParticipantName || t.participantFallbackName,
          greetingMode: mode,
          language: locale,
        };

        if (effectiveAgentToken) {
          metadata.gemini_api_key = effectiveAgentToken;
        }
        const dispatchResult = await ensureAgentDispatch(trimmedRoom, metadata, t);
        if (dispatchResult.agentPresent && dispatchResult.active) {
          setAgentStatus('active');
          if (!dispatchResult.dispatch?.agentName && configuredAgentIdentity) {
            setAgentIdentity((prev: string) => prev || configuredAgentIdentity);
          }
          pauseRequestedRef.current = false;
          return;
        }

      } catch (error) {
        console.error('ensureAgentActive failed', error);
        setAgentStatus('error');
        setAgentMessage(t.errors.agentInviteFailed);
      }
    },
    [
      credentials,
      trimmedRoom,
      effectiveAgentToken,
      isTokenlessRoom,
      trimmedParticipantName,
      isCreator,
      agentStatus,
      configuredAgentIdentity,
      t,
      t.errors.agentInviteFailed,
    ],
  );

  const handleRequestAgent = useCallback(() => {
    // Mobile Safari/Chrome Autoplay Fix:
    // Explicitly resume AudioContext on user interaction to allow future agent audio.
    const unlockAudio = () => {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          // Just creating/resuming is often enough to flag the document as "user activated" for audio
          ctx.resume().then(() => ctx.close()).catch(() => { });
        }
      } catch (e) {
        // ignore errors
      }
    };
    unlockAudio();

    void ensureAgentActive('invite');
  }, [ensureAgentActive]);

  const handleToggleAgentListening = useCallback(async () => {
    if (!credentials) {
      return;
    }
    if (!trimmedRoom) {
      return;
    }

    if (agentStatus === 'paused') {
      await ensureAgentActive('resume');
      return;
    }

    if (agentStatus !== 'active') {
      return;
    }

    try {
      pauseRequestedRef.current = true;
      setAgentStatus('disconnecting');

      const response = await fetch(`/api/dispatch?room=${encodeURIComponent(trimmedRoom)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to pause agent');
      }
      void fetchAgentStatus();
    } catch (error) {
      console.error('handleToggleAgentListening failed', error);
      pauseRequestedRef.current = false;
      setAgentStatus('error');
    }
  }, [agentStatus, credentials, ensureAgentActive, trimmedRoom]);

  const agentControl = useMemo<AgentControlConfig | null>(() => {
    if (agentStatus === 'idle' || agentStatus === 'error') {
      if (!canInviteAgent) {
        return null;
      }
      return {
        label: t.agentControl.inviteLabel,
        ariaLabel: t.agentControl.inviteLabel,
        disabled: inviteDisabled,
        onClick: handleRequestAgent,
        hint: t.agentControl.inviteHint,
        state: 'invite',
      };
    }

    if (agentStatus === 'active') {
      return {
        label: t.agentControl.pauseLabel,
        ariaLabel: t.agentControl.pauseLabel,
        disabled: isPausingRequest,
        onClick: handleToggleAgentListening,
        hint: t.agentControl.pauseHint,
        state: 'pause',
      };
    }

    if (agentStatus === 'paused') {
      return {
        label: t.agentControl.resumeLabel,
        ariaLabel: t.agentControl.resumeLabel,
        disabled: false,
        onClick: handleToggleAgentListening,
        hint: t.agentControl.resumeHint,
        state: 'resume',
      };
    }

    // Requesting state
    return {
      label: t.agentControl.processingLabel,
      ariaLabel: t.agentControl.processingLabel,
      disabled: true,
      onClick: () => { },
      hint: t.agentControl.processingLabel,
      state: 'requesting',
    };
  }, [
    agentStatus,
    canInviteAgent,
    handleRequestAgent,
    handleToggleAgentListening,
    inviteDisabled,
    isPausingRequest,
    t.agentControl.inviteHint,
    t.agentControl.inviteLabel,
    t.agentControl.pauseHint,
    t.agentControl.pauseLabel,
    t.agentControl.processingLabel,
    t.agentControl.resumeHint,
    t.agentControl.resumeLabel,
  ]);

  const showInviteHint = !canInviteAgent && isCreator;

  return (
    <main className={`layout${credentials ? ' layout-room-active' : ''}`} data-lk-theme="default">


      {!credentials && (
        <section className="card" aria-live="polite">
          <div className="card-header-actions">
            <LanguageSwitcher locale={locale} onLocaleChange={handleLocaleChange} />
          </div>
          <h1>
            {participantName ? `${t.welcome} ${participantName}` : (!roomName ? t.createBroadcast : t.welcome)}
          </h1>

          {status && <p className="status-message">{status}</p>}

          {!roomName ? (
            <>
              <p>{t.createBroadcastHelp}</p>
              <div className="actions">
                <button type="button" onClick={handleCreateRoom} aria-label={t.actions.createRoom}>
                  {t.actions.createRoom}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                {t.roomReadyTitle}<br />
                {trimmedParticipantName
                  ? t.roomReadyHelpNoName
                  : showLlmTokenField
                    ? t.roomReadyHelpWithToken
                    : t.roomReadyHelpNoToken}
              </p>

              {isCreator && shareLink && (
                <div className="share-block">
                  <span>{t.shareLinkLabel}</span>
                  <div className="share-link" aria-live="polite">
                    {shareLink}
                  </div>
                </div>
              )}

              <form className="inputs" onSubmit={handleSubmit}>
                {!initialParticipantNameFromStorage && (
                  <label>
                    {t.nameLabel}
                    <input
                      type="text"
                      required
                      value={participantName}
                      onChange={(event) => setParticipantName(event.target.value)}
                    />
                  </label>
                )}

                {showLlmTokenField && (
                  <>
                    <label>
                      {t.llmTokenLabel}
                      <input
                        type="text"
                        value={llmToken}
                        placeholder={t.llmTokenPlaceholder}
                        onChange={(event) => setLlmToken(event.target.value)}
                        aria-describedby="llm-token-hint"
                      />
                    </label>
                    <small id="llm-token-hint" className="hint">
                      {t.llmTokenHint}
                    </small>
                  </>
                )}

                <div className="actions">
                  <button type="submit" disabled={connecting} aria-label={connectButtonText}>
                    {connectButtonText}
                  </button>
                </div>
              </form>
            </>
          )}


          {error && <p className="error">{error}</p>}
        </section>
      )}

      {credentials && (
        <section className="room-container" aria-label={t.conference.roomAriaLabel}>
          <LiveKitRoom
            serverUrl={credentials.serverUrl}
            token={credentials.token}
            connect
            audio
            video={false}
            options={liveKitOptions}
            onDisconnected={handleDisconnect}
            style={{ height: '100%', width: '100%' }}
          >
            <UkrainianConference
              onLeave={() => {
                setCredentials(null);
                setStatus(null);
                setError(null);
                setAgentStatus('idle');
                setAgentMessage(null);
              }}
              agentControl={agentControl}
              showInviteHint={!credentials && !connecting && !error && !status}
              roomName={roomName}
              agentMessage={agentMessage}
              agentIdentity={agentIdentity}
              onAgentPresenceChange={handleAgentPresenceChange}
              agentStatus={agentStatus}
              isDemoRoom={Boolean(demoRoomName && roomName === demoRoomName)}
              translations={translations}
              locale={locale}
              onLocaleChange={handleLocaleChange}
            />
          </LiveKitRoom>
        </section>
      )}
    </main>
  );
}
