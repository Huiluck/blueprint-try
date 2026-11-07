# 引擎迁移到 DSH 0.2.1-rc.5（系统 provider 直读 + 五补丁移植）

## Problem Statement

Blueprint 是一个构建在 DeepSeek Harness（DSH）之上的多智能体工作室：画布、名册、阶段与轮次、上下文重建、工作台、技能与媒体服务都由 DSH 的插件与服务驱动。它当前把 DSH `0.2.1-alpha.2` 连同五个本地引擎补丁一起打进自己的运行包，并维护一套自己的聊天模型 provider 配置（添加/验证/删除/获取模型）与项目级模型选择。

这带来四个问题：

1. **引擎被私有副本锁死**：app 只能使用内置的 alpha.2，无法跟随系统已安装的 DSH（当前 0.2.1-rc.5）升级；升级意味着重新移植五个补丁并重建整包。
2. **provider 配置重复**：用户已经在系统 DSH 里配置好 provider 与凭据，Blueprint 仍要求再配一遍；两处配置容易漂移，键值重复存放。
3. **跨平台可复现性差**：客户端 bundle 由本地生成器从已安装上游包拼接，生成器依赖仓库内 `.dsh/profiles/web` 与 LF 检出；Windows 上 CRLF 会让生成物与 CI/macOS 不一致。
4. **Windows 构建与测试链未收口**：Windows 端口已存在，但引擎仍是旧的 alpha.2，打包、补丁、终端、测试资源都没有在 rc.5 上验证过。

## Solution

把 Blueprint 的运行时引擎切换到系统官方 DSH `0.2.1-rc.5`，并让 Blueprint 只做“产品层”：

- 所有 DSH 包与 Cordis 家族版本精确锁定到 rc.5 兼容版本；五个引擎补丁按“引擎版本 → 补丁文件”映射移植到 rc.5。
- 聊天模型 provider、模型目录与凭据改为**只读读取系统 DSH**（默认 `~/.dsh`，profile `desktop`，可用环境变量覆盖），启动时把系统 profile 里的模型路由行导入 Blueprint 生成的 profile；凭据只在该系统文件存在时引用。
- 删除 Blueprint 自己的聊天 provider 增删改 / 验证 / 获取模型 / 设为默认入口与首连引导；项目模型选择改为从系统模型目录选择，默认规则为“上次选择 → 目录默认 → 首个可用 provider 的首个模型 → 空态提示”。
- 媒体服务（图片/视频/音频）保留完整管理能力。
- 客户端 bundle 生成器与引擎依赖解耦，并在 LF 工作树上重新生成；Windows 安装包与运行包在 rc.5 上重建。
- 终端能力随 rc.5 迁移：studio 终端流改用 `attach` + RemoteStream 契约；已下线的 legacy viewer 终端及其资产管线删除。

完成后的产品行为：用户只需在系统 DSH 里配置一次 provider，Blueprint 启动即可列出其 provider 与模型；项目创建/模型选择使用系统目录；媒体服务照常管理；Windows 可构建安装包。

## User Stories

1. As a Blueprint developer, I want the app to run on the system-installed DSH 0.2.1-rc.5, so that I stop maintaining a pinned private engine copy.
2. As a Blueprint developer, I want the five existing engine capabilities (audio/video input, external worker listing, session read recovery, document preview timeout recovery, tool JSON repair) preserved on rc.5, so that product behavior does not regress.
3. As a Blueprint user, I want to configure model providers once in the system DSH, so that Blueprint never asks me to duplicate API keys.
4. As a Blueprint user, I want Blueprint to list the system DSH provider and model catalog at startup, so that I can see what is actually available.
5. As a Blueprint user, I want model credentials to be read from the system DSH credential file when it exists, so that there is a single source of truth for keys.
6. As a Blueprint user, I want new projects to pick a model from the system catalog with a sensible default, so that project creation stays fast.
7. As a Blueprint user, I want a clear, non-blocking empty state when the system DSH has no model provider, so that I know exactly where to configure one.
8. As a Blueprint user, I want media services (image/video/audio) to remain fully manageable inside Blueprint, so that multimodal nodes keep working.
9. As a Blueprint user, I want the settings dialog to manage only media services, so that I do not confuse it with model provider configuration.
10. As a Blueprint user, I want Blueprint to stop offering add/edit/delete/verify/fetch-models for chat providers, so that the system DSH is the only place I configure models.
11. As a Blueprint user, I want model selection inside a project to write only the project model table, so that project-scoped choices do not mutate global configuration.
12. As a Blueprint user, I want old alpha.2-era projects and sessions to be readable after the migration (or to fail loudly), so that my existing work is not silently damaged.
13. As a Blueprint user, I want the studio terminal to keep working on rc.5, so that terminal output/input behavior is unchanged.
14. As a Windows user, I want a Windows installer built from the migrated tree, so that I can run Blueprint natively.
15. As a Windows user, I want model/provider setup to work from the packaged app, including the documented home/profile overrides, so that the desktop build behaves like the source run.
16. As a maintainer, I want every DSH dependency and override pinned to an exact rc.5 version, so that the engine version has one source of truth.
17. As a maintainer, I want patch scripts to select the right patch by exact engine version and to be idempotent, so that repeated builds and future upgrades are safe.
18. As a maintainer, I want mixed or partially-applied patch states rejected with an actionable message, so that a broken engine never silently ships.
19. As a maintainer, I want a missing GNU patch to fail the build early with an actionable message, so that Windows builds do not silently skip patches.
20. As a maintainer, I want client bundle generators to resolve the pinned engine from the app dependency tree, so that generation no longer depends on a developer-machine profile.
21. As a maintainer, I want generated client bundles to be byte-identical across Windows CRLF and macOS LF checkouts, so that CI and local builds agree.
22. As a maintainer, I want an automated boot-level integration test that starts the real backend with a fixture system DSH home and asserts the provider list over HTTP, so that provider import regressions are caught offline.
23. As a maintainer, I want native feature tests adapted to rc.5 semantics (named plugin exports, Goal complete via `finish`, version-from-manifest), so that the suite reflects real product behavior rather than old engine quirks.
24. As a maintainer, I want the terminal stream port covered by existing tests, so that `attach` sequencing and shutdown semantics are pinned.
25. As a maintainer, I want the dead legacy terminal asset pipeline removed, so that the runtime payload no longer carries unused browser assets.
26. As a maintainer, I want README and third-party notices updated for rc.5 and the system-provider model, so that docs match the shipped behavior.
27. As a release manager, I want build prerequisites (GNU patch, Playwright mirror/prewarmed browser, optional primary runtime assets) documented, so that a clean machine can reproduce the installer.
28. As an AFK agent, I want a spec, an implementation plan, and an acceptance-status record that describe the seams and known limitations, so that follow-up work can continue without re-deriving context.

## Implementation Decisions

- **Engine version and dependency pinning**：所有 DSH 包固定为 `0.2.1-rc.5`；Cordis 家族固定为非 alpha 版本（cordis、group、include、loader、timer、schemastery）；DSH 的 bundle manifest 与 Blueprint 各插件包的 peerDependencies 一并更新，避免版本闸门停用插件。
- **Five patch ports**：每个补丁保留 alpha.2 历史文件，同时新增 rc.5 版本；补丁脚本改为“引擎版本 → 补丁文件”映射，导出 `*PatchForVersion(version)`，`inspect*/ensure*` 契约保持不变；补丁语义保持原样（音视频 FileBlock 序列化、外部激活只读列表、会话读合并/语料修订、预览读取超时恢复、工具参数 JSON 修补）。
- **System provider import**：新增只读导入模块，从系统 DSH home（默认用户目录下 `.dsh`，profile 默认 `desktop`，支持环境变量覆盖）读取 profile patch 中的模型路由行（白名单：默认模型、多 provider、原生 DeepSeek、DeepSeek 账号）；YAML 使用与 profile 组合层一致的 `!!js` 标签；缺失/损坏只降级为 warning，不抛异常；凭据 path 仅当系统凭据文件存在时写入 profile，否则回退到 Blueprint 数据目录的引擎凭据文件。
- **Composition layering**：生成的 profile patch 顺序为 Blueprint bundle patch → 系统 provider 行 → host 覆盖层，保证系统 provider 能覆盖内置默认路由，同时保留应用级覆盖。
- **Read-only connection API**：连接列表中的聊天行标记为系统来源（`source: 'system'`）且不可编辑/删除；save/remove/discover/test 对聊天类型返回明确错误；媒体类型保留完整 CRUD；为兼容旧 UI 的媒体删除 payload，按媒体 id 识别旧式请求；删除“设为默认”动作。
- **UI simplification**：设置对话框只列媒体服务；聊天 provider 只读列表随旧页面下线不再可达；删除聊天首连引导、连接表单、获取模型按钮与 `BlueprintAPI` 写回接缝；`模型就绪` 只看 provider 是否 active，不再要求 key.configured；空态文案统一为“请先在系统 DSH 中配置模型 provider”。
- **Default model rule**：新建项目的模型选择顺序为“上次本项目选择（须在可路由名单）→ 目录默认（须可路由且无失败）→ 首个可路由 provider 的首个模型 → 空态”；目录读取失败时保留上一次良好选择；groups 为空但 failures 非空时同时显示“名单读不出来”与空态原因。
- **Terminal migration**：studio 终端流从已删除的 `follow` 改为 `attach` + RemoteStream；为 HTTP 路由构造 invocation 视图；每条连接维护常驻泵、输出队列与背压上限；上行 write/resize 以从 1 连续递增的序号在消费时编号并等待原生 ack；refusal/结束映射到稳定的终端错误码；生命周期用 AbortSignal 合并并在流 finally 中 abort，确保释放原生 follower。
- **Legacy terminal removal**：删除已不可达的 viewer 终端页、传输层与终端资产构建/复制/校验管线；新终端由 DSH 侧栏终端插件自带 xterm/FitAddon 并从包内懒加载；`/studio/api/terminal` 数据接口保留。
- **Client bundle generation**：生成器从 app 的依赖解析上游客户端包；对读取的文本输入统一做 CRLF→LF 归一化（媒体生成器），布局生成器依赖 LF 工作树；全仓库 `.gitattributes` 固定 `eol=lf`，生成物在 Windows/macOS 下逐字节一致且幂等。
- **Build/runtime packaging**：`prepare:runtime` 在 rc.5 上产出运行包（manifest 记录 engine、node、五个补丁 SHA-256、headlessShell）；Electron builder 产出 Windows 安装包；运行包可以独立搬走。
- **Environment prerequisites**：Windows 构建需要 GNU patch（Git for Windows 或环境变量指定）；Playwright 浏览器资产通过镜像下载并预热；Office/Python 等 primary runtime 资产是可选准备项，缺失时对应测试显式 skip。
- **README/notices**：说明 rc.5、系统 provider 只读来源、凭据优先级、补丁分工（运行包准备应用全部五个补丁；源码 CLI 准备只应用其中四个）、测试需带解析钩子、Windows 构建补丁前置。

## Testing Decisions

- **Good test definition**：只测外部行为与契约——补丁能否正/反向应用且幂等；导入模块对缺失/损坏/越界输入的安全降级；连接 API 的只读/媒体 CRUD 行为；启动后 HTTP 端点返回的 provider/模型目录；生成物与生成器输出一致且幂等；UI 默认模型规则与空态文案。不测内部函数名、私有字段或实现细节。
- **Seams (existing first)**：
  1. 补丁脚本的 `inspect*/ensure*` 契约（既有 seam，最贴近引擎行为）。
  2. provider 导入模块的纯函数输入/输出（新增把逻辑集中到纯函数的 seam）。
  3. profile 组合函数的 patch 顺序（既有 composition seam）。
  4. Studio 连接管理器的 HTTP handler（既有 API seam）。
  5. 真实启动 backend 的 HTTP 端点（新增一个启动级集成 seam，覆盖从系统 home 到连接列表的整链）。
  6. 生成器输出与提交物的哈希一致性（既有生成器 seam）。
  7. 原生功能测试以假模型驱动真实 DSH/Cordis 运行时（既有 seam）。
- **Modules tested**：补丁脚本与补丁文件、provider 导入模块与组合层、连接管理 API 与媒体 CRUD、UI 模型选择/空态（vm 与生成物断言）、启动级集成、客户端生成器、rc.5 原生功能适配、终端 attach 契约。
- **Prior art**：仓库既有的 `node:test` 套件（补丁设施测试、composition 测试、vm 驱动的 UI 测试、原生功能测试、smoke 脚本）；测试统一通过解析钩子运行，数据目录使用 `%TEMP%` 下的受控目录，测试结束清理临时 junction/目录。
- **Verification evidence**：全量套件在普通用户终端为 266 tests / 248 pass / 2 fail / 16 skip；2 个失败为 Windows ACL 沙箱后端不可用（在 agent 会话与普通终端均复现），16 个 skip 为平台专属或缺少可选 primary runtime 资产。
- **Mutation/negative testing**：对版本门禁、provider 导入降级、补丁幂等、默认模型断言、生成器新鲜度均做过变异验证，确认断言非空转。

## Out of Scope

- 早期讨论的“DSH 作为本地 OpenAI 兼容模型网关”方案（未实施；本迁移是先行路径）。
- 把媒体服务迁入系统 DSH 管理。
- provider 配置热更新/热重载（重启生效即可）。
- Windows ACL 沙箱后端的修复与替代（两项失败测试的根因）。
- Office/共享 Python/Playwright MCP 等 primary runtime 资产的准备与对应测试启用。
- 清理已无直接消费者的 npm 依赖与第三方许可证声明（单独一轮）。
- 向官方上游提交 PR / 发布公测版本。
- macOS 安装包与真机验证（本机为 Windows）。

## Further Notes

- 实施已完成在 `r1/rc5` 分支并推送到 `try` 远端（Huiluck/blueprint-try），最新提交为验收状态文档。
- 验收状态、已知限制与复现/发布命令记录在 `docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md`；实现计划在 `docs/superpowers/plans/2026-11-06-rc5-engine-migration.md`；设计说明在 `docs/superpowers/specs/2026-11-06-rc5-engine-migration.md`。
- 关键运行时证据：`prepare:runtime` 成功（Node v22.23.3、614 个生产依赖、五个补丁 `alreadyApplied`）；构建出的 runtime 用系统 DSH 配置启动后，连接列表返回 `opencode-go`（active、Key 来自系统凭据文件、30 个模型）且默认模型与系统配置一致；Windows 安装包已产出。
- 建议后续顺序：修 Windows ACL 沙箱后端 → 准备 primary runtime 资产并启用 Office/MCP 测试 → 依赖/许可证清理 → 干净 Windows 真机按验收清单复跑。
- 许可证边界：Blueprint 源码 AGPL-3.0-only；DSH 为 MIT，保留版权声明；系统 DSH provider/凭据只读导入，不修改系统配置。
