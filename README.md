# DSH Connect Loomy

## 0.5.1 - Composer credit balance
- Shows the **selected eligible account** Loomy points beside the DSH model selector, never a misleading sum across different accounts.
- The badge is provider-scoped (modelSelection) and respects the existing composer/dock location and polling settings.
- Clicking the badge opens per-account masked balance details; refresh is explicitly requested using the existing read-only balance-refresh route.
- Preserves the original host tool permission flow. The current DSH installation is not modified by this release.
- Added offline composer tests, plus the surviving integration tests after a minimal end-of-file syntax repair; full desktop UI visual acceptance remains pending.

DSH Desktop provider adapter for Loomy (local 0.5.1 source snapshot).

## Features
- Account pool, model listing, local sign-in integration and read-only credit information.
- Native OpenAI-compatible tool requests and SSE tool_calls support.
- Recover complete structured tool-call JSON without displaying it as ordinary prose.
- Correctly link assistant `tool_calls` and tool replies through `tool_call_id`.
- DSH host remains the only authority for tool execution and approvals.

## Tests
Run `npm test` for all included offline tests.
A pre-existing local integration test was truncated; the local source was preserved separately, and only its closing syntax was minimally repaired. Its surviving assertions are included and tested; any lost original tail was not reconstructed.

## Security
See [SECURITY.md](SECURITY.md). Local backups, captured diagnostics and all session data are excluded.

## Note
Tool-enabled turns buffer responses until validation is complete; native production approval requires a separate DSH host test.

---

## 中文说明

**DSH Connect Loomy** 是讯飞 Loomy 接入 DeepSeek Harness Desktop 的社区插件（v0.5.1）。提供流式聊天、模型目录、多账号池、只读额度、图像及可选本地回环网关；非官方项目。

### 核心功能

- 将 DSH 宿主本轮开放的 `ToolSchema` 转换为 Loomy 上游的 OpenAI-compatible `tools`。
- 解析 SSE `tool_calls`，恢复模型误输出的完整 `{"type":"tool-call",…}` JSON，并拒绝不在宿主工具清单中的调用。
- 使用 `assistant.tool_calls`、`role:tool`、`tool_call_id` 关联工具请求与结果；工具审批、执行或拒绝均由 DSH 宿主完成。
- 工具回合缓冲避免账号切换时泄漏半截调用或混合输出。

### 使用与测试

```bash
# 在 GitHub 仓库页面点击 Code → HTTPS 获取并复制克隆地址
git clone REPOSITORY_HTTPS_URL
cd dsh-connect-loomy
npm test
```

净化发布版 **95/95 离线测试通过**。本地旧 `tests/integration.test.mjs` 曾意外截断，故**未纳入发布**，不能视为完整生产验收。需要兼容的 DSH Desktop 和合法的 Loomy 会话；入口为 `src/index.mjs`，设置前端 `client.js`。

### 安全限制

插件不会执行本机命令或绕过 DSH 授权。真实上游访问、宿主审批、工具执行与多账号行为尚需目标环境测试。公开仓库不包含真实手机号、Session、Cookie、密钥、日志和本机数据，只使用虚构测试样例；参见 [SECURITY.md](SECURITY.md)。

**许可：** 代码使用仓库附带的 [MIT License](LICENSE)。
