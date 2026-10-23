# 提交物核对清单

核对日期：2026-10-22。对应题目六类提交物。文件均已准备；当前已知的模型回答质量缺陷明确保留，不把“文件齐全”写成所有能力通过。

| 提交物 | 位置 | 核对结果 |
|---|---|---|
| 最小可运行项目/启动说明 | README.md、src/、public/、package.json、pnpm-lock.yaml、.env.example、.pi/ | 原生Pi→E2B→Web链路已验证；独立机器冷启动未执行 |
| 测试用例清单 | docs/testing/test-cases.md | 46条逻辑场景，有目的、输入、预期、实际、状态、证据和环境 |
| 自动化测试代码及结果 | tests/、scripts/、docs/evidence/current/automated-tests.stdout.txt、audit-run.json、web/ | 81/81确定性测试；此前真实10任务、此次联网3任务分开；旧回答质量9/10 |
| 日志/Trace/截图/结果 | docs/evidence/current/real-e2e.json、sse-events.json、artifacts/、webui.png、ui-smoke.json | 真模型/Pi/E2B/HTTP/SSE与真实浏览器；历史证据另目录 |
| 正式测试报告 | docs/testing/test-report.md | 环境、范围、策略、评分、统计、真实缺陷/回归及剩余风险已覆盖 |
| AI使用说明 | docs/testing/test-report.md第9节 | 说明生成范围、实际执行、证据核对与人工复核边界 |

## 实现状态

- Pi是实际Agent运行时，复用原生Loop、工具工厂、模型、上下文；应用不再预设两种任务。
- 真实示例二/追问、8项其他Coding/数据任务均通过。
- 双面板、自动上传、真实来源、工具参数/结果、产物路径、下载和预览已做浏览器回归。
- 原生MCP已接入wigolo@0.2.1 search/fetch；真实搜索、正文、来源文件、连续追问、内网拒绝及来源卡片UI通过；完整示例一和动态页面渲染未验收。
- 真实模型中间陈述存在行数证据矛盾；功能成功、质量失败分开报告，完整审计因此返回1。
- 真实安全对抗、超时/取消、长时间/高并发及新机器安装仍未验收。

## 分发文件与配置

必须保留：

- src/、public/、tests/（含fixtures/）、scripts/、docs/。
- README.md、package.json、pnpm-lock.yaml、pnpm-workspace.yaml、tsconfig.json、.env.example、.gitignore。
- .pi/bin/pi.exe、.pi/extensions/e2b.mjs、.pi/agent/models.json、.pi/agent/mcp.json、.pi/web/config.json、.pi/README.md。

排除：node_modules/、.env、.pi/agent/auth.json、.pi/agent/models-store.json、.pi/runtime/、.pi/qa-browser/、.pi/web/data/、.pi/web/research/、.pi/web/plugins/、临时打包目录。注意打包工具是否漏掉点开头的.pi目录。

所有运行配置都在项目工作区，接收者复制.env.example、填写模型/E2B凭证并检查baseUrl，执行pnpm install --frozen-lockfile、pnpm setup:web和pnpm dev；不依赖原题目录或用户全局Pi配置。搜索无需额外API Key；动态页面可选setup:web --browser。当前未制作最终分发zip，未声称免凭证/免网络。README和文档内部用相对链接以便整体移动。

结构整理阶段的启动/HTTP检查和Pi→模型→E2B烟测证据保留。联网接入后81项确定性测试通过，37项分发必需文件均存在，源码/文档/证据的配置凭据扫描无命中。证据为current/audit-run.json、web/和distribution-check.json；扫描不能代替安全对抗测试。锁文件依赖安装与setup:web已在当前工作区复核通过，未冒充干净机器验收。

