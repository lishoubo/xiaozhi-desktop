# 订单来了 Skills 中文参考索引

整理日期：2026-07-29

## 说明

本文是对本机订单来了安装包中 `smart-order-skills` 目录的中文索引和用途解读，不复制第三方原文、脚本源码或资产内容。

来源目录：

```text
/Applications/订单来了.app/Contents/Resources/smart-order-skills/
```

## 总览

订单来了内置 skill 分为 6 个目录：

| 目录 | 主要用途 | 业务相关度 |
| --- | --- | --- |
| `browser-guide` | 内嵌 PMS/商户后台页面操作指导 | 高 |
| `documents` | Word/DOCX/Google Docs 文档创建、编辑、审阅、渲染校验 | 中 |
| `spreadsheet` | Excel/Google Sheets 表格创建、编辑、格式、图表 | 中 |
| `pdf` | PDF 读取、创建、审阅、渲染检查 | 低到中 |
| `image-generation` | 图片生成/编辑 | 低到中 |
| `video-generation` | 视频生成 | 低到中 |

从业务价值看，`browser-guide` 最接近酒店/PMS/OTA 场景。其他目录主要是通用办公生产力能力，可用于经营报告、表格、PDF、营销素材等。

## Catalog 暴露的技能

| id | 中文名 | 用途说明 |
| --- | --- | --- |
| `browser-guide` | 浏览器操作助手 | 在已登录商家后台中做导航、点击、填写和信息采集 |
| `documents` | Word 文档 | 创建、编辑、批注、审阅 Word / Google Docs 目标文档 |
| `spreadsheet` | Excel 表格 | 创建和编辑电子表格，处理公式、格式、图表 |
| `pdf` | PDF | 创建、编辑和审阅 PDF |

`image-generation` 和 `video-generation` 目录存在，但未出现在当前 catalog 的 `skills` 列表中。

## browser-guide

### 文件

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `browser-guide/SKILL.md` | 1047 | 指导 AI 在内嵌 PMS/商户后台页面中通过 browser 工具进行点击、输入、导航和信息采集 |

### 设计要点

- 只在用户明确需要页面操作时使用。
- 页面操作前先获取页面快照。
- 根据快照里的 `ref` 定位元素。
- 点击或输入后再次获取快照确认结果。
- 遇到弹窗、确认框、页面跳转需要先等待和复查。

### 关联工具

```text
browser_snapshot
browser_click
browser_type
browser_find_text
browser_query_elements
browser_wait_for
```

## documents

### 顶层文件

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `documents/SKILL.md` | 36125 | Word/DOCX 文档技能总说明，定义创建、编辑、批注、修订、渲染校验、质量标准和脚本索引 |
| `documents/LICENSE.txt` | 1418 | 许可证说明 |
| `documents/manifest.txt` | 1961 | 文档 skill 内部文件清单/manifest |
| `documents/render_docx.py` | 14306 | DOCX 渲染辅助脚本，用于把文档渲染成页面图片/PDF 做视觉检查 |
| `documents/agents/openai.yaml` | 314 | agent 配置 |
| `documents/assets/file-document.png` | 10876 | 文档图标/资产 |
| `documents/examples/end_to_end_smoke_test.md` | 930 | 端到端 smoke test 示例说明 |

### OOXML 参考

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `documents/ooxml/comments.md` | 1879 | Word 批注相关 OOXML 结构说明 |
| `documents/ooxml/hyperlinks_and_fields.md` | 2505 | 超链接、字段、TOC/REF 等 Word 字段结构说明 |
| `documents/ooxml/rels_and_content_types.md` | 1381 | DOCX 包关系文件和 content types 说明 |
| `documents/ooxml/tracked_changes.md` | 1653 | Word 修订/红线相关 OOXML 说明 |

### references

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `documents/references/design_presets.md` | 16412 | 文档设计预设、版式/视觉风格参考 |
| `documents/references/header_templates.md` | 12727 | 页眉页脚模板和布局参考 |

### troubleshooting

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `documents/troubleshooting/libreoffice_headless.md` | 1774 | LibreOffice headless 渲染排障 |
| `documents/troubleshooting/run_splitting.md` | 821 | Word run 拆分相关问题说明 |

### tasks

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `documents/tasks/accessibility_a11y.md` | 1964 | 文档可访问性审计和快速修复 |
| `documents/tasks/captions_crossrefs.md` | 3803 | 图表题注和交叉引用 |
| `documents/tasks/clean_tracked_changes.md` | 1669 | 接受/清理修订，输出干净文档 |
| `documents/tasks/comments_manage.md` | 2931 | 批注提取、添加、修改、删除、保留 |
| `documents/tasks/compare_diff.md` | 1172 | 两个 DOCX 的视觉和结构对比 |
| `documents/tasks/create_edit.md` | 1740 | 创建/编辑 DOCX 的常规流程和注意事项 |
| `documents/tasks/fields_update.md` | 2363 | TOC、页码、引用等字段更新处理 |
| `documents/tasks/fixtures_edge_cases.md` | 1707 | 构造边界 case 测试样例 |
| `documents/tasks/footnotes_endnotes.md` | 1850 | 脚注/尾注处理 |
| `documents/tasks/forms_content_controls.md` | 2054 | 表单和内容控件 |
| `documents/tasks/headings_numbering.md` | 1858 | 标题层级和多级编号 |
| `documents/tasks/images_figures.md` | 1382 | 图片/图形插入、定位和锚定 |
| `documents/tasks/multi_doc_merge.md` | 1506 | 多 DOCX 合并 |
| `documents/tasks/navigation_internal_links.md` | 2090 | 文档内部跳转链接、目录、Top/Bottom 链接 |
| `documents/tasks/privacy_scrub_metadata.md` | 839 | 清理文档个人元数据 |
| `documents/tasks/protection_restrict_editing.md` | 1196 | 只读/限制编辑保护 |
| `documents/tasks/read_review.md` | 2526 | 读取和审阅已有 DOCX |
| `documents/tasks/redaction_anonymization.md` | 2364 | 脱敏、匿名化、版式保持 |
| `documents/tasks/sections_layout.md` | 2220 | 分节符、横竖版、页边距、页面尺寸 |
| `documents/tasks/style_lint_normalize.md` | 2577 | 样式检查和格式规范化 |
| `documents/tasks/tables_spreadsheets.md` | 1116 | 表格和电子表格导入/导出 |
| `documents/tasks/templates_style_packs.md` | 1268 | 模板和样式包 |
| `documents/tasks/toc_workflow.md` | 1951 | 插入和更新目录 |
| `documents/tasks/verify_render.md` | 2606 | DOCX 渲染成 PNG 并视觉检查 |
| `documents/tasks/watermarks_background.md` | 1331 | 水印和背景元素 |

### scripts

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `documents/scripts/a11y_audit.py` | 12835 | 文档可访问性审计脚本 |
| `documents/scripts/accept_tracked_changes.py` | 5547 | 接受修订脚本 |
| `documents/scripts/add_tracked_replacements.py` | 5861 | 添加带修订标记的替换 |
| `documents/scripts/apply_template_styles.py` | 4049 | 应用模板样式 |
| `documents/scripts/captions_and_crossrefs.py` | 9678 | 题注和交叉引用处理 |
| `documents/scripts/comments_add.py` | 8644 | 添加 Word 批注 |
| `documents/scripts/comments_apply_patch.py` | 4926 | 对批注应用 patch |
| `documents/scripts/comments_extract.py` | 5421 | 提取批注 |
| `documents/scripts/comments_strip.py` | 4856 | 删除批注 |
| `documents/scripts/content_controls.py` | 11493 | 内容控件处理 |
| `documents/scripts/docx_ooxml_patch.py` | 22103 | 直接 patch DOCX OOXML |
| `documents/scripts/docx_table_to_csv.py` | 2106 | DOCX 表格导出 CSV |
| `documents/scripts/fields_materialize.py` | 10494 | 字段结果物化/冻结 |
| `documents/scripts/fields_report.py` | 5685 | 字段扫描报告 |
| `documents/scripts/flatten_ref_fields.py` | 4718 | 展平引用字段 |
| `documents/scripts/footnotes_report.py` | 2905 | 脚注/尾注报告 |
| `documents/scripts/heading_audit.py` | 3227 | 标题结构审计 |
| `documents/scripts/images_audit.py` | 5839 | 图片审计 |
| `documents/scripts/insert_note.py` | 9025 | 插入脚注/尾注 |
| `documents/scripts/insert_ref_fields.py` | 7114 | 插入引用字段 |
| `documents/scripts/insert_toc.py` | 5088 | 插入目录 |
| `documents/scripts/internal_nav.py` | 11970 | 内部导航链接处理 |
| `documents/scripts/make_fixtures.py` | 8670 | 生成测试 fixture |
| `documents/scripts/merge_docx_append.py` | 3842 | 追加合并 DOCX |
| `documents/scripts/privacy_scrub.py` | 5675 | 隐私元数据清理 |
| `documents/scripts/redact_docx.py` | 9508 | DOCX 脱敏 |
| `documents/scripts/render_and_diff.py` | 4806 | 渲染并比较差异 |
| `documents/scripts/section_audit.py` | 2706 | 分节/页面布局审计 |
| `documents/scripts/set_protection.py` | 4992 | 设置/移除文档保护 |
| `documents/scripts/style_lint.py` | 5416 | 样式 lint |
| `documents/scripts/style_normalize.py` | 5661 | 样式规范化 |
| `documents/scripts/table_geometry.py` | 9796 | 表格尺寸/几何处理 |
| `documents/scripts/watermark_add.py` | 5322 | 添加水印 |
| `documents/scripts/watermark_audit_remove.py` | 4668 | 水印审计和移除 |
| `documents/scripts/xlsx_to_docx_table.py` | 5664 | XLSX 转 DOCX 表格 |

### documents 设计总结

这个 skill 的核心不是“写 Word 文本”，而是完整文档工程流：

```text
创建/编辑 DOCX
  -> 操作 OOXML 或 python-docx
  -> 渲染成 PNG
  -> 逐页视觉检查
  -> 修复布局
  -> 交付最终文档
```

强调点：

- render → inspect → iterate 是硬约束。
- 对批注、修订、字段、目录、水印、脚注等复杂 Word 特性有单独任务说明和脚本。
- 通过脚本覆盖大量 Word GUI 不稳定或 headless 难处理的问题。

## spreadsheet

### 文件

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `spreadsheet/SKILL.md` | 37806 | 表格 skill 总说明，覆盖创建、编辑、公式、格式、图表、验证、API 使用 |
| `spreadsheet/agents/openai.yaml` | 364 | agent 配置 |
| `spreadsheet/assets/file-spreadsheet.png` | 11988 | 表格图标/资产 |
| `spreadsheet/charts.md` | 3812 | 图表设计和创建指南 |
| `spreadsheet/style_guidelines.md` | 9290 | 表格样式和版式指南 |
| `spreadsheet/templates/financial_models.md` | 13963 | 财务模型模板指南 |
| `spreadsheet/templates/healthcare.md` | 3912 | 医疗类表格模板指南 |
| `spreadsheet/templates/marketing_advertising.md` | 3586 | 市场营销/广告类表格模板指南 |
| `spreadsheet/templates/scientific_research.md` | 2508 | 科研类表格模板指南 |

### 设计要点

- 面向 Excel 和 Google Sheets 目标输出。
- 强调工作簿结构、公式、格式、图表、数据验证、条件格式。
- 有明确的完成标准和校验规则。
- 通过 artifact 工具 API 操作 workbook，而不是简单生成 CSV。
- 提供常用 API surface 和 JavaScript 示例。

### 适合借鉴的点

- 表格生成要有“视觉结构”，不能只是数据矩阵。
- 复杂表格需要包含标题区、主表区、摘要区。
- 公式和图表需要可验证。
- 修改已有表格时先理解 workbook 结构，再做局部编辑。

## pdf

### 文件

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `pdf/SKILL.md` | 2517 | PDF 读取、创建、审阅、渲染检查工作流 |
| `pdf/LICENSE.txt` | 10776 | PDF 相关许可证说明 |
| `pdf/agents/openai.yaml` | 250 | agent 配置 |
| `pdf/assets/pdf.png` | 1312 | PDF 图标/资产 |

### 设计要点

- 用于 PDF 阅读、生成和审核。
- 重视渲染和布局检查。
- 建议使用 Poppler、reportlab、pdfplumber、pypdf 等工具。
- 明确临时文件和输出约定。

## image-generation

### 文件

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `image-generation/SKILL.md` | 5664 | 图片生成/编辑 skill 说明 |
| `image-generation/scripts/generate_image.mjs` | 18938 | 图片生成脚本 |

### 设计要点

- 支持文生图、图生图、局部修改等。
- 使用内置 Smart-Order 图片脚本。
- 说明命令执行、网络权限、等待时间、默认参数、尺寸限制。
- 最终回复只给结果和必要说明。

## video-generation

### 文件

| 文件 | 大小 | 中文用途 |
| --- | ---: | --- |
| `video-generation/SKILL.md` | 8291 | 视频生成 skill 说明 |

### 设计要点

- 通过客户端可用视频模型生成短视频。
- 支持文生视频、全能参考、首尾帧。
- 通过 `create_video_task` 工具提交任务。
- 明确不经脚本或直连 HTTP。
- 包含模型参数、触发路径、附件处理、等待时间、取消任务等规则。

## 关键架构观察

订单来了的 skill 目录本身并不是完整业务系统。真正的能力分布是：

```text
Skill 文档：告诉 Agent 何时用、怎么用、注意什么
本地工具：browser_* / pms_* / execute_skill / create_video_task
脚本：处理办公文档、图片等文件任务
远程服务：PMS Agent、图片/视频模型、云 PMS
```

也就是说，skill 是“操作规程 + 工具路由 + 质量标准”，不是全部实现。

## 对业务相关性的排序

| 优先级 | 模块 | 原因 |
| --- | --- | --- |
| P0 | `browser-guide` | 直接对应内嵌 PMS/OTA 页面操作 |
| P1 | `spreadsheet` | 可用于经营数据、日报、价量态表格 |
| P1 | `documents` | 可用于经营报告、方案文档、合同/通知 |
| P2 | `pdf` | 可用于报告审阅、账单/合同处理 |
| P2 | `image-generation` | 可用于营销素材 |
| P3 | `video-generation` | 可用于短视频营销，但离 RMS 核心较远 |

## 可参考但不应照搬的点

1. `browser-guide` 的页面操作规范很有价值：先 snapshot，再 ref 操作，再复查。
2. `documents` 的 render-and-verify 工作流很成熟，适合任何“输出文档必须可看”的场景。
3. `spreadsheet` 的结构化表格生成和验证规则适合经营报表。
4. 文件类 skill 都把复杂能力拆到脚本/工具里，skill 只负责调度和质量约束。
5. 视频/图片生成都通过受控工具提交任务，不让 Agent 自己拼底层 HTTP。

