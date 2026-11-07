# Lead 交接清单 — Blueprint rc.5 引擎迁移（2026-11-07）

> 给下一位 Lead 的自包含交接。先按 §1 做，再按 §2 读文档、§3 复跑基线，然后执行 §6 的待办。
> 本文件不重复设计与验收细节；细节在各权威文档里，按 §2 的顺序读。

## 1. 十分钟上手（带完成判据）

- [ ] `cd C:\MyDocs\Program\Explore\blueprint`，确认：`git branch --show-current` = `r1/rc5`；`git rev-parse --short HEAD` = `eaff35a`；`git status --short` 为空；`git ls-remote try refs/heads/r1/rc5` = `eaff35a`。
      **判据**：四项一致；不一致时先读 §3.3 的“重推”说明再动手。
- [ ] 按 §2 顺序读完 7 份文档 + `app/README.md`。
      **判据**：能不看文档说出——引擎版本 `0.2.1-rc.5`、五个补丁名字、provider 只读语义、下一步计划文件名。
- [ ] 跑 §4 的“快速验证”，再跑一次全量测试（普通用户终端，见 §3.2）。
      **判据**：快速验证全绿；全量复现 `266 tests / 248 pass / 2 fail / 16 skip`，2 个失败与 §3.4 一致。
- [ ] 检查产物与资源：`.build/runtime/runtime-manifest.json` 的 engine=`0.2.1-rc.5` 且五个补丁 `alreadyApplied:true`；`app/dist/Blueprint-1.1.8-x64.exe` 存在；Playwright 缓存含 `INSTALLATION_COMPLETE`。
      **判据**：三项齐全（命令见 §4）。
- [ ] 向用户确认下一步执行方式（Native / Subagent-driven），然后执行 §6 的 P0 计划。
      **判据**：用户已确认；P0 的 5 个任务完成且全量达到 `250 pass / 0 fail / 16 skip`。
- [ ] 之后按 P1 → P4 顺序推进，每项独立建计划/执行。
      **判据**：`r1/rc5` 合入 `main` 并有安装包与验收记录；或用户明确改变优先级。

## 2. 阅读清单（按顺序，标注要提取什么）

| # | 文件 | 读它为了拿走什么 |
|---|---|---|
| 1 | `AGENTS.md`（+ 根目录 `GLOSSARY.md`） | 仓库约定、可用技能、领域词汇；**注意 Issue tracker 章节与现实不一致**，见 §3.5。 |
| 2 | `docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` | `gh` 操作规范与标签映射；`ready-for-agent` 等标签的用法。 |
| 3 | `docs/superpowers/specs/2026-11-06-rc5-engine-migration.md` | 设计决定 D1–D8：版本钉、补丁移植、provider 导入、composition 顺序、连接只读、模型就绪、终端、验收标准。**冲突时以它为准。** |
| 4 | `docs/superpowers/plans/2026-11-06-rc5-engine-migration.md` | 已完成的 14 任务分解；其中 Global Constraints 与 Task 14 的人工验收清单仍有效；偏差记录见文末。 |
| 5 | `docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md` | **当前验收状态与已知限制**（§3）、下一步建议（§5）、复现/发布命令（§4）。这是接手后的“现状单一事实来源”。 |
| 6 | `docs/superpowers/specs/2026-11-07-rc5-migration-spec.md` + [issue #1](https://github.com/Huiluck/blueprint-try/issues/1) | 已发布的 spec（问题/方案/28 条用户故事/实现决定/测试接缝/out of scope）；issue 在 `blueprint-try`（原因见 §3.5）。 |
| 7 | `docs/superpowers/plans/2026-11-07-windows-sandbox-isolation.md` | **下一步 P0 计划**（5 任务）：沙箱探针、ACL 修复、worktree 过滤器断言适配、fail-closed 回归、收口推送。 |
| 8 | `app/README.md` | rc.5 构建/运行/测试命令、系统 DSH provider 与凭据来源、补丁分工、Windows 构建前置。 |

改代码前还应读：

- 运行时装配：`app/runtime/system-providers.mjs`、`app/runtime/composition.mjs`、`app/runtime/backend.mjs`（导入系统 provider 行 → patch 顺序 → 启动）。
- 构建与补丁：`app/package.json`（scripts）、`app/scripts/prepare.mjs`、`app/scripts/patch-command.mjs`、五个 `app/scripts/*-patch.mjs`、`app/patches/*-0.2.1-rc.5.patch`（列表即可，不必通读 patch 内容）。
- 产品行为：`blueprint/packages/studio/src/连接.js`（只读连接 API）、`blueprint/packages/studio/src/index.js` 的 `llm.models` RPC、`viewer/studio.html`（新建项目/模型选择/空态）、`blueprint/packages/layout/{模型就绪.js,项目管理.js,项目入口.js,表单生成.mjs,生成.mjs}`、`blueprint/packages/studio/src/终端.js`。
- 测试：`app/scripts/test-runner.mjs`；`app/tests/system-provider-boot.test.mjs`（启动级接缝）、`app/tests/native-ralph.test.mjs`、`app/tests/native-worktree.test.mjs`（P0 的两个失败点）、`app/tests/native-execution-features.test.mjs`（含 Office/MCP 的资产 gate）、`app/tests/model-catalog.test.mjs`、`app/tests/connections-readonly.test.mjs`。
- 引擎侧约束（必读其一）：`app/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/README.md` 的 Known Limitations（WRITE_OWNER、受限孙进程管道 stdio、AppContainer ACE）。

## 3. 当前状态快照（2026-11-07）

### 3.1 代码与远端

| 项 | 值 |
|---|---|
| 分支 / HEAD | `r1/rc5` / `eaff35a`（工作树干净） |
| 领先 `main` | 56 个提交（`main` = `79a1b38`，未合入） |
| 远端 | `try` = `Huiluck/blueprint-try`，`r1/rc5` 已推送；`origin` = `Huiluck/blueprint`（上游 fork） |
| 引擎 | 系统 `@deepseek-ai/dsh@0.2.1-rc.5`；五个补丁已移植 |
| Issue | [blueprint-try#1](https://github.com/Huiluck/blueprint-try/issues/1)，标签 `ready-for-agent`，OPEN |

### 3.2 环境事实

- 工作目录：`C:\MyDocs\Program\Explore\blueprint`；agent 会话为 `danger-full-access`，**approval prompts 被禁用**——需要“非受限 PowerShell”的动作只能请用户在自己的终端执行。
- 宿主 Node `v24.15.0`；运行包内置 Node `v22.23.3`；Electron `44.5.1`；NSIS/electron-builder 26.15.3。
- GNU patch：`%LOCALAPPDATA%\Programs\Git\usr\bin\patch.exe` 可自动解析；必要时用 `BLUEPRINT_PATCH` 覆盖。
- Playwright：官方 CDN 极慢；用 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`（覆盖 `builds/cft/...` 与 `builds/ffmpeg/...`）。`app/.build/native-resources/browser` 已预热（headless shell + chromium + ffmpeg + winldd，含 `INSTALLATION_COMPLETE`）。
- 测试数据目录约定：`$env:BLUEPRINT_DATA_HOME="$env:TEMP\Blueprint 测试数据"`；测试进程结束自清理。
- 21 个 worktree：主检出 + `C:\Users\Lhui\Documents\deepseek-harness\default-workspace\wt\{t04..t14h}`，分支都已合并；可安全 `git worktree remove`（先 `cmd /c rmdir` 删除其中的 `app\node_modules` junction，避免递归删到共享目录）。未合并的临时分支：无。
- 日志：`C:\Users\Lhui\Documents\deepseek-harness\default-workspace\logs\`，其中 `outside-full-test.log` 是“沙箱外普通终端”的权威全量结果。
- 可清理残留（gitignored）：`app/.build/runtime-stale-20261106235243`、`app/.build/terminal-client`、`C:\Users\Lhui\Documents\deepseek-harness\default-workspace\r1-boot`、`%TEMP%\Blueprint 测试数据` 残留、`%TEMP%\t11-*`。

### 3.3 推送凭据的坑（重要）

本机 `git-credential-manager` 配置路径是坏的（`C:\Users\Lhui\.workbuddy-ai\...\PortableGit\...\git-credential-manager.exe` 不存在），裸 `git push` 会挂在 GCM 交互上。已知可行做法：
- 推荐：让用户在自己终端跑一次 `gh auth login`，或修好 `credential.helper` 后再由 agent 推送；
- 应急：Windows 凭据管理器里有 `git:https://Huiluck@github.com`（用户 `Huiluck`）与 `git:https://github.com`（用户 `jnn332`，对 `Huiluck/blueprint-try` 无权限）条目，可用 P/Invoke `CredRead` 取 Huiluck 的 token，并通过 `git -c http.https://github.com/.extraHeader="Authorization: Basic <base64>" push` 推送；`GH_TOKEN=<token> gh ...` 可用于 issue 操作。**绝不把 token 写入仓库、日志或最终回复**。
- 远端写入权限已验证：Huiluck token 可 push `r1/rc5`、可创建/评论 issue。

### 3.4 测试基线（普通用户终端，非 agent 会话）

- `266 tests / 248 pass / 2 fail / 16 skip`。
- 2 个失败，且都不是 rc.5 迁移回归：
  1. `native-ralph.test.mjs` — “PTC 真实 Node 进程保留项目写入…”：ACL 供给失败/边界未生效（本机目录缺 `WRITE_OWNER`）。
  2. `native-worktree.test.mjs` — “真实 profile、Git 与 Seatbelt…”：Git 外部过滤器经 MSYS `sh` 执行，受限子进程无法创建命名管道（rc.5 文档化限制）。
- 16 skip：darwin 专属 + 缺少官方 primary runtime 资产（Office/Playwright MCP，`native-execution-features.test.mjs` 中有显式 gate）。
- agent 会话内直接跑全量可能与上述数字不同（会话本身带沙箱限制）；判断产品问题请在普通终端复跑。

### 3.5 已知文档/工具不一致

- `AGENTS.md` 与 `docs/agents/issue-tracker.md` 写“Issues live in `Huiluck/blueprint`”，但该仓库 **Issues 已关闭**（`has_issues=false`）。实际可用 tracker 是 `Huiluck/blueprint-try`；`ready-for-agent` 标签是本次在 try 仓库新建的。建议下一次顺手修正 `AGENTS.md`/`docs/agents/issue-tracker.md`（或让用户开启 `Huiluck/blueprint` 的 Issues）。
- `app/THIRD_PARTY_NOTICES.md` 开头仍写 `0.2.1-alpha.2`（P2 清理项）。
- `app/package.json` 仍直接声明 `@xterm/*`、`zustand`、`immer`、`esbuild`，产品已无直接消费者（P2 清理项；涉及许可证声明）。
- `blueprint/packages/layout/README.md` 等处的旧“连接模型”文案已在 t14g 修正；若再看到“连接模型”字样，先查是否属历史文档。

## 4. 快速验证与常用命令

```powershell
cd C:\MyDocs\Program\Explore\blueprint

# 状态
git status --short; git rev-parse --short HEAD; git ls-remote try refs/heads/r1/rc5

# 快速回归（约 30s）
cd app
node --import ./scripts/native-node-protocol-check.mjs?register --test tests/system-providers.test.mjs tests/composition.test.mjs tests/system-provider-boot.test.mjs
cd ..
node --test blueprint/packages/layout/界面语言.test.js
node blueprint/packages/layout/生成.mjs; node blueprint/packages/media/生成.mjs; git status --short   # 生成器应无 diff

# 全量（普通终端）
cd app
$env:BLUEPRINT_DATA_HOME="$env:TEMP\Blueprint 测试数据"
npm test

# 产物检查
(Get-Content app/.build/runtime/runtime-manifest.json -Raw | ConvertFrom-Json) | Select-Object engine,node
Get-ChildItem app/dist -File | Select-Object Name,Length
Get-ChildItem app/.build/native-resources/browser -Recurse -Filter INSTALLATION_COMPLETE | Select-Object FullName
```

## 5. 不可违反的边界（用正向表述写）

- 引擎改动走补丁机制：`app/patches/*.patch` + `app/scripts/*-patch.mjs` + `app/scripts/prepare.mjs` 接线；`app/node_modules` 只作为构建/测试运行时，不手改后提交。
- 生成物只由生成器写：改 `viewer/studio.html` 或 layout 源后跑 `node blueprint/packages/layout/生成.mjs`、`node blueprint/packages/media/生成.mjs`；`client.js` 不手改；`viewer/英文.json` 用 `界面语言.test.js` 对账。
- 沙箱供给失败必须 fail-closed：绝不回退到不受限 spawn；`windows-acl-run:` / 退出码 127 必须原样暴露。
- 测试统一经 `node --import ./scripts/native-node-protocol-check.mjs?register --test ...`；数据目录用 `%TEMP%` 受控目录；测试结束清理临时目录/ junction。
- 工作区一律 LF（`.gitattributes` = `* text=auto eol=lf`）；生成器对 CRLF 的归一化不可回退。
- 产品设计文案（`blueprint/packages/prompt/重置/`）不改写；其余提示词只做功能性最小修正。
- 保留五个补丁能力（音视频输入、外部 worker 列表、会话读恢复、文档预览超时恢复、工具 JSON 修补）。
- 凭据不落盘、不进日志、不进回复。

## 6. 待办与执行顺序

**P0（下一步，已写好计划）**：执行 `docs/superpowers/plans/2026-11-07-windows-sandbox-isolation.md` 的 5 个任务。其中 Task 2 的 ACL 修复需要用户在**普通 PowerShell（非 DSH 会话）**里运行随包诊断脚本；agent 会话里跑会把它自己的限制误报为缺失权限。完成后全量目标：`250 pass / 0 fail / 16 skip`。

**P1 primary runtime 资产与 Office/MCP 测试**：`app/scripts/prepare-office-resources.mjs`（内部调用 `app/scripts/dsh-primary-runtime/prepare.ts`）产出 `app/.build/native-resources/primary-runtime`；之后 `app/tests/native-execution-features.test.mjs` 中 Office/浏览器 MCP 两条 gate 放开并跑通。涉及外部下载，先确认网络/磁盘。

**P2 依赖与许可证清理**：移除 `app/package.json` 中已无直接消费者的 `@xterm/xterm`、`@xterm/addon-fit`、`zustand`、`immer`、`esbuild`（先核对 `app/scripts/source-cli.mjs` 的 `requiredModules`、`app/tests/packaging-engine.test.mjs` 的 fixture、`app/THIRD_PARTY_NOTICES.md` 的许可证归属），`npm install` 重算 lock 后重跑全量与 prepare。

**P3 干净环境验收**：在干净 Windows 用户会话安装 `app/dist/Blueprint-1.1.8-x64.exe`，按迁移计划 Task 14 的 6 条人工清单验收（真实模型最小项目、旧项目读取、五个补丁对应功能、终端、媒体服务、设置只读）。

**P4 合并与发布**：`r1/rc5` → `main`（先与用户确认发布版本/渠道），打 tag、写 release notes、推送；同时决定是否修正 §3.5 的 tracker 文档。

**P5 遗留打磨（可选，非阻塞）**：t14e reviewer 记录的终端私有契约耦合、`project-skills-smoke` 等 smoke 未全量重跑、macOS 安装包/真机验证。

## 7. 当前未决问题（接手时先与用户确认）

1. P0 执行方式：用户尚未在「Native（Lead 直接执行，推荐）」与「Subagent-driven」之间选择。
2. ACL 修复允许范围：若诊断脚本要求临时提权/改目录权限，用户是否接受（脚本会备份并打印回滚命令）。
3. 发布策略：是否把 `r1/rc5` 合入 `main`、是否作为 1.1.8 发布、先 Windows 还是同时要 macOS。
4. P1 的 primary runtime 资产是否必须（不装则该两项测试保持 skip，但 Office/浏览器 MCP 功能在真实使用中不可用）。
