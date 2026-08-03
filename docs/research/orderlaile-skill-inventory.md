# 订单来了 Skills 清单观察

观察日期：2026-07-29

## 说明

本文只记录订单来了本地安装包中的 skill 清单、目录结构和能力边界，不复制其实现内容。

本地来源：

```text
/Applications/订单来了.app/Contents/Resources/skills-catalog.json
/Applications/订单来了.app/Contents/Resources/smart-order-skills/
```

## Skills Catalog

`skills-catalog.json` 中暴露的内置 skill：

| id | 名称 | 描述 | 分类 |
| --- | --- | --- | --- |
| browser-guide | 浏览器操作助手 | 在已登录的商家后台页面中完成导航、点击与信息采集 | store |
| documents | Word 文档 | 创建、编辑、批注与审阅 Word / Google Docs 文档 | files |
| spreadsheet | Excel 表格 | 创建与编辑电子表格，支持公式、格式与图表 | files |
| pdf | PDF | 创建、编辑与审阅 PDF 文件 | files |

另有目录存在但未出现在当前 catalog featured 列表中：

```text
image-generation
video-generation
```

## 目录结构

```text
smart-order-skills/
  browser-guide/
    SKILL.md

  documents/
    SKILL.md
    LICENSE.txt
    manifest.txt
    render_docx.py
    agents/openai.yaml
    assets/file-document.png
    examples/end_to_end_smoke_test.md
    ooxml/
    references/
    scripts/
    tasks/
    troubleshooting/

  spreadsheet/
    SKILL.md
    agents/openai.yaml
    assets/file-spreadsheet.png
    charts.md
    style_guidelines.md
    templates/

  pdf/
    SKILL.md
    LICENSE.txt
    agents/openai.yaml
    assets/pdf.png

  image-generation/
    SKILL.md
    scripts/generate_image.mjs

  video-generation/
    SKILL.md
```

## 能力分组

### browser-guide

定位：

```text
内嵌商户后台页面操作指导
```

能力边界：

- 页面快照。
- 根据 ref 点击。
- 输入文字。
- 导航后等待。
- 弹窗处理。

它依赖的不是 skill 自身实现页面控制，而是订单来了内置的 browser MCP 工具族：

```text
browser_snapshot
browser_click
browser_type
browser_find_text
browser_query_elements
browser_take_screenshot
browser_listen_request
browser_drain_listener
```

### documents

定位：

```text
Word / Google Docs 文档创建、编辑、审阅
```

目录显示其覆盖：

- OOXML 结构处理。
- 批注。
- 修订。
- 字段。
- 超链接。
- 目录。
- 页眉页脚。
- 表格。
- 图片。
- 水印。
- 隐私清理。
- 可访问性检查。
- LibreOffice headless 渲染验证。

### spreadsheet

定位：

```text
Excel / 表格创建和编辑
```

目录显示其覆盖：

- 表格样式指南。
- 图表。
- 财务模型模板。
- 市场营销模板。
- 医疗模板。
- 科研模板。

### pdf

定位：

```text
PDF 创建、编辑、审阅
```

当前目录较轻，主要有 skill 说明、agent 配置和资产。

### image-generation / video-generation

定位：

```text
图片生成 / 视频生成
```

`image-generation` 有本地脚本 `generate_image.mjs`，并且代码里出现 `~/.smartorder` 路径。`video-generation` 当前只观察到 `SKILL.md`。

## 判断

订单来了当前内置 skills 可以分两类：

```text
1. 业务相关：browser-guide
2. 通用办公生产力：documents / spreadsheet / pdf / image-generation / video-generation
```

真正和酒店/PMS/OTA 经营强相关的是 `browser-guide`，但它本身更像“页面操作规范”，核心能力在 App 的 browser MCP 和 PMS Agent 工具层。

通用办公类 skill 很可能用于：

- 生成经营报告。
- 编辑合同/说明文档。
- 导出表格。
- 处理 PDF。
- 生成图片/视频素材。

## 可借鉴点

1. Skill 不一定要直接实现能力，可以只定义“何时使用、如何调用工具、注意事项”。

2. 真正的业务能力应放在受控工具层，例如：

```text
browser tools
pms tools
channel tools
report tools
file tools
```

3. Skill catalog 可以服务 marketplace / tabs / 分类展示：

```text
featured
files
revenue
store
service
```

4. 业务 skill 应该围绕酒店经营重新设计，而不是直接复制通用办公 skill。

## 建议自研 Skill 方向

面向 RMS Desk，更有价值的 clean-room skill 应该是：

```text
ota-browser-guide
channel-session-health
order-event-review
rate-inventory-audit
competitor-price-check
booking-anomaly-detection
review-reply-assistant
daily-ops-report
```

这些 skill 可以复用开源工具思想和公开观察到的工具边界，但需要独立编写说明、schema 和实现。
