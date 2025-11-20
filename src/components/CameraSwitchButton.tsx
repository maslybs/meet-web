import { useCallback, useEffect, useMemo, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { describeCamera } from '../utils/devices';
import type { Translations } from '../i18n';

interface CameraSwitchButtonProps {
  descriptionId: string;
  onAvailabilityChange?: (available: boolean) => void;
  translations: Translations;
}

export function CameraSwitchButton({ descriptionId, onAvailabilityChange, translations }: CameraSwitchButtonProps) {
  const room = useRoomContext();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = translations.devices;

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
        console.warn('Could not load available cameras', err);
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
  const hasMultipleCameras = devices.length > 1;

  useEffect(() => {
    onAvailabilityChange?.(hasMultipleCameras);
  }, [onAvailabilityChange, hasMultipleCameras]);

  const handleSwitch = useCallback(async () => {
    if (!room || !hasMultipleCameras || pending) {
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
      console.warn('Could not switch camera', err);
    } finally {
      setPending(false);
    }
  }, [room, devices, activeDeviceId, hasMultipleCameras, pending]);

  const buttonText = pending ? t.switchingCamera : t.switchCamera;
  const cameraName = activeDevice ? describeCamera(activeDevice, t.primaryCamera, t.otherCamera) : '';
  const ariaLabel = cameraName ? `${t.switchCamera}. ${t.usingCamera} ${cameraName}` : t.switchCamera;
  const disabled = !room || !hasMultipleCameras || pending;
  const title = cameraName ? `${t.usingCamera} ${cameraName}` : undefined;

  if (!hasMultipleCameras) {
    return null;
  }

  return (
    <button
      type="button"
      className="ua-button"
      onClick={handleSwitch}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      aria-describedby={descriptionId}
    >
      {buttonText}
    </button>
  );
}
