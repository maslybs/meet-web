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
import { RemoteParticipant, Room, RoomEvent, Track, facingModeFromDeviceLabel } from 'livekit-client';
import '@livekit/components-styles';
import './style.css';

interface TokenResponse {
  token: string;
  serverUrl: string;
  identity: string;
}

const storedNameKey = 'camera-mother-name';
const storedContactsKey = 'camera-mother-contacts';
const fixedRoomName = 'my-room';

interface ContactEntry {
  pairId: string;
  selfName: string;
  peerName: string;
  lastRoom: string;
  lastConnected: number;
}

function extractDisplayName(identity: string) {
  const trimmed = identity.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed.split('-');
  if (parts.length <= 1) {
    return trimmed;
  }
  const possibleSuffix = parts[parts.length - 1];
  if (/^[0-9A-Z]{4}$/.test(possibleSuffix)) {
    return parts.slice(0, -1).join('-');
  }
  return trimmed;
}

function normalizeNameForId(name: string) {
  return name.trim().toLowerCase();
}

function makePairId(a: string, b: string) {
  const parts = [normalizeNameForId(a), normalizeNameForId(b)].sort((left, right) =>
    left.localeCompare(right, 'uk'),
  );
  return parts.join('__');
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

function selectPreferredCamera(
  devices: MediaDeviceInfo[],
  activeDeviceId?: string,
): MediaDeviceInfo | undefined {
  const candidates = devices.filter(
    (device) =>
      device.kind === 'videoinput' &&
      device.deviceId &&
      device.deviceId !== 'default' &&
      device.deviceId !== 'communications',
  );

  if (candidates.length === 0) {
    return undefined;
  }

  const environmentDevices = candidates.filter((device) => isEnvironmentCamera(device));
  if (environmentDevices.length === 0) {
    return undefined;
  }

  if (activeDeviceId) {
    const different = environmentDevices.find((device) => device.deviceId !== activeDeviceId);
    if (different) {
      return different;
    }
    return undefined;
  }

  return environmentDevices[0];
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
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialRoom = search.get('room');

  const [isViewer, setIsViewer] = useState(() => Boolean(initialRoom));
  const roomName = fixedRoomName;
  const [participantName, setParticipantName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(storedNameKey) ?? '';
  });
  const [isEditingName, setIsEditingName] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(storedNameKey) ?? '';
    return stored.trim() === '';
  });
  const [autoDevices, setAutoDevices] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<TokenResponse | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [contacts, setContacts] = useState<ContactEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(storedContactsKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const lastConnected =
            typeof (item as { lastConnected?: number }).lastConnected === 'number'
              ? (item as { lastConnected: number }).lastConnected
              : 0;

          if (typeof (item as { pairId?: string }).pairId === 'string') {
            const selfName =
              typeof (item as { selfName?: string }).selfName === 'string'
                ? (item as { selfName: string }).selfName.trim()
                : '';
            const peerName =
              typeof (item as { peerName?: string }).peerName === 'string'
                ? (item as { peerName: string }).peerName.trim()
                : '';
            const lastRoom =
              typeof (item as { lastRoom?: string }).lastRoom === 'string'
                ? (item as { lastRoom: string }).lastRoom.trim()
                : '';
            if (!selfName || !peerName) return null;
            const pairId =
              (item as { pairId: string }).pairId || makePairId(selfName, peerName);
            return { pairId, selfName, peerName, lastRoom, lastConnected } as ContactEntry;
          }

          // Legacy shape support
          const legacyName =
            typeof (item as { name?: string }).name === 'string'
              ? (item as { name: string }).name.trim()
              : '';
          const legacyRoom =
            typeof (item as { room?: string }).room === 'string'
              ? (item as { room: string }).room.trim()
              : '';
          if (!legacyName || !legacyRoom) return null;
          const storedSelf =
            typeof window !== 'undefined'
              ? (window.localStorage.getItem(storedNameKey) ?? '').trim()
              : '';
          if (!storedSelf) return null;
          return {
            pairId: makePairId(storedSelf, legacyName),
            selfName: storedSelf,
            peerName: legacyName,
            lastRoom: legacyRoom,
            lastConnected,
          } as ContactEntry;
        })
        .filter((x): x is ContactEntry => Boolean(x))
        .sort((a, b) => b.lastConnected - a.lastConnected);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (participantName) {
      window.localStorage.setItem(storedNameKey, participantName);
    }
  }, [participantName]);

  useEffect(() => {
    if (participantName.trim() === '') {
      setIsEditingName(true);
    }
  }, [participantName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storedContactsKey,
        JSON.stringify(
          contacts.map((contact) => ({
            pairId: contact.pairId,
            selfName: contact.selfName,
            peerName: contact.peerName,
            lastRoom: contact.lastRoom,
            lastConnected: contact.lastConnected,
          })),
        ),
      );
    } catch {
      // ignore storage errors
    }
  }, [contacts]);

  useEffect(() => {
    if (!isViewer) {
      setCredentials(null);
      setStatus(null);
    }
  }, [isViewer]);

  useEffect(() => {
    setCredentials(null);
    setStatus(null);
    if (!isViewer && typeof window !== 'undefined') {
      const url = new URL(window.location.origin);
      url.searchParams.set('room', roomName);
      window.history.replaceState(null, '', url.toString());
    }
  }, [roomName, isViewer]);

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.origin);
    url.searchParams.set('room', roomName);
    return url.toString();
  }, [roomName]);

  const readyToConnect = useMemo(() => participantName.trim() !== '', [participantName]);
  const showNameInput = useMemo(() => isEditingName || participantName.trim() === '', [isEditingName, participantName]);

  const switchToHostMode = useCallback(() => {
    setIsViewer(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.origin);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const handleContactSeen = useCallback(
    ({ peerName, selfName, room }: { peerName: string; selfName: string; room: string }) => {
      const trimmedPeer = peerName.trim();
      const trimmedSelf = selfName.trim();
      const trimmedRoom = room.trim();
      if (!trimmedPeer || !trimmedSelf) {
        return;
      }
      const pairId = makePairId(trimmedSelf, trimmedPeer);
      setContacts((prev) => {
        const filtered = prev.filter((contact) => contact.pairId !== pairId);
        const updated: ContactEntry = {
          pairId,
          selfName: trimmedSelf,
          peerName: trimmedPeer,
          lastRoom: trimmedRoom || '',
          lastConnected: Date.now(),
        };
        return [updated, ...filtered].sort((a, b) => b.lastConnected - a.lastConnected);
      });
    },
    [],
  );

  const handleSelectContact = useCallback(
    (contact: ContactEntry) => {
      switchToHostMode();
      if (contact.selfName.trim()) {
        setParticipantName(contact.selfName.trim());
        setIsEditingName(false);
      }
      setError(null);
      setStatus(null);
      setCredentials(null);
    },
    [switchToHostMode, setParticipantName, setIsEditingName],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!readyToConnect) {
      setError('Заповніть усі поля.');
      return;
    }
    try {
      setConnecting(true);
      setError(null);
      setStatus('Отримую токен…');
      const tokenResp = await requestToken(roomName, participantName.trim());
      setCredentials(tokenResp);
      setStatus('Підключено до кімнати.');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Не вдалося отримати токен.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setCredentials(null);
    setStatus('З’єднання завершено.');
  };

  const liveKitOptions = useMemo(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { facingMode: 'environment' as const },
    }),
    [],
  );

  return (
    <main className="layout" data-lk-theme="default">
      <section className="card" aria-live="polite">
        <h1>{isViewer ? 'Приєднатися до трансляції' : 'Створити трансляцію'}</h1>
        {credentials ? (
          <div className="connected-panel">
            <p>
              Трансляція активна у кімнаті <strong>{roomName}</strong>. Поділіться назвою або
              посиланням, щоб запросити асистента.
            </p>
            {!isViewer && (
              <div className="share-block">
                <span>Посилання для асистента:</span>
                <div className="share-link" aria-live="polite">
                  {shareLink}
                </div>
              </div>
            )}
            <div className="actions">
              <button type="button" onClick={handleDisconnect}>
                Завершити трансляцію
              </button>
            </div>
          </div>
        ) : (
          <>
            <p>
              {isViewer
                ? showNameInput
                  ? 'Введіть своє ім’я та натисніть “Підключитися”.'
                  : 'Натисніть “Підключитися”, щоб приєднатися.'
                : showNameInput
                ? 'Оберіть зручну назву трансляції, поділіться посиланням або назвою із асистентом і вкажіть своє ім’я.'
                : 'Оберіть зручну назву трансляції, поділіться посиланням або назвою із асистентом і натисніть “Підключитися”.'}
            </p>

            <form className="inputs" onSubmit={handleSubmit}>
              <label>
                Назва трансляції
                <input type="text" required readOnly value={roomName} />
              </label>

              {showNameInput ? (
                <label>
                  Ваше імʼя
                  <input
                    type="text"
                    required
                    value={participantName}
                    placeholder="Наприклад, Олексій"
                    onChange={(ev) => setParticipantName(ev.target.value)}
                    onBlur={() => {
                      if (participantName.trim() !== '') {
                        setIsEditingName(false);
                      }
                    }}
                  />
                </label>
              ) : (
                <div className="name-display">
                  <span>
                    Ви підключаєтеся як <strong>{participantName}</strong>
                  </span>
                  <button type="button" className="secondary" onClick={() => setIsEditingName(true)}>
                    Змінити імʼя
                  </button>
                </div>
              )}

              <label className="inline">
                <input
                  type="checkbox"
                  checked={autoDevices}
                  onChange={(ev) => setAutoDevices(ev.target.checked)}
                />
                Автоматично вмикати камеру та мікрофон
              </label>

              {!isViewer && (
                <div className="share-block">
                  <span>Поділіться посиланням з асистентом:</span>
                  <div className="share-link" aria-live="polite">
                    {shareLink}
                  </div>
                </div>
              )}

              <div className="actions">
                <button type="submit" disabled={connecting}>
                  {connecting ? 'Зачекайте…' : 'Підключитися'}
                </button>
              </div>
            </form>
          </>
        )}

        {status && <p>{status}</p>}
        {error && <p className="error">{error}</p>}

        <div className="contacts" aria-label="Контакти">
          <h2>Контакти</h2>
          {contacts.length === 0 ? (
            <p className="contacts-empty">Контакти з’являться тут після першої успішної розмови.</p>
          ) : (
            <ul className="contact-list">
              {contacts.map((contact) => (
                <li key={contact.pairId} className="contact-item">
                  <div className="contact-meta">
                    <strong>{contact.peerName}</strong>
                    <span>{contact.lastRoom || 'Назва кімнати зʼявиться після наступного дзвінка'}</span>
                    <small className="contact-id">
                      ID звʼязку: <code>{contact.pairId}</code>
                    </small>
                  </div>
                  <button type="button" className="secondary" onClick={() => handleSelectContact(contact)}>
                    Почати дзвінок
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {credentials && (
        <section className="room-container" aria-label="Кімната відеозвʼязку">
          <LiveKitRoom
            serverUrl={credentials.serverUrl}
            token={credentials.token}
            connect
            audio={autoDevices}
            video={autoDevices}
            participantName={participantName.trim() || undefined}
            options={liveKitOptions}
            onDisconnected={() => handleDisconnect()}
            style={{ height: '100%', width: '100%' }}
          >
            <ContactListener
              onContact={handleContactSeen}
              fallbackRoomName={roomName}
              fallbackSelfName={participantName}
            />
            <PreferExternalCamera enabled={autoDevices} />
            <UkrainianConference onLeave={handleDisconnect} />
          </LiveKitRoom>
        </section>
      )}
    </main>
  );
}

function ContactListener({
  onContact,
  fallbackRoomName,
  fallbackSelfName,
}: {
  onContact: (details: { peerName: string; selfName: string; room: string }) => void;
  fallbackRoomName: string;
  fallbackSelfName: string;
}) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const activeRoomName = room.name || fallbackRoomName;
    const localIdentity = room.localParticipant?.identity;
    const identityName = localIdentity ? extractDisplayName(localIdentity) : '';
    const localNameFromRoom = room.localParticipant?.name ?? '';
    const resolvedSelfName =
      localNameFromRoom.trim() || fallbackSelfName.trim() || identityName.trim();
    if (!resolvedSelfName) {
      return;
    }

    const handleParticipant = (participant: RemoteParticipant) => {
      if (!participant) return;
      if (participant.identity === localIdentity) return;
      const rawName = (participant.name ?? extractDisplayName(participant.identity)).trim();
      if (!rawName) return;
      onContact({ peerName: rawName, selfName: resolvedSelfName, room: activeRoomName });
    };

    const participantsMap = room.remoteParticipants ?? room.participants;
    participantsMap?.forEach((participant) => handleParticipant(participant));

    const connectedHandler = (participant: RemoteParticipant) => {
      handleParticipant(participant);
    };

    const nameChangedHandler = (participant: RemoteParticipant) => {
      handleParticipant(participant);
    };

    room.on(RoomEvent.ParticipantConnected, connectedHandler);
    room.on(RoomEvent.ParticipantNameChanged, nameChangedHandler);
    room.on(RoomEvent.ParticipantMetadataChanged, nameChangedHandler);

    return () => {
      room.off(RoomEvent.ParticipantConnected, connectedHandler);
      room.off(RoomEvent.ParticipantNameChanged, nameChangedHandler);
      room.off(RoomEvent.ParticipantMetadataChanged, nameChangedHandler);
    };
  }, [room, onContact, fallbackRoomName, fallbackSelfName]);

  return null;
}

function PreferExternalCamera({ enabled }: { enabled: boolean }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    let disposed = false;
    let switching = false;

    const ensurePreferredCamera = async (requestPermissions: boolean) => {
      try {
        const devices = await Room.getLocalDevices('videoinput', requestPermissions);
        if (disposed) {
          return;
        }
        const activeDeviceId = room.getActiveDevice('videoinput');
        const preferredDevice = selectPreferredCamera(devices, activeDeviceId);
        if (!preferredDevice || preferredDevice.deviceId === activeDeviceId) {
          return;
        }
        await room.switchActiveDevice('videoinput', preferredDevice.deviceId);
      } catch (err) {
        console.warn('Не вдалося автоматично обрати основну камеру:', err);
      }
    };

    const scheduleSwitch = (requestPermissions: boolean) => {
      if (switching) {
        return;
      }
      switching = true;
      void ensurePreferredCamera(requestPermissions).finally(() => {
        switching = false;
      });
    };

    scheduleSwitch(enabled);

    const handleDevicesChanged = () => {
      scheduleSwitch(false);
    };

    room.on(RoomEvent.MediaDevicesChanged, handleDevicesChanged);

    return () => {
      disposed = true;
      room.off(RoomEvent.MediaDevicesChanged, handleDevicesChanged);
    };
  }, [room, enabled]);

  return null;
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
        <TrackToggle
          source={Track.Source.ScreenShare}
          className="ua-button"
          captureOptions={{ audio: true, selfBrowserSurface: 'include' }}
        >
          Показати екран
        </TrackToggle>
        <DisconnectButton className="ua-button danger" stopTracks onClick={onLeave}>
          Вийти
        </DisconnectButton>
      </div>
    </div>
  );
}
