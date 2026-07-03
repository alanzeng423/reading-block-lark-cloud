# Troubleshooting

## The Extension Shows "Saved Locally"

The browser is not connected to the Worker, or the session expired. Open the options page and click `Connect`.

## OAuth Callback Fails

Check that the Lark redirect URL exactly equals:

```text
https://YOUR_WORKER_DOMAIN/auth/lark/callback
```

## No Base Appears

The Base is created lazily. It is created when `/api/me` or the first cloud save runs after login. Open the extension options page and look for `Open Base`.

## Calendar Event Is Not Created

The Worker schedules only after there are at least `Saves per block` waiting items. Also check the allowed days, reading window, and Lark calendar permissions.

## Permission Denied From Lark

Re-check OAuth scopes in the Lark or Feishu developer console, then reconnect the extension.
