# Tools

个人效率工具与中文 CheatSheet 的静态站点，发布在
[sunnirvana.github.io](https://sunnirvana.github.io/)。站点不需要构建工具或服务端；每个页面都是可独立打开的静态文件。

## 目录

```text
.
├── index.html                         # 首页目录
├── cheatsheets/
│   ├── matt-pocock-skills/index.html  # Matt Pocock Skills 中文 CheatSheet
│   ├── hermes-agent/index.html        # Hermes Agent 中文 CheatSheet
│   └── trellis/index.html             # Trellis 中文 CheatSheet
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

## 上游 CheatSheet 自动同步

站点上的非官方中文速查会**钉住**上游版本（见 `scripts/upstream/config.json`）。日常内容更新由助手定期用大模型对照上游重写 HTML 并开 PR。仓库里的 `Sync upstream cheatsheets` Action **已关闭定时**，仅保留手动 `workflow_dispatch` 做机械对比（版本钉 / 摘要），**不作为正文更新来源**。对比上游：

| id | 上游 | 版本来源 |
| --- | --- | --- |
| `matt-pocock-skills` | [mattpocock/skills](https://github.com/mattpocock/skills) | GitHub Releases |
| `hermes-agent` | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | GitHub Releases |
| `trellis` | [@mindfoldhq/trellis](https://www.npmjs.com/package/@mindfoldhq/trellis)（仓库 [mindfold-ai/Trellis](https://github.com/mindfold-ai/Trellis)） | npm `latest` |

若发现更新，工作流会改写对应速查页的版本条 / 页脚出处、`index.html` 卡片上的「基于 v…」（若有）、`THIRD_PARTY_NOTICES.md`，并插入简短的「上游变更摘要」区块，然后**打开或更新 PR** 供人工审阅。

**PR 不会自动合并。** 命令表与示例仍是静态整理，自动化只负责版本钉与变更摘要，合并前请对照上游发布说明抽查。

### 手动运行

1. 打开仓库 **Actions → Sync upstream cheatsheets → Run workflow**
2. 可选输入：
   - `dry_run`：只对比、不写文件、不开 PR
   - `force`：即使版本相同也当作需要更新（测试用）
   - `only`：逗号分隔的 id，例如 `hermes-agent,trellis`

### 本地运行

在仓库根目录：

```sh
node scripts/upstream/sync.mjs --dry-run
# 真正写文件（会改 working tree）：
node scripts/upstream/sync.mjs
UPSTREAM_ONLY=trellis node scripts/upstream/sync.mjs --dry-run
```

可选环境变量：`GITHUB_TOKEN` / `GH_TOKEN`（提高 GitHub API 限额）、`UPSTREAM_ONLY`、`SYNC_REPORT_PATH`。
