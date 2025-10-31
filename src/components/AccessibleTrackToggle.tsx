import { forwardRef } from 'react';
import { useTrackToggle } from '@livekit/components-react';
import type { TrackToggleProps } from '@livekit/components-react';
import type { ToggleSource } from '@livekit/components-core';

type LiveKitTrackToggleProps = TrackToggleProps<ToggleSource>;

export interface AccessibleTrackToggleProps extends LiveKitTrackToggleProps {
  baseLabel: string;
  labelOn?: string;
  labelOff?: string;
}

export const AccessibleTrackToggle = forwardRef<HTMLButtonElement, AccessibleTrackToggleProps>(
  ({ baseLabel, labelOn, labelOff, children, ...rest }, ref) => {
    const { buttonProps, enabled } = useTrackToggle(rest);
    const providedLabel =
      (rest as { ['aria-label']?: string })['aria-label'] ?? undefined;
    const computedLabel =
      providedLabel ??
      (enabled
        ? labelOn ?? `${baseLabel}. Зараз увімкнено`
        : labelOff ?? `${baseLabel}. Зараз вимкнено`);
    const mergedProps = {
      ...buttonProps,
      'aria-label': computedLabel,
      'aria-pressed': enabled,
      type: 'button' as const,
    };
    return (
      <button {...mergedProps} ref={ref}>
        {children ?? baseLabel}
      </button>
    );
  },
);

AccessibleTrackToggle.displayName = 'AccessibleTrackToggle';
