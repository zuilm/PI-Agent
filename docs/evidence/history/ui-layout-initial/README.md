# 初次界面回归截图

`markdown-heading-assertion.png` 来自 2026-10-22 第一次交互回归。当时页面将 Markdown `##` 安全映射为 `h3`，测试错误地查找 `h2`，因此断言失败。已修正测试选择器，并完整重新运行通过，当前结果见 `../../current/ui-layout/result.json`。此截图不代表当前界面回归失败。
