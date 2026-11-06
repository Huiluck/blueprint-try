# Blueprint 引擎迁移到 DSH 0.2.1-rc.5 — 设计说明（Spec）

> 本文是实施计划的依据（`docs/superpowers/plans/2026-11-06-rc5-engine-migration.md`）。
> 证据来源：`recon/05-r1-rc5-spike.md`（工作区 `C:\Users\Lhui\Documents\deepseek-harness\default-workspace`）与仓库内代码核对。

## 1. 背景与目标

Blueprint 目前把 DSH `0.2.1-alpha.2` 连同 5 个引擎补丁打进 runtime payload。目标是把引擎换成**系统安装的官方 `@deepseek-ai/dsh@0.2.1-rc.5`**，同时：

1. 保留 Blueprint 全部产品功能（画布、名册、上下文重建、阶段/轮次、工作台、外部 run 等）；
2. 保留 5 个引擎补丁对应的能力：**音视频输入、外部 worker 列表、会话读恢复、文档预览超时恢复、工具参数 JSON 修补**；
3. 删除 Blueprint 自己的"聊天模型 provider 配置"链路，改为**直接读系统 DSH 的 provider 与模型目录**；
4. 媒体服务（图片/视频/音频）仍由 Blueprint 管理，不受影响；
5. Windows 11 x64/arm64 与 macOS Apple Silicon 仍可构建运行。

## 2. 已验证事实（spike）

- 用系统 rc.5 依赖组装的 payload 能启动 Blueprint backend，0 个插件被版本闸门停用（对齐 peerDependencies 后）；
- `GET /` 200、`GET /studio/api/connections` 200；
- 注入系统 DSH 的 `agent-default-model` / `llm-pi-ai.providers.opencode-go` / `credentials.path=~/.dsh/.credentials.yaml` 后，连接列表返回 `opencode-go`（active、Key 来自系统凭据文件、29 个目录模型）与默认模型 `opencode-go/deepseek-v4.1-flash`；
- 现有 5 个补丁在 rc.5 上**未上游**（`listExternalActivations`、`corpusRevisionOf`、`read-timeout`、音视频处理、工具 JSON 修补均不存在于 rc.5 代码）；
- 全局 npm 安装缺 5 个 devDependencies 包（`dsh-browser-use`、`dsh-client-store`、`dsh-experimental-browser-use-playwright-mcp`、`dsh-subagent-codex`、`dsh-subagent-claude-code`），npm 上均有 `0.2.1-rc.5`，正式 `npm install` 可解决。

## 3. 锁定的决策

| # | 决策 | 说明 |
|---|---|---|
| D1 | 引擎全部 `@deepseek-ai/dsh-*` 固定 `0.2.1-rc.5` | `expectedEngineVersion` 以 `dependencies['@deepseek-ai/dsh-llm']` 为唯一来源 |
| D2 | cordis 家族固定非 alpha 版本 | `cordis@4.0.5`、`cordis-plugin-group@1.0.5`、`cordis-plugin-include@1.0.10`、`cordis-plugin-loader@1.0.6`、`cordis-plugin-timer@1.1.7`、`schemastery@3.18.5`；`cordis-plugin-hmr` 覆盖项删除（rc.5 用 `@deepseek-ai/dsh-hmr`） |
| D3 | 5 个补丁全部移植到 rc.5 | 新补丁文件 `app/patches/<name>-0.2.1-rc.5.patch`；保留 alpha.2 旧文件；脚本按引擎版本选补丁 |
| D4 | 聊天 provider 只读，来源=系统 DSH | 启动时读 `$BLUEPRINT_SYSTEM_DSH_HOME`（默认 `~/.dsh`）/profile（默认 `desktop`）的 `cordis.patch.yml`，白名单行导入 Blueprint profile；`credentials.path` 指向系统 `.credentials.yaml` |
| D5 | 删除聊天 provider 写入口 | 不再提供添加/编辑/删除/验证/获取模型/设为默认；项目模型选择仍用 `{provider, model, reasoningEffort}` |
| D6 | 媒体服务保留 | `kind='media'` 的连接仍可增删改测，接口保留 |
| D7 | 生成器改为从 app 依赖解析上游 | `layout/生成.mjs` 不再要求仓库内 `.dsh/profiles/web`，改用 `createRequire(app/package.json)` |
| D8 | 平台：win32 x64/arm64 + darwin arm64 | Node 内置版本仍为 `22.23.3`，Electron `44.5.1` 不变 |

## 4. 全局约束

- 引擎版本：`0.2.1-rc.5`（精确固定，不使用 `^`/`~`）。
- 内置 Node：`v22.23.3`；Electron：`44.5.1`。
- 纯 JavaScript（ESM），无编译构建步骤；客户端 bundle 由各包 `生成.mjs` 生成并提交。
- 中文注释与中文文件/标识符沿用现有风格；不修改 `blueprint/packages/prompt/重置/` 下的提示词文本。
- 补丁通过 GNU patch 应用（`-p0`，部分脚本用 `-F0`）；Windows 需 Git for Windows 的 `patch.exe` 或 `BLUEPRINT_PATCH` 环境变量。
- 系统 DSH 配置为**只读导入**：Blueprint 不写系统 profile/凭据文件（媒体服务 Key 除外，见风险）。
- 分支：`r1/rc5`；远端 `try`（`https://github.com/Huiluck/blueprint-try.git`）。
- 许可：Blueprint 为 AGPL-3.0-only；DSH 为 MIT，保留版权声明。

## 5. 验收标准

1. `npm --prefix app test` 全绿（含新增/更新的测试）。
2. `npm --prefix app run prepare:runtime` 在 rc.5 上成功，5 个补丁全部 `alreadyApplied` 且重复执行幂等。
3. 启动后的连接列表只展示系统 DSH 的 provider 与模型目录；无 provider 时显示引导空态，不崩溃。
4. 用系统 `opencode-go`（或配置的 provider）创建最小项目并让一个 run 完成一轮模型调用。
5. Windows 安装包可启动；打开旧（alpha.2 时代）项目会话能加载或明确报错。
6. 媒体服务仍可新增、编辑、测试（图片/视频/音频）。

## 6. 非目标

- 不重写 Blueprint 编排机制；不引入新的 agent 引擎抽象（R2 不在本期）。
- 不把媒体服务改为读系统 DSH。
- 不保留对 `0.2.1-alpha.2` 的构建支持（旧补丁文件仅作历史留档）。
- 不追求与系统 DSH 的 provider 配置热同步（重启生效）。

## 7. 主要风险

- **生成器接缝**：rc.5 的 `@deepseek-ai/dsh-client-ui-layout` 等客户端 bundle 与 alpha.2 有差异，`生成.mjs` 的文本区域/接缝可能失败，需要逐个修复。
- **补丁 rebase**：rc.5 内部代码变化，5 个补丁的 hunk 需要重新定位；必须保留原有语义。
- **会话格式**：alpha.2 写入的会话/项目数据由 rc.5 读取，可能存在格式迁移问题（rc.5 自带 format 升级链）。
- **凭据文件共享**：媒体服务 Key 与模型 Key 同存系统 `.credentials.yaml`；若不接受，可在后续迭代拆出独立文件。
- **本机缺 `patch.exe`**：验证补丁相关测试前需安装 Git for Windows 或设置 `BLUEPRINT_PATCH`。
