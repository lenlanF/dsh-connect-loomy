# DSH Connect Loomy

DSH Desktop provider adapter for Loomy (local 0.5.0 source snapshot).

## Features
- Account pool, model listing, local sign-in integration and read-only credit information.
- Native OpenAI-compatible tool requests and SSE tool_calls support.
- Recover complete structured tool-call JSON without displaying it as ordinary prose.
- Correctly link assistant `tool_calls` and tool replies through `tool_call_id`.
- DSH host remains the only authority for tool execution and approvals.

## Tests
Run `npm test` for all included offline tests.
A pre-existing local integration test was excluded from this snapshot because its local copy was incomplete. Do not claim that excluded test was validated.

## Security
See [SECURITY.md](SECURITY.md). Local backups, captured diagnostics and all session data are excluded.

## Note
Tool-enabled turns buffer responses until validation is complete; native production approval requires a separate DSH host test.
