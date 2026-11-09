# 创作工作台 V1（本地）

> 入口：`http://127.0.0.1:<启动端口>/workbench`。旧快捷生图入口 `/`、历史、模型参数、参考图与原图下载保持原样。

> 当前 UI（2026-11-09）：`/workbench` 为可返回的项目首页；`/workbench?project=<id>` 直达项目。采用雾灰白档案室、完整本地插画与作品优先布局。UI 阶段记录见第 10 节；运行配置与模拟模式移除见第 11 节；用户授权的单张重试现状见第 12 节；主题资源信息见 [本地主题说明](../public/local-theme/README.md)。

## 1. 启动

```bash
# Windows：双击 start-local.cmd，或：
node scripts/start-local.mjs
```

脚本会：

1. 选择端口（优先 3000）并启动 Next.js；
2. 生成/读取 `.workbench-data/worker-token`；
3. 同时启动 `scripts/workbench-worker.mjs`，由它轮询 `/api/workbench/internal/tick` 执行任务；
4. 关闭窗口（Ctrl+C）时同时停止 Web 与 worker。

worker 与页面完全解耦：关闭或刷新页面不会重新发送已完成的请求。所有状态保存在 `.workbench-data/workbench.sqlite`，素材原图保存在 `.workbench-data/assets/`。备份时停止服务后整体复制 `.workbench-data/`（含 `-wal`/`-shm`）；恢复时放回同一路径。

普通启动器只启动真实运行配置，没有运行模式选择或自动切换接口。规划、搜索、分析、审稿和生图仍需确认；旧 `--mock` / `WORKBENCH_MOCK=1` 开关会明确拒绝启动，防止旧配置意外转为真实请求。历史 `.workbench-data/mock/` 数据保留，不迁移到真实库。

## 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WORKBENCH_DATA_DIR` | `.workbench-data` | SQLite、素材、worker token 目录；默认路径不变 |
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
| `WORKBENCH_TEST_ALLOW_LOOPBACK` | 未设置 | 仅隔离自动化测试使用；允许下载本地测试服务器，不能用于生产 |
| `WORKBENCH_TEST_STRICT_AUTHORIZATION` | 未设置 | 仅内部测试使用；测试同样强制风险确认与预算校验 |

规划模型与思考强度可以在顶栏“设置 → 规划设置”中切换，选择保存在浏览器本地；服务端只接受 `WORKBENCH_PLANNER_MODELS` 白名单内的模型。思考强度通过 Responses API 的 `reasoning.effort` 发送，`gpt-6.1-sol` 支持 `low / medium（默认）/ high / xhigh / max`，不支持 `none`；如果切换到不支持 reasoning 的模型，上游可能拒绝该参数。规划模型与强度会记录在每次设计修订中。

模型名必须与账号实际权限一致；工作台不会静默替换模型。启动日志与“设置”的运行详情会显示当前实际配置。`gpt-6.1-sol` 的官方能力说明见 <https://developers.openai.com/api/docs/models/gpt-6.1-sol>。

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

开发使用真实 API 配置；自动化验收使用内部隔离夹具。收费调用前请确认：

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
npm run test:acceptance          # 旧入口回归（隔离夹具、空 Key）
npm run test:workbench           # 工作台全流程与故障注入（隔离夹具、空 Key）
node --experimental-strip-types scripts/workbench-fetcher-test.mts  # 下载安全单元测试
```

`test:workbench` 使用隔离目录 `test-artifacts/workbench-acceptance/`，不会读写 `.workbench-data/`，并强制所有服务以空 `OPENAI_API_KEY` 启动。它会检查：页面加载无付费调用、设计卡锁定/过期、参考排序、快照不可变、去重、两张批次、部分失败、审稿失败、未知结果、停止晚到结果、预算、费用未知、worker 重启、来源/下载安全检查、密钥不出现在前端与日志、原图哈希与尺寸一致，以及真实运行下历史测试数据隔离与页面截图。

## 8. 已知限制

- SQLite 使用 Node 内置 `node:sqlite`（Node 22.5+，实验特性）；当前 Node 22.23.4 可用，升级 Node 时需回归。
- worker 设计为单实例轮询；不要对同一数据目录启动多个 worker。
- 审稿/规划的文本模型价格未配置，费用显示为未知；工作台不会把它当作 0。
- 真实联网搜图的字段与模型能力依赖账号与官方接口；若账号不支持图片结果，会明确报错并保留手动上传路线。
- 工作台只保存原图与分析文本；候选缩略图直接来自来源站，分析预览在调用时临时生成，不写入素材库。导入时以原图字节为准并重新校验宽高。
- 停止操作能可靠阻止后续步骤，但已发出的在途请求无法跨进程可靠取消，可能继续完成并计费；晚到结果会保存。
- 内部两图自动化测试通过给 PNG 注入不同测试文本块来构造独立结果，像素内容相同，不代表真实模型差异。
- 前端未使用 `next/image`，本地原图直接由本地 API 提供（lint 仅警告）。

## 9. 参考项目与许可证

仅参考交互与数据组织，未复制代码：

- Image Studio（`koppkvn/image-gen-open-source`，MIT，提交 `2d098831c34a5039d2f34cdc5208a5da8c076699`）：参考图分析、preserve/changes、任务记录组织；未引入 Codex CLI 登录路径。
- Loomic（`fancyboi999/Loomic`，MIT，提交 `21206c30054572291b9df000d84568aeca97aeda`）：资产 ID、围绕选中图片的上下文与多图引用；未引入视频、积分、订阅、Supabase 或无限画布。
- LibreChat（`LibreChat-AI/LibreChat`，MIT，提交 `f4154b649efa37e1345ccc517a4d8d1ed2178c82`）：搜索/生图工具组织与多轮编辑上下文；未迁移聊天框架，也未降低原图下载分辨率。
- image-gen-loop（`SteinsFu/image-gen-loop`，MIT，提交 `edbc09df4fce2493ca0839a72c8cfd499beae4d5`）：审稿结果结构与保留各次输出；未照搬 Stable Diffusion 后端或分数驱动自动循环。


## 10. UI 重构验收记录（2026-11-09，历史阶段）

> 以下为上一轮 UI 交付当时的记录；后续运行配置和请求调查已由第 11 节更新，不作为当前模式说明。

当前分支为 `main`，基于 `e2b3b32` 的本地未提交修改。仓库 remote 已核对为 `yingzhu77/gpt-image-playground-local-materials`，接手时工作区干净。本轮未提交、推送或部署公网；API、数据库、worker、预算算法、提示词编译、素材绑定服务与任务状态机源码均未修改。

### 查看与启动

- 当前实际入口：<http://127.0.0.1:3000/workbench>。按用户后续明确授权，现有启动器已切到真实模式，Key 已配置；不在文档或前端导出 Key。
- 真实验收项目：<http://127.0.0.1:3000/workbench?project=085d61ad-af49-4700-a384-c721b91c3289>。这是实际创建、实际规划并发起生成的验收项目，不是假作品。
- 服务未运行时，在项目根目录执行 `node scripts/start-local.mjs`，使用启动器打印的实际端口。完整模型、思考强度、审稿/分析/搜索模型与 Worker 心跳位于“设置”。旧入口 `/` 保持原来的深色主题与历史/原图功能。
- 本地主题 JPEG 与 WebP 不随 Git 分发；完整尺寸、字节数、SHA-256、作者来源和授权边界集中记录在 [public/local-theme/README.md](../public/local-theme/README.md)。本次原始 JPEG 为 1920×1080、505319 字节；WebP 为同尺寸派生文件、373788 字节。没有将主题图加入素材库或请求快照。

### 已实现的行为

首页为 280px 文字区与完整 16:9 插画，复用真实项目列表与新建流程。项目内只有左侧一幅可收起的主题小图；显示偏好保存在浏览器，专注模式隐藏资料、审稿与主题。1366/1440 下默认两栏，1920 下默认三栏，1200 以下切换资料/作品/审稿视图。主图、放大与并排对比均完整 contain；舞台深灰、浅灰、棋盘格只改变预览底色。

设计卡按创作问题分组；参考组用缩略列表、排序、用途和借用说明组织；搜图保留来源、授权未核验与加载/导入错误。作品/提示词和资料标签使用保持挂载的编辑器，未保存、提示词过期、失败、结果未知、预算暂停都可见。导航与生成先检查草稿，只有明确放弃才重置本地编辑器。旧读取响应通过请求代次失效，不能覆盖刚保存的内容。生成确认明确已保存版本和保存时间；参数变化后等待最新估价，不展示旧参数费用。提交错误在弹窗内直接显示。

重复上传已保存的生成原图会由现有服务按哈希复用资产；前端现在保留这些资产的选择入口，避免“上传成功但素材不可见”。绑定动作和规则未改变，也不会自动加入参考或分析图片。

### 修改文件清单

| 范围 | 文件 |
| --- | --- |
| 首页、导航、布局、草稿守卫 | `src/components/workbench/workbench-app.tsx` |
| 主题作用域、插画、语义 token 与响应式 | `src/components/workbench/theme-boundary.tsx`、`theme-artwork.tsx`、`workbench.css`；`src/app/globals.css` 仅导入局部样式 |
| 面板与状态 | `src/components/workbench/shared.tsx`、`design-panel.tsx`、`reference-panel.tsx`、`search-panel.tsx`、`prompt-panel.tsx`、`stage-panel.tsx`、`review-panel.tsx`、`dialogs.tsx` |
| Portal 显式主题传递 | `src/components/ui/theme-scope.tsx`、`dialog.tsx`、`select.tsx`、`tooltip.tsx`（未指定作用域的旧页面行为不变） |
| 本地素材隔离与来源 | `.gitignore`、`public/local-theme/README.md`；第三方二进制未加入 Git |
| 并行环境隔离及验收证据 | `next.config.ts` 的可选 `NEXT_DIST_DIR`；`scripts/acceptance.mjs`、`scripts/workbench-acceptance.mjs` 正确扫描当前构建目录，并保留引擎实际产生的未知/预算状态 JSON |
| 当前状态说明 | 本文档；`src/app/layout.tsx` 已核对，未修改全局默认深色行为 |

没有新增依赖或状态管理框架。临时构建目录 `.next-ui-*`、测试脚本生成物和截图均为 Git 忽略的本地文件。

### 验证与截图

执行输出集中保存在 `test-artifacts/ui-refactor/`：

| 命令 | 实际结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | [typecheck.log](../test-artifacts/ui-refactor/typecheck.log) |
| `npm run lint` | 0 错误、14 条警告（原生 img 与模式重启导航建议） | [lint.log](../test-artifacts/ui-refactor/lint.log) |
| `npm run build` | 通过 | [build.log](../test-artifacts/ui-refactor/build.log) |
| `npm run test:acceptance` | 163 通过、0 失败 | [acceptance.log](../test-artifacts/ui-refactor/acceptance.log) |
| `npm run test:workbench` | 155 通过、0 失败 | [workbench.log](../test-artifacts/ui-refactor/workbench.log) |

两套既有脚本仍显式使用空 Key、隔离 Mock 数据目录，保留原业务/授权断言。通过 `NEXT_DIST_DIR=.next-ui-tests` 与运行中的真实服务隔离；生产构建使用 `.next-ui-build`。浏览器主流程使用真实环境；异常、多参考和长内容场景使用单独浏览器 context 中的验收响应夹具，所有业务 API 被本地接管或中止，没有透传真实付费请求。

实际浏览器检查包括：三个桌面视口、375/390 窄屏、首页无项目/有项目、无结果编辑、有参考、真实单图、隔离 Mock 两版本对比、放大、三种舞台底色、生成确认、草稿/过期、运行中/失败/未知/预算/停止、主题图失败、102 字项目名、8835 字提示词、8 张参考及候选缩略图失败。以上均未出现页面横向滚动。1440 下作品区宽 1086px，审稿默认关闭；专注后为 1392px。减少动态设置将非必要过渡降至 0.00001 秒。

实际页面抽检 106 个可见文字节点，无对比度不达标项，最小 4.90:1；另按实际 token 计算主按钮白字 5.74:1，四种状态文字与底色为 5.96–6.39:1。键盘焦点为可见 2px 轮廓，标签支持左右箭头及 Home/End。

浏览器机器记录见 `test-artifacts/ui-refactor/browser-evidence.json`。隔离注入提交失败后，错误显示在生成弹窗内，弹窗保持打开，实际业务请求未透传。

关键交互证据：设计、主提示词、避免项、验收项及参考说明在切标签/设置/轮询后保留；生成与离开会先要求保存或放弃；设计/提示词/参考保存后与服务端回读一致，脏标记解除。人为延迟一个旧项目 GET、保存新设计再放行旧响应，确认旧响应被拒收。原图实际下载为 4159348 字节，SHA-256 与服务端资产一致；没有用主题滤镜改变作品颜色。

| 实际页面 | 截图 |
| --- | --- |
| 首页桌面 | [1366×768](../test-artifacts/ui-refactor/home-1366.png)、[1440×900](../test-artifacts/ui-refactor/home-1440.png)、[1920×1080](../test-artifacts/ui-refactor/home-1920.png) |
| 真实项目与完整作品 | [1366](../test-artifacts/ui-refactor/project-1366.png)、[1440](../test-artifacts/ui-refactor/project-1440.png)、[1920](../test-artifacts/ui-refactor/project-1920.png) |
| 确认、草稿、参考/过期 | [生成确认](../test-artifacts/ui-refactor/generate-confirm.png)、[弹窗提交失败](../test-artifacts/ui-refactor/dialog-submit-error.png)、[草稿保留](../test-artifacts/ui-refactor/drafts-retained.png)、[参考与过期](../test-artifacts/ui-refactor/reference-stale.png) |
| 审稿与专注 | [审稿侧面板](../test-artifacts/ui-refactor/review-drawer.png)、[专注](../test-artifacts/ui-refactor/focus.png) |
| 窄屏 | [真实作品](../test-artifacts/ui-refactor/narrow-artwork.png)、[真实参考](../test-artifacts/ui-refactor/narrow-reference.png)、[375px 隔离验收](../test-artifacts/ui-refactor/edge-narrow-375-artwork.png) |
| 空首页与资源失败（隔离 Mock） | [空首页](../test-artifacts/ui-refactor/edge-empty-home-1366.png)、[主题失败](../test-artifacts/ui-refactor/edge-theme-load-fallback.png) |
| 故障与对比（隔离 Mock） | [未知](../test-artifacts/ui-refactor/isolated-unknown.png)、[预算](../test-artifacts/ui-refactor/isolated-budget.png)、[两图对比](../test-artifacts/ui-refactor/isolated-budget-compare.png)、[失败/停止历史](../test-artifacts/ui-refactor/edge-failed-stopped-history.png) |
| 长内容（隔离 Mock） | [长提示词](../test-artifacts/ui-refactor/edge-long-prompt-1440.png)、[8 张参考](../test-artifacts/ui-refactor/edge-eight-references-1440.png)、[候选预览失败](../test-artifacts/ui-refactor/edge-search-thumbnail-failure.png) |
| 其他 | [减少动态](../test-artifacts/ui-refactor/edge-reduced-motion-artwork.png)、[200% 等效布局](../test-artifacts/ui-refactor/edge-zoom-200-equivalent-artwork.png)、[旧入口深色主题](../test-artifacts/ui-refactor/legacy-entry.png) |

隔离 Mock 的不同版本来自实际验收引擎，fixture 像素相同，不能据此判断真实模型图片差异或审稿准确率。本地浏览器检查脚本为 `test-artifacts/ui-refactor/edge-browser-check.js` 与 `fault-browser-check.js`；它们使用 Playwright 工具的 `filename` 入口运行，本地夹具与图片在同目录 `fixtures/`。

### 未解决项与实际费用边界

1. 真实验收已执行一次规划，并提交一个两张图的批次：第一张保存成功，第二张为 `UPSTREAM_UNKNOWN / Connection error`，当前批次保留 `paused_unknown`，后续审稿未执行。没有重发、自动放弃核实或自动继续。已保存图片与未知状态均保留在真实验收项目；错误发生在图像请求阶段，根因未确定，本轮未据此改写后端。上游是否产生第二张图及实际计费仍需核实，应用估算不是账单。
2. 200% 已通过 720×450 CSS viewport、DPR 2 的等效布局/位图尺度检查，操作可达、无横滚。工具的键盘快捷键未改变原生缩放，浏览器内部设置页在隔离 context 中不可用；随后桌面电脑工具因无法可靠确定当前浏览器 URL 而自动停止。原生浏览器 200% 缩放未取得证据，不能把等效检查写成原生检查通过。
3. 真实搜图、参考分析、审稿与修订/再抽未额外发起；这些业务与授权边界由既有隔离验收覆盖。真实审稿界面本轮只核对排队/无结论，实际有结论的视觉布局使用隔离 Mock 数据核对。候选导入失败的服务行为由既有验收覆盖，浏览器另核对了预览加载失败及原来源保留。
4. 第三方主题图的公开再分发或商业使用许可未获确认；本轮仅接入本地静态资源，未推送或部署。


## 11. 连接异常调查与运行模式移除（2026-11-09）

> 本节为调查结束时的记录。用户随后已授权一次重试，原错误处理与最新任务结果见第 12 节。

现行启动器只启动真实 API 配置；前端不再显示 Mock 或模式切换入口。旧 `/api/workbench/mode`、`/api/workbench/mock-candidate/*` 与后台模式 watcher 已移除，旧 `--mock` / `WORKBENCH_MOCK=1` 明确拒绝启动，不会静默转成真实请求。当前入口仍为 <http://127.0.0.1:3000/workbench>，Key 和生成开关已配置。已重启本项目 Web 与 worker，使旧启动器退出；未提交、推送或部署。

### 第二张请求的核实结果

本轮没有发起、重发、放弃核实或继续任何真实规划/搜索/分析/审稿/生图任务。真实批次 `3b0d479b-1c27-4c3d-b8d7-0e9adc86c64d` 的参数为 `gpt-image-2.6-sunburst / 2048×1152 / high / 2 张独立请求`，原快照无参考图。

以下时间为北京时间（Asia/Shanghai）：

| 请求 | 开始 | 结束 | 本地结果 |
| --- | --- | --- | --- |
| 第一张 | 11:29:26.827 | 11:30:18.737 | 51.910 秒，成功，原图、usage 和上游请求 ID 已保存 |
| 第二张 | 11:30:18.761 | 11:30:57.292 | 38.531 秒，`UPSTREAM_UNKNOWN / Connection error.`；本地未留存上游请求 ID、HTTP 状态、usage 或响应正文 |

程序在调用 SDK 后遇到缺乏明确 HTTP 状态的连接异常，会保守标记“结果未知”并暂停，避免重新提交导致重复收费。这里能确认的是连接异常及分类原因，不能确定更底层的断连根因，也不能证明上游未收到、未生成或未计费。38.531 秒不能被解释为 SDK 的 600 秒默认超时。

已查真实 SQLite 任务/子项记录、Next 开发日志、启动器/worker 日志配置和 FlClash 持久记录。旧 runner 仅保存异常消息，没有保存 `cause` 链；启动器/worker 当时只有继承终端输出，代理也没有相应时段的持久连接日志，因此无法从现有本地记录还原具体 TCP/TLS/代理错误。当前 Node 22.23.4 支持环境代理，配置为本机 7890 端口，不能根据旧启动器的版本警告认定代理不受支持。详细脱敏记录与完整请求关联 ID 见 [findings.json](../test-artifacts/unknown-investigation/findings.json)。上游实际执行与计费仍需以供应商记录核实。

任务仍为 `paused_unknown`，第一张保留，第二张为 `unknown`，审稿未执行。重启前后对目标 run 和全部 item 的 ID、状态、错误码及开始/结束/更新时间逐字段比较，完全一致；没有活动中的真实任务被中断。

### 后续诊断记录

`src/lib/server/image-request-diagnostics.ts` 已接入真实 generate/edit 客户端。以后每次调用在数据目录下追加 `image-request-events.jsonl`，记录开始、成功或错误、local/run/item 关联 ID、参数摘要、耗时、上游 ID、HTTP 状态和最多五层白名单错误指纹。SDK 仍为 `maxRetries: 0`，原结果和原异常对象原样返回/抛出，日志失败不会改变调用结果，也不会重试。

日志不记录 Key、Authorization、提示词、请求体/响应体或原始错误消息。此记录从接入后生效，不能补出第二张旧请求缺失的 cause 或账单信息；没有伪造旧请求日志。

### 模式移除与数据保留

- 工作台和旧入口均删除运行模式标记与切换；规划、生成、修订和再抽的费用/风险确认始终保留，不再有模式分支绕过确认。
- 历史 `.workbench-data/mock/`、历史测试项目/资产及浏览器记录原样保留，不转成真实项目。普通列表与费用统计排除测试来源，服务端拒绝将历史测试项目/参考/快照用于真实请求；清空可见历史也保护隐藏测试记录及其关联字节。
- 只有自动化验收 runner 可使用内部测试提供方：必须非生产、显式空 Key、严格授权，并指定 `test-artifacts` 子目录。普通启动器清空所有内部测试开关，无法从前端开启。旧图像模拟环境变量同样被拒绝，不会回退为真实请求。
- 前端不再读取 `status.mock/mode/autoRestartAvailable`；状态 API 已删除这些字段。保留数据库 `mock` 等来源字段仅为识别旧测试数据和阻止误收费，不进行有损 schema 迁移。

本轮主要源码落点：`scripts/start-local.mjs`、`workbench-worker.mjs`、`src/lib/workbench/{config,service,planner,vision,search,runner,estimate,http,client,types}.ts`、受限的 `test-fixtures.ts`、图像客户端/诊断模块、旧入口与历史组件、工作台展示与确认组件；删除旧模式模块与路由。没有修改 SDK 参数、unknown 自动重发规则、真实预算算法或已保存图片字节。

### 本轮验证

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 错误、13 条原生图片警告 |
| `npm run build` | 通过 |
| `npm run test:acceptance` | 163 通过、0 失败 |
| `npm run test:workbench` | 156 通过、0 失败；包含普通运行配置下隐藏/拒绝历史夹具项目、无请求、记录不变 |
| `node --experimental-strip-types scripts/workbench-runtime-test.mts` | 14 项运行守卫通过；覆盖旧开关拒绝、空 Key/目录/生产限制 |
| `node --experimental-strip-types scripts/image-request-diagnostics-test.mts` | 通过；覆盖原结果/异常对象、单次调用、错误链、秘密排除和日志故障隔离 |

日志集中在 `test-artifacts/unknown-investigation/`。新增历史隔离检查首次因 Windows 对构建缓存文件的 `EPERM rename` 返回环境 500；改为独立构建目录后完整重跑通过，拒绝收费的断言未放宽。测试使用空 Key 和隔离数据，不继承真实配置。

真实浏览器已确认：无 Mock 文案/切换，旧接口 404，确认弹窗仍有必需的风险复选框，原“结果未知”警示仍在。截图：[工作台](../test-artifacts/unknown-investigation/workbench-real-only.png)、[设置](../test-artifacts/unknown-investigation/settings-real-only.png)。原图和原任务未改动；这轮没有额外收费请求。模式移除完成不代表第二张请求的上游执行或收费已核实。


## 12. 用户授权的单张重试（2026-11-09，现行状态）

用户明确要求清除错误记录并重试一次。本次仅补第二张，未重新生成第一张，未追加第二轮重试。

- 原异常归档到 `.workbench-data/archived-errors/72ec6fd0-e4fe-485d-81e4-0be6c8e24ff9.json`。通过原 `run.stop` 停止旧批次，避免“放弃未知并继续”恢复原待审稿调用；随后精确清空旧 run/item 的错误码与错误文本。旧请求的 `unknown` 审计状态、原快照和第一张资产仍保留，未伪造已知的计费结果。
- 现有再抽原本固定沿用两张数量。已在 `createRerollRun` 与动作 API 增加可选单张数量，默认行为不变；估价、快照、任务条目和调用授权上限一起限制为一张。非法数量、字符串、null 和超过源批次数量均拒绝。
- 唯一新批次：`686395cb-242a-4e73-8029-8a8570bbd2ab`；稳定 action ID 记录于 `test-artifacts/retry-one/plan.json`，避免重复提交。原 prompt、avoid、参考与其余参数原样复用：`gpt-image-2.6-sunburst / 2048×1152 / high / 无参考图`，未发送当前修改后的设计卡或新增参考。
- 北京时间 **13:40:59.010–13:41:43.648**：图像请求成功，已记录 HTTP 200 与上游请求 ID。仅一个图像任务，未重试；随后一次审稿于 **13:41:59.207** 完成，批次为 `completed`。
- 新版本 **B**：`00517006-aac5-4857-8e39-b1dadc58ac71`，2048×1152，3956977 字节。原图文件 SHA-256 与资产记录一致，第一张 A 的原图哈希也保持一致。
- 审稿已完成但结论为“建议修订”：左右建筑被画框裁切、绿植多于少量点缀要求。没有因此再触发生成或修订。

[打开真实项目，在版本条选择 B](http://127.0.0.1:3000/workbench?project=085d61ad-af49-4700-a384-c721b91c3289)。原图位于 `.workbench-data/assets/e5663087e7a44103407cbdb32ed946b154782d9aa5d8d0813dd4dbbc0a60c06b.png`；脱敏操作计划和保存回读证据位于 `test-artifacts/retry-one/`。新的请求/返回诊断位于 `.workbench-data/image-request-events.jsonl`。本次成功不能倒推出先前未知请求未计费或原断连根因已经解决。

单张再抽的完整隔离验收为 **169 通过、0 失败**，并通过 Typecheck、定向 ESLint 和脚本语法检查，日志为 `test-artifacts/unknown-investigation/single-reroll-acceptance.log`。代码发布不包含本地图片、凭据、运行数据库、请求日志或测试产物；当前源码版本以 Git 提交记录为准，未部署公网。
