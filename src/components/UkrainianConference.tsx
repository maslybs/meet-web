import { useEffect, useId, useMemo, useState } from 'react';
import {
  DisconnectButton,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  StartMediaButton,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { AccessibleTrackToggle } from './AccessibleTrackToggle';
import { CameraSwitchButton } from './CameraSwitchButton';
import type { AgentControlConfig, AgentStatus } from '../types/agent';

interface UkrainianConferenceProps {
  onLeave: () => void;
  agentControl: AgentControlConfig | null;
  showInviteHint: boolean;
  roomName: string;
  agentMessage: string | null;
  agentIdentity: string;
  onAgentPresenceChange: (present: boolean) => void;
  agentStatus: AgentStatus;
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
}: UkrainianConferenceProps) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const unmuteHintId = useId();
  const micHintId = useId();
  const camHintId = useId();
  const switchHintId = useId();
  const agentControlHintId = useId();
  const leaveHintId = useId();
  const participants = useParticipants();
  const room = useRoomContext();
  const remoteTracks = useMemo(
    () => tracks.filter((track) => !track.participant.isLocal),
    [tracks],
  );
  const localTracks = useMemo(
    () => tracks.filter((track) => track.participant.isLocal),
    [tracks],
  );
  const tileCount = tracks.length;
  const hasScreenShare = tracks.some((track) => track.source === Track.Source.ScreenShare);
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
          <div className="ua-overlay ua-overlay-room">
            Кімната: <strong>{roomName}</strong>
          </div>
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
            Щоб запросити помічника, додайте LLM токен.
          </div>
        )}
      </div>
      <div className="ua-grid" data-participant-count={tileCount} data-has-screenshare={hasScreenShare}>
        <GridLayout tracks={remoteTracks}>
          <ParticipantTile />
        </GridLayout>
        {localTracks.length > 0 && (
          <div className="local-participant-container">
            <GridLayout tracks={localTracks}>
              <ParticipantTile />
            </GridLayout>
          </div>
        )}
      </div>
      <div className="ua-controls">
        <ul className="sr-only" aria-label="Опис кнопок керування конференцією">
          <li id={unmuteHintId}>
            Увімкнути звук: надає браузеру доступ до аудіо, щоб ви могли чути інших учасників.
          </li>
          <li id={micHintId}>Мікрофон: вмикає або вимикає ваш голос під час дзвінка.</li>
          <li id={camHintId}>Камера: показує або приховує ваше відео.</li>
          {canSwitchCamera && <li id={switchHintId}>Перемкнути камеру: вибирає іншу камеру вашого пристрою.</li>}
          {agentControl && <li id={agentControlHintId}>{agentControl.hint}</li>}
          {showInviteHint && <li>Щоб запросити помічника, додайте LLM токен.</li>}
          <li id={leaveHintId}>Завершення сеансу: завершує трансляцію й вимикає всі пристрої.</li>
        </ul>
        <div className="ua-controls-group ua-controls-group--left">
          <StartMediaButton
            className="ua-button"
            data-variant="primary"
            aria-describedby={unmuteHintId}
            aria-label="Увімкнути звук і дозволити відтворення аудіо"
          >
            Увімкнути звук
          </StartMediaButton>
          <AccessibleTrackToggle
            source={Track.Source.Microphone}
            baseLabel="Мікрофон"
            labelOn="Мікрофон увімкнено. Натисніть, щоб вимкнути."
            labelOff="Мікрофон вимкнено. Натисніть, щоб увімкнути."
            className="ua-button"
            aria-describedby={micHintId}
          >
            Мікрофон
          </AccessibleTrackToggle>
          <AccessibleTrackToggle
            source={Track.Source.Camera}
            baseLabel="Камера"
            labelOn="Камера увімкнена. Натисніть, щоб вимкнути."
            labelOff="Камера вимкнена. Натисніть, щоб увімкнути."
            className="ua-button"
            aria-describedby={camHintId}
          >
            Камера
          </AccessibleTrackToggle>
          <CameraSwitchButton descriptionId={switchHintId} onAvailabilityChange={setCanSwitchCamera} />
        </div>
        <div className="ua-controls-group ua-controls-group--center">
          {agentControl && (
            <button
              type="button"
              className="ua-button secondary agent-control"
              onClick={async () => {
                try {
                  await room.startAudio();
                } catch (err) {
                  console.warn('Audio unlock failed:', err);
                }
                agentControl.onClick();
              }}
              disabled={agentControl.disabled}
              aria-describedby={agentControlHintId}
              aria-label={agentControl.ariaLabel}
              data-agent-state={agentControl.state}
            >
              {agentControl.label}
            </button>
          )}
        </div>
        <div className="ua-controls-group ua-controls-group--right">
          <DisconnectButton className="ua-button danger" onClick={onLeave} aria-describedby={leaveHintId} aria-label="Завершити трансляцію">
            Завершення сеансу
          </DisconnectButton>
        </div>
      </div>
    </div>
  );
}

export default UkrainianConference;
