# Agent Notes

This repository is designed for self-hosted deployments. Do not commit user-specific domains, Lark app IDs, Cloudflare account data, database IDs, bucket names, or secrets.

## Generated Files

These files are generated from `.env` and must stay ignored:

- `wrangler.jsonc`
- `extension/manifest.json`
- `extension/src/lib/config.js`
- `dist/`
- `.env`
- `.dev.vars`

Use `npm run configure` to regenerate them.

## Main Components

- `extension/src/service-worker.js`: saves the active tab. Cloud-connected saves go to the Worker; otherwise they are stored locally.
- `extension/src/options.js`: dashboard, cloud login, cloud list rendering, user settings.
- `extension/src/lib/cloud.js`: extension API client. Reads `CLOUD_API_BASE` from generated config.
- `worker/src/index.js`: Cloudflare Worker API, Lark OAuth callback/polling, per-user Base creation, item persistence, scheduling.
- `extension/src/lib/slots.js`: pure scheduling logic shared by Worker tests.
- `worker/migrations/`: D1 schema.

## Data Flow

1. Extension calls `POST /auth/lark/start`.
2. Worker creates an OAuth state and returns a Lark authorization URL.
3. Lark redirects to `/auth/lark/callback`.
4. Worker exchanges the code, encrypts tokens, creates a session token, and stores it in D1.
5. Extension polls `/auth/lark/poll`, stores the session token in Chrome storage, and then saves links through `/api/items/save`.
6. Worker creates a Lark Base on first use, creates a Base record for each save, and schedules a Lark Calendar event once enough waiting items exist.

## Commands

```bash
npm run configure
npm test
npm run package:extension
npm run worker:dev
npm run worker:deploy
```

## Testing Notes

Tests use fake D1 and fake Lark network responses. They should not require real Cloudflare or Lark credentials.

## Editing Rules

- Keep the Worker runtime-compatible: avoid Node-only APIs in `worker/src/index.js`.
- Keep OAuth/session/token secrets out of logs.
- Keep Chrome extension code Manifest V3 compatible.
- Prefer extending tests before changing shared scheduling or Worker persistence behavior.
