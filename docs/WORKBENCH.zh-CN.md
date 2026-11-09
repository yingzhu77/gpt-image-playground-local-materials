# 创作工作台 V1（本地）

> 入口：`http://127.0.0.1:<启动端口>/workbench`。旧快捷生图入口 `/`、历史、模型参数、参考图与原图下载保持原样。

## 1. 启动

```bash
# Windows：双击 start-local.cmd，或：
node scripts/start-local.mjs
```

脚本会：

1. 选择端口（优先 3000）并启动 Next.js；
2. 生成/读取 `.workbench-data/worker-token`（Mock 模式为 `.workbench-data/mock/worker-token`）；
3. 同时启动 `scripts/workbench-worker.mjs`，由它轮询 `/api/workbench/internal/tick` 执行任务；
4. 关闭窗口（Ctrl+C）时同时停止 Web 与 worker。

worker 与页面完全解耦：关闭或刷新页面不会重新发送已完成的请求。所有状态保存在 `.workbench-data/workbench.sqlite`，素材原图保存在 `.workbench-data/assets/`。备份时停止服务后整体复制 `.workbench-data/`（含 `-wal`/`-shm`）；恢复时放回同一路径。

Mock 演示（不调用真实 API，数据隔离）：

```powershell
$env:WORKBENCH_MOCK='1'; node scripts/start-local.mjs
# 或 cmd: set WORKBENCH_MOCK=1 && node scripts/start-local.mjs
```

脚本会自动生成 `.workbench-data/mock/fixtures/` 的 PNG、场景文件与调用日志，并以空 `OPENAI_API_KEY` 启动本次 Web/worker。规划、搜索、审稿使用固定夹具，生图使用本地 fixture；两张结果会带有不同的 mock 文本块以模拟独立文件。

## 1.1 在界面切换 Mock / 真实模式

工作台右上角的模式徽标（例如“MOCK 模式 · 点击切换真实模式”）打开“切换运行模式”：

- `scripts/start-local.mjs` 正在运行时：确认后，启动器会停止并重启 Web 与 worker，使用目标模式的数据目录与配置；页面会自动等待并跳转。
- 真实模式读取 `.env.local` 中的 Key，规划/搜索/分析/审稿/生图均可能产生真实费用，仍需逐次确认。
- Mock 模式使用 `.workbench-data/mock`、本地 fixture 和空 Key，不调用真实 API。
- 有排队/执行中的任务时禁止切换，避免丢失在途结果；请先等待或停止。
- 如果没有通过 `start-local.mjs` 启动（例如直接 `npm run dev`），界面会显示手动重启命令。
- 自动切换的启动器心跳与请求文件放在 `WORKBENCH_MODE_DIR`（默认 `.workbench-data`）。

## 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WORKBENCH_DATA_DIR` | `.workbench-data` | SQLite、素材、worker token 目录；Mock 模式未显式设置时自动使用 `.workbench-data/mock` |
| `WORKBENCH_MOCK` | `0` | `1` 时规划/分析/审稿/搜图使用本地夹具，生图使用 `IMAGE_API_MOCK_FIXTURE_DIR`；启动时优先使用界面保存的模式切换请求 |
| `WORKBENCH_MODE_DIR` | `.workbench-data` | 一键切换的心跳/请求文件目录 |
| `WORKBENCH_PLANNER_MODEL` | `gpt-6.1-sol` | 设计卡规划默认模型 |
| `WORKBENCH_PLANNER_MODELS` | `gpt-6.1-sol,gpt-6-astra` | 工作台界面可切换的规划模型白名单（逗号分隔） |
| `WORKBENCH_PLANNER_REASONING_EFFORT` | `medium` | 默认思考强度：`low/medium/high/xhigh/max`（gpt-6.1-sol 不支持 `none`） |
| `WORKBENCH_ANALYSIS_MODEL` | `gpt-6.1-sol` | 参考图视觉分析模型 |
| `WORKBENCH_REVIEW_MODEL` | `gpt-6.1-sol` | 审稿/比较模型 |
| `WORKBENCH_SEARCH_MODEL` | `gpt-6.1-sol` | 联网图片搜索模型 |
| `WORKBENCH_IMAGE_MODEL` | `gpt-image-2.6-sunburst` | 工作台默认生图模型，可逐次在确认框中更改 |
| `WORKBENCH_WORKER_TOKEN` | 文件 | worker 调用内部接口的 token；不要写进前端 |
| `WORKBENCH_WORKER_INTERVAL_MS` | `1000` | worker 空闲轮询间隔 |
| `WORKBENCH_STALE_SENDING_MINUTES` | `20` | 发送后长时间无结果转为“未知”的阈值 |
| `WORKBENCH_TEST_ALLOW_LOOPBACK` | 未设置 | 仅 Mock 测试使用；允许下载本地测试服务器，不能用于生产 |
| `WORKBENCH_TEST_STRICT_AUTHORIZATION` | 未设置 | 仅测试使用；在 Mock 下也强制风险确认与预算校验 |

规划模型与思考强度可以在顶栏的“规划 …”按钮中切换，选择保存在浏览器本地；服务端只接受 `WORKBENCH_PLANNER_MODELS` 白名单内的模型。思考强度通过 Responses API 的 `reasoning.effort` 发送，`gpt-6.1-sol` 支持 `low / medium（默认）/ high / xhigh / max`，不支持 `none`；如果切换到不支持 reasoning 的模型，上游可能拒绝该参数。规划模型与强度会记录在每次设计修订中。

模型名必须与账号实际权限一致；工作台不会静默替换模型。启动日志与页面状态栏会显示当前实际配置。`gpt-6.1-sol` 的官方能力说明见 <https://developers.openai.com/api/docs/models/gpt-6.1-sol>。

## 3. 关键流程

1. **设计卡**：关键词或上传素材创建项目；自然语言修改只调整相关字段，锁定字段冲突会列出并等待明确解锁。
2. **参考图**：上传/联网搜索/跨项目复用；每张图绑定用途、借用点、不借用点和顺序。分析结果按文件哈希 + 模型缓存，但生成/审稿始终发送真实图片。
3. **提示词**：从设计卡、锁定项和参考组编译；可手动保存为修订版。设计或参考组变化后标记过期，由用户选择保留手动版或重新编译。
4. **确认**：生成前确认模型、参数、1/2 张、预算、参考顺序与调用范围，保存不可变快照。估价接口不发送模型请求。
5. **生成/审稿**：逐张执行（并发 1），每张成功后立即保存原图与用量，再进入审稿；两张时给出比较与推荐，但不会自动设为基准。
6. **修订/再抽**：修订固定使用选定版本作为编辑基底，只执行一次编辑；同方案再抽复用原快照并创建新动作键，不调用规划器。探索新方向创建独立项目分支。
7. **基准与下载**：可把任意版本设为基准；原图按原始字节下载并显示实际尺寸/哈希；信息记录包含提示词、参考来源、参数、父版本、用量与估算，不含密钥。

## 4. 任务状态与恢复

- 状态：`queued / running / completed / partial / failed / stopped / paused_unknown / paused_budget`。
- 动作去重：客户端动作 ID + 数据库唯一约束；双击、并发同一动作返回同一运行；新动作可合法再抽。
- 停止：不启动后续步骤；在途请求可能无法取消并继续计费，不承诺退款；晚到的成功结果仍保存。
- 结果未知：超时、断连、5xx/429 或进程重启时的已发送请求记为 `unknown`，暂停后续付费步骤，绝不自动重发。用户可“放弃未知并继续”，或自行决定是否重新发起新操作。
- worker 启动时会调用 `/api/workbench/internal/recover`：把上一个 worker 遗留的 `sending` 步骤标记为未知，不重跑已完成步骤。
- 预算：按应用内价格表估算并在每次付费调用前检查；预算/费用未知/调用上限都会阻止继续。估算不是供应商账单。

## 5. 联网搜图

- 使用 OpenAI Responses API 的 `web_search`，请求 `search_content_types: ["image"]`、`image_settings` 与 `include: ["web_search_call.results"]`，从结构化 `image_result` 解析图片地址与来源页；不把模型正文中的 URL 当作搜索证据。
- 一次最多 4 条搜索词，每条最多 6 个结果；无结果时返回真实失败状态，不用无关图片补位。
- 候选卡片分别展示来源域名、可信度说明与授权状态；默认均为“未核验”，不会标成官方或可商用。
- 导入服务端安全检查：仅 http/https、常见端口、公共地址；DNS 与每次重定向都校验，阻止本机/内网/云元数据、危险协议、账号密码 URL；限制下载时长、字节数与解码像素；只接受 PNG/JPEG/WEBP 实际字节。403、HTML 伪图、超大文件、私网重定向均保留失败状态。
- 下载失败时仍可手动上传；不会绕过访问限制或生成假图补位。

## 6. 真实调用的授权边界

默认开发与验收使用 Mock。真实调用前请确认：

- 规划/分析/审稿/搜索的模型名与账号权限；
- 每类调用次数上限与图片张数；
- 图片费用估算（本地价格表）与审稿/搜索费用未知项；
- 预算上限只是应用层停止条件，不是供应商账单硬上限，也不能撤销已发生费用。

应用层与 SDK 均关闭隐式重试（`maxRetries: 0`）。

## 7. 自动化验证

```bash
npm run typecheck
npm run lint
npm run build
npm run test:acceptance          # 旧入口回归（Mock，无真实 Key）
npm run test:workbench           # 工作台全流程与故障注入（Mock）
node --experimental-strip-types scripts/workbench-fetcher-test.mts  # 下载安全单元测试
```

`test:workbench` 使用隔离目录 `test-artifacts/workbench-acceptance/`，不会读写 `.workbench-data/`，并强制所有服务以空 `OPENAI_API_KEY` 启动。它会检查：页面加载无付费调用、设计卡锁定/过期、参考排序、快照不可变、去重、两张批次、部分失败、审稿失败、未知结果、停止晚到结果、预算、费用未知、worker 重启、来源/下载安全检查、密钥不出现在前端与日志、原图哈希与尺寸一致，以及 Mock 模式截图。

## 8. 已知限制

- SQLite 使用 Node 内置 `node:sqlite`（Node 22.5+，实验特性）；当前 Node 22.23.4 可用，升级 Node 时需回归。
- worker 设计为单实例轮询；不要对同一数据目录启动多个 worker。
- 审稿/规划的文本模型价格未配置，费用显示为未知；工作台不会把它当作 0。
- 真实联网搜图的字段与模型能力依赖账号与官方接口；若账号不支持图片结果，会明确报错并保留手动上传路线。
- 工作台只保存原图与分析文本；候选缩略图直接来自来源站，分析预览在调用时临时生成，不写入素材库。导入时以原图字节为准并重新校验宽高。
- 停止操作能可靠阻止后续步骤，但已发出的在途请求无法跨进程可靠取消，可能继续完成并计费；晚到结果会保存。
- `WORKBENCH_MOCK` 的真实两图测试通过给 PNG 注入不同 mock 文本块来模拟独立结果，像素内容相同，不代表真实模型差异。
- 前端未使用 `next/image`，本地原图直接由本地 API 提供（lint 仅警告）。

## 9. 参考项目与许可证

仅参考交互与数据组织，未复制代码：

- Image Studio（`koppkvn/image-gen-open-source`，MIT，提交 `2d098831c34a5039d2f34cdc5208a5da8c076699`）：参考图分析、preserve/changes、任务记录组织；未引入 Codex CLI 登录路径。
- Loomic（`fancyboi999/Loomic`，MIT，提交 `21206c30054572291b9df000d84568aeca97aeda`）：资产 ID、围绕选中图片的上下文与多图引用；未引入视频、积分、订阅、Supabase 或无限画布。
- LibreChat（`LibreChat-AI/LibreChat`，MIT，提交 `f4154b649efa37e1345ccc517a4d8d1ed2178c82`）：搜索/生图工具组织与多轮编辑上下文；未迁移聊天框架，也未降低原图下载分辨率。
- image-gen-loop（`SteinsFu/image-gen-loop`，MIT，提交 `edbc09df4fce2493ca0839a72c8cfd499beae4d5`）：审稿结果结构与保留各次输出；未照搬 Stable Diffusion 后端或分数驱动自动循环。
