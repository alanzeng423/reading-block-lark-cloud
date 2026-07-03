# 自托管部署指南

这个项目的推荐用法是：每个人部署自己的 Cloudflare Worker、自己的 Lark 应用、自己的 Chrome 插件包。

## 1. 创建 Lark 应用

请使用海外 Lark 开放平台，不是国内飞书开放平台。

详细步骤看：[docs/LARK_SETUP.zh-CN.md](docs/LARK_SETUP.zh-CN.md)。

你需要准备：

- App ID，例如 `cli_xxx`。
- App Secret，后面作为 Worker secret 保存。
- OAuth 回调地址：`https://你的后端域名/auth/lark/callback`。
- 用户级 OAuth 权限：Base 创建、Base 记录读写、日历忙闲查询、日历事件创建、`offline_access`。

## 2. 创建 Cloudflare 资源

详细步骤看：[docs/CLOUDFLARE_SETUP.zh-CN.md](docs/CLOUDFLARE_SETUP.zh-CN.md)。

```bash
npx wrangler login
npx wrangler d1 create reading-block-prod
```

把命令返回的 `database_id` 填进 `.env`。

## 3. 生成本地配置

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
PUBLIC_BASE_URL=https://reading-block.example.com
LARK_APP_ID=cli_xxxxxxxxxxxxxxxx
D1_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

生成 `wrangler.jsonc`、`extension/manifest.json` 和插件配置：

```bash
npm run configure
```

## 4. 设置 Worker Secrets

```bash
npx wrangler secret put LARK_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` 必须是 32 字节随机值的 base64：

```bash
npm run secret:key
```

`SESSION_SECRET` 用另一个足够长的随机字符串即可。

## 5. 迁移数据库并部署

```bash
npx wrangler d1 migrations apply reading-block-prod --remote
npm run worker:deploy
```

部署后，在 Cloudflare 里把你的自定义域名绑定到这个 Worker，确保 `.env` 里的 `PUBLIC_BASE_URL` 就是这个域名。

## 6. 打包和安装插件

```bash
npm run package:extension
```

开发时可以直接加载 `extension/` 目录；分发时使用 `dist/reading-block-lark-extension.zip`。

安装说明看：[docs/EXTENSION_INSTALL.zh-CN.md](docs/EXTENSION_INSTALL.zh-CN.md)。

## 7. 第一次使用

1. 打开插件 options 页面。
2. 点击 `Connect`。
3. 在 Lark 完成授权。
4. 保存几篇文章。
5. 在 options 页面打开自动创建的 Base。
6. 收藏数量达到阈值后，去 Lark 日历里查看 Reading Block。
