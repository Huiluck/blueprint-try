# @blueprint/context

本包是插件，消费 dsh 的 systemPrompt、agent/pre-step、工具与会话服务，只读 roster 和 prompt。提供稳定提示、动态节点背景、技能装配、工具文案、只读 blueprintToolCatalog 及纯消息读取，不写名册或工作文档。装配与重建分工见 [协议.md](../../../协议.md#22-提示与思考开头)。

模型看到的模式标记就是用户选的（co-create 或 solo），不再改写；工具目录除 run 外去掉 ask_user_question（协议 2.18）。

## 源码入口

| 文件 | 职责 |
| --- | --- |
| [src/index.js](src/index.js) | 身份与系统提示装配、动态背景恢复 |
| [src/拼.js](src/拼.js)、[src/恢复.js](src/恢复.js) | 节点前缀与原文背景 |
| [src/消息协议.js](src/消息协议.js) | 读取原生来源与一等 tool 消息；仅在读取边界兼容历史 v3 |
| [src/可调用工具.js](src/可调用工具.js)、[src/工具文案.js](src/工具文案.js) | 常驻／可调用分层、原文说明与只读工具目录 |
| [src/技能目录.js](src/技能目录.js)、[src/技能加载.js](src/技能加载.js) | 节点本体技能恒可用，项目工具类技能与依赖过滤 |

稳定装配清单由 prompt 的 `提示结构()` 提供，占位缺失报错。按等级装配：常规使用常规执行说明；复杂使用共用核心及复杂协助页，按需使用流程；run 只装自己一段、公共前缀和使用情境；旧困难按复杂运行。运行与 SYS 共用 `节点提示身份()`。节点前缀只提供请求原文、节点身份、自己的文档入口与产物空间，不扫描素材；run 不给文档入口（`节点前缀run` 模板，`节点前缀文()` 按类型选），给有派出者的节点（run、helm 派出的座位分身）的 node_doc 不带 brief（`有派出者的节点文档()`）。正式节点的总图景全文在系统提示装配时按当前项目重新读取，开场即可看到；节点总表不进运行背景（运行背景任何一段变了，dsh 都会整份再追加一次），由 node 的思考开头给出；组织情境同理，运行背景里只给 run（helm、dock 随思考开头给）；素材文件仍按问题读取，读取 skill 不另触发文件正文注入。思考开头与原生文档 compaction 后端由 node 提供，context 不写第二份认识存储。

项目工具类 skill 选择保存 `系统文档/技能.json`，按调用会话的原项目读取；原生 skill 发现仍跟随当前工作目录，实际依赖每步发现。节点本体技能不参与该开关。原生当前目录上下文保留，节点文档与正式产物空间提供绝对入口；旧重建 checkpoint 只替换身份前缀，保留其余原文和历史；压缩结束后刷新重建消息改由节点前缀来路＋重建标记承载（带原 compactionId），不在压缩事务外沿用原生 checkpoint 来源，否则 dsh 冷读判整本账损坏。读图适配见 [读图说明](../../../.dsh/读图说明.md)。

节点手里没有 Codex／Claude Code 的工具（叶 6：选了它们的 run 由它们自己当，node 的 `外部run.js` 启动）。用户在「Agent 选择」页给这个项目打开了至少一家时：divide 的 executor 那条和参数枚举只列打开了的（再加 `deepseek`，`执行者目录()`）；打开了哪几家、选择偏好那段（`shells/外部agent.md`，叶 5）不在每步的运行背景里，只拼在座位分身的 plan 阶段那一页底下（node 的 `选择机.js`，10-18 用户）；都关着一个字不出现。材料帮手的常驻定义和按需目录都不显示节点工具，实际调用仍由 node 的角色白名单拒绝。

dsh 自带的 `subagent`（run 开 run，2026-10-18）出现在 dock、run 的工具目录里；run 用它或 `subagent_fork` 开出来的会话（provider `spawn`／`fork`，`是子run()`）和批量帮助一样是帮手，节点专用工具、subagent 本身和只给 run 的工具都不给（`程序协助禁用工具`）。

run 照 dsh 标准模式补齐（2026-10-28）：roster 的 `只给run的工具`（ask_user_question、todo_write、present、exit_plan_mode、subagent_fork、send_message、interrupt_agent、list_agents、list_subagent_models）只进 run 的工具目录，run 不给 `compact`；dock 的 subagent 去掉 dsh 选模型的 provider／model／reasoning_effort 字段（`不选模型()`）；计划模式规则段 `plan:policy` 只在 run 的系统提示里放行（`run放行`）。

六个原生 `terminal_*` 工具沿同一按需目录呈现。`工具目录.guidance(name, agent)` 通过当前原生装配取得 `tool:pty` 原文，由 `tool_info` 附在对应工具说明里；不另存指引或修改 prompt 原文。工具直接呈现时保留原生指引，按需呈现时不重复常驻。

核对：`node --test blueprint/packages/context/*.test.js`。
