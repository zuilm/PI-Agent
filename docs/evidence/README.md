# 执行证据说明

- current/：当前原生Pi架构的自动化、真实模型/HTTP/E2B、浏览器证据，正式结论只使用这里的数据。
- history/before-pi-prompt-fix/：本轮修复前10任务批次9/10、浏览器分隔符误判及截图。文件名是当时测试名，历史错误保留供复核。
- legacy/：旧固定脚本实现的47测试、模拟回答及泛化0/4。仅解释历史缺陷，不能证明当前模型执行。
- history/web-initial/：联网初轮样本，sources.md只记日期，保留模型正文完整性陈述局限。
- history/web-before-rejection-check/：修正私网策略断言前的样本；localhost实际为连接失败，不能当作策略隔离证据。
- history/web-before-access-time/：来源时间仍混淆cached_at与本次访问，修复前样本保留；其中审计曾发现测试脚本的类型收窄错误，当前已修复。

current主要文件：

| 文件 | 内容 |
|---|---|
| audit-run.json | 实际命令、执行模式、时间、退出码、TAP计数；外部证据有各自时间戳 |
| automated-tests.stdout/stderr.txt | 当前81条确定性测试的原始输出 |
| real-e2e.json | 10项真实任务的prompt/answer、工具参数、Pi原生Trace、校验及产物 |
| sse-events.json | 真实HTTP SSE流收到的事件；不是根据结果重建 |
| response-quality.json | 实际模型样本的规则评分，9/10，保留R01失败 |
| artifacts/ | 实际下载的文本/JSON/PNG/修复代码 |
| ui-smoke.json、webui.png | 真实Edge界面的执行结果和截图 |
| browser-downloads/ | 浏览器点击下载后实际保存的文件，按运行UUID分目录 |
| pi-model-probe.json及stdout/stderr | 目录整理后的真实Pi→模型→bash→E2B烟测 |
| pi-rpc-smoke.json | 只做get_state，不代表模型任务已验证 |
| startup-smoke.json | 整理后实际启动src/server.ts进程，首页及health均HTTP200 |
| distribution-check.json | 37项必需文件存在；源码/文档/证据配置凭据扫描无命中，不代表渗透测试 |
| web/mcp-check.json | 真实wigolo stdio发现、搜索、正文、内网拒绝；独立诊断，不经过模型 |
| web/real-e2e.json、sse-events.json | 新增联网3项真实模型/Pi原生MCP/E2B/HTTP/SSE，不混入此前10项统计 |
| web/sources.md、source_count.json | W01和W02实际下载文件；来源时间使用Pi结果钩子生成的app_accessed_at并核对本轮范围，卡片另记工具返回时间 |
| web/ui-smoke.json、webui.png | 真实Edge与模型Fetch，来源卡片、链接、缓存/时间和执行器 |
| ui-layout/result.json、desktop-empty.png、desktop-replay.png、mobile-*.png | 2026-10-22 三栏界面交互回归；真实浏览器 + ReplayPi/MemorySandbox，不代表模型或远程代码执行 |

图表和所有输出均为实际执行产物；哈希在对应Trace/元信息中。服务内存中的下载链接在该次测试退出后失效，可阅读已保存文件，或重跑测试建立新会话。生成时间戳使用UTC。

