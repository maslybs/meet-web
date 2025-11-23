import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { AccessibleTrackToggle } from './AccessibleTrackToggle';
import { CameraSwitchButton } from './CameraSwitchButton';
import type { AgentControlConfig, AgentStatus } from '../types/agent';
import { useConnectionSounds } from '../hooks/useConnectionSounds';
import type { Translations } from '../i18n';

// Custom hook since it's not exported in this version of components-react
function useAudioLevel(participant: Participant | null) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!participant) {
      setLevel(0);
      return;
    }

    const handleLevelChange = (lvl: number) => {
      setLevel(lvl);
    };

    const handleSpeakingChange = () => {
      // Force update level when speaking status changes, just in case
      setLevel(participant.audioLevel);
    };

    participant.on('audioLevelChanged', handleLevelChange);
    participant.on('isSpeakingChanged', handleSpeakingChange);

    setLevel(participant.audioLevel || 0);

    return () => {
      participant.off('audioLevelChanged', handleLevelChange);
      participant.off('isSpeakingChanged', handleSpeakingChange);
    };
  }, [participant]);

  return level;
}

// --- Icons ---

const MicOnIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const MicOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const CamOnIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const CamOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

// New Icons for Agent Control
const InviteIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3V4M12 20V21M21 12H20M4 12H3M18.364 5.636L17.657 6.343M6.343 17.657L5.636 18.364M18.364 18.364L17.657 17.657M6.343 6.343L5.636 5.636" />
    <path d="M12 12L12 12.01" strokeWidth="4" />
  </svg>
);

const PauseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const ResumeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const SpinnerIcon = () => (
  <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

interface UkrainianConferenceProps {
  onLeave: () => void;
  agentControl: AgentControlConfig | null;
  showInviteHint: boolean;
  roomName: string;
  agentMessage: string | null;
  agentIdentity: string;
  onAgentPresenceChange: (present: boolean, agentId?: string | null) => void;
  agentStatus: AgentStatus;
  isDemoRoom: boolean;
  translations: Translations;
  locale: 'uk' | 'en';
  onLocaleChange: (locale: 'uk' | 'en') => void;
}

function UkrainianConference({
  onLeave,
  agentControl,
  showInviteHint,
  roomName,
  agentMessage,
  agentIdentity,
  onAgentPresenceChange,
  agentStatus,
  isDemoRoom,
  translations,
  locale,
  onLocaleChange,
}: UkrainianConferenceProps) {
  const t = translations;
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );
  const participants = useParticipants();
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const micHintId = useId();
  const cameraHintId = useId();
  const switchHintId = useId();
  const agentControlHintId = useId();
  const leaveHintId = useId();
  const room = useRoomContext();

  const normalizeValue = useCallback((value?: string | null) => value?.trim().toLowerCase() ?? '', []);

  const isAgentParticipant = useCallback(
    (identity?: string | null, name?: string | null, metadata?: string | null) => {
      const normalizedTarget = normalizeValue(agentIdentity);
      const normalizedIdentity = normalizeValue(identity);
      const normalizedName = normalizeValue(name);

      if (normalizedTarget && (normalizedIdentity === normalizedTarget || normalizedName === normalizedTarget)) {
        return true;
      }

      // Stronger check for identity starting with 'agent-'
      if (normalizedIdentity.startsWith('agent-')) {
        return true;
      }

      if (normalizedName.includes('agent')) {
        return true;
      }

      const rawMetadata = typeof metadata === 'string' ? metadata.trim() : '';
      if (!rawMetadata) {
        return false;
      }

      const loweredMetadata = rawMetadata.toLowerCase();
      if (loweredMetadata.includes('ai-agent') || loweredMetadata.includes('voice_agent')) {
        return true;
      }

      try {
        const parsed = JSON.parse(rawMetadata);
        if (parsed && typeof parsed === 'object') {
          const possibleFlags = [
            parsed.agent,
            parsed.isAgent,
            parsed.aiAgent,
            parsed.is_ai_agent,
            parsed.voice_agent,
          ];
          if (possibleFlags.some((flag) => Boolean(flag))) {
            return true;
          }
          const roleLike = parsed.role || parsed.type || parsed.participantType;
          if (typeof roleLike === 'string' && roleLike.toLowerCase().includes('agent')) {
            return true;
          }
          if (Array.isArray(parsed.roles)) {
            const hasAgentRole = parsed.roles.some(
              (role) => typeof role === 'string' && role.toLowerCase().includes('agent'),
            );
            if (hasAgentRole) {
              return true;
            }
          }
        }
      } catch {
        // metadata is not JSON; fall back to substring checks only
      }

      return loweredMetadata.includes('agent');
    },
    [agentIdentity, normalizeValue],
  );

  // Filter out agent tracks completely so they don't appear in the grid
  const filteredTracks = useMemo(() => {
    return tracks.filter(track => {
      return !isAgentParticipant(track.participant.identity, track.participant.name, track.participant.metadata);
    });
  }, [tracks, isAgentParticipant]);

  // Create manual placeholders for real users who have no camera track
  const trackWithPlaceholders = useMemo(() => {
    const cameraTracks = filteredTracks.filter(t => t.source === Track.Source.Camera);
    const participantsWithCamera = new Set(cameraTracks.map(t => t.participant.identity));

    const realParticipants = participants.filter(p =>
      !p.isLocal && !isAgentParticipant(p.identity, p.name, p.metadata)
    );

    const additionalTracks: any[] = [];
    realParticipants.forEach(participant => {
      if (!participantsWithCamera.has(participant.identity)) {
        additionalTracks.push({
          participant,
          source: Track.Source.Camera,
          track: null,
          isPlaceholder: true
        });
      }
    });

    return [...filteredTracks, ...additionalTracks];
  }, [filteredTracks, participants, isAgentParticipant]);

  const remoteTracks = useMemo(
    () => trackWithPlaceholders.filter((track) => !track.participant.isLocal),
    [trackWithPlaceholders],
  );

  // Explicitly use ONLY filtered tracks for the grid
  const humanRemoteTracks = useMemo(
    () =>
      remoteTracks.filter(
        (track) => !isAgentParticipant(track.participant.identity, track.participant.name, track.participant.metadata),
      ),
    [remoteTracks, isAgentParticipant],
  );

  const localTracks = useMemo(
    () => trackWithPlaceholders.filter((track) => track.participant.isLocal),
    [trackWithPlaceholders],
  );

  const tileCount = humanRemoteTracks.length + localTracks.length;
  const hasScreenShare = trackWithPlaceholders.some((track) => track.source === Track.Source.ScreenShare);

  const agentParticipant = useMemo(() => {
    return (
      participants.find((participant) =>
        !participant.isLocal && isAgentParticipant(participant.identity, participant.name, participant.metadata),
      ) ?? null
    );
  }, [participants, isAgentParticipant]);

  const showAgentAnimation = agentStatus !== 'idle' && agentStatus !== 'error';

  // SOLO MODE: Active whenever there are no other human participants to show.
  // This ensures the local user is fullscreen when alone or only with the agent.
  const isSoloMode = humanRemoteTracks.length === 0;

  useEffect(() => {
    onAgentPresenceChange(Boolean(agentParticipant), agentParticipant?.identity ?? agentParticipant?.name ?? null);
  }, [agentParticipant, onAgentPresenceChange]);

  // --- Waiting Sound Logic ---
  // We want to play the sound if:
  // 1. Agent is being requested (waiting for join)
  // 2. Agent has joined (active) but hasn't spoken yet (waiting for greeting)

  const [hasAgentSpoken, setHasAgentSpoken] = useState(false);
  const agentAudioLevel = useAudioLevel(agentParticipant);

  // Reset hasAgentSpoken when agent leaves or status changes to non-active
  useEffect(() => {
    if (agentStatus !== 'active' && agentStatus !== 'requesting') {
      setHasAgentSpoken(false);
    }
  }, [agentStatus]);

  // Detect speech
  useEffect(() => {
    if (agentStatus === 'active' && agentParticipant && agentAudioLevel > 0.01) {
      setHasAgentSpoken(true);
    }
  }, [agentStatus, agentParticipant, agentAudioLevel]);

  // Play sound if requesting OR (active AND not spoken yet)
  // But add a safety timeout (e.g. 10s) after active to stop sound even if no speech detected, 
  // to avoid eternal ringing if agent is silent.
  const [activeTimeout, setActiveTimeout] = useState(false);

  useEffect(() => {
    if (agentStatus === 'active') {
      const timer = setTimeout(() => setActiveTimeout(true), 10000);
      return () => clearTimeout(timer);
    } else {
      setActiveTimeout(false);
    }
  }, [agentStatus]);

  const shouldPlayWaitingSound =
    agentStatus === 'requesting' ||
    (agentStatus === 'active' && !hasAgentSpoken && !activeTimeout);

  const { playAgentDisconnectSound, playUserDisconnectSound, initAudio } = useConnectionSounds(shouldPlayWaitingSound);

  // Play disconnect sound when agent goes from active to idle/paused OR disconnecting
  const prevAgentStatus = useRef(agentStatus);
  useEffect(() => {
    // If we are disconnecting, play sound immediately
    if (agentStatus === 'disconnecting' && prevAgentStatus.current === 'active') {
      playUserDisconnectSound();
    }
    // Fallback for other transitions if needed, but 'disconnecting' covers the pause click
    else if (prevAgentStatus.current === 'active' && (agentStatus === 'idle' || agentStatus === 'paused')) {
      playUserDisconnectSound();
    }
    prevAgentStatus.current = agentStatus;
  }, [agentStatus, playUserDisconnectSound]);

  const handleDisconnect = () => {
    // User leaving - no sound requested

    // Small delay to let the sound start before tearing down
    setTimeout(() => {
      room.disconnect();
    }, 200);
  };

  const [controlsAnnouncement, setControlsAnnouncement] = useState('');

  useEffect(() => {
    const labels = [
      t.devices.microphone,
      t.devices.camera,
      agentControl?.label,
      t.conference.leaveLabel,
    ]
      .map((label) => label?.trim())
      .filter(Boolean)
      .join(', ');

    setControlsAnnouncement(labels ? `${t.conference.controlsAnnouncementPrefix} ${labels}.` : '');
  }, [agentControl?.label, t]);

  return (
    <div className="conference-layout">
      <div className="ua-header" aria-hidden="true">
        <div className="ua-room-info">
          {isDemoRoom ? (
            <h2>{t.conference.demoRoomLabel}</h2>
          ) : null}
          {agentMessage && (
            <div className="agent-status-message">
              {agentMessage}
            </div>
          )}
        </div>
        <div className="ua-language-float">
          <button
            type="button"
            className="language-toggle"
            onClick={() => onLocaleChange(locale === 'uk' ? 'en' : 'uk')}
            aria-hidden="true"
            tabIndex={-1}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span className="lang-code">{locale.toUpperCase()}</span>
          </button>
        </div>
      </div>

      <div
        className={`ua-grid ${isSoloMode ? 'ua-grid--solo-agent' : ''}`}
        data-participant-count={tileCount}
        data-has-screenshare={hasScreenShare}
        aria-hidden="true"
      >
        {/* Standard Grid Mode (Multiple Humans) - Everyone in grid including local user */}
        {!isSoloMode ? (
          <div className="ua-grid-remote">
            <GridLayout tracks={[...humanRemoteTracks, ...localTracks]}>
              <ParticipantTile />
            </GridLayout>
          </div>
        ) : (
          /* Solo Mode - Local user is fullscreen background */
          localTracks.length > 0 && (
            <div className="local-participant-container local-participant-container--solo">
              <GridLayout tracks={localTracks}>
                <ParticipantTile />
              </GridLayout>
            </div>
          )
        )}
      </div>

      {/* Footer Area with Controls and Agent Visual */}
      <div className="ua-footer">
        {controlsAnnouncement ? (
          <div className="sr-only" role="status" aria-live="polite">
            {controlsAnnouncement}
          </div>
        ) : null}
        <div className="ua-controls">

          <div className="control-group">
            <AccessibleTrackToggle
              source={Track.Source.Microphone}
              baseLabel={t.devices.microphone}
              labelOn={`${t.devices.microphone}. ${t.toggle.on}`}
              labelOff={`${t.devices.microphone}. ${t.toggle.off}`}
            >
              {(enabled) => enabled ? <MicOnIcon /> : <MicOffIcon />}
            </AccessibleTrackToggle>

            <AccessibleTrackToggle
              source={Track.Source.Camera}
              baseLabel={t.devices.camera}
              labelOn={`${t.devices.camera}. ${t.toggle.on}`}
              labelOff={`${t.devices.camera}. ${t.toggle.off}`}
              onChange={setCanSwitchCamera}
            >
              {(enabled) => enabled ? <CamOnIcon /> : <CamOffIcon />}
            </AccessibleTrackToggle>

            {canSwitchCamera && (
              <CameraSwitchButton descriptionId={switchHintId} translations={translations} />
            )}
          </div>

          <div className="control-group control-group--actions">
            {agentControl && (
              <button
                type="button"
                className={`ua-button agent-control ${agentControl.state === 'requesting' ? 'icon-button' : ''}`}
                onClick={(e) => {
                  initAudio();
                  agentControl.onClick(e);
                }}
                disabled={agentControl.disabled}
                aria-label={agentControl.ariaLabel}
                title={agentControl.label}
                data-agent-state={agentControl.state}
              >
                {agentControl.state === 'pause' ? (
                  <PauseIcon />
                ) : agentControl.state === 'resume' ? (
                  <ResumeIcon />
                ) : agentControl.state === 'invite' ? (
                  <InviteIcon />
                ) : (
                  <SpinnerIcon />
                )}
                {/* Show label text for Invite/Pause/Resume states */}
                {(agentControl.state === 'pause' || agentControl.state === 'resume' || agentControl.state === 'invite') && (
                  <span className="ua-button-label">{agentControl.label}</span>
                )}
              </button>
            )}

            <button
              type="button"
              className="ua-button danger"
              aria-label={t.conference.leaveLabel}
              onClick={handleDisconnect}
              title={t.conference.leaveLabel}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M16 12H22M22 12L19 9M22 12L19 15M12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <RoomAudioRenderer />
        </div>

        {/* Agent Visual (Orb) - Placed to the right of controls */}
        {showAgentAnimation && (
          <AgentPresenceVisual
            state={agentStatus}
            participant={agentParticipant}
            translations={translations}
          />
        )}
      </div>
    </div>
  );
}

interface AgentPresenceVisualProps {
  state: AgentStatus;
  participant: Participant | null;
  translations: Translations;
}

function AgentPresenceVisual({ state, participant, translations }: AgentPresenceVisualProps) {
  // Cast to any because standard types might expect TrackReference, but newer SDKs handle Participant or we handle nulls safely
  const audioLevel = useAudioLevel(participant as any);

  // Calculate reactive scale
  // Natural feel: Subtle size change (x0.6), rely on internal animation speed/glow for intensity.
  const scale = Math.min(1.15, 1 + (audioLevel || 0) * 0.6);

  const isConnecting = state === 'requesting' || (state === 'active' && !participant);
  // Only show speaking animation if active (not paused)
  const isSpeaking = state === 'active' && (audioLevel || 0) > 0.01;

  return (
    <div
      className="agent-visual-side"
      aria-hidden="true"
      data-agent-state={state}
      data-agent-connecting={isConnecting}
      data-is-speaking={isSpeaking}
      title={isConnecting ? translations.conference.agentConnectingTitle : translations.conference.agentActiveTitle}
      style={{
        '--agent-scale': scale,
      } as React.CSSProperties}
    >
      <div className="agent-visual__halo agent-visual__halo--outer" />
      <div className="agent-visual__halo agent-visual__halo--inner" />
      <div className="agent-visual__core">
        {isConnecting ? (
          <div className="agent-loader" />
        ) : (
          <>
            <div className="agent-visual__spark agent-visual__spark--one" />
            <div className="agent-visual__spark agent-visual__spark--two" />
            <span>AI</span>
          </>
        )}
      </div>
    </div>
  );
}

export default UkrainianConference;
