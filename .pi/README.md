# 项目内 Pi 运行目录

本项目直接运行 bin/pi.exe 的 RPC 模式，Pi 是实际 Agent 运行时。

- agent/models.json：模型 provider、baseUrl、模型 ID；apiKey 使用 $DASHSCOPE_API_KEY 环境引用。
- agent/mcp.json：Pi 原生 MCP 配置，已接入工作区 wigolo，仅直接暴露 search/fetch。更改后重建会话生效。
- web/config.json：wigolo core 搜索后端、超时、关闭本地LLM和重排模型；无需搜索API密钥。
- web/data/：联网缓存/SQLite、浏览器、模型和临时文件，运行时生成，不分发。
- extensions/e2b.mjs：复用 Pi 的 createReadTool/createWriteTool/createEditTool/createBashTool，通过 operations 适配 E2B；另加 publish_artifact 交付工具。
- runtime/<sessionId>：Pi 会话 cwd，运行时生成，不分发。
- qa-browser/：浏览器测试临时 profile，不分发。
- bin/pi.exe：随附 Windows x64 Pi 1.4.0。

Fastify 将 PI_CODING_AGENT_DIR 明确设为本目录下的 agent；凭证放工作区 .env。项目不依赖用户主目录下的 Pi 配置。

启动时关闭自动发现扩展和原生宿主机文件/Shell工具，再显式加载 e2b.mjs、builtin:codemode、builtin:tool-search、builtin:mcp。codemode 使用 Pi 自带运行机制调用已注册工具；数据处理代码经 bash 在 E2B 中运行。MCP stdio 进程本身的权限由其部署环境决定。

MCP command 的 cwd=../../.. 从固定会话目录 runtime/<sessionId> 回到工作区，node入口为 scripts/mcp/wigolo.ts。入口自动定位工作区并设置缓存和配置路径，再直接启动上游MCP服务；不依赖用户主目录。不要从任意cwd照搬配置直接启动Pi。安装后执行 pnpm setup:web，动态页面可另选 pnpm setup:web --browser。

分发时保留二进制、配置和扩展，排除 auth.json、runtime/、qa-browser/、web/data/、web/research/、web/plugins/，不得把实际凭证打入包内。

