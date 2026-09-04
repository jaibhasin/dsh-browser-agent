```text
Chrome extension
  - Observes tabs, pages, DOM, and screenshots
  - Executes scrolling, clicking, typing, navigation, and other actions
  - Requests explicit user approval for dangerous actions
             │
             │ WebSocket
             ▼
TypeScript backend
  - Maintains browser sessions and multi-tab state
  - Coordinates observations, actions, approvals, and events
  - Uses @deepseek-ai/dsh-sdk-client
             │
             │ stdio JSON-RPC
             ▼
DeepSeek Harness process
  - Acts as the agent brain
  - Reasons about goals and browser state
  - Chooses tools/actions
  - Potentially coordinates sub-agents
             │
             ▼
LLM, agents, and tools
```
