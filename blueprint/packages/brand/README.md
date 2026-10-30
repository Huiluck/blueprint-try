# @blueprint/brand

仅浏览器品牌槽位。侧栏与对话首页的标志取字标首字 B，置于直角黑底；侧栏名称使用 `viewer/blueprint-wordmark.svg` 的原字标。`生成.mjs` 将 SVG 和浏览器图标 `viewer/favicon.png` 内嵌为 data URL，无额外静态路由。标签页与 Apple 图标复用 192px 黑底白色 B 方标，固定标签页使用同形的单色 B；品牌 effect 统一替换原生图标入口，卸载时恢复。

另挂一个 `priority: 1` 的 `root` 占位。开发时 layout 热重载要先撤旧 root 再挂新 root，空档里 dsh 的 `RootOutlet` 找不到 root 会抛 `SlotAssemblyError`，整页卸掉白屏，新 layout 挂上也画不回来；有占位时空档里画「界面正在重新加载…」（10 秒没回来改成提示刷新），平时被 layout（priority 0）压着看不见。brand 很少重建，所以占位放在这里。重载后 layout 回到项目首页（store 新建，默认 `home: true`）。

`ui-conversation` 的 `hero.headline` 没有可覆盖槽位；当前 locale 服务的 `register()` 拒绝同 namespace、同 locale 的重复注册，未提供覆盖接口。因此保留「探索未至之境」，不修改 DOM 或上游包。窗口标题由 layout 的 `DocumentTitle` 固定为 `Blueprint`，不随会话或面板切换。

```sh
node blueprint/packages/brand/生成.mjs
```
