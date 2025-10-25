import { FormEvent, useEffect, useMemo, useState } from 'react';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

interface TokenResponse {
  token: string;
  serverUrl: string;
  identity: string;
}

const storedNameKey = 'camera-mother-name';

function generateRoomName() {
  const adjectives = ['Затишна', 'Сонячна', 'Тиха', 'Весела', 'Світла'];
  const nouns = ['кімната', 'зустріч', 'майстерня', 'студія', 'гостина'];
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective} ${noun}`;
}

async function requestToken(room: string, name: string) {
  const url = new URL(`/api/token`, window.location.origin);
  url.searchParams.set('room', room);
  url.searchParams.set('name', name);

  const response = await fetch(url.toString());
  const text = await response.text();
  try {
    return JSON.parse(text) as TokenResponse;
  } catch (error) {
    throw new Error(text || 'Невідома помилка токена');
  }
}

export default function App() {
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const urlRoom = search.get('room');
  const isViewer = Boolean(urlRoom);

  const [roomName, setRoomName] = useState(() => urlRoom ?? generateRoomName());
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

  const readyToConnect = useMemo(() => roomName.trim() !== '' && participantName.trim() !== '', [roomName, participantName]);
  const showNameInput = useMemo(() => isEditingName || participantName.trim() === '', [isEditingName, participantName]);

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

  return (
    <main className="layout" data-lk-theme="default">
      <section className="card" aria-live="polite">
        <h1>{isViewer ? 'Приєднатися до трансляції' : 'Створити трансляцію'}</h1>
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
            Назва кімнати
            <input
              type="text"
              required
              value={roomName}
              onChange={(ev) => {
                if (!isViewer) {
                  setRoomName(ev.target.value);
                }
              }}
              readOnly={isViewer}
            />
          </label>
          {!isViewer && (
            <button
              type="button"
              className="secondary"
              onClick={() => setRoomName(generateRoomName())}
            >
              Згенерувати іншу назву
            </button>
          )}

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
            <button type="button" className="secondary" onClick={handleDisconnect}>
              Від’єднатися
            </button>
          </div>
        </form>

        {status && <p>{status}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {credentials && (
        <section className="room-container" aria-label="Кімната відеозвʼязку">
          <LiveKitRoom
            serverUrl={credentials.serverUrl}
            token={credentials.token}
            connect
            audio={autoDevices}
            video={autoDevices}
            options={{ adaptiveStream: true, dynacast: true }}
            style={{ height: '100%', width: '100%' }}
          >
            <VideoConference />
          </LiveKitRoom>
        </section>
      )}
    </main>
  );
}
