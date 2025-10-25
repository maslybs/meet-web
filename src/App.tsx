import { FormEvent, useEffect, useMemo, useState } from 'react';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

interface TokenResponse {
  token: string;
  serverUrl: string;
  identity: string;
}

const DEMO_SERVER = 'wss://demo.livekit.cloud';
const PLAYGROUND_URL = 'https://livekit.io/api/playground';

function randomSuffix(length = 3) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function generateRoomName() {
  const bases = ['Вітальня', 'Студія', 'Світлиця', 'Майстерня', 'Тераса'];
  const base = bases[Math.floor(Math.random() * bases.length)];
  const year = new Date().getFullYear().toString().slice(-2);
  return `${base}-${year}${randomSuffix(2)}`;
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
  const [participantName, setParticipantName] = useState('');
  const [serverUrl, setServerUrl] = useState(DEMO_SERVER);
  const [autoDevices, setAutoDevices] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<TokenResponse | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!isViewer) {
      setServerUrl(DEMO_SERVER);
      setCredentials(null);
      setStatus(null);
      setParticipantName('');
    }
  }, [isViewer]);

  useEffect(() => {
    setCredentials(null);
    setStatus(null);
  }, [roomName]);

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomName);
    return url.toString();
  }, [roomName]);

  const readyToConnect = useMemo(() => roomName.trim() !== '' && participantName.trim() !== '' && serverUrl.trim() !== '', [roomName, participantName, serverUrl]);

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
        <h1>{isViewer ? 'Приєднатися до кімнати' : 'Створити кімнату LiveKit'}</h1>
        <p>
          {isViewer
            ? 'Введіть своє ім’я та натисніть “Підключитися”, щоб говорити з ведучим.'
            : 'Оберіть зручну назву кімнати, поділіться посиланням із асистентом і вкажіть своє ім’я.'}
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

          <label>
            Ваше імʼя
            <input
              type="text"
              required
              value={participantName}
              placeholder="Наприклад, Олексій"
              onChange={(ev) => setParticipantName(ev.target.value)}
            />
          </label>

          <label>
            LiveKit URL
            <input
              type="url"
              required
              value={serverUrl}
              placeholder="wss://..."
              onChange={(ev) => setServerUrl(ev.target.value)}
            />
          </label>

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

        <details>
          <summary>Як отримати токен?</summary>
          <ol>
            <li>У LiveKit Cloud створіть API ключ і секрет.</li>
            <li>
              Сформуйте токен у{' '}
              <a href={PLAYGROUND_URL} target="_blank" rel="noopener noreferrer">
                Playground
              </a>{' '}
              або власним бекендом (приклад функції див. у `functions/api/token.ts`).
            </li>
            <li>Вставте URL і токен у форму та натисніть “Підключитися”.</li>
          </ol>
        </details>
      </section>

      <section className="room-container" aria-label="Кімната відеозвʼязку">
        {credentials ? (
          <LiveKitRoom
            serverUrl={credentials.serverUrl || serverUrl}
            token={credentials.token}
            connect
            audio={autoDevices}
            video={autoDevices}
            options={{ adaptiveStream: true, dynacast: true }}
            style={{ height: '100%', width: '100%' }}
          >
            <VideoConference />
          </LiveKitRoom>
        ) : (
          <div className="placeholder">Трансляція зʼявиться після підключення.</div>
        )}
      </section>
    </main>
  );
}
