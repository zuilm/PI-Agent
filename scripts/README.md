# 脚本目录

所有命令从项目根目录运行；执行脚本时不需要切进子目录。

| 目录 | 用途 | package命令 |
|---|---|---|
| checks/ | 依赖连通性检查 | smoke:pi、smoke:e2b、smoke:model、smoke:web |
| e2e/ | 真模型/Pi/E2B/HTTP与真实浏览器 | test:e2e、test:ui、test:web、test:web:ui |
| e2e/layout.ts | 真实浏览器 + 协议回放的界面交互与响应式回归，不调用模型 | test:ui:layout |
| mcp/ | 直接启动固定版本wigolo的MCP服务，由Pi管理stdio | 应用自动调用 |
| setup/ | 工作区SQLite依赖检查/修复，选装Chromium | setup:web；加--browser预装浏览器 |
| reports/ | 已保存回答质量评分、执行证据汇总 | eval:responses、audit:submission |
| dev/ | 开发时查看/按指定ID销毁沙箱 | 手动使用；测试和应用不依赖它们 |

test:e2e会创建并销毁真实E2B，调用实际模型。test:ui需要Edge/Chrome，可设BROWSER_BIN。audit:submission默认不重跑外部模型，用--real/--ui重新执行；质量失败时返回非零并保留证据。

dev/kill-sandbox.ts只作用于明确提供的sandbox ID，不应对未知ID操作。两个开发脚本从根.env加载凭据，不把密钥写进参数。

smoke:web使用上游MCP SDK做独立诊断，不经过模型；实际应用仍只用Pi原生MCP。test:web运行真实搜索/Fetch、E2B来源文件、同会话追问和拒绝访问三项任务。test:web:ui在真实浏览器提交模型Fetch请求，核对来源卡片和链接。audit:submission --web --web-ui可集中重跑联网验收。联网证据独立保存在docs/evidence/current/web/。setup:web默认不下载浏览器，静态正文可直接使用；--browser需要下载较大的Chromium资源。

