# Agent Runbook

This file is for coding agents that help a user install, configure, deploy, or modify this self-hosted project. After reading this file, an agent should be able to drive the setup end to end while pausing at the few steps that require the human user's browser login, console access, or secret entry.

## Mission

Deploy Reading Block for one user or one workspace:

1. Create or verify a Lark/Feishu developer app.
2. Configure Cloudflare Worker, D1, and optional R2.
3. Generate project config from `.env`.
4. Set Worker secrets.
5. Run D1 migrations.
6. Deploy the Worker and bind the public domain.
7. Package and install the Chrome extension.
8. Help the user complete OAuth authorization from the extension.
9. Verify that saves create Base records and schedule Calendar events.

## Do Not Commit

Never commit user-specific or secret files:

- `.env`
- `.dev.vars`
- `wrangler.jsonc`
- `extension/manifest.json`
- `extension/src/lib/config.js`
- `dist/`

Never print or commit:

- `LARK_APP_SECRET`
- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- Cloudflare account IDs
- real D1 database IDs unless the user explicitly wants them in private notes
- private domains if the user is preparing a public fork

## Human Checkpoints

Pause and ask the user to complete these. Do not pretend they can be automated unless the required authenticated tool/browser state is already available.

| Checkpoint | Why It Needs The Human | What To Ask For |
| --- | --- | --- |
| Cloudflare login | `wrangler login` opens a browser and requires account approval. | Ask the user to run/approve `npx wrangler login`, or confirm it is already logged in. |
| Lark/Feishu app creation | The developer console may require org permissions, captcha, app release/tester settings, and manual scope approval. | Ask for App ID, confirm App Secret is available for secret entry, and confirm redirect URL/scopes are configured. |
| Worker secrets | Secrets should be typed into Wrangler prompts, not pasted into chat if avoidable. | Run `npx wrangler secret put ...` and let the user enter values in the terminal. |
| Custom domain/DNS | The user owns the domain and may need to approve route/DNS changes in Cloudflare. | Ask what public URL they want, then guide Worker custom domain binding. |
| Extension installation | Chrome requires local UI interaction for unpacked extensions. | Ask the user to open `chrome://extensions`, enable Developer mode, and load `extension/`. |
| OAuth authorization | The extension opens Lark/Feishu authorization in the user's browser. | Ask the user to click `Connect` in extension options and approve the app. |

## Required Inputs

Collect these before generating config:

- `PUBLIC_BASE_URL`: public Worker URL, for example `https://reading-block.example.com`.
- Platform choice: overseas Lark or domestic Feishu.
- `LARK_APP_ID`: app ID from the Lark/Feishu developer console.
- `LARK_APP_SECRET`: app secret, entered as a Worker secret.
- `D1_DATABASE_NAME`: default `reading-block-prod`.
- `D1_DATABASE_ID`: returned by `npx wrangler d1 create ...`.
- `DEFAULT_TIME_ZONE`: default `Asia/Shanghai`.
- Optional `LARK_OPEN_API_BASE` and `LARK_AUTH_URL`: only needed when not using the default overseas Lark endpoints.
- Optional `R2_BUCKET_NAME`: only needed if hosting the extension zip from R2.

Default overseas Lark endpoints:

```text
LARK_OPEN_API_BASE=https://open.larksuite.com/open-apis
LARK_AUTH_URL=https://accounts.larksuite.com/open-apis/authen/v1/authorize
```

For domestic Feishu, ask the user to confirm the matching OpenAPI and OAuth authorization hosts from the Feishu developer console, then set the two optional variables.

## Lark/Feishu Console Checklist

Create a custom app and configure:

- Redirect URL: `PUBLIC_BASE_URL + /auth/lark/callback`
- OAuth mode: user authorization
- App ID copied to `.env` as `LARK_APP_ID`
- App Secret entered later with `npx wrangler secret put LARK_APP_SECRET`
- Scopes:

```text
offline_access
base:app:create
base:table:create
base:record:create
base:record:update
base:record:retrieve
calendar:calendar:readonly
calendar:calendar.free_busy:read
calendar:calendar.event:create
```

If the console uses localized names or different scope identifiers, use the closest equivalents for:

- offline refresh token access
- create Base apps/tables
- create/update/retrieve Base records
- read calendar/free-busy
- create calendar events

For personal use, ensure the user is a tester or the app is released to the workspace where authorization will happen.

## Cloudflare Runbook

1. Check login:

```bash
npx wrangler whoami
```

If not logged in, ask the user to complete:

```bash
npx wrangler login
```

2. Create D1 if needed:

```bash
npx wrangler d1 create reading-block-prod
```

Record the returned `database_id`.

3. Create `.env` from `.env.example` and fill values:

```bash
cp .env.example .env
```

Expected minimum `.env`:

```bash
PUBLIC_BASE_URL=https://reading-block.example.com
LARK_APP_ID=cli_xxxxxxxxxxxxxxxx
WORKER_NAME=reading-block-api
D1_DATABASE_NAME=reading-block-prod
D1_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DEFAULT_TIME_ZONE=Asia/Shanghai
```

4. Generate config:

```bash
npm run configure
```

This creates ignored files:

- `wrangler.jsonc`
- `extension/manifest.json`
- `extension/src/lib/config.js`

5. Generate encryption key:

```bash
npm run secret:key
```

6. Set Worker secrets. Let the user type/paste values into the Wrangler prompt:

```bash
npx wrangler secret put LARK_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` must be the base64 value from `npm run secret:key`. `SESSION_SECRET` can be another long random string.

7. Apply migrations:

```bash
npx wrangler d1 migrations apply reading-block-prod --remote
```

8. Deploy:

```bash
npm run worker:deploy
```

9. Bind custom domain in Cloudflare so `PUBLIC_BASE_URL` reaches the deployed Worker.

10. Verify health:

```bash
curl https://YOUR_WORKER_DOMAIN/health
```

Expected JSON:

```json
{"ok":true,"service":"reading-block-api"}
```

## Extension Runbook

1. Ensure config has been generated:

```bash
npm run configure
```

2. Package zip if desired:

```bash
npm run package:extension
```

3. For local install, ask the user to:

- open `chrome://extensions`
- enable Developer mode
- click `Load unpacked`
- select the repository's `extension/` directory

4. Ask the user to open the extension options page and click `Connect`.

5. The extension opens the Lark/Feishu authorization URL. The user must approve it manually.

6. After authorization, the options page should show connected status and eventually an `Open Base` link.

## Verification

Run local tests:

```bash
npm test
```

Manual end-to-end check:

1. Open a normal `https://` article page.
2. Click the Reading Block extension icon.
3. Open extension options.
4. Confirm the item appears in the cloud list.
5. Open the linked Base and confirm a record exists.
6. Save enough unread items to reach `Saves per block`.
7. Confirm a Reading Block event appears on the user's calendar.

## Common Failures

- `Required Worker name missing`: run commands from the repo root after `npm run configure`, or pass `--name`.
- `redirect_uri is invalid`: the developer console redirect URL must exactly match `PUBLIC_BASE_URL/auth/lark/callback`.
- `Permission denied`: missing scopes, app not released, or user not added as tester.
- Extension says `Saved locally`: cloud session is missing or expired. Open options and reconnect.
- No Base link: Base is created lazily; open options after login or save one cloud item.
- No Calendar event: the waiting item count has not reached `Saves per block`, the reading window has no free slot, or calendar scopes are missing.
- `TOKEN_ENCRYPTION_KEY must decode to 32 bytes`: regenerate with `npm run secret:key` and update the Worker secret.

## Safe Agent Behavior

- Prefer editing templates and docs over generated files.
- If generated files are needed locally, run `npm run configure`; do not commit the outputs.
- Use `npm test` after Worker or scheduling changes.
- Keep `worker/src/index.js` Worker-runtime compatible; do not add Node-only APIs there.
- Keep Chrome extension code Manifest V3 compatible.
- Do not log OAuth tokens, refresh tokens, session tokens, or secrets.
