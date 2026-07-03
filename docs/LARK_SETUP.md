# Lark / Feishu App Setup

Both overseas Lark and domestic Feishu can work. The examples below use overseas Lark; Feishu users should create the app in the Feishu developer console and configure the matching OpenAPI/OAuth hosts when needed.

## Create The App

1. Create a custom app.
2. Copy the App ID into `.env` as `LARK_APP_ID`.
3. Keep the App Secret for `npx wrangler secret put LARK_APP_SECRET`.
4. Optional: if you are not using the default overseas Lark endpoints, set `LARK_OPEN_API_BASE` and `LARK_AUTH_URL` in `.env`.

## OAuth Redirect

Add this redirect URL:

```text
https://YOUR_WORKER_DOMAIN/auth/lark/callback
```

It must exactly match `PUBLIC_BASE_URL` plus `/auth/lark/callback`.

## OAuth Scopes

The Worker uses user access tokens. Start with these scopes and verify them in the Lark or Feishu console because scope names may change in the platform UI:

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

The generated `wrangler.jsonc` stores the same list in `LARK_OAUTH_SCOPES`.

## Release / Tester Access

For personal use, add yourself as a tester or publish the app only to the workspace where you will authorize it.

## Common Problems

- `redirect_uri is invalid`: the platform redirect URL does not exactly match the Worker callback URL.
- `Permission denied`: a required scope is missing or the app has not been released/test-enabled.
- OAuth succeeds but Base creation fails: check Base permissions and whether the app is allowed in your workspace.
