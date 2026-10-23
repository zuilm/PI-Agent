# 系统测试用例清单

执行日期：2026-10-22。本文按逻辑场景列出46条用例，不等同于Node测试运行器的81个子测试。PASS 41、FAIL 0、BLOCKED 0、NOT_EXECUTED 5；执行覆盖41/46=89.13%，已执行功能场景通过41/41。回答质量另有1个失败，详见正式报告，不计入功能成功率。新增联网证据与此前10项任务分开记录。

证据缩写：T=[自动化原始TAP](../evidence/current/automated-tests.stdout.txt)；R=[真实任务及Pi Trace](../evidence/current/real-e2e.json)；B=[真实浏览器](../evidence/current/ui-smoke.json)。源码定位用测试名称检索，无需依赖本机绝对路径。

## 确定性用例（协议回放/内存文件，不调用模型）

| ID/目的 | 输入或前提 | 预期 | 实际结果 | 状态/证据 |
|---|---|---|---|---|
| A01 正常分隔符 | 3, 1 换行 -2 +2 2 | 正确解析正负数、空格、逗号、重复值 | 与固定数组一致 | PASS；T，core.test |
| A02 非法整数 | 1 nope；超安全整数 | 不静默忽略、不损失精度 | 均抛明确错误 | PASS；T，core/storage-validation |
| A03 空文件 | 空字符串/零字节 | 提示没有整数 | 校验拒绝 | PASS；T，core/storage-validation |
| A04 越权路径 | 宿主路径、../、反斜杠、/workspace-other | 拒绝访问 | 网关/路径函数拒绝；普通 result..txt 允许 | PASS；T，core/tool-gateway/storage-validation |
| A05 字节保存 | Uint8Array上传后修改原数组 | 内存文件独立保存原字节 | 原文件内容不变 | PASS；T，storage-validation |
| A06 排序校验 | 重复值、乱序、数量/多重集合改变、缺失文件 | 保留重复，错误输出不得通过 | 摘要正确；错误均被发现 | PASS；T，core/storage-validation |
| A07 筛选校验 | 已知7倍数、错序/遗漏、无符合项 | 完整降序金标一致，空结果可合法 | 固定样本逐项正确 | PASS；T，core/storage-validation |
| A08 禁止默认排序 | CSV/绘图/未知任务 | 原请求送Pi，不自动执行sort | prompt原文保留，无伪造工具事件 | PASS；T，agent |
| A09 无附件与元数据 | 不上传文件；已有文件/产物追问 | 可提交；附件仅作为上下文元数据 | Pi收到原任务及路径 | PASS；T，agent/api |
| A10 流式与来源 | 回放text_delta/message_end及MCP事件 | 保留权威全文、messageId及执行来源 | pi-model和Pi/MCP/E2B标签正确 | PASS；T，agent/api |
| A11 正确终态 | agent_end后暂不发agent_settled | 继续running，settled后完成 | 未提前完成 | PASS；T，agent |
| A12 工具错误恢复 | 回放tool start/update/end(isError) | 事件有调用ID/错误，允许Pi继续 | 完整转发，不伪造脚本答案 | PASS；T，agent |
| A13 模型错误 | 最终provider error；错误后成功重试 | 最终错误失败，已恢复则成功 | 分别failed/idle | PASS；T，agent |
| A14 进程/RPC异常 | 启动失败、prompt拒绝、process_error | 明确失败并收敛状态 | 均有run_failed | PASS；T，agent |
| A15 取消/超时 | 不结束的协议回放；AbortController | 请求Pi abort，失败/取消终态 | 断言通过；没有真实长命令 | PASS；T，agent/api |
| A16 输入API边界 | 空/非字符串Prompt、>10MiB文件、运行中提交/上传 | 400/413/409，不污染状态 | 返回值与状态符合预期 | PASS；T，api |
| A17 会话隔离 | 两会话上传同名不同内容 | 内容不串用 | 各自保持正确bytes | PASS；T，api |
| A18 内部桥鉴权 | 缺token、错token、跨会话token、无活跃任务 | 403/409；状态不暴露token | 全部符合 | PASS；T，api |
| A19 桥参数约束 | 非法base64、不支持操作、超范围timeout、任意合法命令 | 非法请求拒绝，合法命令原样交给sandbox接口 | 转发与错误符合断言；命令执行为记录替身 | PASS；T，tool-gateway |
| A20 产物验证约束 | 文件缺失、inputPath缺失、非output路径、错误排序 | 不发成功产物 | 全部拒绝；参数错误先于文件IO | PASS；T，tool-gateway |
| A21 防校验绕过 | 错误结果语义校验失败后改选file | 相同bytes不得绕过 | 继续拒绝，修复bytes后允许 | PASS；T，tool-gateway |
| A22 下载/元信息 | 重复发布、跨session下载、文本预览 | 去重、403、inline和原bytes、正确SHA256 | 结果符合 | PASS；T，api/storage-validation/tool-gateway |
| A23 完成前交付 | Pi写文件但不publish；交付回调抛错 | 发现文件后才settled；失败明确显示 | 文件卡片事件先于完成，失败不报成功 | PASS；T，agent/api |
| A24 SSE回放 | 实际socket，Last-Event-ID设倒数第二个 | 只回放新id | HTTP事件流及id断言通过；Pi为回放 | PASS；T，api |
| A25 关闭资源 | 创建会话后app.close | 停止Pi，清理sandbox/会话 | 替身生命周期及session清空断言通过 | PASS；T，api |
| A26 联网适配边界 | 迁移工作区、继承凭据、模拟真实MCP结果/坏JSON/HTTP错误/恶意URL、Pi fetch事件回放 | 配置留项目内、不把失败/摘要变来源卡片 | 新增9项子测试通过，不调用外网或模型 | PASS；T，web.test |

## 真实任务（HTTP/SSE + qwen-plus + pi.exe + E2B）

全部使用统一应用入口；测试脚本只提供提示、输入与金标，不给Agent注入排序/统计等任务程序。R01/R02为同一会话，R03至R10为另一连续会话。

| ID/目的 | 输入或前提 | 预期 | 实际结果 | 状态/证据 |
|---|---|---|---|---|
| R01 示例二 | 上传10000乱序整数，要求排序/统计/验证/下载 | 输出1..10000，数量/多重集合不变；有前后10项 | 金标逐项一致；独立number-sort通过；模型初次误读格式后自修复。中间行数陈述错误另记质量缺陷 | PASS；R/R01，artifacts/sorted_numbers_asc.txt |
| R02 多轮追问 | 在R01同会话筛7倍数降序 | 9996..7，共1428项，完整准确 | 金标逐项一致；复用数据与上下文 | PASS；R/R02，artifacts/multiples_of_7_desc.txt |
| R03 无附件程序 | 计算1..100整数和JSON | sum=5050 | 下载JSON精确一致 | PASS；R/R03，artifacts/series_sum.json |
| R04 统计 | 3 1 2 2；总和/平均值 | sum=8、mean=2 | JSON精确一致 | PASS；R/R04，artifacts/statistics.json |
| R05 去重降序 | 复用R04输入 | 3、2、1 | 内容精确一致 | PASS；R/R05，artifacts/unique_desc.txt |
| R06 偶数 | 原始小文件，保留重复 | 2、2 | 内容精确一致 | PASS；R/R06，artifacts/even_numbers.txt |
| R07 非7倍数任务 | 筛3倍数 | 3 | 内容精确一致 | PASS；R/R07，artifacts/multiples_of_3.txt |
| R08 CSV汇总 | category,amount；A10/B5/A20 | A=30、B=5 | JSON精确一致 | PASS；R/R08，artifacts/category_totals.json |
| R09 PNG产物 | 基于R08绘制柱状图 | 可读PNG、HTTP image/png、正尺寸 | 签名/MIME/尺寸通过，保存实际图片；图像语义没有自动视觉金标 | PASS；R/R09，artifacts/category_chart.png |
| R10 Coding修改 | add(a,b)误写a-b；要求原生edit修改 | 原文件变a+b，断言通过，返回代码和JSON | 原生edit事件、沙箱原文件与输出代码正确，result=5 | PASS；R/R10，artifacts/fixed_add.py、add_result.json |

## 真实界面与未执行范围

| ID/目的 | 输入或前提 | 预期 | 实际结果 | 状态/证据 |
|---|---|---|---|---|
| UI01 浏览器链路 | Edge headless，真实模型/E2B；先算6*7，再选择fixture排序 | 自动上传、42、工具轨迹/路径、正确下载、预览、无JS异常 | 9项检查通过，浏览器实际落盘下载与HTTP内容一致；截图已保存 | PASS；B、webui.png |
| W01 联网完整链路 | 真实搜索Fastify官方入门文档、fetch正文、E2B写来源文件 | 原生MCP调用、实际正文、来源可下载且时间属于本轮 | search/fetch、官方正文、app_accessed_at、来源文件及时间范围通过；不把缓存时间当访问时间 | PASS；current/web/real-e2e.json W01 |
| W02 联网后追问 | 同会话读取sources.md，用Python按URL主机去重 | source_count=1，E2B实际执行 | JSON金标一致，无需重传上下文 | PASS；current/web/real-e2e.json W02 |
| W03 失败反馈 | 真实fetch 192.168.0.1，禁止换源绕过 | private IPv4策略拒绝，模型明确说明，不产生来源卡片 | 核对实际错误内容而非仅isError；不把连接失败当策略拒绝 | PASS；current/web/real-e2e.json W03 |
| WUI01 来源界面 | Edge浏览器提交真实模型fetch | 精确URL、安全链接、访问时间/缓存、工具与模型来源、无JS异常 | 全部通过并保存截图 | PASS；current/web/ui-smoke.json、webui.png |
| U01 多来源联网分析 | 题目示例一与追问、真实冲突/验证码/动态页面 | 多机构年份对齐及分析、来源冲突处理 | 基础搜索/正文另由W01覆盖；本专项未执行 | NOT_EXECUTED |
| U02 模型安全对抗 | 上传恶意指令、要求读取宿主机/泄漏密钥 | 不越权、不把数据当系统指令 | 只验证网关路径/凭据隔离，未做真实模型攻击 | NOT_EXECUTED |
| U03 实际取消/超时 | E2B长命令，取消后同会话继续 | 长命令被杀、不串事件、状态可恢复 | 只有协议层/故障注入证据 | NOT_EXECUTED |
| U04 新机器分发 | 全新Windows目录/账号，独立安装启动 | 不依赖原题路径或全局Pi配置 | 文件清单核对完成，未做干净机器冷启动 | NOT_EXECUTED |
| U05 稳定性统计 | 各任务重复至少3次，更多格式/错误文件/并发与弱网 | 报告重复成功率、尾延迟及失败模式 | 本轮每真实任务一次，不推断统计可靠性 | NOT_EXECUTED |

## 单独的模型质量结果

功能PASS不等于回答所有陈述正确。quality.ts 对10个实际样本运行六项基础规则及可适用的行数证据一致性规则：R01为6/7 FAIL，R02至R10为6/6 PASS，总计9/10。R01的wc -l实际为1，模型中间回复称10000行；后续更正格式并完成正确文件，仍保留该回答质量失败。

