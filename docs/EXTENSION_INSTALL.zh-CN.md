# Chrome 插件安装

## 开发安装

1. 执行 `npm run configure`。
2. 打开 `chrome://extensions`。
3. 开启 Developer mode。
4. 点击 `Load unpacked`。
5. 选择 `extension/` 目录。

## 打包 zip

```bash
npm run package:extension
```

zip 会生成在：

```text
dist/reading-block-lark-extension.zip
```

本地测试时，先解压 zip，再在 Chrome 里加载解压后的目录。Chrome 不能像 Chrome Web Store 一样直接安装任意未签名 zip。

## 更新

如果修改了 `.env` 或 Worker 域名：

```bash
npm run configure
npm run package:extension
```

然后在 `chrome://extensions` 里 reload 插件。
