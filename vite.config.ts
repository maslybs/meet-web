import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VOICE_AGENT_DEFAULT_ROOM': JSON.stringify(env.VOICE_AGENT_DEFAULT_ROOM ?? ''),
      'import.meta.env.VOICE_AGENT_NAME': JSON.stringify(env.VOICE_AGENT_NAME ?? ''),
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: false,
        },
      },
    },
  };
});
