# Lark 应用配置

请使用海外 Lark 开放平台。

## 创建应用

1. 创建一个自建应用。
2. 把 App ID 填到 `.env` 的 `LARK_APP_ID`。
3. App Secret 不要写进仓库，后面用 `npx wrangler secret put LARK_APP_SECRET` 保存到 Cloudflare。

## OAuth 回调地址

添加这个 Redirect URL：

```text
https://你的后端域名/auth/lark/callback
```

它必须等于 `PUBLIC_BASE_URL` 加上 `/auth/lark/callback`，一个字符都不能错。

## OAuth 权限

Worker 使用用户授权 token。可以先配置下面这些权限，并在 Lark 控制台里确认权限名称，因为开放平台 UI 里的名称可能会调整：

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

`npm run configure` 生成的 `wrangler.jsonc` 也会把同一组权限写入 `LARK_OAUTH_SCOPES`。

## 发布 / 测试用户

如果先自己用，把自己加入测试用户，或只发布到自己的 workspace。

## 常见问题

- `redirect_uri is invalid`：Lark 配置的回调地址和 Worker 回调地址不一致。
- `Permission denied`：缺权限，或应用还没有发布/没有把你加成测试用户。
- OAuth 成功但 Base 创建失败：检查 Base 相关权限，以及 workspace 是否允许这个应用使用 Base 能力。
