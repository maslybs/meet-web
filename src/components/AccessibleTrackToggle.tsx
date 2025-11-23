import { forwardRef, ReactNode } from 'react';
import { useTrackToggle } from '@livekit/components-react';
import type { TrackToggleProps } from '@livekit/components-react';
import type { ToggleSource } from '@livekit/components-core';

type LiveKitTrackToggleProps = TrackToggleProps<ToggleSource>;

export interface AccessibleTrackToggleProps extends LiveKitTrackToggleProps {
  baseLabel: string;
  labelOn?: string;
  labelOff?: string;
  children?: ReactNode | ((enabled: boolean) => ReactNode);
}

export const AccessibleTrackToggle = forwardRef<HTMLButtonElement, AccessibleTrackToggleProps>(
  ({ baseLabel, labelOn, labelOff, children, ...rest }, ref) => {
    const { buttonProps, enabled } = useTrackToggle(rest);
    const { disabled, onClick, ...otherButtonProps } = buttonProps;

    const providedLabel =
      (rest as { ['aria-label']?: string })['aria-label'] ?? undefined;
    const basePrefix = baseLabel ? `${baseLabel}. ` : '';
    const computedLabel =
      providedLabel ??
      (enabled
        ? labelOn ?? `${basePrefix}On`
        : labelOff ?? `${basePrefix}Off`);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      onClick?.(e);
    };

    const mergedProps = {
      ...otherButtonProps,
      onClick: handleClick,
      'aria-label': computedLabel,
      'aria-pressed': enabled,
      'aria-disabled': disabled,
      title: computedLabel,
      type: 'button' as const,
      className: `ua-button icon-button ${enabled ? 'active' : 'inactive'} ${disabled ? 'disabled' : ''}`,
    };

    return (
      <button {...mergedProps} ref={ref}>
        {typeof children === 'function' ? children(enabled) : children ?? baseLabel}
      </button>
    );
  },
);

AccessibleTrackToggle.displayName = 'AccessibleTrackToggle';
