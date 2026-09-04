```text
Chrome Extension
  - Side panel UI
  - DOM + vision observations
  - Scrolling, browsing, clicks, typing, and navigation
  - Multi-tab awareness
  - Human approval for dangerous actions
             │
             │ Secure WebSocket
             ▼
DSH Browser Plugin
  - Runs inside the local DSH Web host
  - Registers browser tools with the agent
  - Bridges tool calls to the Chrome extension
  - Maintains browser and tab state
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
