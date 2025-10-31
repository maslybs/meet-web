import { facingModeFromDeviceLabel } from 'livekit-client';

export function isEnvironmentCamera(device: MediaDeviceInfo) {
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

export function describeCamera(device: MediaDeviceInfo) {
  const label = (device.label ?? '').trim();
  if (label) {
    return label;
  }
  return isEnvironmentCamera(device) ? 'Основна камера' : 'Інша камера';
}
