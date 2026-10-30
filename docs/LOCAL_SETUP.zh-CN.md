# 本地素材版部署与使用说明（Windows）

本文对应本项目默认分支 `main`（功能分支 `feat/local-materials-v1` 保留）。目标是用于插画、视频封面、MV 背景和透明 PNG 素材：默认低成本、确认后提交、保留 API 原始字节，并为每次请求写本地 JSON 元数据。

## 1. 当前环境与仓库

| 项目 | 值 |
| --- | --- |
| 仓库根目录 | 克隆后的本地仓库目录（迁移后不固定盘符） |
| 上游仓库 | `https://github.com/alasano/gpt-image-playground` |
| 上游 commit | `47f6f95fb7ea0b20a997eba9f51a4f1f82cf6798` |
| 默认分支 | `main` |
| Node.js | `v24.12.0`（项目要求 `>=22`；Node 代理支持需要 `>=24`） |
| npm | `11.6.2` |
| 依赖安装 | `npm ci`（仓库有 `package-lock.json`） |

Mock 验收使用服务端 SDK 边界的本地 fixture client，不会发送真实 OpenAI 请求，也不会回退到真实网络。真实调用只会在你显式启用开关并手动提交时发生。Node 代理配置见 4.3。

## 2. 目录与关键文件

```text
gpt-image-playground/
├─ .env.local                 本地私密配置（已被 git 忽略，不要提交）
├─ .env.local.example         可提交的配置模板（不含真实密钥）
├─ start-local.cmd            Windows 启动入口
├─ scripts/
│  ├─ start-local.mjs         选择端口并启动 Next.js 开发服务器
│  └─ acceptance.mjs          无真实 API 的 mock 验收
├─ docs/LOCAL_SETUP.zh-CN.md  本文件
├─ generated-images/          运行后生成的原图（git 忽略）
│  └─ metadata/               每次请求的 JSON 元数据（git 忽略）
└─ test-artifacts/            mock 验收的 fixture、日志与测试图片（git 忽略）
```

## 3. 安装与首次检查

在仓库根目录执行：

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

`npm run typecheck` 使用仓库自带的 TypeScript 7 预览版；`npm run lint` 检查 `src`；`npm run build` 为生产构建。不要为了消除依赖提示而批量升级依赖。

## 4. 本地配置

### 4.1 `.env.local`

当前本地文件只包含：

```dotenv
OPENAI_API_KEY=
ENABLE_IMAGE_API=false
NEXT_PUBLIC_IMAGE_STORAGE_MODE=fs
```

说明：

- `OPENAI_API_KEY`：只给服务端使用。填写真实 Key 后浏览器和前端 bundle 都不会接触它。不要把它改名为 `NEXT_PUBLIC_*`，也不要写入浏览器存储。
- `ENABLE_IMAGE_API`：本轮新增的服务端总开关，默认 `false`。关闭时页面、参数调整、确认框仍可用，但生成/编辑会在接触 OpenAI SDK 或网络之前返回“生成服务未启用”。
- `NEXT_PUBLIC_IMAGE_STORAGE_MODE=fs`：显式使用文件系统存储原图。
- `APP_PASSWORD`：可选。设置后页面会要求输入访问密码；本轮未启用。
- `OPENAI_API_BASE_URL`：本分支固定官方 OpenAI endpoint，代码会忽略这个变量，不会自动接入中转服务。

`.env.local.example` 是可提交的模板，不含真实密钥。若本地文件丢失，可复制模板后填写。

### 4.2 密钥安全

- 只有 `src/lib/server/image-api.ts` 在服务端读取 `OPENAI_API_KEY`。
- 前端只收到 `auth-status` 的布尔值（是否启用、是否已配置 Key、是否 mock），不会收到 Key。
- 不要用 `NEXT_PUBLIC_` 前缀保存 Key，不要把 Key 写入 `localStorage`、URL、截图或日志。
- `.env.local` 已被 `.gitignore` 忽略；`.env.local.example` 被单独放行。

### 4.3 Node 外网代理（本机已启用）

本机开发环境使用 Windows 系统代理 `127.0.0.1:7890`（Clash，HTTP 代理）作为示例。**迁移电脑时必须按实际代理地址和端口修改，不要照抄。** Node 的 `fetch` 默认不会读取 Windows 系统代理，因此 `.env.local` 中需要额外配置：

```dotenv
NODE_USE_ENV_PROXY=1
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1,::1,192.168.*,10.*,*.local
```

注意：

- `scripts/start-local.mjs` 会在启动 Next.js 子进程**之前**读取这些变量并注入子进程环境；只把变量写在 `.env.local`、却直接执行 `npm run dev`，不能保证它们对 Node 启动时生效。请使用 `start-local.cmd`。
- 不要将代理地址填进 `OPENAI_API_BASE_URL` / `baseURL`；`baseURL` 必须保持官方 API。
- `NO_PROXY` 不能包含 `api.openai.com`，否则该请求会绕过代理。
- 启动日志会打印 `Node 代理: http://127.0.0.1:7890（NODE_USE_ENV_PROXY=1）` 这类信息，只显示 host/port，不显示代理凭据。
- `NODE_USE_ENV_PROXY` 需要 Node 24（本机验证版本 24.12）。若代理地址变化，修改 `.env.local` 后必须重启。
- 保留 TLS 校验；代理只负责建立连接，不替代 OpenAI 官方 endpoint。

## 5. 启动、访问、停止与重启

### 5.1 Windows 启动

双击仓库根目录的 `start-local.cmd`，或在终端执行：

```bash
node scripts/start-local.mjs
```

脚本行为：

- 只监听 `127.0.0.1`。
- 优先使用端口 `3000`。
- 若 `3000` 被占用，会自动向后寻找空闲端口，并打印实际地址；不会结束其他进程。
- 打印 `ENABLE_IMAGE_API` 与存储模式。
- 启动后通常访问：`http://127.0.0.1:3000`。

也可以手动执行等价命令：

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

手动命令不会经过 `start-local.mjs` 的代理注入；若需要 Node 代理，请使用 `start-local.cmd`。

### 5.2 停止与再次启动

- 停止：在运行脚本的窗口按 `Ctrl+C`。
- 再次启动：重新双击 `start-local.cmd`。
- 修改 `.env.local` 后必须重启服务才会生效。

### 5.3 启动后的配置确认

服务是否启用、Key 是否已配置以 `.env.local` 和页面顶部提示为准；启动日志会打印 `ENABLE_IMAGE_API`、存储模式和 Node 代理状态。真实调用前请确认：

- `ENABLE_IMAGE_API=true`
- `OPENAI_API_KEY` 非空
- 页面没有“生成服务未启用”“未配置 Key”或“MOCK 测试模式”提示

首次真实生成的具体步骤见第 10 节。

## 6. 默认参数与操作流程

### 6.1 首次打开默认值

- 模型：`gpt-image-2.5-flare`
- 尺寸：`1024×1024`
- 质量：`low`（低成本）
- 张数：`1`（本轮固定）
- 输出：`PNG`
- 背景：`auto`

模型选择保留上游全部可选项，不会静默换模型。

### 6.2 尺寸预设

生成与编辑界面都提供：

- `1024×1024`
- `1536×864（16:9 草稿）`
- `2048×1152（16:9 2K）`

自定义尺寸继续使用上游约束：宽高为 16 的倍数、单边不超过 3840、长宽比不超过 3:1、总像素 655,360 到 8,294,400。服务端会再次校验尺寸、模型、质量、背景与输出格式组合，不会只依赖前端。

`2048×1152` 是直接按该尺寸请求，不是先生成小图再放大。

### 6.3 生成前确认

点击“生成图片（先确认）”或“编辑图片（先确认）”后，不会立即请求 API，而是打开“生成前确认”对话框，显示：

- 完整提示词
- 模式（生成/编辑）
- 模型
- 实际提交的尺寸
- 质量
- 张数
- 背景
- 输出格式
- 审核档位
- 编辑模式下的参考图数量、文件名顺序，以及是否带遮罩

只有点击“确认并提交”才发送请求；点击“取消”或关闭对话框不会发请求。确认框、实际请求和浏览器历史使用同一份参数快照，避免确认后修改表单导致提交内容不一致。

提示词不会被自动改写，也不会额外调用文本模型“优化提示词”。

### 6.4 张数与流式预览

- 本轮固定 `n=1`。服务端会拒绝 `n>1`，不会静默改写参数。
- 流式预览已关闭，前端不再提供开关；服务端会拒绝 `stream=true`。

## 7. 透明 PNG

选择 `Transparent` 背景时：

- 界面会自动把输出格式切换为 `PNG`。
- `JPEG` 和 `WebP` 选项会被禁用并给出中文提示。
- 请求会真实携带 `background=transparent` 和 `output_format=png`。
- 服务端拒绝“透明背景 + JPEG”等组合。

预览区使用棋盘格只是为了看清透明区域；棋盘格不会写入图片文件。保存和“下载原图”都直接使用 API 返回的原始字节，不经过 Canvas 截图、缩放或重新编码。

## 8. 原图、JSON 元数据与浏览历史

### 8.1 原图

默认保存到：

```text
generated-images/
```

文件名格式：

```text
<毫秒时间戳>-<序号>.<png|jpeg|webp>
```

图片字节按 API 返回的 base64 直接解码写入，不做二次编码。

### 8.2 JSON 元数据

每次成功请求旁会写入：

```text
generated-images/metadata/<本地 request id>.json
```

主要字段包括：

- `schema_version`
- `local_request_id`（本地生成）
- `created_at`（ISO 时间）
- `mode`、完整 `prompt`、`model`、`size`、`quality`、`n`、`background`、`output_format`、`output_compression`、`moderation`
- `reference_image_count`、`reference_images`（文件名、顺序、MIME、字节数）
- `has_mask`、`mask_filename`、`mask_size_bytes`
- `output_filename`、`outputs`
- `actual_width`、`actual_height`（从收到的图片字节解析）
- `size_matches_request`（实际尺寸与请求尺寸是否一致）
- `usage`（完整原始 usage；缺失时为 `null`）
- `usage_missing`
- `estimated_cost_usd`、`cost_note`（基于 usage 的估算；缺失时未知，不写 0）
- `openai_request_id`（能从 SDK 响应头取得时保存；取不到为 `null`，不会用本地 ID 冒充）
- `local_duration_ms`、`storage_mode`、`is_mock`、`warnings`

如果实际像素尺寸与请求尺寸不一致，原图仍会保留，JSON 中记录差异，界面会显示警告，不会自动缩放或重新生成。若原图已保存但 JSON 写入失败，响应会报告归档失败，并保留原图，不会自动重新生图补救。

### 8.3 浏览器历史

浏览器历史仍存放在当前浏览器的 `localStorage` 的 `openaiImageHistory` 键中。新增字段包括 `size`、`n`、`usage`、`requestId`、`openaiRequestId`、`metadataFile`、`isMock`，并兼容旧记录：

- 旧记录没有尺寸时显示“未记录（旧记录）”。
- 旧记录没有 usage 时显示“未知（usage 缺失）”，不会显示成 0 或免费。
- 费用显示为“根据 usage 估算”，不是 OpenAI 账单或账户余额。
- MOCK 记录的图片和信息会明确标记为测试数据，并且不计入历史费用合计。

注意：浏览器历史与磁盘 JSON 元数据目前没有完整同步。清空浏览器历史不会删除磁盘上的原图或 JSON；删除单条历史会删除对应原图，但已写入的 JSON 元数据会保留。JSON 元数据也没有提供页面内的恢复/索引界面。跨浏览器恢复、参考图全量归档和历史库重构留待下一阶段。

## 9. 错误、重试与并发

- 图像 SDK client 显式配置 `maxRetries: 0`；前端和服务端都不会自动重试、失败换模型或超时自动重发。
- 生成和编辑共用 busy 状态；前端有同步 in-flight 锁，快速双击“确认并提交”只会发送一次。
- 单机服务端有轻量单请求并发保护，忙碌时返回“已有生成或编辑请求正在处理”。这只覆盖当前 Node.js 进程，不是跨进程、跨重启的“恰好一次”保证。
- 错误会区分：
  - `ENABLE_IMAGE_API=false`：生成服务未启用
  - `OPENAI_API_KEY` 缺失：配置错误
  - 401：鉴权失败
  - 403：权限不足或组织未验证
  - 429：限流
  - 超时：504
  - 上游 5xx：502
- 错误信息不会把失败自动解释为“未消费”或“免费”。请求一旦发往上游，是否计费以 OpenAI 账单为准。
- 服务端日志只保留本地请求 ID、上游 request ID（若有）、模式、模型、尺寸、质量、格式、耗时等诊断字段；不记录 Key、Authorization、完整请求体、完整提示词或图片数据。

## 10. 首次真实生成（下一轮由你操作）

本轮结束时 `ENABLE_IMAGE_API=false`，没有发送真实请求。你确认要开始真实调用后：

1. 打开 `.env.local`。
2. 填写真实 Key（等号后直接写值，不要加引号）：
   ```dotenv
   OPENAI_API_KEY=你的真实Key
   ```
3. 把开关改为：
   ```dotenv
   ENABLE_IMAGE_API=true
   ```
4. 保存文件，按 `Ctrl+C` 停止当前服务，再双击 `start-local.cmd` 重启。
5. 页面打开后，先做一次低成本测试：
   - 模型保持 `gpt-image-2.5-flare`
   - 尺寸保持 `1024×1024`
   - 质量保持 `low`
   - 张数固定 `1`
   - 输出 `PNG`
   - 背景先选 `auto`
6. 输入一个简单提示词，点击“生成图片（先确认）”。
7. 在确认框核对完整提示词、模型、尺寸、质量、张数、背景、格式，然后点击“确认并提交”。
8. 生成成功后检查：
   - 页面历史中的尺寸、张数、Tokens、费用估算、MOCK 标记（真实请求应无 MOCK）
   - `generated-images/` 中的原图
   - `generated-images/metadata/` 中对应 JSON 的 `usage`、`openai_request_id`、`actual_width/height`
9. 真实请求会产生费用；本地费用估算不是账单或余额。

如果首次调用返回 403，通常是 OpenAI 组织未完成验证或没有该模型权限；返回 401 检查 Key；返回 429 稍后手动重试。

## 11. 无真实 API 的 mock 验收

已提供可重复脚本：

```bash
npm run test:acceptance
```

脚本会：

- 在 `test-artifacts/` 下生成本地 PNG fixture（含透明 PNG、2048×1152）。
- 依次启动隔离的开发服务器（mock、禁用开关、无 Key）并自动停止。
- 通过真实 HTTP 路由验证：参数、原图字节、透明 PNG、实际尺寸、元数据、usage 缺失、错误分类、并发保护、开关拦截。
- 不会调用真实 OpenAI endpoint；mock 模式只读取本地 fixture，fixture 读取失败时直接报错，不会回退网络。
- 产物留在 `test-artifacts/`，已被 git 忽略。mock 数据带有 `MOCK` 标记，与真实图片目录隔离（测试时使用 `test-artifacts/mock-images`）。

浏览器检查已覆盖：默认值、确认框取消不发请求、透明背景联动 PNG、双击确认只提交一次、编辑确认框参考图顺序/遮罩状态、历史字段显示、禁用开关横幅与错误提示。

## 12. 已知限制

- 单次请求固定 1 张；不做批处理队列。
- 流式预览关闭。
- 服务端并发保护只覆盖单进程；没有分布式锁或持久任务队列。
- 浏览器历史与磁盘 JSON 元数据未实现完整恢复同步；参考图字节没有归档，只记录文件名/数量/大小。
- 删除单条历史会删除对应原图，但已写入的 JSON 元数据不会自动删除；清空浏览器历史不会删除磁盘文件。
- 自定义 `OPENAI_API_BASE_URL` 在本分支不生效，固定官方 endpoint。
- 费用为本地估算，usage 缺失时显示未知；没有硬预算系统，也不读取账户余额。
- 没有 Docker、云部署、数据库或全面重构。

## 13. 常见问题

**页面能打开，但点击确认后提示“生成服务未启用”**
：`.env.local` 中 `ENABLE_IMAGE_API` 仍为 `false`，或修改后未重启。

**提示未配置 OPENAI_API_KEY**
：开关已为 `true`，但 Key 为空或服务未重启。

**端口 3000 被占用**
：直接使用 `start-local.cmd`，它会自动选择下一个空闲端口并打印 URL；不会结束占用端口的进程。

**真实生图报“上游请求失败：Request timed out.” / 约 10 秒结束**
：这通常不是 SDK 的 600 秒超时，而是 Node 的底层连接超时（undici 默认约 10 秒）。如果 Node 未使用可用代理，直连 `api.openai.com` 可能因 DNS/网络不可用而失败。检查启动日志中的 `Node 代理` 行，确认 `.env.local` 的代理变量存在且 `NO_PROXY` 没有排除 `api.openai.com`；修改后必须通过 `start-local.cmd` 重启。服务端日志会记录 `phase`、耗时、error/cause 链和有效的 SDK timeout/maxRetries。

**服务端返回 504 `UPSTREAM_TIMEOUT`**
：查看日志 cause 链。`UND_ERR_CONNECT_TIMEOUT` 表示 Node 未建立连接（优先检查代理/DNS/网络）；`UND_ERR_HEADERS_TIMEOUT` 表示传输层等待响应头超时，可能涉及代理或 undici 的 headersTimeout 与 SDK timeout 不匹配。本地不会自动重试。

**构建时提示字体下载失败**
：构建使用 `next/font/google`，需要能访问 Google Fonts 的网络环境；应用运行时不依赖它。

**图片显示 404**
：确认图片文件在 `generated-images/`（或当前 `IMAGE_OUTPUT_DIR` 指向的目录），且文件名没有子路径。元数据位于 `metadata/` 子目录，不会通过图片 URL 暴露。
