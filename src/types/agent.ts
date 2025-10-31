export type AgentControlState = 'invite' | 'requesting' | 'pause' | 'resume' | 'error';

export interface AgentControlConfig {
  label: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  hint: string;
  state: AgentControlState;
}

export type AgentStatus = 'idle' | 'requesting' | 'active' | 'paused' | 'error';
