import { useEffect, useRef, useCallback } from 'react';

export function useConnectionSounds(isConnecting: boolean) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const nextNoteTimeRef = useRef<number>(0);
    const timerIdRef = useRef<number | null>(null);
    const isPlayingRef = useRef<boolean>(false);

    // Initialize AudioContext lazily
    const getContext = () => {
        if (!audioContextRef.current) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                audioContextRef.current = new AudioContextClass();
            }
        }
        return audioContextRef.current;
    };

    // --- Bubbling Sound Logic ---
    useEffect(() => {
        if (isConnecting) {
            const ctx = getContext();
            if (!ctx) return;

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => { });
            }

            isPlayingRef.current = true;
            nextNoteTimeRef.current = ctx.currentTime + 0.1;

            const scheduleBubbles = () => {
                if (!isPlayingRef.current || !ctx) return;

                const currentTime = ctx.currentTime;

                while (nextNoteTimeRef.current < currentTime + 0.1) {
                    // Play a cluster of bubbles
                    const now = nextNoteTimeRef.current;

                    // Bubble 1
                    playBubble(ctx, now, 400, 800, 0.1);
                    // Bubble 2 (slightly delayed, higher pitch)
                    playBubble(ctx, now + 0.15, 500, 900, 0.08);
                    // Bubble 3 (delayed, lower pitch)
                    playBubble(ctx, now + 0.3, 300, 600, 0.12);

                    // Schedule next cluster in ~2 seconds
                    nextNoteTimeRef.current += 2.0;
                }

                timerIdRef.current = window.requestAnimationFrame(scheduleBubbles);
            };

            scheduleBubbles();
        } else {
            isPlayingRef.current = false;
            if (timerIdRef.current !== null) {
                window.cancelAnimationFrame(timerIdRef.current);
                timerIdRef.current = null;
            }
        }

        return () => {
            isPlayingRef.current = false;
            if (timerIdRef.current !== null) {
                window.cancelAnimationFrame(timerIdRef.current);
                timerIdRef.current = null;
            }
        };
    }, [isConnecting]);

    const playBubble = (ctx: AudioContext, time: number, startFreq: number, endFreq: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';

        // Frequency sweep (chirp) for bubble effect
        osc.frequency.setValueAtTime(startFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + duration);

        // Envelope
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.3, time + (duration * 0.2));
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        osc.start(time);
        osc.stop(time + duration);
    };

    // --- Disconnect Sound Logic ---
    // Agent Disconnect Sound: Descending Chord (Sawtooth + Sine)
    const playAgentDisconnectSound = useCallback(() => {
        const ctx = getContext();
        if (!ctx) return;

        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }

        const now = ctx.currentTime;

        // Oscillator 1: Sawtooth for "buzz" (Power down feel)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(400, now);
        osc1.frequency.exponentialRampToValueAtTime(50, now + 0.5);
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc1.start(now);
        osc1.stop(now + 0.5);

        // Oscillator 2: Sine for "weight" (Low drop)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(200, now);
        osc2.frequency.exponentialRampToValueAtTime(20, now + 0.5);
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(0.2, now + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc2.start(now);
        osc2.stop(now + 0.5);
    }, []);

    // User Disconnect Sound: Simple Descending Tone (Sine)
    const playUserDisconnectSound = useCallback(() => {
        const ctx = getContext();
        if (!ctx) return;

        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.start(now);
        osc.stop(now + 0.3);
    }, []);

    // Mobile Autoplay Fix: Expose a function to initialize/resume context on user interaction
    const initAudio = useCallback(() => {
        const ctx = getContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }
    }, []);

    return { playAgentDisconnectSound, playUserDisconnectSound, initAudio };
}
