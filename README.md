# Camera Mother — простий LiveKit клієнт на React

Це мінімальний SPA на `React + Vite`, що дозволяє вести приватну трансляцію для незрячого користувача:

- На головній сторінці вводите LiveKit URL і токен, отриманий у [Playground](https://livekit.io/api/playground).
- Натискаєте “Підключитися” — зʼявляється стандартний блок LiveKit із камерою, мікрофоном і чатом.
- Кнопкою “Відʼєднатися” можна завершити сесію.

## Локальний запуск

```bash
npm install
npm run dev
```

Сайт відкриється на http://localhost:5173.

## Білд

```bash
npm run build
```

Готові файли будуть у каталозі `dist/`.

## Деплой на Cloudflare Pages

1. Додайте ключі як секрети (CLI або Dashboard):
   ```bash
   wrangler secret put LIVEKIT_API_KEY
   wrangler secret put LIVEKIT_API_SECRET
   wrangler secret put LIVEKIT_URL
   ```
2. Зберіть та опублікуйте:
   ```bash
   npm run build
   wrangler pages deploy dist
   ```

## Де взяти токен LiveKit?
- У LiveKit Cloud створіть API ключ і секрет.
- Згенеруйте JWT у playground або власній функції.
- Вставте URL та токен у форму на головній сторінці — і підключайтесь.

Функція `functions/api/token.ts` демонструє, як підписати токен на Cloudflare Pages без `livekit-server-sdk` (через Web Crypto / HMAC-SHA256).
