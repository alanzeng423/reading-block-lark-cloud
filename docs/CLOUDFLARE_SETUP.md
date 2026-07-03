# Cloudflare Setup

## Login

```bash
npx wrangler login
```

## Create D1

```bash
npx wrangler d1 create reading-block-prod
```

Copy the returned `database_id` into `.env` as `D1_DATABASE_ID`.

## Generate Config

```bash
cp .env.example .env
npm run configure
```

This creates:

- `wrangler.jsonc`
- `extension/manifest.json`
- `extension/src/lib/config.js`

## Set Secrets

```bash
npx wrangler secret put LARK_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

Generate a valid token encryption key:

```bash
npm run secret:key
```

## Run Migrations

```bash
npx wrangler d1 migrations apply reading-block-prod --remote
```

## Deploy

```bash
npm run worker:deploy
```

Then attach the custom domain that you used in `PUBLIC_BASE_URL`.

## Optional R2 Download Hosting

If you want the Worker to serve the extension zip at `/downloads/reading-block-lark-extension.zip`:

1. Create an R2 bucket.
2. Set `R2_BUCKET_NAME` in `.env`.
3. Run `npm run configure` again.
4. Deploy again.
5. Upload `dist/reading-block-lark-extension.zip` to the bucket with key `reading-block-lark-extension.zip`.
