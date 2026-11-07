# Blueprint rc.5 引擎迁移 — 执行状态与验收记录

日期：2026-11-07 · 分支：`r1/rc5` · 仓库：`C:\MyDocs\Program\Explore\blueprint` · 远端：`try`（Huiluck/blueprint-try）

> 本文件记录实施计划的执行结果、验收证据与已知限制，供后续接手者与发布使用。
> 计划本身见 `docs/superpowers/plans/2026-11-06-rc5-engine-migration.md`，设计见 `docs/superpowers/specs/2026-11-06-rc5-engine-migration.md`。

## 1. 结论

迁移已完成：Blueprint 的运行时已从内置 `dsh 0.2.1-alpha.2` + 5 补丁切换到系统官方 **`dsh 0.2.1-rc.5`**，五个补丁全部移植，聊天模型 provider 改为只读系统 DSH 配置，媒体服务保留，Windows 构建与安装包可产出。

主要提交（`git log --oneline` 摘要）：
- `ad44034` / `29d2ac0`：引擎与 peerDependencies 锁定 rc.5、bundle manifest 对齐、版本门禁测试
- `b4de33b` / `fd9875d`：生成器改用 app 依赖解析、按 rc.5 重新生成全部 client bundle + 新鲜度测试
- `b168fd7`：GNU patch 缺失时明确失败、打包管线适配 rc.5
- `604a5d5` / `1ebc13a` / `4a6ced7` / `2180f4c` / `29c7313`：五个 rc.5 补丁（音视频、外部 worker、读恢复、文档预览超时、工具 JSON 修补）
- `5f7e435` / `3dd7148`：系统 DSH provider/凭据导入 + 加固（环境变量放行、warning、路径安全、`!!js`）
- `30e86d5` / `2137340`：Studio 连接 API 只读化 + 旧 payload 媒体删除兼容
- `d345402` / `cc13858`：连接管理 UI 改媒体-only + 生成器跨平台（CRLF 无关）
- `2b06ac2`：删除聊天 provider 引导、模型就绪只看系统目录
- `55588fc` / `1cb0968`：默认模型来自系统目录（新建项目默认规则、空态）
- `f75e75c` / `2fae3d2`：下线 legacy viewer 终端；studio 终端流移植到 rc.5 `attach`/RemoteStream
- `b7a954b`：删除死终端资产管线
- `3cd1f77` / `5ec3863`：外部 provider 资产 fixture、启动级系统 provider 集成测试
- `9bd4f3a` / `514cc0e`：README 对齐 rc.5 与系统 provider
- `8711727` / `588b0b7`：native 功能测试适配 rc.5（默认导出、Goal 语义、产品规则）
- `51ca4d7`：收尾（空态、文档、提示词、死样式/死代码）
- LF 规范化：`.gitattributes` → `* text=auto eol=lf`，工作树不再依赖 CRLF/LF 检出

## 2. 验收证据

### 2.1 运行包构建

```
cd app
$env:PLAYWRIGHT_DOWNLOAD_HOST='https://cdn.npmmirror.com/binaries/playwright'
npm run prepare:runtime
```

结果（实测）：
- `运行资源已准备：app/.build/runtime`，`Node v22.23.3，614 个生产依赖`
- `runtime-manifest.json`：`engine=0.2.1-rc.5`、`node=v22.23.3`、五个补丁 SHA-256、`headlessShell=chromium_headless_shell-1243 (153.0.8010.12)`
- 五个补丁脚本 `--check` 均返回 `compatible:true, alreadyApplied:true`
- 运行包 node_modules：29,093 文件 / 1.17 GB

### 2.2 构建出的运行时真实启动（系统 DSH 配置）

用 `.build/runtime/node/node.exe backend.mjs` + 默认系统 DSH home（`~/.dsh`，profile `desktop`）启动：

```
Blueprint studio 数据接口已挂上 —— /studio/api/
dsh web: http://127.0.0.1:14199/?token=...
Blueprint 已启动：http://127.0.0.1:14199/?token=...
```

`GET /` → 200；`GET /studio/api/connections` → 200，返回：

| provider | namespace | active | Key | models | 来源 |
|---|---|---|---|---|---|
| `opencode-go` | `llm-pi-ai` | true | configured（`source=file`，系统 `~/.dsh/.credentials.yaml`） | 30 | `source:"system"` |
| `deepseek-official` | `llm-deepseek` | false | 未配置 | 2 | `source:"system"` |

`default = { provider:"opencode-go", model:"deepseek-v4.1-flash", reasoningEffort:"max" }` —— 与系统 DSH 桌面配置一致。

### 2.3 测试

- 迁移完成时基线：**266 tests / 248 pass / 2 fail / 16 skip**（详见 §3；两项失败已按 P0 收口处理）。
- P0 收口后（`npm test`，`BLUEPRINT_DATA_HOME=%TEMP%\Blueprint 测试数据`，2026-11-07 本机实测）：**269 tests / 253 pass / 0 fail / 16 skip**（新增 Windows ACL 边界探针 2 条 + fail-closed 回归 1 条；16 skip 为平台专属 + 缺 primary runtime 资产）。发布前建议在普通用户终端复跑一次确认。
- 每个迁移任务另有独立 implementer + 独立 reviewer 的定向测试与变异验证记录（见各任务提交与 review 消息）

### 2.4 Windows 安装包

```
npm run dist
```
产出 `app/dist/Blueprint-1.1.8-x64.exe`（约 495.7 MB），`win-unpacked/resources/runtime` 内 `dsh-llm=0.2.1-rc.5`、`engine 0.2.1-rc.5`。

## 3. 已知限制（非 rc.5 迁移引入）

1. **Windows ACL 沙箱后端的写边界语义（平台限制）**：
   - 供给本身可用：Stage A 探针（`app/scripts/windows-sandbox-probe.mjs` + `app/tests/windows-sandbox.test.mjs`）在 `%TEMP%` 下用户 FullControl 工作区实测 workspace-write `inside=written / outside=EPERM`、read-only `inside=EPERM`，无 `windows-acl-run:`（证据 `app/.build/windows-sandbox-probe/`）。早先的 `SetNamedSecurityInfoW Win32 5` 只出现在非 FullControl 目录（仓库根 `项目`、仓库树负例），不是“后端不可用”；把这类目录当工作区时仍需按 P0 Task 2 的诊断脚本补 owner FullControl。
   - 根内单文件写保护缺失：**`native-ralph`** 的 PTC 边界在 win32 上只能验证“工作区内可写 + 工作区外不可写”；项目根内的“机器账本”（`系统文档/任务.db`）对 PTC 子进程可写——ACL 后端只表达“可写根”，无法复现 macOS Seatbelt 的 `机器保护` 单文件 deny。按 P0 Task 2b 的 B1 方案：win32 上平台门控该断言（保留 own/host 边界），产品级加固由 [issue #2](https://github.com/Huiluck/blueprint-try/issues/2)（`ready-for-human`）跟踪；PTC 默认关闭（`执行能力设置.ptc=false`），风险面受限。
   - **`native-worktree`**：真实 Git 外部过滤器经 MSYS `sh` 执行时，受限子进程无法创建命名管道（rc.5 文档化限制）；已按 P0 Task 3 平台门控（2026-11-07，保留工作树行为断言与 `-text` 属性以保持 LF 检出）。
2. **Office / 浏览器 MCP 测试依赖官方 primary runtime 资产**：本仓库当前未准备 `app/.build/native-resources/primary-runtime`（Office sidecar、共享 Python、Playwright MCP 运行环境），测试显式 skip 并提示准备方式；不静默通过。
3. **Playwright 资产下载**：官方 CDN 极慢，使用镜像 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`（覆盖 `builds/cft/...` 与 `builds/ffmpeg/...`）。本机已预热 `app/.build/native-resources/browser`（headless shell + chromium + ffmpeg + winldd，含 `INSTALLATION_COMPLETE`）；若丢失可镜像重装。
4. **打包后媒体 API 页只列媒体服务**：聊天 provider 的只读列表仅存在于已下线的旧 `/studio` 页面，打包版不可达；对话模型在系统 DSH 设置中管理（README 已按此描述）。
5. **reviewer 记录的非阻断风险**（供后续打磨）：
   - rc.5 Goal 的 complete 动作在 Blueprint 节点里按产品规则被拒绝，应以 `finish` 交回（测试已按此语义修正）；
   - studio 终端的假 `invocation` 依赖 rc.5 私有契约（`attach` 只用 `uplink()/uplinkWindow`），升级引擎时需复核；
   - `app/package.json` 仍保留 `@xterm/*`、`zustand`、`immer`、`esbuild` 等已无直接消费者的依赖（涉及 THIRD_PARTY_NOTICES 许可证声明，未在本轮删除）；
   - `project-skills-smoke.mjs` 对已下线 `/studio` 页面的 200 断言已按 302/404 修正（t14g 范围），其余 smoke 未全量重跑。

## 4. 复现/发布命令

```powershell
# 依赖（已锁 rc.5 + cordis 家族）
cd app
npm ci 2>$null; npm install   # package-lock 已锁 0.2.1-rc.5

# 构建运行包（需 GNU patch、Playwright 镜像或预热缓存）
$env:PLAYWRIGHT_DOWNLOAD_HOST='https://cdn.npmmirror.com/binaries/playwright'
npm run prepare:runtime

# 全量测试（在普通用户终端运行，避开 agent 会话沙箱）
$env:BLUEPRINT_DATA_HOME="$env:TEMP\Blueprint 测试数据"
npm test

# Windows 安装包
npm run dist
```

## 5. 下一步建议

1. ~~Windows 沙箱收口（P0）~~：已完成（2026-11-07 收口 269/253/0/16；`native-ralph` 采用 B1 平台门控、`native-worktree` 过滤器平台门控、fail-closed 回归入库；根内机器账本写保护是产品级加固，见 [issue #2](https://github.com/Huiluck/blueprint-try/issues/2)）。
2. 准备官方 primary runtime 资产后启用 Office / Playwright MCP 测试（去掉 skip）。
3. 清理已无直接消费者的包依赖并同步 `THIRD_PARTY_NOTICES.md`。
4. 用真机（干净 Windows + 正常用户会话）安装 dist 产物，按计划 Task 14 的 6 条人工验收清单跑一遍。
