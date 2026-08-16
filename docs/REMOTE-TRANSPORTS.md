# Cross-Collaboration 多传输架构设计（超越 LAN）

> 目标：把 dsh-cross-collaboration 从「内网直连」泛化为**多传输、跨网络、跨生态**的设备间 Agent 协作层。
> 现状回顾：本插件已简化为**纯消息模型**——wire 协议（`hello` / `msg.post`）本质是**传输无关的 JSON-RPC**；网关子进程已经是一个「网络能力宿主」——扩展路径就是把网关升级为**多适配器传输层**，上层（身份摘要、消息投递、工具、UI）完全不动。若未来要重新引入任务模型，A2A/ACP 的映射关系见下表。

## 1. 生态调研：现有分布式 Agent 实现

### 1.1 开放互操作协议（跨生态）

| 协议 | 模型 | 与我们的映射 | 证据/来源 |
|---|---|---|---|
| **ACP**（Zed/IBM，agentcommunicationprotocol.dev） | JSON-RPC 2.0 over HTTP+SSE；`initialize`（能力协商）→ `session/new` → `session/prompt`（人机 UI 环）；agent↔agent 走 `session/start` + app intent | 实现 acp 适配器后，本设备可作为 ACP agent 被调用 / 主动调其他 ACP agent；映射到我们的 task 模型 | DSH 的 `dsh-subagent` 类型把 `acp` 列为官方 provider 范例（`spawn`/`fork`/`acp`）；本机 `dsh-mcp-client` 证明官方已在做协议客户端 |
| **Google A2A** | **Agent Card**（`/.well-known/agent.json` 描述技能/端点）+ `tasks/send`/`tasks/get`/`tasks/cancel`，HTTP/JSON（SSE 流式、webhook 推送） | 若未来重新引入任务模型则最贴合；在 webServer 上挂 Agent Card + 适配器即可与 Google 生态任何 agent 互操作 | A2A 规范（2025 公开，agent card + task lifecycle） |
| **MCP** | tool/resource/prompt 共享；stdio / HTTP+SSE / streamable-HTTP 传输 | 与 P4 `tool.proxy` 同一方向：本设备以 MCP server 暴露工具；也可把其他 MCP server 当作「工具型 peer」 | DSH 自带 `dsh-mcp-client` 包 |

### 1.2 传输/组网层（跨网络）

| 方案 | 机制 | 适配性 |
|---|---|---|
| **libp2p**（IPFS 技术栈） | multiaddr、mDNS 发现、**relay 中继**、hole punching、noise/TLS 加密 | 重但完整；若未来要 p2p 大规模网格可引入，中期不建议自研 |
| **WebRTC DataChannel** | STUN/TURN 打洞、DTLS 加密 | 适合浏览器端直连；我们的网关是 Node 子进程，node-datachannel 可行但复杂度高 |
| **中心化 Relay Hub（推荐首选）** | 每设备**只出站** WebSocket 连到共享 relay；relay 按 deviceId 转发 JSON 信封；配 E2E 加密 | NAT 友好（无入站端口）、跨网段/跨网络、与现有网关子进程模型无缝；relay 可自托管（仓库附 30 行 Node 实现）或部署在云 |
| **MQTT/NATS 消息总线** | 主题 `dshcc/<deviceId>/in` 投递；QoS1；离线排队（JetStream/保留消息） | 适合防火墙严格、需要**异步离线队列**的场景；公共 broker（如 test.mosquitto.org）零部署起步 |
| **Tailscale/WireGuard** | 网络层 VPN | 零代码路径：装上 Tailscale 后，现有 LAN 适配器直接跑在 tailnet 上即可跨网络——文档化即可 |

### 1.3 编排拓扑（控制面，非传输）

AutoGen（agent chat）、LangGraph、OpenAI Swarm（handoffs）、Claude Agent SDK：这些解决的是**编排关系**（mesh/star/交接），而非设备间传输。对我们的启示：跨设备编排保持「工具 + 子代理 Provider」双形态（已有），未来可加 `lan_*` 风格的**多播/广播**（relay 上的 group topic）支持「一个任务分发给多台验证机」。

## 2. 架构：传输适配器层

```
Host 半体（不变的任务桥/Provider/工具/UI）
        │  send(remoteId, method, params) → Promise<result>
        ▼
Remote 注册表（对等体抽象）
  remote = { remoteId, name, caps, transports: { lan?: addr, relay?: id, mqtt?: topic, a2a?: url } }
  route(remoteId) → 按 偏好序(lan > relay > mqtt) 选适配器，失败降级
        ▼
网关子进程 = 适配器宿主（每个适配器一个模块，可并存）
  ├─ lan       UDP 发现 + TCP RPC          ← 现有，微调为适配器接口
  ├─ relay     WS 客户端 ↔ relay hub       ← 跨网络首选
  ├─ mqtt      主题发布/订阅               ← 离线/防火墙友好
  ├─ a2a-srv   Agent Card + tasks/send     ← 对外暴露（挂在 DSH webServer 路由）
  ├─ a2a-cli   发现卡片 → 视为 remote      ← 调用外部 agent
  ├─ mcp-srv   暴露 delegate 面为 MCP 工具  ← 工具级互操作
  └─ acp       ACP 客户端/服务端           ← 与 ACP 生态互通（DSH 官方预留位）
```

**关键不变式**：所有适配器只实现 `discover/connect/send/onReceive` 四个原语，JSON-RPC 方法集与授权语义（granted 白名单、pendingAuth 流程）保持唯一实现于 Host 层——**换传输不换协议**。

## 3. 安全模型升级（多传输后攻击面扩大）

- 每 remote 仍按能力授权（现有 granted 集合，settings 持久化）。
- **新增传输维度授权**：relay/mqtt 等公共信道默认仅允许「发现」，任务委托需配对。
- **E2E 加密**：配对时交换一次性配对码 → HKDF 派生共享密钥 → NaCl box / AES-GCM 信封；relay/MQTT 只能看到密文与路由头。
- A2A/ACP/MCP 适配器只暴露 delegate 能力，同样过 granted 闸门；入站请求走既有 pendingAuth 弹窗。
- 时间戳 + nonce 防重放（原 P4 规划项，随 relay 一起落地）。

## 4. 分阶段实施建议

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P5-transport** | 网关重构为适配器架构；Host 端 `remotes` 模型（多传输地址 + 路由偏好）；LAN 适配器回归 | LAN 行为不变，全量冒烟通过 |
| **P6-relay** | relay hub（仓库内 30 行实现）+ WS 适配器 + 配对码 + E2E box 加密 | 两台跨网络设备（如公司网↔家庭网）经 relay 完成委派 |
| **P7-mqtt** | MQTT 适配器（复用 P6 的加密与路由） | 经公共 broker 完成异步任务投递 |
| **P8-a2a** | A2A Agent Card + tasks 适配器（webServer 路由，信任栅栏复用） | 第三方 A2A agent 能调用本机；本机可调用外部 A2A agent |
| **P9-mcp** | MCP server 暴露工具面（对应原 P4 tool.proxy） | 其他 MCP 客户端可调用本机工具 |
| **P10-acp** | ACP 适配器（对齐 DSH 官方 acp provider 约定） | 与 ACP 生态互通 |

## 5. 与现有成果的关系

- P1–P4 全部保留：任务桥、`lan:<id>` 子代理 Provider、授权弹窗、设置页、持久插件形态。
- `lan_*` 工具与 Provider 名称不变（保持向后兼容）；新增 `remotes` 概念时，Provider 名演进为 `remote:<remoteId>`，`lan:` 作为别名保留。
- 网关子进程模型不变——适配器只是其内部模块，DSH 侧零架构改动。

## 6. 待你决策

1. **优先级**：建议 P5→P6（relay，最快达成「Windows 开发机 ↔ macOS 验证机跨网络」）→ P8（A2A 生态互通）；MQTT/ACP/MCP 按需插队。
2. **Relay 部署**：自托管（仓库附带实现，你已有 NAS/服务器？）还是公共/云 relay？
3. **加密**：E2E box 加密是否现在就做（P6 一并落地，推荐），还是先用 TLS relay 过渡？
