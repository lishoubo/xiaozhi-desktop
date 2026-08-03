# Codex Plugin Marketplace 与订单来了 Skill Market

调研日期：2026-07-29

## 结论

订单来了的 `skill market` 不是凭空自研的一套孤立机制。Codex 官方本身就有 **plugins / marketplace / skills / MCP server** 这一整套扩展体系。

更准确的判断是：

```text
市场机制、插件包格式、skills/MCP 组合方式：Codex 官方能力
订单来了自己的市场源、插件内容、业务 skill、OTA/PMS tools：订单来了实现
```

也就是说，订单来了大概率不是自己从零发明了一个 skill market，而是：

```text
基于 Codex 的 plugin marketplace 能力
  -> 接入自己的 ddll-skill-market
  -> 分发 ctrip-helper / meituan-helper / PMSInquiryGuide 等业务插件
  -> 每个插件里放 skill、MCP tool、业务提示词或本地工具
```

## Codex 官方有什么能力

官方 Codex/ChatGPT 插件体系里，plugin 是一个可安装包，可以包含：

- skills
- MCP server
- connectors
- hooks
- optional UI
- assets
- marketplace metadata

官方文档明确说：

```text
ChatGPT and Codex share one universal plugin directory.
```

也支持本地 marketplace / repo marketplace / personal marketplace，用来开发、测试、团队分发插件。

一个典型 plugin 结构是：

```text
my-plugin/
  .codex-plugin/
    plugin.json
  skills/
    some-skill/
      SKILL.md
  .mcp.json
  .app.json
  hooks/
  assets/
```

其中 `.codex-plugin/plugin.json` 是必需入口。它可以声明：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Bundle reusable skills and MCP servers.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "apps": "./.app.json",
  "hooks": "./hooks/hooks.json"
}
```

## Marketplace 是什么

Codex 官方 marketplace 本质上是一个 JSON catalog，列出可安装插件。

官方支持几类来源：

- universal public plugin directory
- repo marketplace：`$REPO_ROOT/.agents/plugins/marketplace.json`
- personal marketplace：`~/.agents/plugins/marketplace.json`
- Git-backed marketplace
- npm-backed plugin package
- local marketplace root

一个 marketplace 可以长这样：

```json
{
  "name": "local-example-plugins",
  "interface": {
    "displayName": "Local Example Plugins"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "source": {
        "source": "local",
        "path": "./plugins/my-plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

安装后，ChatGPT/Codex 会把 plugin bundle 缓存到类似路径：

```text
~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/
```

然后在新 chat/session 里加载它的 skills、MCP servers、hooks 等能力。

## 订单来了看到的是什么

之前在订单来了本机配置里观察到：

```text
~/.smartorder/config.toml
~/.smartorder/skills/
~/.smartorder/codex-marketplaces/ddll-skill-market/prod/current
/Applications/订单来了.app/.../smart-order-skills
```

还看到 marketplace/plugin 名称：

```text
ddll-skill-market
ctrip-helper
meituan-helper
PMSInquiryGuide
```

这说明订单来了至少做了几件事：

1. 把 Codex home 从默认 `~/.codex` 换成或包装成 `~/.smartorder`。
2. 配置了自己的 marketplace 源：`ddll-skill-market`。
3. 把官方/通用 Codex plugin 能力用于自己的行业插件分发。
4. 给业务插件接入自己的 MCP tools，例如 `browser_*`、`ota_account_list`、`pms_get_context`、`pms_http_request`。
5. 用自己的 app bridge 把插件能力连到 Electron 主进程和 OTA/PMS 页面。

## 哪些是 Codex 自带，哪些是订单来了自研

| 部分 | 来源判断 | 说明 |
|---|---|---|
| plugin 概念 | Codex 官方 | plugin 是可安装能力包 |
| skill 概念 | Codex 官方 | `SKILL.md` 工作流说明 |
| marketplace 概念 | Codex 官方 | JSON catalog，可本地/仓库/Git/npm |
| `.codex-plugin/plugin.json` | Codex 官方 | plugin manifest |
| MCP server 打包进 plugin | Codex 官方 | plugin 可包含 `.mcp.json` |
| plugin install/cache/enable | Codex 官方 | Codex/ChatGPT 支持 |
| `ddll-skill-market` | 订单来了 | 自己的私有 marketplace 源 |
| `ctrip-helper` / `meituan-helper` | 订单来了 | OTA 业务插件 |
| `PMSInquiryGuide` | 订单来了 | PMS 业务 skill/plugin |
| `browser_*` MCP tools | 订单来了 | 工具 schema 借鉴开源可能性高，但 Electron bridge 自研 |
| `pms_get_context` / `pms_http_request` | 订单来了 | 强绑定 PMS 登录态和页面上下文 |
| `~/.smartorder` runtime home | 订单来了包装 | 基于 Codex runtime 改了产品 home 和配置 |

## 为什么订单来了要做自己的 market

因为官方 Codex plugin marketplace 是通用扩展机制，但订单来了需要行业化分发：

- 携程插件
- 美团插件
- 飞猪插件
- 抖音插件
- PMS 查询插件
- 渠道巡店 skill
- 房价/库存/订单检查 skill

这些插件不能只靠公共 marketplace。它们需要：

- 只给订单来了用户使用。
- 跟订单来了账号体系绑定。
- 跟 PMS 门店、渠道账号、登录态绑定。
- 能调用订单来了内置 MCP tools。
- 能随产品版本更新。
- 能区分 prod/staging/edition。

所以它做一个 `ddll-skill-market` 很合理：底层用 Codex marketplace 机制，上层由订单来了维护自己的插件目录和发布渠道。

## 对我们的启发

如果我们做 RMS Desk，也可以照这个拆：

```text
底层扩展机制：
  使用 Codex plugin/skill/MCP marketplace 思路，或兼容其目录结构。

行业市场：
  自己维护 rms-skill-market。

插件内容：
  ctrip-helper
  meituan-helper
  douyin-helper
  booking-helper
  rate-inventory-audit
  order-review
  daily-ops-report

工具能力：
  browser_*
  pms_*
  ota_*
  report_*
```

推荐不要把所有渠道逻辑写死进主程序。更好的边界是：

```text
主程序：
  提供稳定 browser/PMS/OTA 工具和权限。

market/plugin：
  提供渠道特定 workflow、页面路径知识、字段解释、异常处理策略。
```

这样 OTA 页面变了，不一定每次都要发主程序版本；可以升级对应 helper plugin/skill。

## 参考来源

- OpenAI Codex Plugins: https://learn.chatgpt.com/docs/plugins
- OpenAI Build plugins: https://learn.chatgpt.com/docs/build-plugins.md
- OpenAI Package your plugin: https://developers.openai.com/plugins/build/plugins.md
- OpenAI Plugin architecture: https://developers.openai.com/plugins/concepts/plugins.md

