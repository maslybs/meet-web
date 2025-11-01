# Meet Web — a simple LiveKit client on React

This is a minimal SPA on `React + Vite` that allows you to conduct a private broadcast for a visually impaired user:

- On the main page, enter the LiveKit URL and token obtained from the [Playground](https://livekit.io/api/playground).
- Click "Connect" — a standard LiveKit block appears with a camera, microphone, and chat.
- The "Disconnect" button allows you to end the session.

## Local Launch

```bash
npm install
npm run dev
```

The site will open at http://localhost:5173.

## Build

```bash
npm run build
```

The ready files will be in the `dist/` directory.

## Deploy to Cloudflare Pages

1. Add keys as secrets (CLI or Dashboard):
   ```bash
   wrangler secret put LIVEKIT_API_KEY
   wrangler secret put LIVEKIT_API_SECRET
   wrangler secret put LIVEKIT_URL
   ```
2. Build and publish:
   ```bash
   npm run build
   wrangler pages deploy dist
   ```

## Where to get a LiveKit token?
- In LiveKit Cloud, create an API key and secret.
- Generate a JWT in the playground or your own function.
- Insert the URL and token into the form on the main page — and connect.

The `functions/api/token.ts` function demonstrates how to sign a token on Cloudflare Pages without `livekit-server-sdk` (via Web Crypto / HMAC-SHA256).