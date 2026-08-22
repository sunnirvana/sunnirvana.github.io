# Tools

个人效率工具与中文 CheatSheet 的静态站点，发布在
[sunnirvana.github.io](https://sunnirvana.github.io/)。站点不需要构建工具或服务端；每个页面都是可独立打开的静态文件。

## 目录

```text
.
├── index.html                         # 首页目录
├── cheatsheets/
│   ├── matt-pocock-skills/index.html  # Matt Pocock Skills 中文 CheatSheet
│   └── hermes-agent/index.html        # Hermes Agent 中文 CheatSheet
├── tools/                             # 未来独立小工具放在 tools/<name>/
├── assets/                            # 共享图标、公开运行配置与脚本
└── .github/workflows/deploy.yml       # master 自动发布到 GitHub Pages
```

## 本地预览

静态文件可以直接用浏览器打开。若需要接近真实站点的路径行为，可在仓库根目录启动任意静态服务器，例如：

```sh
python3 -m http.server 8000
```

然后访问 `http://localhost:8000/`。

## 新增页面

- CheatSheet 放在 `cheatsheets/<slug>/index.html`。
- 独立工具放在 `tools/<slug>/index.html`。
- 在首页的 “On the shelf” 区域补上链接和说明。
- 页面优先保持无 JavaScript 也能阅读核心内容；需要密钥或持久化时，默认只使用访客浏览器本地存储，绝不提交私密值。

## 发布到 GitHub Pages

推送到 `master` 后，GitHub Actions 会部署整个仓库。首次启用时，请在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions** 作为 Source。部署完成后，站点地址为：

`https://sunnirvana.github.io/`

## GA4（默认关闭）

统计脚本位于 `assets/site.js`，但只有在 `assets/site-config.js` 填入有效的 GA4 Measurement ID 后才会加载 Google 的脚本：

```js
window.TOOLS_SITE_CONFIG = {
  gaMeasurementId: "G-XXXXXXXXXX"
};
```

Measurement ID 本身是公开站点配置，不是密钥。启用后，本站只记录匿名页面浏览，以及 CheatSheet 的搜索、复制提示词与打印事件；不发送搜索词、复制内容或其他访客输入。

## 内容来源与许可

本站自行编写的代码与页面框架采用 [MIT License](LICENSE)。CheatSheet 是对公开上游项目的非官方中文整理，具体归属、上游版本与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
