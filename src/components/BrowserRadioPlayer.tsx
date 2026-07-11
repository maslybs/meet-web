import { useCallback, useEffect, useRef, useState } from 'react';
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
  playback_rate?: number;
  rate?: number;
  seconds?: number;
  percent?: number;
  metadata?: Record<string, unknown>;
};

type BrowserRadioState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error';
  title: string;
  audioUrl: string;
  pageUrl: string;
  volume: number;
  playbackRate: number;
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

function canUseWebAudioGain(src: string) {
  try {
    const parsed = new URL(src, window.location.href);
    return parsed.origin === window.location.origin || parsed.pathname.startsWith('/api/audio-proxy');
  } catch {
    return false;
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
    playbackRate: 1,
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
      audio.volume = clampVolume(Math.min(1, safeVolume));
    }
    // WebAudio gain is only safe for same-origin/proxied audio. External ukr.radio MP3
    // files do not expose CORS headers, so connecting them to AudioContext can make
    // browsers reject playback with “no supported source”.
    if (audio && audio.src && canUseWebAudioGain(audio.src)) {
      const graph = ensureAudioGraph();
      if (graph?.gain) {
        graph.gain.gain.value = safeVolume;
      }
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
        playback_rate: state.playbackRate,
        current_time: audioRef.current?.currentTime || 0,
        duration: Number.isFinite(audioRef.current?.duration || NaN) ? audioRef.current?.duration : 0,
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

  const applyPlaybackRate = useCallback((rate: number) => {
    const safeRate = Math.max(0.25, Math.min(3, Number.isFinite(rate) ? rate : 1));
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = safeRate;
      audio.defaultPlaybackRate = safeRate;
    }
    setState((current) => ({ ...current, playbackRate: safeRate }));
    publishStatus({ playback_rate: safeRate });
  }, [publishStatus]);

  const seekBySeconds = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const nextTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
    audio.currentTime = nextTime;
    publishStatus({ current_time: nextTime, duration: audio.duration });
  }, [publishStatus]);

  const seekToSeconds = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const nextTime = Math.max(0, Math.min(audio.duration, seconds));
    audio.currentTime = nextTime;
    publishStatus({ current_time: nextTime, duration: audio.duration });
  }, [publishStatus]);

  const seekToPercent = useCallback((percent: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const normalized = percent > 1 ? percent / 100 : percent;
    const nextTime = Math.max(0, Math.min(audio.duration, audio.duration * normalized));
    audio.currentTime = nextTime;
    publishStatus({ current_time: nextTime, duration: audio.duration, percent: normalized });
  }, [publishStatus]);

  const playAudio = useCallback(async (command: RadioCommand) => {
    const audioUrl = (command.audio_url || command.audioUrl || '').trim();
    if (!audioUrl) return;

    const audio = audioRef.current;
    if (!audio) return;

    const title = (command.title || 'Аудіо').trim();
    const pageUrl = (command.page_url || command.pageUrl || '').trim();
    const volume = normalizeIncomingVolume(command, state.volume || 1);
    const playbackRate = Math.max(0.25, Math.min(3, command.playback_rate || command.rate || state.playbackRate || 1));

    setState({ status: 'loading', title, audioUrl, pageUrl, volume, playbackRate, error: '' });

    audio.pause();
    const playbackUrl = proxiedAudioUrl(audioUrl);
    audio.src = playbackUrl;
    if (canUseWebAudioGain(playbackUrl)) {
      audio.crossOrigin = 'anonymous';
    } else {
      audio.removeAttribute('crossorigin');
      audio.crossOrigin = null;
    }
    audio.preload = 'auto';
    audio.playbackRate = playbackRate;
    audio.defaultPlaybackRate = playbackRate;
    applyVolume(volume);

    try {
      if (canUseWebAudioGain(playbackUrl)) {
        const graph = ensureAudioGraph();
        await graph?.ctx.resume();
      }
      await audio.play();
      setState({ status: 'playing', title, audioUrl, pageUrl, volume, playbackRate, error: '' });
      publishStatus({ status: 'playing', title, audio_url: audioUrl, page_url: pageUrl, volume, playback_rate: playbackRate });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося запустити аудіо у браузері.';
      console.warn('Browser radio playback failed', error);
      setState({ status: 'error', title, audioUrl, pageUrl, volume, playbackRate, error: message });
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
      } else if (type === 'radio.rate') {
        applyPlaybackRate(command.playback_rate || command.rate || 1);
      } else if (type === 'radio.seek.by') {
        seekBySeconds(Number(command.seconds || 0));
      } else if (type === 'radio.seek.to') {
        seekToSeconds(Number(command.seconds || 0));
      } else if (type === 'radio.seek.percent') {
        seekToPercent(Number(command.percent || 0));
      } else if (type === 'radio.status.request') {
        publishStatus();
      }
    };

    room.on(RoomEvent.DataReceived, handleData as any);
    return () => {
      room.off(RoomEvent.DataReceived, handleData as any);
    };
  }, [applyPlaybackRate, applyVolume, pauseAudio, playAudio, publishStatus, resumeAudio, room, seekBySeconds, seekToPercent, seekToSeconds, state.volume, stopAudio]);

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

  return <audio ref={audioRef} preload="none" style={{ display: 'none' }} />;
}

export default BrowserRadioPlayer;
