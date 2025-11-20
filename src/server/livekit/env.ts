export interface LiveKitEnv {
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  LIVEKIT_URL: string;
}

export interface LiveKitAgentEnv extends LiveKitEnv {
  LIVEKIT_AGENT_NAME?: string;
  VOICE_AGENT_NAME?: string;
  VITE_DEFAULT_ROOM?: string;
  VOICE_AGENT_DEFAULT_ROOM?: string;
  VITE_DEMO_ROOM?: string;
  VOICE_AGENT_DEMO_ROOM?: string;
}
