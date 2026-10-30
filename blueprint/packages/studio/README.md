# @blueprint/studio

本包是宿主插件，消费原生 webServer、sessionPersistence、sessionQuery、agents、sessionController、子会话和事件，以及 roster 的项目投影。提供界面、问答、模型连接、产物与文件入口，不实现第二套会话契约、不写节点名册。架构与写入归属见 [协议.md](../../../协议.md#二包与接缝)。

## 源码入口

| 文件 | 职责 |
| --- | --- |
| [src/index.js](src/index.js)、[src/项目操作.js](src/项目操作.js) | Studio路由、建项目与原生会话操作 |
| [src/名册视图.js](src/名册视图.js)、[src/运行状态.js](src/运行状态.js) | 节点关系与 Agent.status 投影 |
| [src/子代理.js](src/子代理.js) | 左窗「Agent 选择」页的接口：整页保存开关、模型和三家的选择偏好，DSH 卡共用项目模型；随包命令行（node 的 `外部程序.js`）的检测（程序、登录、测试三盏灯；每家最近一次测试结果记在 dsh 存储里）、在终端里登录 |
| [src/软件.js](src/软件.js) | 左窗「软件」页的接口：常用软件的清单（类别、名称、什么时候装、命令、Homebrew 包名）、装没装（命令在不在 PATH 里，不启动程序）、后台用 Homebrew 一键安装（一次一个、其余排队），没有 Homebrew 时在终端里装它 |
| [src/助理.js](src/助理.js) | 右上角「帮助」那条会话：数据根下的 `助理/` 当工作目录，每次打开把 prompt 生效目录里的 `助理/AGENTS.md` 抄进去；照 dsh 的 `cordis` 预设开（standard 的工具加插件管理），开出来调一次 `/permission danger-full-access`，再给这一条记默认思考档 `low`（`设会话思考`：沿用全局默认的模型，只走 dsh `selectModel` 里管单条会话的那一步，不存成全局默认；模型不认 low 就照默认）；会话号记在数据根的 `助理会话.json`，下次接着用，「新对话」另开。不进名册、不挂项目工作区 |
| [src/外部协助.js](src/外部协助.js) | 原生 external catalog、运行查询与父 Inbox 的只读展示，按项目和直父校验停止（10-18 起节点不再开原生外部任务，只剩旧记录会显示） |
| [src/外部run视图.js](src/外部run视图.js) | 外部 run 的 Chat 接口 `GET /api/external-run?session=&id=`：按次读取任务快照与完整执行说明；`视图=工作` 仅返回可阅读字段，隐藏原始输入、schema 和系统补文。实时文件由 `外部run产物.js` 从本节点工作目录读取；原始输入继续供诊断调用方使用，不重建历史 prompt；只读 |
| [src/终端.js](src/终端.js) | 用户终端的项目校验与原生 controller 传输，全停后收回本项目 Agent 执行终端 |
| [src/工作时间.js](src/工作时间.js) | 按项目累计节点运行时间；并发不重复、中断暂停、恢复接续 |
| [src/实时输出.js](src/实时输出.js)、[src/提示统计.js](src/提示统计.js) | 原生事件流、历史与提示字数 |
| [src/问答链.js](src/问答链.js)、[src/停止后台.js](src/停止后台.js) | 问答恢复与原生后台停止 |
| [src/连接.js](src/连接.js) | settings／credentials 连接管理，不回传Key |
| [src/产物.js](src/产物.js)、[src/预览.js](src/预览.js) | 只读产物发现、预览与用户点击打开 |
| [src/文件夹.js](src/文件夹.js)、[src/材料.js](src/材料.js)、[src/任务廊预览.js](src/任务廊预览.js) | 文件浏览、已上架素材和过程／取得材料，以及按需内容预览 |

## 两张脸并排

顶栏显示本项目“已工作 HH:MM:SS”。至少一个原生 Agent 为 running 时累计，全部 idle 或释放时暂停；节点与帮手会话并发只计一份墙钟时间。切节点、切项目或关闭界面不影响计时。累计保存在 `系统文档/工作时间.json`，首次从该项目全部会话的运行区间并集补算，不受树显示数量限制；未收尾的旧记录只算到最后事件。运行中每 15 秒保存一次，正常退出保存至退出时刻，异常退出最多丢失最后 15 秒，不累计停机空档。页面断线暂停显示，重连以服务端记录校准。

| 地址 | 是谁的 | 干什么 |
|---|---|---|
| `http://127.0.0.1:<port>/` | dsh 自带 | 说话、调试、对照组 |
| `http://127.0.0.1:<port>/studio/` | 我们的 | 旧页面 10-15 下线，访问时 302 到新界面（dsh 网页界面的根）；这里只剩数据接口 |

dsh 自带那张脸占着 fallback（`dsh-host-frontend-static`），本包只注册一条 prefix 路由，
不去抢它。HTTP 匹配次序是「exact → 最长 prefix → fallback」，两者不冲突。

## 为什么自己开一条 SSE，而不复用 dsh 的 `/api`

本包保留自己的 SSE 翻译入口：
dsh 的 `/api` SSE 是它**私有的 wire 协议**（`packages/host/apiproxy/src/api-proxy.ts`），
复用等于把这张脸焊死在一份会变的内部协议上，而且翻译要挪进浏览器。
翻译在服务端，前端只认我们自己的形状 —— dsh 改协议时，改动集中在这一个入口。

模型增量已经直接消费 `sessionController.follow` 的快照与有序事件，SSE 只翻译成页面帧；浏览器断线后重取历史。对话分页仍需前端接入。见下面「Known Limitations」。

## 路由

| 路径 | 方法 | 干什么 |
|---|---|---|
| `/studio`、`/studio/` | GET | 302 到 `/`（新界面）。旧页面和它的静态文件不再提供；`viewer/` 的源码仍在，新界面的包生成时从里面截取代码 |
| `/studio/api/project-name` | POST | `{session,name}` 保存项目显示名并标记为手动名称，同步原生工作区标题；目录不变，后续自动命名不覆盖 |
| `/studio/api/history?session=<id>` | GET | 一整个会话的折叠视图：条目 / 统计 / 轨迹 / 落点计数 |
| `/studio/api/stream` | GET | SSE。每帧带 `session`；一连上先补发还悬着的问话 |
| `/studio/api/running` | GET | 后台此刻占着的节点（原生 `Agent.status`）、命令（`ctx.jobs`）、external activation（原生 manager 只读查询）、外部 run（node 包内存表）与残留进程（只读 ps）。跨项目，每行带所属项目 `项目`，文件夹没了带 `项目已删` |
| `/studio/api/subagents?session=<会话>` | GET | 这个项目的开关、模型与思考程度，加本机的登录检查和测试结果（`测试`：每家最近一次，带当时的模型和思考程度）；不带会话只给默认值（新建项目表单用） |
| `/studio/api/subagents/save` | POST | `{session,开关,模型,偏好,全局模型?}` 保存整页草稿；校验模型和新打开的 Agent 就绪状态，项目模型沿用 `改模型`。项目模型保存失败时恢复原 Agent 设置。编辑或失焦不写入，新项目点击保存后才交给创建表单。 |
| `/studio/api/subagents/check` | POST | 当场查程序版本与登录状态；带 `key` 只查那一家（点卡上的「检测」），不带两家都查 |
| `/studio/api/subagents/switch` | POST | `{session,key,on}` 拨这个项目的开关：`key` 为 `dsh` 时不查程序和登录，三家至少开一家（外部都关着时 DSH 关不了）；外部两家打开前当场查程序和登录，再看这家测过没有，三样不全退回；关随时能关，关掉最后一家外部 DSH 跟着打开 |
| `/studio/api/subagents/login` | POST | `{key}` 在 macOS 终端里开原生登录窗口；清掉这一家记着的测试结果 |
| `/studio/api/subagents/models` | GET | 每家可选的模型与思考档位：Codex 在沙箱里现查 `codex debug models`（十分钟缓存，`refresh=1` 重查），Claude Code 是固定别名。页面先显示内存／`sessionStorage` 中上次成功的目录，再后台刷新；初次显示加载状态，失败保留旧目录。 |
| `/studio/api/subagents/model` | POST | `{session,key,model,effort}` 改这个项目一家的模型和思考程度；Codex 只收目录里有的模型与它支持的档位 |
| `/studio/api/subagents/try` | POST | `{key,session,model?,effort?}` 测试当前编辑的模型；不带模型时用项目原设置，测试不保存草稿。临时目录套上和节点相同的项目沙箱，真跑一句最小的话，每家记最近一次通过与否、报错原文、是否要重新登录（`测试记录路径` 指的文件，落盘；换模型不用重测）。 |
| `/studio/api/software` | GET | 本机共用、不分项目：`brew`（在不在、位置）和每款软件的类别、名称、说明（按界面语言）、`在`／`位置`、`装`（`排队`／`安装中`／`失败`＋说明，装好就清掉） |
| `/studio/api/software/install` | POST | `{key}` 排进后台安装队列，跑 `brew install [--cask] <包>`；已经装好或正在装的不重复排。brew 退出 0 且命令找得到才算装好，否则记失败和最后几行输出（已有非 Homebrew 装的 App、Homebrew 正忙、断网换成人话）；失败的可再点重试 |
| `/studio/api/software/brew` | POST | 没有 Homebrew 时在 macOS 终端里开官方安装命令（要输开机密码，所以不在后台装）；页面每 4 秒查一次，最多等 10 分钟 |
| `/studio/api/external-run?session=<项目会话>&id=<号>` | GET | 外部 run 的过程页数据（`外部run视图.js`）；图纸上它的砖由 `seatTree()` 照名册画（`node_id` 为 `外部:<号>`，状态与第二行见 `外部态()`、`外部两行()`，核对见 `外部run界面.test.js`） |
| `/studio/api/external-subagents?session=<父会话>` | GET | 父会话登记的外部协助：catalog 成员、耐久启动回执、native live 状态与 Inbox／历史完成报告 |
| `/studio/api/terminal` | POST | 同源 JSON `{method, sessionId, projectSessionId, args}`：原生用户终端 list／environment／shells／create／write／resize／rename／close |
| `/studio/api/terminal?mode=<retain或follow>&sessionId=<所属会话>&projectSessionId=<项目会话>&id=<终端>&attachmentId=<输出连接>` | GET | 直接传递原生持有／屏幕与有序输出流；retain 无需 attachmentId |
| `/studio/api/kill` | POST | `{id}` → `ctx.jobs.kill(…)`；`{类:'外部run', id}` → `停外部run`（停因记下，继续时接着做）；`{类:'进程', id, 起于}` → 重新列一遍、号码和起点对上才停整组。停节点走 `/api/rpc` 的 `session.cancel`，跟输入框那个「停」同一份实现 |
| `/studio/api/rpc` | POST | `{method, payload}` → 翻译成 `ctx.sessionController`／`ctx.subagents` 的调用。**一件能力都不自己实现** |
| 同上，`method: 'respond'` | POST | `{rpcId, value}` → 交还给接力链上等着的那一环。答一句问话，**回**原来那条的 `rpcId`，不新开 |
| 同上，加 `cancel: true` | POST | `{rpcId, cancel:true}` → 撤掉这一问：那一环抛 `ASK_CANCELLED`，工具以错误收场，**那一轮接着跑**。批准没有这条路 |

## 用户终端

右栏 Terminal 为当前节点打开交互 Shell，支持多标签、输入、调整尺寸和原生屏幕恢复。新终端使用原生 workingDirectory 的当前目录；之后 Session 换目录不会偷偷改变既有 Shell。输出默认只在终端显示，不送入模型。创建套用 node 的用户终端项目执行域，维持项目、机器文件、认证与管理端口边界；不借用模型预测或审批。

`viewer/terminal-native.mjs` 只导出官方 `ClientTerminals`、`RemoteStream` 及其依赖；`terminal-transport.js` 翻译 HTTP，`terminal.js` 画标签与 xterm。身份、持有、输入排队、输出顺序、断线恢复与关闭意图沿官方客户端。浏览器只额外存标签的会话与出现身份，不保存屏幕、运行状态或 cwd。切节点保留已有 PTY；断线与刷新复用原身份，原进程丢失时明确提示并由用户新建，不静默重启。多窗口共享终端时只有当前原生控制连接能输入。

关闭标签等待原生 `terminalController.close()` 释放进程与最终输出；失败保留官方关闭意图并可跨刷新重试。关闭页面只释放连接，Host／所属 Agent 释放时的资源清理由原生负责。主机重启后不恢复原 PTY。Seatbelt 包装的活动查询可能为 unknown，不承诺固定闲置时限内自动回收。

官方客户端与 xterm 资源由 `app/scripts/terminal-client-assets.mjs` 从选定安装构建并核对版本及摘要。Studio 仅白名单读取 `native-terminal.js`、`xterm.js`、`xterm-fit.js`、`xterm.css`，目录来自 `terminalAssetsDir` 或 `BLUEPRINT_TERMINAL_ASSETS_DIR`。旧服务仍读取新 HTML、终端脚本尚不可用时，仅 Terminal 页显示升级提示，主界面照常使用。核对：`app/tests/studio-terminal.test.mjs`、`app/tests/terminal-view.test.mjs`；真实 PTY 与项目执行域另见 `app/tests/native-terminal.test.mjs`。

## `/api/rpc`：一条通道，不是一堆动作

右上角帮助用 `助理.打开`（`{新对话?}` → `{sessionId, 目录}`）：会话本身仍由 `sessionController.create({sessionId, cwd, agentPreset})` 开，记着的会话预设或目录对不上（`agent-preset/conflict`、`session/conflict`）才另开，别的错照原样回。页面中途关掉也会开完、记下，下次接着那一条。对话里的材料条（`/api/materials?view=used`）对不在项目里的会话回空，不报 404。

节点右上角的重启按钮先显示“取消／重置”确认框，再通过 `node.restart` 校验项目并调用 node 的重启入口。恢复首次文档与开工输入，清除旧对话、预测、审议、交回及等待，收回旧子树；作品文件保留。旧会话保存在原生账本，树只显示同一节点的新会话。重复请求复用同一次重启；运行过但缺少可靠初始请求的旧会话拒绝猜测。`app/scripts/node-restart-backend-smoke.mjs` 核对隔离真实引擎的实际 context（旧页面的按钮交互冒烟随旧页面 10-15 挪进回收站）。

树上的 Stop All／Start All 只操作点击时的当前项目。批量操作在 `session.list`、取消与继续的 payload 中携带 `projectSessionId`；服务端按会话的项目目录过滤，同目录的节点、分叉与所属辅助会话均在范围内，明确指向其他目录的会话排除。该次 `session.list` 另带属于这些父会话的 native live external，并核对活任务直父 catalog，不把外部 ID 放进 Session 名单、不为批量名单加载整个项目的冷账本；全停并行发送会话取消和外部 interrupt，Start All 仍只恢复 Session。逐条动作在执行前再次校验项目与直父 catalog 归属。操作中切换项目不改变既有目标。输入框的「停」仍只管一个对话节点。

Stop All 在上述取消完成后，按 `session.list.canCloseAgentTerminals` 调用 `project.closeAgentTerminals`：后端重新校验项目，取得本项目实际 Agent，等待全部 `whenIdle()` 再关闭其原生执行终端；发布前启动或清理失败仍会报未释放。用户手动终端属于独立 controller，继续保留。单节点 Stop 保留它的执行 Shell。旧服务没有能力位时沿用原停止行为。

Claude Code／Codex 外部协助显示在父对话的 catalog 创建行和既有完成记事行，不提供外部 Session 树、输入框或中间 transcript。运行状态由 `subagents.listExternalActivations` 查询已发布的原生对象；停止仅表示 interrupt 被接受，资源释放前仍显示停止中或收尾中。冷读取提供方与启动目录只信 `tool/result.meta.blueprintExternal`，旧记录显示未记录；报告从当前原生 Inbox 与已消费的 `subagent-settled` 原文读取，显示已收到报告，不解析英文猜成功/失败。无 live 对象且无报告时显示运行状态未能恢复，不提供续跑。

运行灯、对话计时、树和后台运行列表统一读 dsh 的 `Agent.status`。`turn/start` 只提供开跑时刻和轮号；即使取消或异常后没有 `turn/end`，原生 `agent/status: idle` 或 `session/disposed` 也会撤掉实时运行状态。重新读取历史或连接 SSE 时直接核对 Agent，旧时刻不会把已停节点显示为运行。核对：`node --test blueprint/packages/studio/运行状态.test.js`。

取消节点同时通过原生 `ctx.jobs.kill()` 结束它自己的后台执行；kill 标记完成通知已报告，避免长命令结束后又自动唤醒已停节点。其他节点、委派出去的 subagent 和排队的用户输入保留。后台工作的停止失败会原样返回，不把已发送节点取消当作全部停稳。`app/scripts/stop-smoke.mjs` 用隔离项目和模拟模型核对真实取消、后台任务、SSE 与历史状态。

说话、停、开新会话、换模型、分叉 —— dsh 的 `ctx.sessionController` 全都做完了，
而且做得比我们能做的细（分叉那条要找完整 turn 边界、带上边界后的零散追加、
继承 cwd / preset / 模型 / `parentSessionId` 血统、挂进同一个工作区）。
所以这里只有一张白名单翻译表，只留这张脸用得上的那几行。

**页面这头的方法名和形状是 apiProxy 时代定下的，翻译全在服务端那张表里，页面不用改。**
dsh 0.1.5（2026-09-13 装上）把 `apiProxy` 整个删了，方法搬进了
[`session-controller`](../../../参考/dsh/packages/api/session-controller/src/index.ts) 和
[`subagent`](../../../参考/dsh/packages/subagent/subagent/src/index.ts)：
调法从「`{rpcId, payload}` 进、`{result}` 出」变成「请求对象进、值出、失败抛带 `code` 的错」。
几处要补的：`requestId` 由服务端铸；`llm.models` → `modelCatalog`；
`session.models` 没了，由目录 ＋ 会话的 `modelSelection` 投影拼回原来那份
`{groups, failures, current, routable}`；错误码 `subagent/xxx` 换回页面认的 `subagent-xxx`。

```
session.prompt  session.cancel  session.list  session.models
session.selectModel  session.fork  subagent.interrupt  subagent.prompt
```

`subagent.*` 那两条不是重复：`session.cancel` 明写了拒绝 subagent 拥有的会话，
`session.prompt` 对子节点一律回 agent-busy —— 没有它们，界面上的「停」和「说话」
只够得着 Blueprint。

不在表上的一律 404。**一处诚实记账**：dsh 在它自己的 `/api` 上还过一层校验，
我们这条没有——它是同进程直调，调用方是我们自己那一页，每个 payload 都在一处拼出来。
真送进去个歪的，dsh 的实现会抛，这里兜成一条「炸了」原样回给页面，不静默。

## 输入条：行为抄 dsh，画皮是我们的

| 行为 | 抄自 | 是什么 |
|---|---|---|
| 送法：只有一种 | —— **这一条不抄 dsh**（2026-08-21 用户裁定） | 回车 ＝ Cmd·Ctrl+回车 ＝ 点发送。模式是**算出来的**：闲 → `queue`，忙 → `steer`。原来那个「排队／插话」下拉删了：一个永远该选最快的选择摆出来让人选，唯一作用是让人选错 |
| 发送之前先撤问卷 | `respond` 的 `cancel:true` | 一张没答的问卷会把那一轮钉死，后面排的话一句都读不到。所以「发送」＝ 先把你的话放进去，**再**撤掉挡路的问卷（顺序不能反）。批准（准／不准）不替你按，只提示 |
| 停 | `session.cancel` | 停掉正在跑的这一轮；**排着队的不丢**，停稳后按先来后到接着读（已实测） |
| 斜杠命令 | `session.prompt` 的行为 | 契约上：正文是单独一块、以 `/` 开头时 dsh 就地执行，不送模型。**这个部署里没生效**——见下 |
| 拦不拦输入 | `SessionModels.routable` | dsh 明写「要拦输入的界面必须读这个，不是读 groups」——一个还在服务但不再报名的模型 groups 里没有却完全能用 |

## 要你点头：不用抢位置，也不用 dsh 那张脸开着

dsh 0.1.5 起，批准和提问是两条**接力链**（cordis waterfall）：`approval/request`、
`user-questions/request`。链上每一环要么自己答，要么 `next()` 交给下一环；
dsh 自带那张脸是链上的一环（`参考/dsh/packages/api/remotes/src/index.ts` 的 `forwardWaterfall`）。
（apiProxy 时代走的是 mux 流，一开始还判错过一次「只能二选一」—— 那一套连同 mux 一起没了。）

我们这一环**排在它前面（`prepend`），同时 `next()` 把问话交下去**：

```
接力链  ──►  我们这一环  ──►  blueprint.ask       ──►  流里长出一块砖
             │  同时 next() ──►  dsh 那张脸
             └  谁先答算谁的  ──►  blueprint.ask_done  ──►  砖上落章
砖上按下  ──►  POST api/rpc {method:'respond', rpcId, value}  ──►  那一环 resolve
```

- **为什么排前面**：dsh 那一环在没有浏览器连着时会一直等，排它后面就永远收不到。
- **dsh 自带那张脸开不开都不影响**，两边并存（谁先答谁算数）。我们先答了，会把交下去的
  那份收回（换掉 `request.signal`），dsh 那边的框随之消失。
- 协作终稿沿同一提问链展示完整方案。真实回答先交给 node 保存当前版本的审核决定，再结束问卷或恢复节点；保存期间停止也保留答复，重启后沿原通道递交。
- 这张脸后开／刷新过，由 `/api/stream` 一连上就把悬着的补一遍。
- **落点在流里它发生的位置，没有盒子**（禁令 2）。页签上那个数字只是个「那边有事」的记号：
  不装东西、点不开、没有列表。
- 问话发生在**别的会话**上时，顶栏会说「别处 N 件等你点头」。
  筛掉不说的后果是那个会话安静地卡死，而这张脸上一点异常都看不出来。

## 「排着队」那一行的判据

`agent/inbox/spliced` 两个方向都会画错，所以判据写在这里：

- **全画** → 每句话出现两次（排队那行 ＋ 你说的话那个气泡），一件事两个真相
- **全不画** → **一句还没被读的话会整个消失**。实测有这种事：一条消息进了收件盒、
  那一轮再没跑起来，全流水里只有这一条事件带着它

所以判据是「它后来有没有落成一条 `user/message`」：落成了就是重复（归结构性），
没落成就是还排着（画出来）。**靠消息 id 比对，不靠正文**——同一句话说两遍很正常，
按正文比会把第二遍误判成重复。

（这里的 inbox 是 dsh 自己的字段名，指 agent 的下一步待办队列，不是被禁的「用户收件箱」——
它长在流里它发生的位置，没有盒子。）

## 翻译对照（dsh → 渲染器）

| dsh 会话事件 | 变成什么 |
|---|---|
| `user/message`（`source.kind === 'user'`） | 用户块（右对齐），带 `time`（下面那行动作条上的时钟） |
| `turn/end` | **轮尾行**（`blueprint.turn_tail`）：时刻 · 用时 · 首 token · tok/s · 这一轮的 token，外加分叉锚点 `seq`。一步没跑的那一轮不出这一行 |
| `user/message`（插件注入、转达、快照…） | 「记」一行，点开是全文。**不摆在用户那一侧**——那是伪造发言人 |
| `assistant/message` | assistant 块：`text`→正文、`reasoning`→想、`tool-call`→工具行 |
| `tool/result` | 挂回对应工具行的结果（全文）；正文里那几行信封（【取】【进】【出】）另出一帧 `blueprint.块排`，在那一行底下摆一排 context 词块 |
| `request/header` | 折叠的「SYS · 节点上线 / 系统提示词变更」，点开是本次请求的 system prompt 全文 + 工具名单 |
| `compaction/summary` | 「压」一行，点开是切线摘要全文 |
| `todo/write` | 「记」一行，点开是整张待办快照 |
| `assistant/chunk` | 实时流式帧（`message_start` / `message_update` / …），定格时由 `assistant/message` 整块替换 |
| `tool/call` | 实时 `tool_execution_start`；历史里它已经是 assistant 块的 `toolCall`，不重复画 |

### 实时思考与等待

整轮的 busy 只控制底部运行条是否存在。推理、正文、工具和提问事件分别显示「thinking」「输出中」「执行工具」「等待子代理」「等待你回答」；未收到模型内容时显示「等待模型」。运行条的时钟按当前阶段计算，悬停可看整轮总耗时，轮尾仍保留整轮统计。这里计量的是事件界定的阶段，并非模型内部计算时间；缺少原生时刻时从界面收到阶段起计时，不把之前的等待算作思考。

展开只显示本步实际收到的推理文本；没有内容时是一行等待提示。连续多余空行只在显示时压缩，原生记录与内部 buffer 保持全文。历史推理收起时不挂载长正文，点开再显示。流式 token 每 50ms 合并追加一次，正文达到 8000 个 UTF-16 单元后改为 150ms，减少全文 Markdown 重排；结构边界先冲刷，切节点取消未渲染的旧增量，增量不刷新整条导航。中途连接时，原生快照中连续的推理／正文片段合成一个增量，保留文本、阶段边界与时刻，避免重放几万次 DOM 更新。

`app/node_modules/.bin/electron app/scripts/long-text-stream-smoke.cjs` 在隐藏浏览器中核对长正文重绘次数、结构边界冲刷、切节点清队列及实时／回放一致，不连接运行项目或调用模型。

### 多节点运行时的历史刷新

新节点尚未进入名单时，它的展示事件和多节点问答通知统一走合并刷新，只补取树；诊断帧不触发取数。上一趟未返回时只记一次待补取，避免每条事件重取整份历史。隐藏页面暂停自动历史刷新，回到页面后合并补取一次；SSE 仍接收对话、问题和提醒。相同历史请求共用整趟取数与落屏，在途完整历史可满足同节点的树刷新；切节点、换页或需要更多内容时取消过时请求，取消不显示后端离线。正常切节点建立的 SSE 首次连接不再重复刷新，同一连接的断线重连仍补取历史。

其他节点的树更新只绘制相关区域，保留当前对话与输入。树的事件计数和原始边表变化不触发绘图；同项目未变化的节点复用卡片 DOM，更新节点内容、折叠计数和位置仍按当前数据计算，切项目清理旧卡片。

Studio 的名册只读投影按文件 inode、尺寸与纳秒修改时间共用冻结的解析结果；文件变更、删除或瞬时 I/O 错误后重新读取，不把界面对象交给权威写入路径。最多保留 128 份、源文件合计 8 MiB；单文件超额仍正常读取，不进入缓存。

`node app/scripts/load-smoke.mjs` 用慢响应核对新节点事件突发、问答、去重、取消和重连；`node --test app/tests/webui-refresh.test.mjs app/tests/webui-tree-update.test.mjs` 核对隐藏页、恢复、诊断帧、实时条目和树刷新范围。`app/node_modules/.bin/electron app/scripts/mirror-update-smoke.cjs` 核对节点复用、增删、折叠、点击与切项目；`node --test blueprint/packages/studio/名册读缓存.test.js` 核对文件变化与读取恢复。`app/scripts/load-browser-smoke.cjs` 可在隐藏浏览器中载入一份离线 history JSON，增加 100 个树节点并注入并发事件，核对完整页面的请求峰值与输入响应；不调用模型或连接真实会话。

## `live` 那一列：现成的账，一本都不自己记

顶栏那个 `live`（内部那个根仍叫「在跑」）问的是**后台还有什么东西泡着**，全部项目一起列。答案分四处：

- **跑着的节点** —— dsh 的 `Agent.status`；`busy` 只存 `turn/start` 的时刻，
  用于显示「跑了多久」，不承担运行与否的判断。
- **后台工作** —— **dsh 自己的 `ctx.jobs`**（后台 bash、subagent 委派往里登记；
  `tool-jobs` 是给模型用的同一本册子）。协议的原生复用不变式：dsh 有的不造 ——
  自己再立一个登记册，两本第一天就开始各说各的。
- **外部 run**（Codex／Claude Code 直接当节点做）—— node 包 `外部run.js` 的内存表（`外部run清单()`），
  开工、结束由 `听外部run变化` 推一帧。
- **残留进程** —— 上面哪一类都不认、却还开着的进程（10-18：删掉的项目留下一个卡了两小时的 Godot，哪里都看不见）。
  `node/src/残留进程.js` 只读 ps：本服务的子孙、本服务开过的进程组里留下的、被系统收养且命令里写着项目目录的；
  一个进程组算一件，有终端的不算，已算作外部 run 或在跑后台任务（命令原文对得上）的不重复列。
  它们自己退出没有事件，列出来过的就每 15 秒复查一次，变了推一帧，没有了就不查。

`ctx.jobs` 走 `ctx.get('jobs')` 取，取不到只报前一半，并在返回里写明缺了哪一半
（一列空着的时候，「没东西在跑」和「这一半读不到」是两件事）。
册子变了由 `onJobsChanged` 推一帧 `blueprint.在跑变了`（**不带数据**，看着的那张脸自己去取；
那一列没开着就一个请求都不发）—— 不轮询。

⚠️ **说得出来的边界**：这一列只看得见**登记过的**。`hands` 自己 spawn 的那几个
（截图/录屏的 Chrome、ffmpeg、解压）没有登记，所以不在这儿；它们活几秒自己收，
崩掉留下的孤儿这一列看不见。要它们也看得见，正路是**让它们也走 `ctx.jobs.start()`**，
不是在这儿再列第二张表。

**两个坑，已经处理：**

1. `tool-call.arguments` 是**未解析的 JSON 字符串**，渲染器要对象。
   解析失败**不静默吞掉**——参数对象里换成 `{参数解析失败, 原始参数}`，
   原样出现在那一行点开后的 args 里。
2. `TokenUsage` 的四个计数是**互不重叠**的（计费输入 = `inputTokens` + `cacheReadTokens`
   + `cacheWriteTokens`）。五个字段一个不丢地传给渲染器，落在轮尾行上。

## 轮尾行的三个读数，口径抄 dsh

抄的是 [`contract/turn-metrics.ts`](../../../参考/dsh/packages/client/ui-chat/src/client/contract/turn-metrics.ts)
的 `deriveTurnMetrics`，逐条同口径：

| 读数 | 怎么算 | 为什么是这个算法 |
|---|---|---|
| 用时 | `turn/end.time − turn/start.time` | 整轮墙钟，含工具时间 |
| 首 token | **第一步**的 `step/start → 第一条 chunk`，不是各步平均 | 它回答的是「你按下回车之后多久开始看见字」，那只跟第一步有关 |
| tok/s | Σ输出 token ÷ Σ解码墙钟，只算两样都记全了的步 | 没报 usage 或没记计时的步不许进分母 |

分叉锚点用 `turn/end` 自己的 `seq`：dsh 的 `sessions.fork` 要求种子止于一个跑完的
`turn/end`，这条事件本身就是那个边界，不用去猜。已实测：从轮尾行的 `seq` 分叉，
子会话只带这一轮（`seedLength` 与父的血统都落在 `SessionHeader` 里）。

## Trace：移植自 dsh，不是另起炉灶

`/studio/api/history` 返回的 `turns` 是把 dsh 的
[`ui-trajectory/src/client/layout.ts`](../../../参考/dsh/packages/client/ui-trajectory/src/client/layout.ts)
（1126 行 TS）在服务端重写了一遍。搬的是**折叠规则**，不是那 7858 行 React 组件：

- 一轮（turn）一节，节内分组：`Message` / `Step N` / `Compaction <seq>`
- 组头是**墙钟跨度 + 工具直方图**（`10,762 ms bash×3`），照 `groupDescription`
- 一条 `assistant/message` 炸成多条记录：正文与想合成一条 `ASSISTANT`，每个工具调用各一条 `TOOL`
- 七种 kind 与标签原名照抄 `TrajectoryTable.tsx:38`：
  `SYSTEM` / `USER` / `CONTEXT` / `COMPACTED` / `ASSISTANT` / `TOOL` / `SUBTOOL`
- `user/message` 在线上**没有 turn** —— 归进它后面那条 assistant 的 turn（dsh 的规则）
- 孤儿 `turn 0`（没有任何 assistant 认领的工具结果）折进 `Turn 1`
- 行内容 `名字 参数 → 结果` 与 `(tool call only)`，照 `recordDisplayText` / `recordResultText`
- 一行的排布照 `TrajectoryCell.tsx`：`#序号 · 种类标签 · 内容 · [in/out/思] · 自身时长`

**dsh 有、这里没有的**（逐条列出，不许悄悄少）：

| 缺什么 | 为什么 |
|---|---|
| `SUBTOOL` 行（`run_code` 的子调用） | dsh 从 `ToolCallBlock.subCalls` 拿，那是它**客户端投影**里的字段，原始会话事件里没有 |
| `requestOnly`（一次没有任何输出的请求） | 同上，来自它的 `RequestView` 投影 |
| 正在飞的那一条（`partial` / `runningCalls`） | 实时由 SSE 单独喂进 Chat 页；Trace 页要等这一轮定格 |
| 左边那条时间线轴（Input / Model / Tools 三道） | **用户明确要去掉** |
| 折叠/展开、搜索、虚拟滚动 | dsh 的工具栏功能，这一版没搬 |
| 缩略图 | 图片块只留元数据（dsh 也只在有 data URI 时才画） |

## 零暗层：三个筐必须装完

每条会话事件必属于三筐之一，三个数加起来等于事件总数。历史 API 保留这些诊断计数，对话区不显示开发提示框：

- **画出来的** —— 上表那些（`turn/end` 从 2026-08-17 起在这一筐：它出轮尾行）
- **结构性** —— `turn/start`、`step/*`、`assistant/chunk`、`tool/call`、`session/end-seed`、
  `compaction/start|end`、`web/deepseek-search-llm-request`、`subagent/catalog`。
  对应过程已由其他条目展示，目录和底层请求不另作对话消息。
  一步没跑的那一轮，它的 `turn/end` 也退回这一筐 —— 它的内容（没有内容）不该报成「未画出」
- **未画出** —— 其余一切（含以后新增的、这个包没听说过的类型），历史 API 的 `undrawn` **逐类报数**。
  「读不出」和「没有」必须分得开

## 配置项

| 字段 | 默认 | 干什么 |
|---|---|---|
| `mount` | `/studio` | 路由前缀。改了它，那两张脸的地址跟着改 |
| `viewerDir` | 本包位置往上四层的 `viewer/` | 那几个文件在哪。给的是相对路径时按 dsh 进程的工作目录解析 |

## 预期能看见什么

```sh
./dsh --profile web web
```

启动日志里有 `Blueprint studio 已挂上 —— /studio/`。然后：

- `http://127.0.0.1:3080/` —— dsh 自带那张脸，照常
- `http://127.0.0.1:3080/studio/` —— 我们这张脸；在上面那张脸里说一句话，
  这条流里同步长出这一轮的全过程；刷新后形态与实时那次逐字一致

## Known Limitations and Deferred Work

- **一次只看一个会话。** 切换节点读取它自己的流水，不聚合成全项目一条流。
- **SSE 没有断线续传。** 断了重连会重取一次历史（不丢东西，只是会重画）。
  dsh 自己那条 `/api` 做了分页与游标，我们这条没有。
- **历史一次性全取，不分页。** 会话很长时这一次请求会很大。
- **普通冷会话的实时 follow 会被原生 controller 提升为活会话。** 历史与树的 observation 始终只读；实时入口沿用原生行为。后续需要区分只查看与接续运行。
- **提问回答后默认折叠，审批历史仍只留工具记录。**
  `ask_user_question` 的问题与答案从工具参数和回执恢复：回答前完整展示，回答后默认收成可点击的一行，展开保留完整问题、选项和只读答案。
  实时提问卡与对应工具回执共用一个入口，刷新后沿用同一形态。答复发送失败时保留完整问题与已填内容，允许重试。
- **斜杠命令在 `web` 这个 profile 里根本没接。** 契约上 `session.prompt` 会把
  单块 `/开头` 的正文当命令就地执行，不认识的名字回 `unknown-command`。
  实测（打了一条 `/definitely-not-a-real-command` 进去）：回的是 `accepted: true`，
  那句话原样进了模型。结论是这个 profile 没有挂命令注册表
  （`@deepseek-ai/dsh-base` + `dsh-web-app` 两个 bundle 里没有它）。
  **所以这一格不是我们缺功能，是这台机器上没有这件东西。** 挂上就自动能用，
  界面这边一个字都不用改；缺的只会是补全菜单。
- **输入条不提供 @子 agent 与技能引用。** 项目附件走既有项目附件入口。
- **排队项不能改也不能删。** 界面没长出编辑/删除的入口，`session.updateQueue` 也就不在白名单上（2026-08-30 收白名单时删了——只开真用得着的口）。
- **轨迹是平移，不是新坐标系。** 三条道（输入 / 模型 / 工具）是「一个 agent 一次会话内部」
  的坐标系。当前不另做跨节点时间线。
- **shadow 那一页 2026-08-31 拆了** —— 那两个器官整个裁撤
  （工单-目标图景（09-04 删了，git 里有） 第 1 件）。右列现有五个页签（2026-10-01 英文命名）：
  Brief / Chat / Artifacts / Trace / Feed。帮手会话（批量帮助等）通过原生子会话产生自己的事件，不上节点树；run 用 subagent 开的会话例外，画成 run 下面带 `SUB` 角标的砖（`seatTree()` 的 `子run们`，瘦账保留 `subagent/descriptor` 认它）。
- **纯 JavaScript，零构建** —— 全 bundle 一样，没有编译步骤。

## 产物画廊

任务廊默认查看当前节点，可切当前节点及下属或整个项目，支持类型筛选、名称／路径／节点搜索。两列卡片以上方 16:9 内容为主体：图片显示裁切缩略图，视频显示真实帧，音乐显示前 30 秒的频谱，网页优先复用现成封面，缺少封面时由内置浏览器生成截图。文档显示正文摘录，目录显示直接条目，其他格式显示文件信息；PDF、演示及 Office 尚无逐页缩略图转换。底部 28px 行左侧为单行名称，右侧常驻「打开」「引用」；引用直接复制带名称和项目内路径的 Markdown 链接，不切换对话或插入输入框。

外部 run 没有会话，文件廊用 `GET /studio/api/materials?session=<项目会话>&view=live&id=<节点号>` 读取名册对应的实时工作目录，复用上述卡片和预览。包含相对开工起点已提交、未提交与新建的文件，保留已删除文件的不可用状态；提供普通分页、类型与搜索参数，文件观察不虚构会话事件或发布记录。页面可见时每 3 秒读取，隐藏、切页签及切节点取消旧读取；可切项目共享素材与过程文件。

`GET /studio/api/artifacts?session=<id>&scope=branch|self|project` 是现有名册、会话账本和项目文件的只读投影。`src/产物.js` 统一识别成功 write/edit、preview/read_image 的路径、bash/job_output 回执中的明确文件路径，以及 assistant 正文的 Markdown 链接和行内代码文件引用。不会因为读了一份文本就把它列为新产物；失败调用和未落地的正文引用不进入画廊。命令回执与查看记录只标记来源，不证明文件由该节点生成。任意 shell 脚本静默产生、从未返回或引用的文件暂不能自动发现。

同一路径合并成一张卡，保留全部来源步骤；对话在相应工具或消息后插入同一份卡片。来源可跨节点跳转，早期对话会先展开。节点交回结论与产物是否存在分开显示，不把写入成功当作验收通过。

**预览是当前文件，不是历史快照。** 卡片标注当前文件修改时间；来源历史只保存已有事件的坐标，不另立登记账，不复制文件，不改模型 context，不唤醒节点。事件有变化时合并刷新；手工修改文件后使用刷新按钮。相对文件引用按原生目录事件与调用时目录解析，继承前缀只用于恢复目录事实，不重复展示引用。文件真实路径须位于项目内，符号链接越界不预览。预览一律 no-store；成果卡带 `t`（原件修改时间）来取且与当前文件一致时才允许浏览器缓存，再带 `w` 时，比该宽度大的 PNG／JPEG 由系统 `sips` 缩一份放应用持久预览缓存（按路径、大小、修改时间认，同时只缩两张），小图、其他格式或缩失败照发原件。材料与产物投影按会话记住折到第几条事件，同版账本只折新来的事件；材料汇集按引用条数认缓存，运行中节点的新事件多数不重查文件。汇集列表只收节点做了、看了、拿给人看的（2026-10-25）：搜索结果的候选网址和系统叫醒话里的路径不列；bash 输出里提到的路径只列节点开工以后新建或改过的文件（按 ctime，解压、拷贝也算），开工前就有的素材参考和目录本身不列。引用记录照旧全留，点开路径的定位不受影响。原生 `.agents/worktrees/<名称>/` 中的普通产物可展示，Git 管理文件与隐藏配置不提供预览。

前端 `viewer/artifacts.js` 共用卡片渲染与请求协调，`artifacts.css` 延用中性色、直角和静态布局。需重启 studio 后端加载新路由；旧后端尚未重启时，页面显示提示，对话仍可使用。

核对：`node --test blueprint/packages/studio/产物.test.js blueprint/packages/studio/核对.test.js`。

`GET /studio/api/material-preview?session=<id>&path=<入口>` 为可见任务廊卡片按需返回 PNG 或文档／目录信息。视频帧和音乐频谱使用本机 `ffmpeg`，网页使用 `blueprintRenderer` 的隔离浏览器；文件边界复用只读预览检查。首次成功生成后，缩略图、频谱及文档／目录信息原子写入应用数据根的 `.dsh/任务廊预览缓存/`，图片缩略另存于其 `图片缩略/` 子目录，不写回项目。缓存按项目、入口、原文件修改信息及预览版本区分，不包含节点会话，也不按时间过期；换节点、内存淘汰和服务重启都直接复用磁盘结果。文件改变或缓存损坏时才重新生成。远程网页保留首次截图，不定时访问原站。内存最多保存 64 项，前端最多同时请求三份预览，服务端最多处理两份，同文件并发去重；ffmpeg 的解码、滤镜、输出线程限制为一，音频最多取前 30 秒，视频最多取前 3 秒。对话中的原件卡仍沿用既有封面，不自动截图或嵌入运行网页的 iframe。

来源数据只用于将原件卡挂到对应对话位置，卡片不展示来源记录展开区。任务廊名称行不常驻显示时间和路径，完整名称、路径、修改时间、大小及说明保留在名称的悬停提示中。

### 复杂项目的产物加载（2026-09-29）

看对话时 `/api/artifacts` 只请求 `scope=self`；打开 Artifacts 页后才按所选范围汇集下属。Artifacts 页隐藏时不建立卡片 DOM。图片由 IntersectionObserver 在进入可见区域附近后才设置 src，异步解码；离开／删除的待加载图片解除观察。卡片仍使用原文件，没有压缩或改写项目素材。

对话挂卡每次统一建立来源锚点和已有卡片索引，不再对每个来源重复全 DOM 查询；同一帧的挂卡任务合并，仅在消息定格等结构事件后补挂，不随每个文本 token 扫描。画廊内容未改变时复用 DOM，不因刷新请求开始而重复创建图片。

以运行中的 10.0 项目抽样，优化前同组节点切换约 0.6–1.2 秒，优化后约 0.05–0.47 秒；这是本机当时的测量，不是延迟保证，未复现用户报告的完整 10 秒。浏览器检查确认隐藏画廊为 0 张卡、249 张图的画廊首屏仅 12 张设置 src，滚到末尾后增至 22；节点与范围切换正常，无页面脚本错误。

### 本地试玩入口（2026-09-30）

`.app` 应用与 `.command` 启动器作为「本地试玩」产物，与其他类型共用范围、引用和紧凑卡片；有同目录同名图片时复用为封面，否则显示文字入口及使用说明。assistant 正文和 `ask_user_question` 参数中的文件引用均可收集，待回答的问题不必等工具结束。明确的 Markdown 链接还支持未知格式和目录；引用须对应真实项目文件。

「启动／打开」通过 `POST /studio/api/artifact-open` 调用本机 macOS 的系统打开服务，效果相当于双击文件或目录；「定位」通过 `POST /studio/api/artifact-reveal` 在 Finder 选中入口，作为备用方式。接口校验本机同源、项目边界及真实路径，用参数数组调用 `open`／`open -R`，不接受命令或启动参数。只有用户点击才打开，卡片展示不启动游戏、不生成截图。非 macOS 部署明确报不可用；需重新加载后端才能使用新路由。

### 统一产物协议（2026-09-30）

节点可选用 `present_artifact` 提供 entry、title、cover、description、opening，或在正文中给出 Markdown 文件链接；finish 的 `files`（2026-10-22）同样作「交付入口」，先按调用时的目录认，那里没有再按项目根。成功回执 `artifactVersion:1` 与 artifact 是明确展示的事实，无额外清单、数据库或模型上下文注入；正文引用不冒充工具回执。Studio 合并同入口，并沿用最近一次明确展示的名称和说明；自动发现继续覆盖旧会话。文件、目录、未知格式、HTTP(S) 地址共享卡片。汇集阶段只对本地入口验证存在，任务廊可见时才按需生成内容预览；预览失败回退文件信息。点击预览或「打开」才打开原件，沿用声明的网页、系统打开或 Finder 定位方式。

工具参数与校验归 node 的 `src/产物.js`，工具说明归 prompt。新格式无需新增展示分支：未知格式默认 reveal，也可明确选 system；特殊内置预览能力仍须单独实现。`GET /studio/api/artifact-entry` 为正文链接检查存在与项目边界，规范化相对／绝对路径、URL 编码和行号，并返回与卡片相同的打开策略。对话 Markdown 渲染器以可点击名称显示链接，HTTP(S) 在浏览器打开，本地文件复用产物打开通道；空格或括号路径可用尖括号包裹。现有会话在重新加载服务后获得工具；不改历史回执，旧节点未明确引用的未知格式不保证自动发现。

正文与工具头部点击附带原生 `seq/callId`，服务端按该条引用或调用时目录定位；之后切目录不改变旧链接目标。新模型展示回执提供本地绝对入口，画廊兼容新绝对和旧项目相对回执，声明与界面路径统一规范为项目相对。

## 文件浏览器

`GET /studio/api/files?根=项目&session=<id>&位置=<相对目录>` 只列这一层的直属条目，位置为空时列根。项目根仍从会话 header.cwd 认定；拒绝绝对位置、父目录与指向根外的符号链接。读取失败明确返回错误，不当作空目录。目录优先、名称自然排序，隐藏 Finder 的 `.DS_Store` 与 Git 管理条目；原生 `.agents` 只开放 worktrees 及其中普通目录，系统文档和其他普通目录照常浏览。

前端展开目录时再读取，没有整个项目的 4000 条／八层截断，`node_modules` 也可展开。完整条目保留在内存，视口仅绘制附近的行；箭头键浏览、回车打开文件。展开与缓存按根／项目隔离；刷新保留展开、滚动与文件阅读页。面板可见时每五秒核对根和展开的目录，恢复窗口焦点时立即核对，关闭面板或隐藏页面时停止读取。


## 2026-10-01：右栏页签命名

右栏按 Brief / Chat / Artifacts / Trace / Feed 排列。节点信息按 helm／dock／run 展示身份、职责、做法、进展与交付（`src/节点信息.js`，`GET /studio/api/node-information`）；系统提示、出生包与系统启动原文不进入该投影；helm 独有的 `projectRequest` 从项目首节点的原始需求／开工起点读取，保留全文，不以当前阶段请求或工作文档回填；Chat 承载对话与消息输入；Artifacts 汇集真实文件和可预览产物；Trace 展示每轮每步的模型与工具执行过程；Feed 按轮查看输入／输出的节点信息往来。页签只改显示名称，正文说明仍用中文。

当前节点的 Context、累计 token 与费用在同一页签栏常驻；页签横向滚动时数值保持原位。顶栏 live 左侧常驻 7px 状态圆：无后台运行时白底灰边、静止；有后台运行时为绿实心呼吸，仅在大于 0 时显示数量。


## 2026-10-01：API 连接管理

顶栏和新项目表单均可打开 API 连接弹窗。支持 DeepSeek、OpenAI、Anthropic、OpenRouter、本地模型和自定义模板；可添加、编辑、搜索及删除连接。左侧点击连接即可编辑，右侧常驻小方形删除按钮；默认、内置、部署及项目正在使用的连接都可删除；删除确认显示在详情顶部。获取模型列表或手动维护模型 ID、名称、上下文与输出上限、图片输入和思考档位。模型列表获取与实际生成测试分别执行，测试会消耗少量 token。保存后刷新现有模型选择；可设置新项目默认模型，或沿用 `模型.改` 应用到当前项目。

`src/连接.js` 消费 dsh 现有 `settings`、`credentials`、`llm`、`sessionController`、`agentDefaultModel` 服务。配置写入本部署的 settings，Key 由 credentials 存储，不回传到页面，不写入浏览器存储。留空保留原 Key；替换 Key 使用独立托管凭据引用，保留环境凭据与原有 headers、compat、原生模型字段。版本冲突拒绝覆盖并清理临时 Key。删除连接不要求先切换默认或项目模型，也不自动迁移已有项目。内置／部署层用持久删除标记覆盖，模型目录过滤该连接，凭据引用改为未配置的专用入口，避免重启重新出现或回退到环境 Key。用户添加的连接直接移除；已删除的部署连接可用相同标识重新添加。模型单项移除仍校验现有引用。只清理不再被其他连接引用的 Blueprint 托管 Key。

`GET /studio/api/connections` 返回不含秘密的连接投影；`POST /studio/api/connections/{save,delete,discover,test,default}` 接受同源 JSON。发现与测试使用所选地址和协议，拒绝带密码的 URL，不自动转发重定向，限制请求大小、响应大小与超时。前端 `connections.js` / `connections.css` 复用当前中性配色，提供原生 dialog、键盘焦点、未保存修改确认与错误反馈。

核对：`node --test blueprint/packages/studio/连接.test.js`。新增路由首次部署需重启 Studio，后续连接保存即生效。

SYS 正文字数取该条 `system/message`；工具定义按最近 `request/header` 的紧凑 JSON 计量，动态提示按该请求之前的原生活动 surface 计算上下文文字消息，排除用户原话、工具结果及压缩摘要。原生与历史消息都通过 context 的纯消息入口读取。不能重建时显示未知。当前磁盘来源文件保留独立查看入口，不计入上述字数；字符数不表示 token 用量。

## 2026-10-12：原生会话观察

历史、材料、产物与树的账本读取共用 `sessionQuery.observeSession`。事件、原生 seq 与继承长度来自同一截面，读取后释放租约；冷会话不发布 Session，不创建 Agent，也不写回原生为中断轮补齐的收尾。冷读取校验与全文缓存归原生服务，Studio 不再保留第二份全文缓存。

树保留已有的瘦投影，以原生 cursor／revision 与 Session 实例判断是否变化，并逐事件折入新增事实。未变化时不访问惰性的 events；只刷新树时跳过当前会话正文。重建实例、缩短截面和冷 revision 变化会重新折叠，冷分叉的继承段不重复归属或计量。

真实引擎测试确认 0.1.5-rc.2 与 0.2.1-alpha.2 的只读截面语义都可用。alpha 以稳定的 persistence identity 命中原生冷缓存；旧版代理身份导致这项缓存未命中，因此切换前旧引擎的重复冷读仍有解压成本。检查：`node --test blueprint/packages/studio/原生会话观察.test.js blueprint/packages/studio/会话观察引擎.test.js blueprint/packages/studio/实时输出.test.js`。

node_doc 沿用原生会话展示，在 viewer 中默认归入动作组，展开显示节点文档原文；它不进入产物投影，也不生成文档卡。strategy、note、shelve 分别标为校准定稿、纸条、上架。名册去掉的整棵分支在树上显示灰色，文档、产物与会话入口仍保留。

### 图纸与节点信息的读取链路（2026-10-15）

`history?要=目录` 只读取项目目录，`要=身份` 沿原身份投影返回身份，不折叠或附带对话正文；原 `要=树／全／对话` 响应仍保留。图纸与 SSE 树更新取得一次新鲜原生 persistence.list 快照，冷节点复用该次观察的 revision，与同一存储实例的瘦投影比较；版本变化仍经原生只读校验重读，缺失快照回到原生 stat。活会话继续读原生观察截面，运行、待回答和名册状态判据不变。并发目录扫描合并，普通目录沿原有 1500ms 有效期，图纸不复用过期版本。

本机同项目对照：10-12-5 的 13 个节点，优化前 5 次图纸读取中位数 1288.5ms；优化后进程内已有投影时 4 次中位数 433.9ms（359.8–678.4ms）。身份页中位数 43.5ms → 16.0ms，返回 811128 → 1990 字节。整棵图纸、项目节点运行值和身份内容逐字段一致，107 项相关测试通过。这一轮优化时测到服务重启后的首次冷读 4277.4ms，其中原生历史恢复约 3891ms；下述原生并发优化继续处理这部分，该冷读不计入后续读取中位数。以上是接口计时，不含浏览器绘制，也不作为时延保证。

首次冷读继续优化（2026-10-15）：原生历史迁移中多个节点同时确认子会话目录，改为合并进行中的同源扫描；会话头最多 16 份并行读取，仍按原目录顺序执行身份、重复 ID 与错误判定。目录与迁移校验每次都重新观察文件（会话头按文件身份记住见下一段）；不把旧树直接显示为新树，不迁移写回用户账本。补丁随固定引擎接线，详见 `app/scripts/native-read-patch.mjs`。

原生并发优化验收：同一 13 节点项目，两次分别重启服务后立即读取图纸，首个 HTTP 请求为 1483.5ms、2950.3ms（前次基准 4277.4ms），其中节点历史恢复为 1118.9ms、1996.3ms。原生目录实际扫描从 23 次降至 5 次；相邻对照恢复的事件和继承长度逐项一致，项目 19 份原账本哈希未变，显示状态一致。回归 132 项中 130 项通过，剩余为源码 profile 启动检查无输出、已移除工作量分类的旧 Run 断言；冷读、取消、迁移、打包接线专项 23 项通过。并行负载造成明显计时波动，以上为本机接口计时，不含浏览器绘制。

列目录与冷读再提速（2026-10-15 晚）：

- 原生补丁（同一份 `app/patches/native-read-0.2.1-alpha.2.patch`）：会话头按文件身份（dev/ino/大小/修改与变更时刻）记住，每次列举仍逐个 stat，身份一变即重读；目录与按 ID 查账本改并行探（仍做旧布局拒绝与重复 ID 判定）；`list()` 用同一次观察算语料版本与快照版本，不再扫第二遍。764 份账本的克隆数据上逐项对照：`list()` 结果 764/764 一致，24 份账本只读打开的事件哈希全一致；`list()` 345ms → 42ms，单份冷读平均 426ms → 101ms。
- 画树摘要落盘（`src/树摘要盘.js`）：冷节点的瘦账写到账本旁的 `<DSH_HOME>/storages/blueprint_tree/<会话>.json`，钥匙是原生版本号＋瘦账格式指纹，一字不差才用；读坏、写不进都回到现读。旧格式（v3）账本的版本号带全库语料指纹，任何账本一写就变，所以旧项目只在账本都没动过时命中；新项目（v4）稳定命中。
- 实测（克隆数据、无模型钥匙、接口计时不含浏览器绘制）：重启后首开项目 1.0–4.9s → 0.07–0.11s（盘上已有摘要时）；再开同一项目 0.16–0.36s → 0.06–0.08s；点节点（旧格式 10-12-4）0.6–1.2s → 约 0.2s。65 个项目的整棵树在「盘上摘要」与「现读账本」两种情况下 `lineage` 逐字段一致。
- 没做：树回包仍带全机会话名单（约 257KB），删它要动前端；dsh 冷读缓存只留 2 份，后台预热节点帮不上点节点。

## 项目顶栏计量（2026-10-15）

`history?要=项目统计` 只读原生项目成员的瘦账，复用项目操作的归属边界，覆盖帮手会话、分叉与重启前会话，不受图纸 300 节点限制；种子继承按原事件下标去重，并补入有用量的压缩摘要。瘦投影保留请求开始时间、步号和压缩用量，不恢复冷 Agent。并发读取最多 4 条，统计不折叠或传输正文。读取失败与缺少用量保留缺口，不能当作零。运行时长复用项目工作计时：至少一个原生节点实际运行或外部 run 进程在做事才累计，并发取并集。待用户回答或审批的节点不计时；问题发出、答复与外部 run 开停都立即校准计时，全部停止或等待时暂停。

`项目计量.js` 仅为 DeepSeek 官方域名连接估算调用费用；第三方提供的同名模型不套官方价格。单价与峰谷规则来自 `单价.json` 的 `官方分时` 字段，缓存命中、未命中、写入和输出分别计算，推理 token 不重复累加。北京时间周一至周五非中国节假日 09:00–12:00、14:00–18:00 为高峰，其余半价；2026 假期按国务院安排维护，未知年份不猜。当前可靠价格版本自 2026-09-10 12:00（北京时间）起：缺请求时间、跨价段、早于版本或未知模型的记录计入总 token、单独标记未计价；估算不是账单。Flash 旧模型名按官网说明映射当前 Flash，Pro 保留独立价格。旧 `价` 字段与其他模型的原牌价语义保留。

项目管理的删除使用 RPC `project.trash`（`projectSessionId`、`projectPath`、`requestId`）。真实目录从原生项目会话读取，由 node 停稳和验证后移入系统回收站；待回答记录在移动前关闭，成功后解除图纸监听。自动分组核验删除状态和目录仍在原位，防止并发扫描重新登记。项目目录、作品和系统文档整体移动，原生会话日志保留。

项目保存位置：`GET/POST /studio/api/project-storage` 读取／更改默认位置，POST `{action:"open"}` 在访达中打开后端当前位置。应用数据目录中的 `项目存储.json` 保存默认位置、版本与全部历史位置，默认文稿 `Blueprint/项目`；旧数据目录的 `项目/` 始终作为历史位置保留。创建固定请求开始时的位置与版本；扫描、文件访问、回收站、连接引用与计时按所有已知位置认项目，换默认位置不迁移旧项目或改变其 cwd。

`/studio/api/collab`（2026-10-29，协 7，取代 `POST /studio/api/solo`；`src/协作入口.js`）：GET `?session=` 读这一阶段的协作表（`node/src/协作设置.js` 的 `读协作设置`：preset、ask、helm、parts、blocks、columns），图纸也从 `tree.collab` 拿同一份。POST 按传入会话核验项目，一次改一处：`{preset}` 填满整张表、`{ask:'ask'|'self'}` 换过程中问不问（写 helm 行 stageMode build／solo，spark 交完的不改写）、`{who, point, on}` 点一格（who 是 helm、parts 或一个 dock 的编号）。存下后推送图纸更新，再跑一遍 `通过项目待审核` 和 `复查项目等待`：按新的表放行此刻挂着的——方案审核看那个节点还勾不勾「计划」，别的提问和原生权限只在改成自己判断时代答，等用户回话的那一点被关掉就放行；回最新的表和放行了几处。其他项目和已保存的用户回答保留；自动答复明确记为系统来源，恢复失败保留收据供重试。节点不能自行改写名册。
