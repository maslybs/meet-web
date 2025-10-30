import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DisconnectButton,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  StartMediaButton,
  TrackToggle,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
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
  llmToken?: string;
}

const storedNameKey = 'camera-mother-name';
const storedLlmTokenKey = 'camera-mother-llm-token';

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

async function ensureAgentDispatch(room: string, metadata: AgentMetadata) {
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

  const [roomName, setRoomName] = useState(() => (initialRoom ? initialRoom : ''));
  const [isCreator, setIsCreator] = useState(() => !initialRoom);
  const [participantName, setParticipantName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(storedNameKey) ?? '';
  });
  const [llmToken, setLlmToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(storedLlmTokenKey) ?? '';
  });
  const [credentials, setCredentials] = useState<TokenResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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
    if (llmToken.trim()) {
      window.localStorage.setItem(storedLlmTokenKey, llmToken.trim());
    } else {
      window.localStorage.removeItem(storedLlmTokenKey);
    }
  }, [llmToken]);

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

  const needsLlmToken = isCreator;
  const readyToConnect =
    roomName.trim() !== '' && participantName.trim() !== '' && (!needsLlmToken || llmToken.trim() !== '');

  const connectButtonText = connecting ? 'Зачекайте…' : isCreator ? 'Почати трансляцію' : 'Підключитися';

  const handleCreateRoom = useCallback(() => {
    const generated = generateRoomName();
    setRoomName(generated);
    setIsCreator(true);
    setCredentials(null);
    setStatus(null);
    setError(null);
    setConnecting(false);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!readyToConnect) {
      setError(needsLlmToken ? 'Вкажіть ім’я та LLM токен.' : 'Вкажіть своє ім’я.');
      return;
    }

    const trimmedRoom = roomName.trim();
    const trimmedName = participantName.trim();
    const trimmedToken = llmToken.trim();

    try {
      setConnecting(true);
      setError(null);
      setStatus('Активую асистента…');
      const metadata: AgentMetadata = {
        roomName: trimmedRoom,
        participantName: trimmedName,
      };
      if (trimmedToken) {
        metadata.llmToken = trimmedToken;
      }
      await ensureAgentDispatch(trimmedRoom, metadata);
      setStatus('Отримую токен…');
      const tokenResp = await requestToken(trimmedRoom, trimmedName);
      setCredentials(tokenResp);
      setStatus('Трансляція активна.');
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
  }, []);

  return (
    <main className="layout" data-lk-theme="default">
      {!credentials && (
        <section className="card" aria-live="polite">
          <h1>{!roomName ? 'Створити трансляцію' : 'Вітаю'}</h1>

          {!roomName ? (
            <>
              <p>Натисніть нижче, щоб створити нову трансляцію і запросити людину-асистента.</p>
              <div className="actions">
                <button type="button" onClick={handleCreateRoom}>
                  Створити трансляцію
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Вашу кімнату для зустрічі створено.<br/>Якщо потрібно ви можете змінити ім’я: {needsLlmToken ? 'LLM токен і ' : ''}
                Натисніть кнопку, щоб підключитися.
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

                {needsLlmToken && (
                  <label>
                    LLM API токен для ШІ асистента
                    <input
                      type="text"
                      required
                      value={llmToken}
                      placeholder="Вставте токен вашого асистента"
                      onChange={(event) => setLlmToken(event.target.value)}
                      aria-describedby="llm-token-hint"
                    />
                  </label>
                )}

                {needsLlmToken && (
                  <small id="llm-token-hint" className="hint">
                    Токен збережеться в браузері й автоматично передаватиметься ШІ асистенту.
                  </small>
                )}

                <div className="actions">
                  <button type="submit" disabled={connecting}>
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
            <UkrainianConference onLeave={handleDisconnect} />
          </LiveKitRoom>
        </section>
      )}
    </main>
  );
}

function CameraSwitchButton() {
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

  const handleSwitch = useCallback(async () => {
    if (!room || devices.length <= 1 || pending) {
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
  const disabled = !room || devices.length <= 1 || pending;
  const title = activeDevice ? `Зараз використовується: ${describeCamera(activeDevice)}` : undefined;

  return (
    <button
      type="button"
      className="ua-button"
      onClick={handleSwitch}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {buttonText}
    </button>
  );
}

function UkrainianConference({ onLeave }: { onLeave: () => void }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  return (
    <div className="ua-conference">
      <RoomAudioRenderer />
      <div className="ua-grid">
        <GridLayout tracks={tracks}>
          <ParticipantTile />
        </GridLayout>
      </div>
      <div className="ua-controls">
        <StartMediaButton className="ua-button" data-variant="primary">
          Увімкнути звук
        </StartMediaButton>
        <TrackToggle source={Track.Source.Microphone} className="ua-button">
          Мікрофон
        </TrackToggle>
        <TrackToggle source={Track.Source.Camera} className="ua-button">
          Камера
        </TrackToggle>
        <CameraSwitchButton />
        <TrackToggle
          source={Track.Source.ScreenShare}
          className="ua-button"
          captureOptions={{ audio: true, selfBrowserSurface: 'include' }}
        >
          Показати екран
        </TrackToggle>
        <DisconnectButton className="ua-button danger" onClick={onLeave}>
          Вийти
        </DisconnectButton>
      </div>
    </div>
  );
}
