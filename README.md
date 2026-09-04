```text
Chrome Extension
  - Side panel chat UI
  - DOM and accessibility snapshots
  - Viewport and offscreen page state
             │
             │ Authenticated WebSocket
             ▼
DSH Browser Plugin
  - Runs inside the local DSH Web host
  - Creates DSH agent sessions for extension chat
  - Registers the browser_snapshot tool
  - Bridges chat and tool calls to the Chrome extension
  - Groups extension sessions by workspace
             │
             ▼
DeepSeek Harness Web
  - Agent brain and tool orchestration
  - LLM integration
  - Sessions, approvals, skills, and subagents
             │
             ▼
LLM / Agents / Tools
```

DSH documentation: https://deepseek-harness.github.io/deepseek-harness/en/
