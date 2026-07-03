# Self-Hosting Guide

This guide assumes you want your own Worker, your own Lark or Feishu app, and your own Chrome extension build.

## 1. Create A Lark Or Feishu App

Both overseas Lark and domestic Feishu can work. This guide uses overseas Lark as the example; for Feishu, create the app in the Feishu developer console and set the matching OpenAPI/OAuth hosts in `.env` if they differ.

See [docs/LARK_SETUP.md](docs/LARK_SETUP.md).

You will need:

- App ID, for example `cli_xxx`.
- App Secret, stored later as a Worker secret.
- Redirect URL: `https://YOUR_WORKER_DOMAIN/auth/lark/callback`.
- User OAuth scopes for Base creation, Base records, calendar free/busy, calendar event creation, and `offline_access`.

## 2. Create Cloudflare Resources

See [docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md).

```bash
npx wrangler login
npx wrangler d1 create reading-block-prod
```

Copy the returned `database_id` into `.env`.

## 3. Configure The Project

```bash
cp .env.example .env
```

Edit `.env`:

```bash
PUBLIC_BASE_URL=https://reading-block.example.com
LARK_APP_ID=cli_xxxxxxxxxxxxxxxx
D1_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Generate deployment-specific files:

```bash
npm run configure
```

## 4. Set Worker Secrets

```bash
npx wrangler secret put LARK_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` must be 32 random bytes encoded as base64:

```bash
npm run secret:key
```

Use another long random value for `SESSION_SECRET`.

## 5. Migrate And Deploy

```bash
npx wrangler d1 migrations apply reading-block-prod --remote
npm run worker:deploy
```

Then attach your custom domain in Cloudflare so `PUBLIC_BASE_URL` points to this Worker.

## 6. Package And Install The Extension

```bash
npm run package:extension
```

Install `extension/` as an unpacked extension during development, or use `dist/reading-block-lark-extension.zip` for distribution.

See [docs/EXTENSION_INSTALL.md](docs/EXTENSION_INSTALL.md).

## 7. First Run

1. Open the extension options page.
2. Click `Connect`.
3. Authorize with Lark.
4. Save several articles.
5. Open your Lark Base from the options page.
6. Once the batch threshold is reached, check your Lark Calendar.
