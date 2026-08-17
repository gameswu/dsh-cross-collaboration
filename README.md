# dsh-cross-collaboration

让多台运行 [DSH](https://github.com/deepseek-ai/dsh)（DeepSeek Harness）的设备互相发现、互相**发消息唤醒对方的主 Agent**。

- **发现**：同一局域网零配置自动互发现；跨网段按 `ip:port` 手动添加（Minecraft 联机式）；添加的节点会通过组网自动同步给其他设备
- **通信**：唯一的跨设备操作就是发消息。**粒度是会话**——在 DSH 里一个会话就是一个主 Agent，不存在 workspace 级 Agent；消息可以精确投递给对端设备上的指定会话（不指定则投给其默认主 Agent），不存在任何远端执行
- **版本兼容检查**：设备间通过发现/握手交换插件版本与协议号，版本不兼容的对端会在节点列表与 `lan_peers` 中以 ⚠ 标出
- **私密**：中继流量端到端加密；面板只显示通信消息，不显示任何工作状态

> 典型用法：Windows 开发机给 Mac 验证机的某个会话发一句「请在 macOS 上验证构建」，该会话的 Agent 被唤醒后用本机工具完成验证，再回一条消息通报结果。

## 安装

```bash
cd dsh-cross-collaboration
pnpm install
pnpm run build

dsh plugin --profile web add "file:$(pwd)"   # 一步安装进 profile
dsh web                                       # 重启生效
```

卸载：`dsh plugin --profile web remove dsh-cross-collaboration`

## 把设备连起来

1. 两台设备都安装并重启 DSH。同一局域网会自动互发现
2. 跨网段（如 Tailscale）：打开 设置 →「LAN 协作」→「添加节点」，填入对方地址 `ip:port`（如 `192.168.1.100:45232`，省略端口用默认值）
3. 连接成功后节点信息自动同步——组网内其他设备会获知并自动连接新节点，全组收敛为全互联
4. 给设备起个名、选个工作区标签，方便对方识别

## 发消息

**模型工具**

| 工具 | 说明 |
|---|---|
| `lan_peers` | 查看组网内有哪些设备，以及每台设备**当前有哪些会话**（会话 ID + 标题，一个会话即一个主 Agent） |
| `lan_message(peer, content, session?)` | 发消息；`peer` 支持设备名、设备 ID 或 `ip:port`；`session` 可选，填 `lan_peers` 里看到的会话 ID 即可精确投递给那个会话，省略则投给设备的默认主 Agent。**对端离线时自动排队，上线后补投** |

消息进入目标 Agent 的收件箱并唤醒它开始新对话。空消息会被拒绝，超过 4000 字自动截断。对端离线时消息进入离线队列（最多 50 条，持久化保存），对端上线后自动按序补投；发给已关闭会话的排队消息会被丢弃。

**界面**：设置页「LAN 协作」的节点列表会显示每台设备的会话数，发消息卡可下拉选择目标会话，通信消息记录标注会话标题，另有「离线队列」卡片可查看/移除排队消息；装有 dsh-plugin-vscode-sidebar 时侧边栏有同名标签页；装有 dsh-notifacation-frame 时收到消息会推送通知。

## 网络场景速查

| 场景 | 做法 |
|---|---|
| 同一局域网 | 无需配置，自动发现 |
| 跨网段 / Tailscale | 「添加节点」填对方的 `ip:port`（tailnet 地址 + 45232）；防火墙放行 UDP 45231 与 TCP 45232 |
| 跨网络 | 自建中继 `node scripts/relay.cjs [port]`（需 Node ≥ 22），配置 `relayUrl`，两端在「中继配对」填入相同口令（≥ 8 位）完成 E2E 配对 |

## 配置

组合行 `config`（都有默认值，一般无需改动）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `udpPort` | `45231` | LAN 发现端口（UDP），通信走 `udpPort + 1` |
| `deviceName` | 随机 | 展示给对端的设备名 |
| `beaconMs` | `3000` | 发现心跳间隔（毫秒） |
| `relayUrl` | `""` | 中继地址（如 `ws://host:8799`），留空禁用中继 |

设备名、工作区标签、节点列表、配对关系都在设置页维护，热生效并持久化。

覆盖 `relayUrl` 示例（profile 的 `cordis.patch.yml`）：

```yaml
- id: dsh-cross-collaboration
  config:
    relayUrl: "ws://relay.example.com:8799"
```

## 安全

- **只通信，不操作**：对端唯一能做的事是把消息投进本机主 Agent 的收件箱，因此不需要授权/白名单体系
- **端到端加密**：中继传输只接受已配对设备的 AES-256-GCM 信封，中继服务器只能看到密文
- **同源栅栏**：客户端 API（`/dshcc/api/*`）只接受本机或可信来源请求

## 开发

要求 Node ≥ 22（中继传输）、pnpm。

```bash
pnpm install && pnpm run build     # 编译 src/*.ts → dist/*.js
pnpm run typecheck                 # 仅类型检查
node scripts/gateway-smoke.cjs     # LAN 冒烟：组网同步 + 消息往返
node scripts/relay-smoke.cjs       # 中继冒烟：配对与 E2E 加密往返
```

结构：`src/host.ts`（DSH 集成与消息投递）、`src/gateway.ts`（网络子进程：UDP 发现 + TCP JSON-RPC + WebSocket 中继）、`src/client.ts`（设置页与侧边栏 UI）。

## 路线图

- [x] 离线消息队列（对端离线时暂存、上线后补投）
- [ ] MQTT 传输适配器
