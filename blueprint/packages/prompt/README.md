# @blueprint/prompt

本包保存模型文字与读取函数，不是插件。消费本地文本和 YAML，提供 canon、节点本体技能、工具说明、机器模板及统一提示装配清单；context 负责装配，node 和 brain 填写原文模板。模型文字的唯一来源在本包。

## 文字与接口

| 入口 | 内容 |
| --- | --- |
| [src/index.js](src/index.js) | 一段、说明书、技能正文、提示结构、节点本体技能名及工具结果形状 |
| [src/路径.js](src/路径.js) | 源码／应用数据位置与项目临时目录 |
| [src/项目技能.js](src/项目技能.js) | 项目工具类 skill 选择与退役入口过滤 |
| [shells/核心.md](shells/核心.md) | 系统目标、三个圈、三个嫁接点、组织生长与节点账本 |
| 公共前缀、使用情境 | 共用的操作提醒与使用背景 |
| [shells/开头.md](shells/开头.md)、节点前缀、请求及叫醒模板 | 机器填原文和动态事实 |
| [shells/上下文提醒.md](shells/上下文提醒.md)、上下文续工摘要 | context 过提醒线时的读数；节点用 compact 收起后，它写的要点放进重组的底座 |
| [skill/orient/SKILL.md](skill/orient/SKILL.md)、what、execute | 粗略估计、经验粗评、实际执行各自的工作目标与思考问题，永远可读 |
| [工具/strategy.md](工具/strategy.md)、[shells/叫醒/差异判断.md](shells/叫醒/差异判断.md) | 校准定稿与差异判断的工作目标、思考问题及提交入口 |
| [工具/](工具/) | publish、wait、compact、node_doc、shelve 与操作工具说明（divide、note、finish 等有新版的在 `重置/工具/`） |
| [能力依赖.json](能力依赖.json) | 工具类技能的依赖条件 |
| [助理/AGENTS.md](助理/AGENTS.md) | 右上角「帮助」那条普通 dsh 会话的说明：studio 每次打开帮助时抄进数据目录的 `助理/`，dsh 从工作目录读；节点不读 |

目标版本文字的初版来自 [第十四件附录A](../../../回收站/旧系统-2026-10-15/根目录/工单-第十四件-目标版本.md)，此后由用户按真跑效果修改；实现时不改写，只填变量；不在代码里拼额外模型规则。模板漏占位或读取不到正文时报错。协作模式目录统一提供界面选项与模型原文：co-create、solo（2026-10-18 起，协议 2.18；旧名 conduct、light-collab、execute、high-collab 按 co-create 读），各引用自己的一份提示词，模型看到的模式就是用户选的。`工具/原生工具文案.json` 不再有 ask_user_question。以 spark 开工的分身读 `重置/阶段/spark.md`。

工具类目录有 22 个入口，按项目选择与实际依赖进入模型目录。情境组合在 `viewer/project-presets.js`，按工作目标分为办公、游戏、设计、视频、小说、3D、文档；办公有独立的资料、数据与图表组合。游戏覆盖 Godot 工程与 Phaser 网页 2D，3D 覆盖 Godot 实时场景与 Three.js 网页展示，摘要明确各自交付用途。Phaser、Three.js 与 HTML 时间轴的浏览器资源随工程分发，小说材料与修订使用独立 Node 脚本，办公读取使用固定 MarkItDown 依赖，PPT 保留可编辑工程。共享能力复用同一入口；相似设计资料统一为 OpenDesign，旧 UI UX Pro Max 与 Explainroo 选择在 `src/项目技能.js` 映射到保留入口，其旧辅助文件继续保留，SKILL 入口已撤下。各技能只提供领域 context 和可执行资料，节点组织、任务文档和交回方式沿用现有系统。

how 的取材评估入口已移至仓库回收站；旧项目选择与共享目录中的残留 how 不再加载。

核对：`node --test blueprint/packages/prompt/*.test.js`，含目标版本原文与节点本体技能入口检查。
