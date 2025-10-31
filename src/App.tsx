import {
  FormEvent,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from 'react';
import {
  DisconnectButton,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  StartMediaButton,
  useTrackToggle,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import type { TrackToggleProps } from '@livekit/components-react';
import type { ToggleSource } from '@livekit/components-core';
import { Room, RoomEvent, Track, facingModeFromDeviceLabel } from 'livekit-client';
import '@livekit/components-styles';
import './style.css';

interface TokenResponse {
  token: string;
  serverUrl: string;
  identity: string;
}

interface AgentMetadata {
  roomName: string;
  participantName: string;
  gemini_api_key?: string;
  multi_participant?: boolean;
}

type AgentStatus = 'idle' | 'requesting' | 'active' | 'paused' | 'error';

const storedNameKey = 'camera-mother-name';
const storedTokenMapKey = 'camera-mother-llm-tokens';
const configuredRoomName = (import.meta.env.VITE_DEFAULT_ROOM ?? '').trim();
const configuredAgentToken = (import.meta.env.VITE_DEFAULT_LLM_TOKEN ?? '').trim();
const configuredAgentIdentity = (import.meta.env.VITE_AGENT_IDENTITY ?? '').trim();

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

function isEnvironmentCamera(device: MediaDeviceInfo) {
  const label = (device.label ?? '').trim();
  if (!label) {
    return false;
  }
  const facing = facingModeFromDeviceLabel(label)?.facingMode;
  if (facing === 'environment') {
    return true;
  }
  const normalized = label.toLowerCase();
  const keywords = ['back', 'rear', 'environment', 'main', 'основн', 'зад'];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function describeCamera(device: MediaDeviceInfo) {
  const label = (device.label ?? '').trim();
  if (label) {
    return label;
  }
  return isEnvironmentCamera(device) ? 'Основна камера' : 'Інша камера';
}

function detectMobileViewport() {
  if (typeof window === 'undefined') {
    return false;
  }
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent || navigator.vendor || '' : '';
  const uaMatch = /Mobi|Android|iPhone|iPad|Mobile|Silk/.test(userAgent);
  return uaMatch || window.innerWidth <= 768;
}

type LiveKitTrackToggleProps = TrackToggleProps<ToggleSource>;

interface AccessibleTrackToggleProps extends LiveKitTrackToggleProps {
  baseLabel: string;
  labelOn?: string;
  labelOff?: string;
}

const AccessibleTrackToggle = forwardRef<HTMLButtonElement, AccessibleTrackToggleProps>(
  ({ baseLabel, labelOn, labelOff, children, ...rest }, ref) => {
    const { buttonProps, enabled } = useTrackToggle(rest);
    const providedLabel =
      (rest as { ['aria-label']?: string })['aria-label'] ?? undefined;
    const computedLabel =
      providedLabel ??
      (enabled
        ? labelOn ?? `${baseLabel}. Зараз увімкнено`
        : labelOff ?? `${baseLabel}. Зараз вимкнено`);
    const mergedProps = {
      ...buttonProps,
      'aria-label': computedLabel,
      'aria-pressed': enabled,
      type: 'button' as const,
    };
    return (
      <button {...mergedProps} ref={ref}>
        {children ?? baseLabel}
      </button>
    );
  },
);

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
      .filter(
        ([room, value]) =>
          typeof room === 'string' &&
          typeof value === 'string' &&
          value.trim() !== '' &&
          (!configuredRoomName || room !== configuredRoomName),
      )
      .map(([room, value]) => [room, (value as string).trim()] as const);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function ensureAgentDispatch(room: string, metadata?: AgentMetadata) {
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
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Не вдалося активувати асистента (код ${response.status}).`);
    }
  } catch (error) {
    console.warn('ensureAgentDispatch failed', error);
    throw error;
  }
}

async function requestToken(room: string, name: string) {
  const url = new URL(`/api/token`, window.location.origin);
  url.searchParams.set('room', room);
  url.searchParams.set('name', name);

  const response = await fetch(url.toString());
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Сервер токена повернув помилку ${response.status}.`);
  }

  const trimmed = text.trim();
  if (contentType.includes('text/html') || trimmed.startsWith('<!DOCTYPE')) {
    throw new Error(
      'Не вдалося отримати токен. Переконайтесь, що запущено бекенд, який відповідає на /api/token (наприклад, wrangler pages dev).',
    );
  }

  try {
    return JSON.parse(trimmed) as TokenResponse;
  } catch (error) {
    throw new Error('Сервер токена повернув невалідну відповідь.');
  }
}

export default function App() {
  const search =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialRoom = search.get('room')?.trim() ?? '';

  const [roomName, setRoomName] = useState(() => initialRoom);
  const [isCreator, setIsCreator] = useState(() => !initialRoom);
  const [participantName, setParticipantName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(storedNameKey) ?? '';
  });
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
    if (participantName.trim()) {
      window.localStorage.setItem(storedNameKey, participantName.trim());
    } else {
      window.localStorage.removeItem(storedNameKey);
    }
  }, [participantName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const entries = Object.entries(tokenByRoom).filter(([room, token]) => {
        if (!room || typeof token !== 'string' || token.trim() === '') {
          return false;
        }
        if (configuredRoomName && room === configuredRoomName) {
          return false;
        }
        return true;
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

  const trimmedRoom = roomName.trim();
  const trimmedParticipantName = participantName.trim();
  const trimmedToken = llmToken.trim();
  const isConfiguredRoom = Boolean(configuredRoomName) && trimmedRoom === configuredRoomName;
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
        setAgentIdentity((prev) => (dispatchAgentName && dispatchAgentName !== prev ? dispatchAgentName : prev));
      }
      if (!data.active && pauseRequestedRef.current) {
        setAgentStatus('paused');
        setAgentMessage('Агент на паузі.');
        return 'paused';
      }
      const nextStatus: AgentStatus = data.active ? 'active' : 'idle';
      setAgentStatus(nextStatus);
      if (nextStatus === 'active') {
        setAgentMessage((prev) => (prev && prev.includes('паузі') ? prev : 'Агент у кімнаті.'));
      } else if (!pauseRequestedRef.current) {
        setAgentMessage(null);
      }
      return nextStatus;
    } catch (error) {
      console.warn('fetchAgentStatus failed', error);
      setAgentStatus('error');
      setAgentMessage('Не вдалося отримати стан агента.');
      return 'error';
    }
  }, [trimmedRoom]);

  useEffect(() => {
    if (!credentials || !trimmedRoom) {
      setAgentStatus('idle');
      setAgentMessage(null);
      pauseRequestedRef.current = false;
      return;
    }
    if (agentStatus === 'paused') {
      if (!agentMessage) {
        setAgentMessage('Агент на паузі.');
      }
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
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [credentials, trimmedRoom, agentStatus, fetchAgentStatus, agentMessage]);

  useEffect(() => {
    const previous = previousAgentStatusRef.current;
    if (agentStatus === 'active' && previous !== 'active') {
      setAgentMessage('Агент приєднався.');
    } else if (agentStatus === 'paused' && previous !== 'paused') {
      setAgentMessage('Агент на паузі.');
    } else if (agentStatus === 'idle' && previous === 'active' && !pauseRequestedRef.current) {
      setAgentMessage('Агент відʼєднався.');
    }
    if (agentStatus !== 'paused' && pauseRequestedRef.current && agentStatus !== 'requesting') {
      pauseRequestedRef.current = false;
    }
    previousAgentStatusRef.current = agentStatus;
  }, [agentStatus]);

  const showLlmTokenField = isCreator;
  const canInviteAgent = Boolean(effectiveAgentToken) || isConfiguredRoom;
  const readyToConnect = trimmedRoom !== '' && trimmedParticipantName !== '';

  const connectButtonText = connecting ? 'Зачекайте…' : isCreator ? 'Почати трансляцію' : 'Підключитися';
  const inviteButtonLabel =
    agentStatus === 'active'
      ? 'Агент у кімнаті'
      : agentStatus === 'requesting'
      ? 'Запрошую…'
      : agentStatus === 'paused'
      ? 'Агент на паузі'
      : agentStatus === 'error'
      ? 'Спробувати ще раз'
      : 'Запросити агента';
  const pauseButtonLabel = agentStatus === 'paused' ? 'Активувати' : 'Пауза';
  const inviteDisabled = !credentials || !canInviteAgent || agentStatus === 'requesting';
  const showInviteButton = canInviteAgent && (agentStatus === 'idle' || agentStatus === 'error');
  const showPauseButton = agentStatus === 'active' || agentStatus === 'paused';
  const pauseDisabled = !credentials || agentStatus === 'requesting';
  const showInviteHint = !canInviteAgent && isCreator;

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
      setAgentMessage(null);
      pauseRequestedRef.current = false;
    } catch (error) {
      console.warn('clearAgentDispatch failed', error);
    }
  }, [trimmedRoom]);

  const handleCreateRoom = useCallback(() => {
    const generated = generateRoomName();
    setRoomName(generated);
    setIsCreator(true);
    setLlmToken('');
    setCredentials(null);
    setStatus(null);
    setError(null);
    setConnecting(false);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!readyToConnect) {
      setError('Вкажіть своє ім’я.');
      return;
    }

    try {
      setConnecting(true);
      setError(null);
      setStatus('Готую з’єднання…');
      const tokenResp = await requestToken(trimmedRoom, trimmedParticipantName);
      setCredentials(tokenResp);
      setStatus('Трансляція активна.');
      if (trimmedRoom) {
        setTokenByRoom((prev) => {
          if (!isConfiguredRoom && trimmedToken) {
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
      await clearAgentDispatch();
    } catch (err) {
      console.error(err);
      setCredentials(null);
      setStatus(null);
      setError(err instanceof Error ? err.message : 'Не вдалося отримати токен.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = useCallback(() => {
    setCredentials(null);
    setStatus('З’єднання завершено.');
    setAgentStatus('idle');
    setAgentMessage(null);
    pauseRequestedRef.current = false;
    void clearAgentDispatch();
  }, [clearAgentDispatch]);

  const handleAgentPresenceChange = useCallback((present: boolean) => {
    setAgentStatus((prev) => {
      if (present) {
        return prev === 'paused' ? 'paused' : 'active';
      }
      if (prev === 'active') {
        return 'idle';
      }
      return prev;
    });
    setAgentMessage((prev) => {
      if (present) {
        return prev && prev.includes('паузі') ? prev : 'Агент у кімнаті.';
      }
      if (pauseRequestedRef.current) {
        return prev && prev.includes('паузі') ? prev : 'Агент на паузі.';
      }
      if (prev && prev.includes('Агент у кімнаті')) {
        return null;
      }
      return prev;
    });
  }, []);

  const ensureAgentActive = useCallback(
    async (mode: 'invite' | 'resume') => {
      if (!credentials) {
        setAgentMessage('Спершу підключіться до кімнати.');
        return;
      }
      if (!trimmedRoom) {
        setAgentMessage('Спершу створіть або оберіть кімнату.');
        return;
      }
      if (mode === 'invite' && (agentStatus === 'active' || agentStatus === 'paused')) {
        setAgentMessage('Агент уже підключений.');
        return;
      }
      if (!effectiveAgentToken && !isConfiguredRoom) {
        setAgentMessage('Щоб запросити агента, додайте LLM токен.');
        return;
      }

      try {
        pauseRequestedRef.current = false;
        setAgentStatus('requesting');
        setAgentMessage(mode === 'resume' ? 'Активую агента…' : 'Запрошую агента…');

        const metadata: AgentMetadata = {
          roomName: trimmedRoom,
          participantName: trimmedParticipantName || 'Учасник',
        };

        if (effectiveAgentToken) {
          metadata.gemini_api_key = effectiveAgentToken;
        }
        if (!isCreator) {
          metadata.multi_participant = true;
        }

        await ensureAgentDispatch(trimmedRoom, metadata);
        const status = await fetchAgentStatus();
        if (status === 'idle') {
          //setAgentMessage('Очікую на підключення агента…');
        }
      } catch (error) {
        console.error('ensureAgentActive failed', error);
        setAgentStatus('error');
        setAgentMessage(mode === 'resume' ? 'Не вдалося активувати агента.' : 'Не вдалося запросити агента.');
      }
    },
    [
      credentials,
      trimmedRoom,
      effectiveAgentToken,
      isConfiguredRoom,
      trimmedParticipantName,
      isCreator,
      fetchAgentStatus,
      agentStatus,
    ],
  );

  const handleRequestAgent = useCallback(() => {
    void ensureAgentActive('invite');
  }, [ensureAgentActive]);

  const handleToggleAgentListening = useCallback(async () => {
    if (!credentials) {
      setAgentMessage('Спершу підключіться до кімнати.');
      return;
    }
    if (!trimmedRoom) {
      setAgentMessage('Спершу створіть або оберіть кімнату.');
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
      setAgentStatus('requesting');
      setAgentMessage('Призупиняю агента…');

      const response = await fetch(`/api/dispatch?room=${encodeURIComponent(trimmedRoom)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to pause agent');
      }
      setAgentStatus('paused');
      setAgentMessage('Агент на паузі.');
    } catch (error) {
      console.error('handleToggleAgentListening failed', error);
      pauseRequestedRef.current = false;
      setAgentStatus('error');
      setAgentMessage('Не вдалося призупинити агента.');
    }
  }, [agentStatus, credentials, ensureAgentActive, trimmedRoom]);

  return (
    <main className={`layout${credentials ? ' layout-room-active' : ''}`} data-lk-theme="default">
      {!credentials && (
        <section className="card" aria-live="polite">
          <h1>{!roomName ? 'Створити трансляцію' : 'Вітаю' } {participantName}</h1>

          {!roomName ? (
            <>
              <p>Натисніть нижче, щоб створити нову трансляцію і запросити людину-асистента.</p>
              <div className="actions">
                <button type="button" onClick={handleCreateRoom} aria-label="Створити трансляцію">
                  Створити трансляцію
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Вашу кімнату для зустрічі створено.<br />
                {trimmedParticipantName
                  ? 'Натисніть кнопку, щоб підключитися.'
                  : showLlmTokenField
                    ? 'Вкажіть своє імʼя, за бажанням додайте LLM токен і натисніть кнопку, щоб підключитися.'
                    : 'Вкажіть своє імʼя і натисніть кнопку, щоб підключитися.'}
              </p>

              {isCreator && shareLink && (
                <div className="share-block">
                  <span>Посилання для асистента:</span>
                  <div className="share-link" aria-live="polite">
                    {shareLink}
                  </div>
                </div>
              )}

              <form className="inputs" onSubmit={handleSubmit}>
                {!trimmedParticipantName && (
                  <label>
                    Ваше імʼя
                    <input
                      type="text"
                      required
                      value={participantName}
                      placeholder="Наприклад, Олексій"
                      onChange={(event) => setParticipantName(event.target.value)}
                    />
                  </label>
                )}

                {showLlmTokenField && (
                  <>
                    <label>
                      LLM API токен для ШІ асистента (необов’язково)
                      <input
                        type="text"
                        value={llmToken}
                        placeholder="Вставте токен вашого асистента"
                        onChange={(event) => setLlmToken(event.target.value)}
                        aria-describedby="llm-token-hint"
                      />
                    </label>
                    <small id="llm-token-hint" className="hint">
                      Токен збережеться в браузері і, якщо введений, передаватиметься асистенту. Без токена працюватиме
                      звичайна відеозустріч.
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

          {status && <p className="status-message">{status}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {credentials && (
        <section className="room-container" aria-label="Кімната відеозвʼязку">
          <LiveKitRoom
            serverUrl={credentials.serverUrl}
            token={credentials.token}
            connect
            audio
            video
            options={liveKitOptions}
            onDisconnected={handleDisconnect}
            style={{ height: '100%', width: '100%' }}
          >
            <UkrainianConference
              onLeave={handleDisconnect}
              onInviteAgent={handleRequestAgent}
              onToggleAgent={handleToggleAgentListening}
              inviteDisabled={inviteDisabled}
              pauseDisabled={pauseDisabled}
              inviteButtonLabel={inviteButtonLabel}
              pauseButtonLabel={pauseButtonLabel}
              showInviteButton={showInviteButton}
              showPauseButton={showPauseButton}
              showInviteHint={showInviteHint}
              roomName={roomName}
              agentMessage={agentMessage}
              agentIdentity={agentIdentity}
              onAgentPresenceChange={handleAgentPresenceChange}
              agentStatus={agentStatus}
            />
          </LiveKitRoom>
        </section>
      )}
    </main>
  );
}

function CameraSwitchButton({
  descriptionId,
  onAvailabilityChange,
}: {
  descriptionId: string;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const room = useRoomContext();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!room) return;

    let cancelled = false;

    const loadDevices = async (requestPermissions: boolean) => {
      try {
        const available = await Room.getLocalDevices('videoinput', requestPermissions);
        if (cancelled) return;
        const usable = available.filter(
          (device) =>
            device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications',
        );
        setDevices(usable);
        const active = room.getActiveDevice('videoinput');
        if (
          active &&
          active !== 'default' &&
          active !== 'communications' &&
          usable.some((device) => device.deviceId === active)
        ) {
          setActiveDeviceId(active);
        } else if (usable.length > 0) {
          setActiveDeviceId(usable[0].deviceId);
        } else {
          setActiveDeviceId(null);
        }
      } catch (err) {
        console.warn('Не вдалося отримати перелік камер', err);
        setDevices([]);
        setActiveDeviceId(null);
      }
    };

    void loadDevices(true);

    const handleChanged = () => {
      void loadDevices(false);
    };

    room.on(RoomEvent.MediaDevicesChanged, handleChanged);

    return () => {
      cancelled = true;
      room.off(RoomEvent.MediaDevicesChanged, handleChanged);
    };
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const active = room.getActiveDevice('videoinput');
    if (active && active !== activeDeviceId) {
      setActiveDeviceId(active);
    }
  }, [room, activeDeviceId]);

  const activeDevice = useMemo(
    () => devices.find((device) => device.deviceId === activeDeviceId) ?? null,
    [devices, activeDeviceId],
  );
  const hasMultipleCameras = devices.length > 1;

  useEffect(() => {
    onAvailabilityChange?.(hasMultipleCameras);
  }, [onAvailabilityChange, hasMultipleCameras]);

  const handleSwitch = useCallback(async () => {
    if (!room || !hasMultipleCameras || pending) {
      return;
    }
    const currentIndex = devices.findIndex((device) => device.deviceId === activeDeviceId);
    const nextDevice = devices[(currentIndex + 1) % devices.length];
    if (!nextDevice) {
      return;
    }
    try {
      setPending(true);
      await room.switchActiveDevice('videoinput', nextDevice.deviceId);
      setActiveDeviceId(nextDevice.deviceId);
    } catch (err) {
      console.warn('Не вдалося перемкнути камеру', err);
    } finally {
      setPending(false);
    }
  }, [room, devices, activeDeviceId, pending]);

  const buttonText = pending ? 'Перемикаю…' : 'Перемкнути камеру';
  const ariaLabel = activeDevice
    ? `Перемкнути камеру. Використовується ${describeCamera(activeDevice)}`
    : 'Перемкнути камеру';
  const disabled = !room || !hasMultipleCameras || pending;
  const title = activeDevice ? `Зараз використовується: ${describeCamera(activeDevice)}` : undefined;

  if (!hasMultipleCameras) {
    return null;
  }

  return (
    <button
      type="button"
      className="ua-button"
      onClick={handleSwitch}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      aria-describedby={descriptionId}
    >
      {buttonText}
    </button>
  );
}

function UkrainianConference({
  onLeave,
  onInviteAgent,
  onToggleAgent,
  inviteDisabled,
  pauseDisabled,
  inviteButtonLabel,
  pauseButtonLabel,
  showInviteButton,
  showPauseButton,
  showInviteHint,
  roomName,
  agentMessage,
  agentIdentity,
  onAgentPresenceChange,
  agentStatus,
}: {
  onLeave: () => void;
  onInviteAgent: () => void;
  onToggleAgent: () => void | Promise<void>;
  inviteDisabled: boolean;
  pauseDisabled: boolean;
  inviteButtonLabel: string;
  pauseButtonLabel: string;
  showInviteButton: boolean;
  showPauseButton: boolean;
  showInviteHint: boolean;
  roomName: string;
  agentMessage: string | null;
  agentIdentity: string;
  onAgentPresenceChange: (present: boolean) => void;
  agentStatus: AgentStatus;
}) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );
  const isMobile = useIsMobile();
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const unmuteHintId = useId();
  const micHintId = useId();
  const camHintId = useId();
  const switchHintId = useId();
  const inviteHintId = useId();
  const pauseHintId = useId();
  const shareHintId = useId();
  const leaveHintId = useId();
  const participants = useParticipants();
  const agentParticipant = useMemo(
    () =>
      agentIdentity
        ? participants.find((participant) => participant.identity === agentIdentity) ?? null
        : null,
    [participants, agentIdentity],
  );

  useEffect(() => {
    onAgentPresenceChange(Boolean(agentParticipant));
  }, [agentParticipant, onAgentPresenceChange]);

  return (
    <div className="ua-conference">
      <RoomAudioRenderer />
      <div className="ua-overlays">
        {roomName && (
          <div className="ua-overlay ua-overlay-room">Кімната: <strong>{roomName}</strong></div>
        )}
        {agentMessage && (
          <div
            className={`ua-overlay ua-overlay-agent${agentStatus === 'error' ? ' ua-overlay-error' : ''}`}
            role="status"
          >
            {agentMessage}
          </div>
        )}
        {showInviteHint && (
          <div className="ua-overlay ua-overlay-hint" role="status">
            Щоб запросити агента, додайте LLM токен.
          </div>
        )}
      </div>
      <div className="ua-grid">
        <GridLayout tracks={tracks}>
          <ParticipantTile />
        </GridLayout>
      </div>
      <div className="ua-controls">
        {/* <ul className="sr-only" aria-label="Опис кнопок керування конференцією">
          <li id={unmuteHintId}>
            Увімкнути звук: надає браузеру доступ до аудіо, щоб ви могли чути інших учасників.
          </li>
          <li id={micHintId}>Мікрофон: вмикає або вимикає ваш голос під час дзвінка.</li>
          <li id={camHintId}>Камера: показує або приховує ваше відео.</li>
          {canSwitchCamera && <li id={switchHintId}>Перемкнути камеру: вибирає іншу камеру вашого пристрою.</li>}
          {showInviteButton && (
            <li id={inviteHintId}>Запросити агента: додає асистента, щоб допомогти описувати події під час сеансу.</li>
          )}
          {showInviteHint && (
            <li>Щоб запросити агента, додайте LLM токен.</li>
          )}
          {showPauseButton && (
            <li id={pauseHintId}>
              Пауза агента: тимчасово вимикає агента; натисніть «Активувати», щоб знову дозволити йому слухати.
            </li>
          )}
          {!isMobile && (
            <li id={shareHintId}>
              Показати екран: передає зображення вашого екрана співрозмовнику (доступно лише на компʼютері).
            </li>
          )}
          <li id={leaveHintId}>Завершення сеансу: завершує трансляцію й вимикає всі пристрої.</li>
        </ul> */}
        {/* <StartMediaButton
          className="ua-button"
          data-variant="primary"
          aria-describedby={unmuteHintId}
          aria-label="Увімкнути звук і дозволити відтворення аудіо"
        >
          Увімкнути звук
        </StartMediaButton> */}
        <AccessibleTrackToggle
          source={Track.Source.Microphone}
          baseLabel="Мікрофон"
          labelOn="Мікрофон увімкнено. Натисніть, щоб вимкнути."
          labelOff="Мікрофон вимкнено. Натисніть, щоб увімкнути."
          className="ua-button"
          // aria-describedby={micHintId}
        >
          Мікрофон
        </AccessibleTrackToggle>
        <AccessibleTrackToggle
          source={Track.Source.Camera}
          baseLabel="Камера"
          labelOn="Камера увімкнена. Натисніть, щоб вимкнути."
          labelOff="Камера вимкнена. Натисніть, щоб увімкнути."
          className="ua-button"
          // aria-describedby={camHintId}
        >
          Камера
        </AccessibleTrackToggle>
        <CameraSwitchButton descriptionId={switchHintId} onAvailabilityChange={setCanSwitchCamera} />
        {showInviteButton && (
          <button
            type="button"
            className="ua-button secondary"
            onClick={onInviteAgent}
            disabled={inviteDisabled}
            // aria-describedby={inviteHintId}
            aria-label="Запросити агента"
          >
            {inviteButtonLabel}
          </button>
        )}
        {showPauseButton && (
          <button
            type="button"
            className="ua-button secondary"
            onClick={() => {
              const result = onToggleAgent();
              if (result instanceof Promise) {
                void result;
              }
            }}
            disabled={pauseDisabled}
            // aria-describedby={pauseHintId}
            aria-label={agentStatus === 'paused' ? 'Активувати агента' : 'Призупинити агента'}
          >
            {pauseButtonLabel}
          </button>
        )}
        {!isMobile && (
          <AccessibleTrackToggle
            source={Track.Source.ScreenShare}
            baseLabel="Показ екрану"
            labelOn="Показ екрану активний. Натисніть, щоб зупинити."
            labelOff="Показ екрану вимкнений. Натисніть, щоб увімкнути."
            className="ua-button"
            captureOptions={{ audio: true, selfBrowserSurface: 'include' }}
            // aria-describedby={shareHintId}
          >
            Показати екран
          </AccessibleTrackToggle>
        )}
        <DisconnectButton
          className="ua-button danger"
          stopTracks
          onClick={onLeave}
          // aria-describedby={leaveHintId}
          aria-label="Завершити трансляцію"
        >
          Завершення сеансу
        </DisconnectButton>
      </div>
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(() => detectMobileViewport());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsMobile(detectMobileViewport());
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return isMobile;
}
