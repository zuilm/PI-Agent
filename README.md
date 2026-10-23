# Spawn Pi Agent

基于 Spawn Pi 的 Coding Agent 二次开发：由工作区内的 `pi.exe` 原生 Agent Loop 完成规划、模型调用、工具选择和多轮对话；TypeScript/Fastify 提供 WebUI、RPC 连接、E2B 工具接入、SSE 和文件交付。示例二是验收任务，应用没有按提示词匹配排序或筛选脚本。

## 启动

已验证环境：Windows x64、Node.js 24.19.0。需要有效的模型服务和 E2B 凭证。

从 GitHub 克隆时，需安装 Git LFS 并拉取随附的 Pi 二进制文件：

```powershell
git clone https://github.com/zuilm/PI-Agent.git
cd PI-Agent
git lfs install --local
git lfs pull
```

`.pi/bin/pi.exe` 通过 Git LFS 保存。下载源码 ZIP 的接收者也应确认获取的是实际二进制文件，而不是 LFS 指针。

在本项目目录运行：

```powershell
# 已有 .env 时保留并编辑，不要覆盖
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# 编辑 .env，填写 E2B_API_KEY、DASHSCOPE_API_KEY
# 检查 .pi/agent/models.json 的 baseUrl 是否适用于你的模型服务
pnpm install --frozen-lockfile
pnpm setup:web
pnpm dev
```

使用 pnpm 和随附锁文件安装；SQLite原生文件由 `setup:web` 检查和准备，避免安装阶段因本机缺C++编译器中断。浏览器打开 `http://127.0.0.1:8787`。首次安装、模型请求和沙箱创建均需网络。

直接发送任务即可，不强制上传文件。上传时选择文件会自动上传，状态栏展示实际沙箱路径。运行中可点击停止任务。界面采用浅色三栏布局：左侧会话导航、中间流式对话和底部输入框、右侧执行工作区。右侧可切换进度、原始事件日志和文件，工具卡支持 UI/RAW 及前后翻阅。回答标记“Pi 模型”，工具标记执行器，独立校验另行标记；产物展示完整沙箱路径，文本和图片支持预览、下载。

左侧只记录本次打开页面中的真实会话，支持新建、切换、重命名和保留输入草稿；没有跨刷新持久化。手机端使用侧边抽屉查看会话和执行面板。界面使用工作区内的 HTML/CSS/JavaScript 和 SVG，无外部字体或前端 CDN。详见[界面说明与验证](docs/architecture/web-ui.md)。

## 示例与通用任务

选择 `tests/fixtures/shuffled_numbers_10000.txt`，输入：

```text
请分析上传文件的结构和数据量，编写可复用程序，在沙箱将整数升序排列。
生成 sorted_numbers_asc.txt，使用整数排序校验后发布文件。
用中文汇报数量、最小值、最大值、前10个和后10个数字。
```

同一页面继续：“基于刚才的数据筛选7的倍数，降序保存为 multiples_of_7_desc.txt，校验并发布。”

也可要求无附件编程、计算总和/平均数、去重、按类别汇总 CSV、绘制 PNG 或修改上传的 Python 代码。这些任务均经过真实 Pi/模型/E2B 回归，详见报告；不代表任意开放式任务都已验证。

## 配置说明

| 配置 | 填写内容 |
|---|---|
| 工作区 `.env`：`PI_PROVIDER` | `models.json` 中 provider 的名字，例如 `dashscope` |
| 工作区 `.env`：`PI_MODEL` | 对应 provider 的模型 ID，例如 `qwen-plus` |
| 工作区 `.env`：`DASHSCOPE_API_KEY` | 模型 API 密钥 |
| `.pi/agent/models.json`：`baseUrl` | 模型服务 URL；随附值来自题目测试服务，需要按接收者环境检查 |
| `.pi/agent/models.json`：`apiKey` | `$DASHSCOPE_API_KEY`，引用环境变量，不写明文密钥 |
| 工作区 `.env`：`E2B_API_KEY` | E2B 密钥 |
| 工作区 `.env`：`PI_BIN` | 默认 `.pi/bin/pi.exe` |
| 工作区 `.env`：`RUN_TIMEOUT_MS` | 单轮上限，默认600000毫秒 |

所有项目配置和 Pi 状态均放在工作区。RPC 客户端明确指定 `PI_CODING_AGENT_DIR=<项目>/.pi/agent`，每个会话 cwd 在 `.pi/runtime/<sessionId>`。不要求接收者复制你的用户级 Pi 配置。

项目通过 Pi 原生扩展注册远程 `read/write/edit/bash`，执行与文件读写转到 E2B。Pi 原生 MCP、codemode、tool_search 作为显式内置扩展加载；`.pi/agent/mcp.json` 已接入固定版本 `wigolo@0.2.1`，向模型直接提供 `mcp__web__search` 和 `mcp__web__fetch`。连接和调用均由 Pi 负责，应用不增加 Agent Loop 或 MCP Client。联网工具无需额外搜索 API Key；模型与 E2B 仍需前述凭证。

可以直接提问：“请搜索 Fastify 官方入门文档，获取正文，说明安装命令并生成 sources.md。”界面会展示实际调用、正文来源链接、访问时间及缓存标记。修改 MCP 配置后需要新建会话或重启服务。

`setup:web` 检查工作区 SQLite 运行依赖，必要时从上游下载匹配当前 Node ABI 的原生文件。静态搜索和正文获取已实际验证，不要求先下载 Chromium。需要 JavaScript 渲染的页面可运行 `pnpm setup:web --browser` 预装浏览器；首次下载体积较大，wigolo 也可能按需安装。所有缓存、浏览器和模型文件均定位到 `.pi/web/data/`，配置在 `.pi/web/config.json`。本轮 Chromium 下载较慢且未完成，未宣称渲染页面已经通过验收。详见[联网接入设计与限制](docs/architecture/web-search.md)。

wigolo 是可信宿主机 stdio 进程，不属于 E2B 隔离范围；生成的分析代码仍在 E2B 执行。联网样本通过不代表题目示例一的多机构数据合并和年份对齐已经完成。

## 验证与交付文档

项目按职责整理，根目录保留启动说明和工程配置：

```text
src/                   Fastify入口与共享类型
  agent/               Pi RPC及运行事件适配
  sandbox/             E2B、工具网关、独立校验
  artifacts/           文件内容及元信息存储
  web/                 工作区联网环境与真实来源元信息
public/                三栏WebUI（index.html、app.css、app.js）
.pi/                   项目内Pi二进制、配置、扩展及运行缓存
tests/                 确定性测试及输入fixtures
scripts/
  checks/              Pi/模型/E2B连通性检查
  e2e/                 真实任务和浏览器验收
  reports/             质量评估及审计
  dev/                 开发用沙箱管理
  mcp/                 wigolo原生服务启动入口
  setup/               工作区联网依赖初始化
docs/
  architecture/        架构和阶段设计
  testing/             用例和正式测试报告
  delivery/            提交与分发核对
  evidence/            current、history、legacy执行证据
```

完整入口见 [文档导航](docs/README.md) 和 [脚本说明](scripts/README.md)。

```powershell
pnpm typecheck
pnpm test
pnpm smoke:pi
pnpm smoke:model
pnpm smoke:web
pnpm test:web
pnpm test:web:ui
pnpm test:e2e
pnpm test:ui
pnpm test:ui:layout
pnpm eval:responses
pnpm audit:submission
# 需要重新调用外部服务时：
pnpm audit:submission --real --ui
# 单独重新运行联网及其界面验收：
pnpm audit:submission --web --web-ui
```

`test:e2e` 实际走 HTTP/SSE、Pi 模型和 E2B，执行10个任务。`test:ui` 使用已安装 Edge/Chrome 的 headless 模式；其他安装路径可设 `BROWSER_BIN`。`audit:submission` 默认运行类型检查、自动化测试、Pi 协议烟测，并评估已保存的真实回答；加 `--real` 或 `--ui` 才重新创建外部模型/沙箱测试。

`test:ui:layout` 使用真实浏览器配合 ReplayPi/MemorySandbox，检查会话切换、工具面板、上传重试、停止、文件预览下载及响应式布局，不调用模型、不执行生成代码。2026-10-22 界面改版后，82项确定性测试、此交互回归、真实排序/下载 UI 和真实联网来源 UI 均已通过。运行服务与准备 SQLite 原生依赖必须使用同一 Node 主版本；本机当前 Node 22 对应 ABI 127，另一个 Node 24 环境对应 ABI 137，混用会导致 MCP 加载失败，应在选定 Node 环境运行 `pnpm setup:web`。

当前证据统一在 `docs/evidence/current/`；`legacy/` 属于旧实现，`history/` 保存本轮修复前失败，不能混入当前通过率。

- [设计架构](docs/architecture/design.md)
- [阶段取舍与后续计划](docs/architecture/roadmap.md)
- [正式测试报告及 AI 使用说明](docs/testing/test-report.md)
- [测试用例清单](docs/testing/test-cases.md)
- [提交物清单](docs/delivery/checklist.md)
- [当前审计记录](docs/evidence/current/audit-run.json)
- [真实任务 Trace](docs/evidence/current/real-e2e.json)
- [浏览器截图](docs/evidence/current/webui.png)

## 分发与限制

分发须包含隐藏目录 `.pi` 内的 `bin/pi.exe`、`extensions/e2b.mjs`、`agent/models.json`、`agent/mcp.json`、`web/config.json` 和 `README.md`，以及源码、前端、测试、脚本、文档、fixture、package.json、pnpm-lock.yaml、pnpm-workspace.yaml、tsconfig.json、.env.example。排除 `.env`、`.pi/agent/auth.json`、`.pi/runtime/`、`.pi/qa-browser/`、`.pi/web/data/`、`.pi/web/research/`、`.pi/web/plugins/` 和 `node_modules/`。接收者填自己的凭证并按启动步骤安装即可使用；Windows Pi 约111MB，其他平台需换对应二进制。

会话、事件和 Artifact 在内存中，重启失效；沙箱生命周期30分钟，尚未自动续期。默认仅监听本机，sessionId 归属检查不能代替公网身份认证。当前81项确定性测试通过，新增联网真实3/3和真实来源卡片UI检查通过；此前10项Coding任务证据保留，未重复计数。搜索可能无结果、被限流或返回不相关页面，模型须据实说明。示例一、动态页面渲染、真实来源冲突专项、数据库/R2和新机器冷启动未验收。泛化任务的 file 校验仅证明可读/哈希一致；具体语义必须结合模型生成的程序、执行日志及金标评估。

