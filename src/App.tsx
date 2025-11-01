import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

import UkrainianConference from './components/UkrainianConference';
import type { AgentControlConfig, AgentStatus } from './types/agent';

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

type DispatchResponse = {
  status?: string;
  active?: boolean;
  reused?: boolean;
  agentPresent?: boolean;
  dispatch?: { agentName?: string | null } | null;
};

async function ensureAgentDispatch(room: string, metadata?: AgentMetadata): Promise<DispatchResponse> {
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
      throw new Error(text || `Не вдалося активувати асистента (код ${response.status}).`);
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
  const initialParticipantNameFromStorage = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(storedNameKey) ?? '';
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
  const [agentMessage] = useState<string | null>(null);
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
      if (pauseRequestedRef.current && !data.active) {
        setAgentStatus('paused');
        return 'paused';
      }
      const agentPresent = Boolean(data?.agentPresent);
      if (!data.active && !agentPresent && pauseRequestedRef.current) {
        setAgentStatus('paused');
        return 'paused';
      }
      if (agentPresent && !dispatchAgentName && configuredAgentIdentity) {
        setAgentIdentity((prev: string) => prev || configuredAgentIdentity);
      }

      const nextStatus: AgentStatus = data.active || agentPresent ? 'active' : 'idle';
      setAgentStatus(nextStatus);

     
    
      return nextStatus;
    } catch (error) {
      console.warn('fetchAgentStatus failed', error);
      setAgentStatus('error');
      return 'error';
    }
  }, [trimmedRoom]);

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
   
    if (agentStatus !== 'paused' && pauseRequestedRef.current && agentStatus !== 'requesting') {
      pauseRequestedRef.current = false;
    }
    previousAgentStatusRef.current = agentStatus;
  }, [agentStatus]);

  const showLlmTokenField = isCreator;
  const canInviteAgent = Boolean(effectiveAgentToken) || isConfiguredRoom;
  const readyToConnect = trimmedRoom !== '' && trimmedParticipantName !== '';

  const connectButtonText = connecting ? 'Зачекайте…' : isCreator ? 'Почати трансляцію' : 'Підключитися';
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
    pauseRequestedRef.current = false;
    void clearAgentDispatch();
  }, [clearAgentDispatch]);

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
      if (!effectiveAgentToken && !isConfiguredRoom) { 
        return;
      }

      try {
        pauseRequestedRef.current = false;
        setAgentStatus('requesting'); 

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

        const dispatchResult = await ensureAgentDispatch(trimmedRoom, metadata);
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
      setAgentStatus('requesting'); 

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
 
      if(agentStatus === 'idle'){
        if (!canInviteAgent) {
          return null;
        }
        return {
          label: 'Запросити помічника',
          ariaLabel: 'Запросити ШІ помічника до кімнати',
          disabled: inviteDisabled,
          onClick: handleRequestAgent,
          hint: 'Запросити помічника: додає асистента, який допомагатиме користувачеві.',
          state: 'invite',
        };
      }

  }, [
    agentStatus,
    canInviteAgent,
    handleRequestAgent,
    handleToggleAgentListening,
    inviteDisabled,
    isPausingRequest,
    pauseDisabled,
  ]);

  const showInviteHint = !canInviteAgent && isCreator;

  return (
    <main className={`layout${credentials ? ' layout-room-active' : ''}`} data-lk-theme="default">
      {!credentials && (
        <section className="card" aria-live="polite">
          <h1>{!roomName ? 'Створити трансляцію' : 'Вітаю' } {participantName}</h1>

          {status && <p className="status-message">{status}</p>}

          {!roomName ? (
            <>
              <p>Натисніть нижче, щоб створити нову трансляцію і запросити помічника.</p>
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
                {!initialParticipantNameFromStorage && (
                  <label>
                    Ваше імʼя
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
              agentControl={agentControl}
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
