import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

type RadioCommand = {
  source?: string;
  type?: string;
  command?: string;
  title?: string;
  audio_url?: string;
  audioUrl?: string;
  page_url?: string;
  pageUrl?: string;
  volume?: number;
  volume_percent?: number;
  metadata?: Record<string, unknown>;
};

type BrowserRadioState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error';
  title: string;
  audioUrl: string;
  pageUrl: string;
  volume: number;
  error: string;
};

const RADIO_TOPIC = 'radio-control';

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function normalizeIncomingVolume(command: RadioCommand, fallback: number) {
  const raw = typeof command.volume === 'number'
    ? command.volume
    : typeof command.volume_percent === 'number'
      ? command.volume_percent / 100
      : fallback;

  return Math.max(0, Number.isFinite(raw) ? raw : fallback);
}

function proxiedAudioUrl(audioUrl: string) {
  const proxyBase = (import.meta.env.VITE_AUDIO_PROXY_URL || '').trim();
  if (!proxyBase) return audioUrl;
  try {
    const parsed = new URL(audioUrl);
    if (parsed.origin === window.location.origin) return audioUrl;
    const base = proxyBase.endsWith('/') ? proxyBase.slice(0, -1) : proxyBase;
    return `${base}?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return audioUrl;
  }
}

export function BrowserRadioPlayer() {
  const room = useRoomContext();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [state, setState] = useState<BrowserRadioState>({
    status: 'idle',
    title: '',
    audioUrl: '',
    pageUrl: '',
    volume: 1,
    error: '',
  });

  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioContextRef.current = new AudioContextCtor();
    }
    const ctx = audioContextRef.current;
    if (!sourceRef.current) {
      sourceRef.current = ctx.createMediaElementSource(audio);
      gainRef.current = ctx.createGain();
      sourceRef.current.connect(gainRef.current);
      gainRef.current.connect(ctx.destination);
    }
    return { ctx, gain: gainRef.current };
  }, []);

  const applyVolume = useCallback((volume: number) => {
    const safeVolume = Math.max(0, Math.min(10, volume));
    const audio = audioRef.current;
    if (audio) {
      // Keep element volume at 100%; use WebAudio gain for >100% amplification.
      audio.volume = clampVolume(Math.min(1, safeVolume));
    }
    const graph = ensureAudioGraph();
    if (graph?.gain) {
      graph.gain.gain.value = safeVolume;
    }
    setState((current) => ({ ...current, volume: safeVolume }));
  }, [ensureAudioGraph]);

  const publishStatus = useCallback((extra: Record<string, unknown> = {}) => {
    try {
      const payload = JSON.stringify({
        source: 'browser-radio-player',
        type: 'radio.status',
        status: state.status,
        title: state.title,
        audio_url: state.audioUrl,
        page_url: state.pageUrl,
        volume: state.volume,
        volume_percent: Math.round(state.volume * 100),
        ...extra,
      });
      room.localParticipant.publishData(new TextEncoder().encode(payload), {
        reliable: true,
        topic: RADIO_TOPIC,
      } as any);
    } catch (error) {
      console.warn('Failed to publish browser radio status', error);
    }
  }, [room, state]);

  const playAudio = useCallback(async (command: RadioCommand) => {
    const audioUrl = (command.audio_url || command.audioUrl || '').trim();
    if (!audioUrl) return;

    const audio = audioRef.current;
    if (!audio) return;

    const title = (command.title || 'Аудіо').trim();
    const pageUrl = (command.page_url || command.pageUrl || '').trim();
    const volume = normalizeIncomingVolume(command, state.volume || 1);

    setState({ status: 'loading', title, audioUrl, pageUrl, volume, error: '' });

    audio.pause();
    audio.src = proxiedAudioUrl(audioUrl);
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    applyVolume(volume);

    try {
      const graph = ensureAudioGraph();
      await graph?.ctx.resume();
      await audio.play();
      setState({ status: 'playing', title, audioUrl, pageUrl, volume, error: '' });
      publishStatus({ status: 'playing', title, audio_url: audioUrl, page_url: pageUrl, volume });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося запустити аудіо у браузері.';
      console.warn('Browser radio playback failed', error);
      setState({ status: 'error', title, audioUrl, pageUrl, volume, error: message });
      publishStatus({ status: 'error', title, audio_url: audioUrl, error: message });
    }
  }, [applyVolume, ensureAudioGraph, publishStatus, state.volume]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setState((current) => ({ ...current, status: 'stopped' }));
    publishStatus({ status: 'stopped' });
  }, [publishStatus]);

  const pauseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setState((current) => ({ ...current, status: 'paused' }));
    publishStatus({ status: 'paused' });
  }, [publishStatus]);

  const resumeAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !state.audioUrl) return;
    try {
      await audioContextRef.current?.resume();
      await audio.play();
      setState((current) => ({ ...current, status: 'playing', error: '' }));
      publishStatus({ status: 'playing' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося продовжити аудіо.';
      setState((current) => ({ ...current, status: 'error', error: message }));
    }
  }, [publishStatus, state.audioUrl]);

  useEffect(() => {
    const handleData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== RADIO_TOPIC) return;
      let decoded = '';
      try {
        decoded = new TextDecoder().decode(payload);
      } catch {
        return;
      }
      let command: RadioCommand;
      try {
        command = JSON.parse(decoded) as RadioCommand;
      } catch {
        return;
      }
      if (command.source === 'browser-radio-player') return;
      const type = command.type || command.command || '';
      if (type === 'radio.play') {
        void playAudio(command);
      } else if (type === 'radio.stop') {
        stopAudio();
      } else if (type === 'radio.pause') {
        pauseAudio();
      } else if (type === 'radio.resume') {
        void resumeAudio();
      } else if (type === 'radio.volume') {
        applyVolume(normalizeIncomingVolume(command, state.volume || 1));
      } else if (type === 'radio.status.request') {
        publishStatus();
      }
    };

    room.on(RoomEvent.DataReceived, handleData as any);
    return () => {
      room.off(RoomEvent.DataReceived, handleData as any);
    };
  }, [applyVolume, pauseAudio, playAudio, publishStatus, resumeAudio, room, state.volume, stopAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => {
      setState((current) => ({ ...current, status: 'ended' }));
      publishStatus({ status: 'ended' });
    };
    const onPlaying = () => setState((current) => ({ ...current, status: 'playing', error: '' }));
    const onPause = () => {
      if (!audio.ended && state.status === 'playing') {
        setState((current) => ({ ...current, status: 'paused' }));
      }
    };
    const onError = () => {
      const message = 'Браузер не зміг відтворити аудіо.';
      setState((current) => ({ ...current, status: 'error', error: message }));
      publishStatus({ status: 'error', error: message });
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [publishStatus, state.status]);

  const visible = state.status !== 'idle' && (state.title || state.audioUrl || state.error);
  const volumeLabel = useMemo(() => `${Math.round(state.volume * 100)}%`, [state.volume]);

  return (
    <div className={`browser-radio-player ${visible ? 'browser-radio-player--visible' : ''}`} aria-live="polite">
      <audio ref={audioRef} />
      {visible && (
        <div className="browser-radio-player__panel">
          <div className="browser-radio-player__meta">
            <span className="browser-radio-player__eyebrow">Відтворення у браузері</span>
            <strong>{state.title || 'Аудіо'}</strong>
            {state.status === 'loading' && <span>Завантаження…</span>}
            {state.error && <span className="browser-radio-player__error">{state.error}</span>}
          </div>
          <div className="browser-radio-player__controls">
            {state.status === 'playing' ? (
              <button type="button" onClick={pauseAudio} aria-label="Пауза аудіо">Пауза</button>
            ) : (
              <button type="button" onClick={() => void resumeAudio()} disabled={!state.audioUrl} aria-label="Відтворити аудіо">Грати</button>
            )}
            <button type="button" onClick={stopAudio} aria-label="Зупинити аудіо">Стоп</button>
            <label>
              <span>Гучність {volumeLabel}</span>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={Math.min(3, state.volume)}
                onChange={(event) => applyVolume(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default BrowserRadioPlayer;
