# Cloudflare 配置

## 登录

```bash
npx wrangler login
```

## 创建 D1

```bash
npx wrangler d1 create reading-block-prod
```

把返回的 `database_id` 填到 `.env` 的 `D1_DATABASE_ID`。

## 生成配置

```bash
cp .env.example .env
npm run configure
```

这会生成：

- `wrangler.jsonc`
- `extension/manifest.json`
- `extension/src/lib/config.js`

## 设置 Secrets

```bash
npx wrangler secret put LARK_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

生成合法的 token 加密 key：

```bash
npm run secret:key
```

## 执行数据库迁移

```bash
npx wrangler d1 migrations apply reading-block-prod --remote
```

## 部署

```bash
npm run worker:deploy
```

部署完成后，把 `.env` 里的 `PUBLIC_BASE_URL` 对应的自定义域名绑定到这个 Worker。

## 可选：用 R2 托管插件 zip

如果你希望 Worker 通过 `/downloads/reading-block-lark-extension.zip` 提供插件下载：

1. 创建一个 R2 bucket。
2. 在 `.env` 里设置 `R2_BUCKET_NAME`。
3. 再执行一次 `npm run configure`。
4. 重新部署 Worker。
5. 把 `dist/reading-block-lark-extension.zip` 上传到 bucket，key 使用 `reading-block-lark-extension.zip`。
