export interface LiveKitEnv {
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  LIVEKIT_URL: string;
}

export interface LiveKitAgentEnv extends LiveKitEnv {
  LIVEKIT_AGENT_NAME?: string;
}
