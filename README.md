# DSH Connect Loomy

## 0.5.3：上游 SSE 连接中断的有界恢复（2026-11-17）

- 真实 DSH 会话记录中，`todo_write` 返回成功后，后续模型执行阶段出现 `UNKNOWN / terminated`；这不是一次 `TOOL_PROTOCOL` 拒绝。原始日志缺少网络底层 cause，**尚不能证明该次断开必然来自网络**。
- 用本机临时 HTTP/SSE 服务实际模拟中途断开，Node.js 复现 `TypeError: terminated`、`cause.code=UND_ERR_SOCKET`。对**工具模式且尚未完成模型响应、未向 DSH 发出任何 tool-call 的阶段**，这种可识别的连接中断仅自动重试 1 次，同一账号、使用相同宿主工具清单；失败两次后仍按原规则报错或切换后备账号。
- DSH 主动取消、工具参数/权限拒绝、未知非网络异常均不会被此机制重试；不自动执行宿主工具。网络重试会再次请求上游模型，**可能产生额外模型用量/积分**，不保证所有连接异常都能恢复。
- 新增 `tests/network-recovery.test.mjs` 6 项，覆盖真实本机 HTTP 断流恢复、仅一次重试、用户取消、未知错误、杜绝半截模型响应进入 DSH；项目 `npm test` 128/128 通过（退出码 0）。安装运行中的 DSH 插件未改动。
- 对 DSH 宿主 `session_event_search` 的独立只读核查：42/42 份原始 Zstandard JSONL 日志完整；DSH 自带 SQLite 会话搜索使用内存索引，持久化快照最多重试 2 次，持续变更可能导致 `SESSION_QUERY_PERSISTENCE_FAILED`。**未能证实该次错误的底层原因**，不建议删除或重置历史会话；不修改 DSH 本体。
- 后续验收：安装新版后在 Loomy 新会话验证真实长任务连续执行，观察是否仍有 `terminated`；动态工具实际增删与恢复仍需宿主产生真实变化才能验证。

## 0.5.2 - DSH current-turn tool declarations and safe recovery

- Removed unimplemented toolUpdate: addition-only capability. The DSH host supplies complete current-turn ToolSchema declarations instead.
- Each native tool request remains strictly constrained to tool names actually offered in that turn. Invalid/mixed batches are rejected atomically before any DSH tool call.
- When upstream returns an unoffered tool such as todo_write or malformed arguments, Loomy may retry with specific feedback and the true offered-tool inventory (at most three requests, then fail closed).
- Optional todo_write is never a prerequisite: the model can plan in text and use other permitted tools. plugin_market and plugin_manager are mentioned only when the host offered them, and no plugin installation/activation or permission change is automatic.
- Added offline tests for unknown-tool recovery, bounded retries, current-turn inventory changes, mixed batches, provider guidance and sanitized errors. The local release has not been installed in DSH Desktop; full host tool execution still requires a separate live acceptance test.

## 0.5.1 - Composer credit balance
- Shows the **selected eligible account** Loomy points beside the DSH model selector, never a misleading sum across different accounts.
- The badge is provider-scoped (modelSelection) and respects the existing composer/dock location and polling settings.
- Clicking the badge opens per-account masked balance details; refresh is explicitly requested using the existing read-only balance-refresh route.
- Preserves the original host tool permission flow. The current DSH installation is not modified by this release.
- Added offline composer tests, plus the surviving integration tests after a minimal end-of-file syntax repair; full desktop UI visual acceptance remains pending.

DSH Desktop provider adapter for Loomy (local 0.5.3 source snapshot).

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

**DSH Connect Loomy** 是讯飞 Loomy 接入 DeepSeek Harness Desktop 的社区插件（v0.5.2）。提供流式聊天、模型目录、多账号池、只读额度、图像及可选本地回环网关；非官方项目。

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
