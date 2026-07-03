# 排障

## 插件提示 Saved Locally

说明浏览器没有连上 Worker，或者登录 session 已过期。打开 options 页面，重新点击 `Connect`。

## OAuth 回调失败

确认 Lark 里配置的回调地址完全等于：

```text
https://你的后端域名/auth/lark/callback
```

## 看不到多维表格

Base 是懒创建的：登录后打开 options 页面，或第一次云端保存时才会创建。options 页里会显示 `Open Base`。

## 没有创建日历事件

Worker 只有在待读条目数量达到 `Saves per block` 后才会排日程。也要检查可阅读日期、时间窗口，以及 Lark 日历权限。

## Lark 返回 Permission denied

重新检查 Lark 开放平台里的 OAuth 权限，然后在插件里重新连接。
