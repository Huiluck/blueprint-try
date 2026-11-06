# Blueprint 引擎迁移到 DSH 0.2.1-rc.5 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Blueprint 的内置 DSH 引擎从 `0.2.1-alpha.2`+5 补丁迁移到系统官方 `0.2.1-rc.5`，删除 Blueprint 自己的聊天 provider 配置链路改为直读系统 DSH 的 provider/模型目录，并保留音视频输入、外部 worker 列表、会话读恢复、文档预览超时、工具参数 JSON 修补五项能力。

**Architecture:** 所有 `@deepseek-ai/dsh-*` 依赖与 peerDependencies 精确固定到 `0.2.1-rc.5`；5 个引擎补丁按"版本→补丁文件"映射新增 rc.5 版本（保留 alpha.2 历史文件）；新增 `app/runtime/system-providers.mjs` 从系统 DSH home 只读导入模型路由行并指向系统凭据文件；Studio/前端删除聊天 provider 写入口，仅保留只读展示与媒体服务管理；客户端 bundle 由各包 `生成.mjs` 基于 rc.5 上游重新生成。

**Tech Stack:** Node.js 22.23.3（内置）、Electron 44.5.1、Cordis 插件、DSH `0.2.1-rc.5`、GNU patch、node:test、纯 JavaScript（ESM，无编译步骤）。

**Spec:** `docs/superpowers/specs/2026-11-06-rc5-engine-migration.md`

## Global Constraints

- 引擎：所有 `@deepseek-ai/dsh-*` = `0.2.1-rc.5`（精确版本，不用 `^`/`~`）；`@deepseek-ai/dsh-llm` 是版本唯一来源。
- Cordis 家族：`@deepseek-ai/cordis@4.0.5`、`@deepseek-ai/cordis-plugin-group@1.0.5`、`@deepseek-ai/cordis-plugin-include@1.0.10`、`@deepseek-ai/cordis-plugin-loader@1.0.6`、`@deepseek-ai/cordis-plugin-timer@1.1.7`、`@deepseek-ai/schemastery@3.18.5`；删除 `cordis-plugin-hmr` 覆盖项。
- 内置 Node `v22.23.3`；Electron `44.5.1`；平台 win32 x64/arm64 与 darwin arm64。
- 纯 JavaScript/ESM，无编译步骤；`client.js` 由 `生成.mjs` 生成并提交，生成器必须幂等。
- 中文注释、中文标识符沿用现有风格；**不得修改** `blueprint/packages/prompt/重置/` 下的提示词文本。
- 补丁通过 GNU patch `-p0` 应用（部分脚本沿用 `-F0`）；Windows 需要 Git for Windows 的 `patch.exe` 或 `BLUEPRINT_PATCH` 环境变量。
- 系统 DSH 配置只读导入：默认 home `%USERPROFILE%\.dsh`、profile `desktop`；环境变量覆盖 `BLUEPRINT_SYSTEM_DSH_HOME`、`BLUEPRINT_SYSTEM_DSH_PROFILE`。
- 媒体服务（`kind='media'`）保留完整增删改测能力，不迁移。
- 分支 `r1/rc5`；每个任务独立提交；里程碑后推送到 `try`（https://github.com/Huiluck/blueprint-try.git）。
- Blueprint 源码 AGPL-3.0-only；DSH MIT 声明保留。

## Review Focus

实现与验收时必须覆盖以下五类最可能伤害真实用户的情况（每条已在对应任务中安排测试）：

1. **系统 DSH home 缺失或配置损坏**：应用必须启动并显示"请先在 DSH 中配置模型"的空态，不能崩溃或白屏（Task 9、12 测试）。
2. **OAuth/原生 provider（`llm-deepseek-account`）出现在目录但调用会失败**：只读列表不能把"有 Key 才算就绪"错当成"provider 已可用"，UI 不得假装 ready（Task 9、12 测试）。
3. **补丁应用幂等性与混装版本**：重复 prepare 必须是无操作；部分应用、版本不一致必须明确拒绝并给出可操作报错（Task 4–8 测试）。
4. **alpha.2 时代的旧项目/旧会话被 rc.5 读取**：必须能加载或明确报错，不能静默损坏（Task 14 验收清单）。
5. **Windows 没有 `patch.exe`**：构建必须失败并给出安装 Git for Windows 或设置 `BLUEPRINT_PATCH` 的明确提示，不能静默跳过补丁（Task 3 测试）。

---

## 文件结构总览

**新增：**
- `app/runtime/system-providers.mjs` — 读取系统 DSH profile 的模型路由行与凭据路径
- `app/tests/system-providers.test.mjs`、`app/tests/engine-version-pin.test.mjs`、`app/tests/blueprint-peer-versions.test.mjs`、`app/tests/patch-command.test.mjs`、`app/tests/layout-generator.test.mjs`、`app/tests/connections-readonly.test.mjs`
- `app/patches/multimodal-0.2.1-rc.5.patch`、`native-external-0.2.1-rc.5.patch`、`native-read-0.2.1-rc.5.patch`、`preview-read-recovery-0.2.1-rc.5.patch`、`tool-json-repair-0.2.1-rc.5.patch`

**主要修改：**
- `app/package.json`、`app/package-lock.json`、`app/runtime/composition.mjs`、`app/runtime/backend.mjs`、`app/scripts/{multimodal,native-external,native-read,preview-read-recovery,tool-json-repair}-patch.mjs`、`app/scripts/patch-command.mjs`、`app/README.md`
- `blueprint/packages/{context,node,studio}/package.json`（peerDependencies）
- `blueprint/packages/layout/生成.mjs`、`模型就绪.js`、`项目管理.js`、`助理.js`、`表单生成.mjs`；删除 `模型引导.js`、`模型引导.css`；重新生成 `client.js`
- `blueprint/packages/studio/src/连接.js`、`src/index.js`；`studio/连接.test.js`
- `viewer/connections.js`、`viewer/studio.html`、`blueprint/packages/media/生成.mjs` 与其生成的 `client.js`
- 测试：`app/tests/{composition,model-catalog,packaging-engine,source-profile-runtime,multimodal,native-external,native-read-patch,preview-read-recovery,tool-json-repair-patch,external-provider-assets}.test.mjs`，`blueprint/packages/layout/模型就绪.test.js`

---

## Task 1: 引擎与依赖锁定到 rc.5

**Files:**
- Modify: `app/package.json`、`app/package-lock.json`、`app/overrides`（即 package.json 内 `overrides`）、`blueprint/package.json`（@blueprint/bundle 的 peerDependencies）、`blueprint/packages/context/package.json`、`blueprint/packages/node/package.json`、`blueprint/packages/studio/package.json`
- Test: `app/tests/engine-version-pin.test.mjs`（Create）、`app/tests/blueprint-peer-versions.test.mjs`（Create）、`app/tests/packaging-engine.test.mjs`（Modify：版本常量改为读 manifest）

**Interfaces:**
- Consumes: `expectedEngineVersion(manifest)`（`app/scripts/source-cli.mjs`）继续从 `dependencies['@deepseek-ai/dsh-llm']` 取版本。
- Produces: `app/package.json` 中引擎依赖与 overrides 全部为 `0.2.1-rc.5`；`blueprint/package.json`（bundle）与 `blueprint/packages/{context,node,studio}` 的 peerDependencies 为 `0.2.1-rc.5`（`schemastery` 为 `3.18.5`）。

- [ ] **Step 1: 写失败测试**

`app/tests/engine-version-pin.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
const ENGINE = '0.2.1-rc.5'

test('全部引擎依赖与 overrides 精确固定到 rc.5，且没有 alpha 残留', () => {
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.overrides })) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, ENGINE, `${name}`)
  }
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.overrides })) {
    assert.ok(!String(version).includes('alpha'), `${name} 仍有 alpha 版本 ${version}`)
  }
  assert.equal(manifest.dependencies['@deepseek-ai/cordis'], '4.0.5')
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '3.18.5')
  assert.equal(manifest.dependencies['@deepseek-ai/cordis-plugin-timer'], '1.1.7')
  assert.equal(manifest.overrides['cordis-plugin-hmr'], undefined)
})
```

`app/tests/blueprint-peer-versions.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))

test('Blueprint 包 peerDependencies 对齐 rc.5', async () => {
  for (const name of ['context', 'node', 'studio']) {
    const manifest = JSON.parse(await readFile(join(repo, 'blueprint/packages', name, 'package.json'), 'utf8'))
    for (const [dep, version] of Object.entries(manifest.peerDependencies || {})) {
      if (dep.startsWith('@deepseek-ai/dsh')) assert.equal(version, '0.2.1-rc.5', `${name}:${dep}`)
      if (dep === '@deepseek-ai/schemastery') assert.equal(version, '3.18.5', `${name}:${dep}`)
    }
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/engine-version-pin.test.mjs tests/blueprint-peer-versions.test.mjs`
Expected: FAIL（出现 `0.2.1-alpha.2` 或 alpha 版本）

- [ ] **Step 3: 修改清单并安装**

把 `app/package.json` 的 `dependencies`、`overrides` 中所有 `0.2.1-alpha.2` 改成 `0.2.1-rc.5`；cordis 家族改成 Global Constraints 的精确版本；删除 `overrides['cordis-plugin-hmr']`；保留 `overrides['@openai/codex'] = '0.163.0'`。把 `blueprint/package.json`（@blueprint/bundle）与 `blueprint/packages/{context,node,studio}/package.json` 的 peerDependencies 同样改到 rc.5 / schemastery 3.18.5。同时把 `app/tests/packaging-engine.test.mjs` 顶部的 `const version = '0.2.1-alpha.2'` 改为从 `app/package.json` 读取（`manifest.dependencies['@deepseek-ai/dsh-llm']`），fixture 的 `overrides` 同步使用该版本。测试必须断言真实键：`overrides['@deepseek-ai/cordis-plugin-hmr'] === undefined`、`@openai/codex` 保留、group/include/loader/timer/schemastery 精确版本，以及 bundle manifest 的 dsh peers（用变异自测证明断言非空转）。

Run: `cd app && npm install`（需要网络；生成新的 `package-lock.json`）
Expected: 安装成功；`app/node_modules/@deepseek-ai/dsh-llm/package.json` 的 version 为 `0.2.1-rc.5`。

- [ ] **Step 4: 运行确认通过**

Run: `cd app && node --test tests/engine-version-pin.test.mjs tests/blueprint-peer-versions.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/package.json app/package-lock.json blueprint/packages/context/package.json blueprint/packages/node/package.json blueprint/packages/studio/package.json app/tests/engine-version-pin.test.mjs app/tests/blueprint-peer-versions.test.mjs app/tests/packaging-engine.test.mjs
git commit -m "rc5: pin engine and peer dependencies to 0.2.1-rc.5"
```

---

## Task 2: 客户端生成器解耦并按 rc.5 重新生成

**Files:**
- Modify: `blueprint/packages/layout/生成.mjs:8`、`app/package.json`（新增 `@deepseek-ai/dsh-client-ui-layout` 依赖，版本 rc.5）、重新生成的 `blueprint/packages/{layout,media,canvas,brand,feed,files,skill,workspace}/client.js`
- Test: `app/tests/layout-generator.test.mjs`（Create）

**Interfaces:**
- Consumes: `app/package.json` 的 `@deepseek-ai/dsh-client-ui-layout`（rc.5）。
- Produces: 所有 `client.js` 与 rc.5 上游一致且生成器幂等；`layout/生成.mjs` 不再依赖仓库内 `.dsh/profiles/web`。

- [ ] **Step 1: 写失败测试**

`app/tests/layout-generator.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const generator = join(repo, 'blueprint/packages/layout/生成.mjs')
const client = join(repo, 'blueprint/packages/layout/client.js')

test('layout 生成器可在仓库内运行且幂等', () => {
  execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
  const before = readFileSync(client, 'utf8')
  execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
  assert.equal(readFileSync(client, 'utf8'), before)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/layout-generator.test.mjs`
Expected: FAIL（`Cannot find module .../.dsh/profiles/web/package.json` 或上游接口报错）

- [ ] **Step 3: 解耦并重新生成**

1. `layout/生成.mjs` 第 8 行改为：
```js
const require = createRequire(new URL('../../../app/package.json', import.meta.url))
```
2. `app/package.json` 的 `dependencies` 增加 `"@deepseek-ai/dsh-client-ui-layout": "0.2.1-rc.5"`；`cd app && npm install`。
3. 逐个运行生成器：`node blueprint/packages/{layout,media,canvas,brand,feed,files,skill,workspace}/生成.mjs`。
4. 若 rc.5 上游 bundle 区域标记变化导致 `接缝不合`：只改 `生成.mjs` 中对应 marker/替换串，保持原有布局与行为语义；不允许改上游包内容。
5. 运行四次生成确认稳定，提交重新生成的 `client.js`。

Run: `node blueprint/packages/layout/生成.mjs && node blueprint/packages/media/生成.mjs && ...`
Expected: 每个生成器退出码 0。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/layout-generator.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add broad: app/package.json app/package-lock.json app/tests/layout-generator.test.mjs blueprint/packages/*/client.js blueprint/packages/layout/生成.mjs
git commit -m "rc5: regenerate client bundles from pinned engine packages"
```

---

## Task 3: 打包/启动管线在 rc.5 上跑通

**Files:**
- Modify: `app/scripts/patch-command.mjs`（新增 `assertPatchCommand`）、`app/scripts/prepare.mjs`（启动补丁前调用它）、`app/scripts/terminal-client-assets.mjs`（版本表 5 处 `0.2.1-alpha.2`/`4.0.5-alpha.1` → `0.2.1-rc.5`/`4.0.5`）、`app/tests/packaging-engine.test.mjs`（fixture 版本从 manifest 读取）、`app/tests/source-profile-runtime.test.mjs`（插件数量断言按 rc.5 修正）
- Test: `app/tests/patch-command.test.mjs`（Create）

**Interfaces:**
- Produces: `assertPatchCommand(environment = process.env): string` —— 返回可用的 patch 路径；找不到时抛出 `需要 GNU patch：安装 Git for Windows，或设置 BLUEPRINT_PATCH 指向 patch 可执行文件。`

- [ ] **Step 1: 写失败测试**

`app/tests/patch-command.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPatchCommand } from '../scripts/patch-command.mjs'

test('缺少 patch 时给出可操作报错', () => {
  assert.throws(() => assertPatchCommand({ BLUEPRINT_PATCH: 'C:/不存在/patch.exe' }), /Git for Windows|BLUEPRINT_PATCH/)
})
test('显式 BLUEPRINT_PATCH 优先', () => {
  assert.equal(assertPatchCommand({ BLUEPRINT_PATCH: 'C:/tool/patch.exe' }), 'C:/tool/patch.exe')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/patch-command.test.mjs`
Expected: FAIL（`assertPatchCommand is not a function`）

- [ ] **Step 3: 实现并接线**

在 `patch-command.mjs` 中：`assertPatchCommand` 先取 `patchCommand(environment)`，若返回 `'patch'` 且 `spawnSync('patch', ['--version'])` 失败则抛错（提示文案见 Interfaces）。`prepare.mjs` 在调用任何 `ensure*Patch` 之前执行 `assertPatchCommand()`。

- [ ] **Step 4: 在 rc.5 上跑通打包管线**

Run:
```bash
cd app
node --test tests/packaging-engine.test.mjs tests/patch-command.test.mjs tests/source-profile-runtime.test.mjs
npm run prepare:runtime
```
Expected: 测试 PASS（`source-profile-runtime` 在未准备源码 CLI 时自动 skip）；`prepare:runtime` 若因 5 个补丁尚未移植失败，记录失败项留待 Task 4–8；本任务只需确认 **patch 缺失提示** 与版本身份检查正确。

注意：`app/.build/runtime` 与 `app/dist/win-unpacked` 是 gitignored 的 alpha.2 旧产物，本任务重新生成前先删除/重建，避免用旧引擎误测；npm lock 重算后 `@earendil-works/pi-ai` 等非引擎版本有浮动，若 Task 14 真实 provider 冒烟异常，用 override 钉回或记录原因。另外：`prepare:runtime` 预期会在 5 个补丁（Task 4–8 尚未移植）处失败，失败信息必须是"尚未核对 DSH 0.2.1-rc.5"这类版本判定的明确报错；若在此之前失败于 `terminal-client-assets` 版本表、外部 provider 资产或生成器新鲜度，先在本任务修掉。`blueprint/packages/canvas/生成座位展示壳.mjs` 是手工开发工具（无脚本/打包/测试调用），本任务只需确认 prepare 链路不调用它，不修改。

- [ ] **Step 5: 提交**

```bash
git add app/scripts/patch-command.mjs app/scripts/prepare.mjs app/tests/patch-command.test.mjs app/tests/packaging-engine.test.mjs app/tests/source-profile-runtime.test.mjs
git commit -m "rc5: fail loudly when GNU patch is unavailable"
```

---

## Task 4: 音视频输入补丁移植（multimodal）

**Files:**
- Create: `app/patches/multimodal-0.2.1-rc.5.patch`
- Modify: `app/scripts/multimodal-patch.mjs`（版本映射）、`app/tests/multimodal.test.mjs`
- 目标包：`@deepseek-ai/dsh-llm/lib/index.js`、`@deepseek-ai/dsh-llm-pi-ai/lib/index.js`、`@earendil-works/pi-ai/dist/api/openai-completions.js`、`@earendil-works/pi-ai/dist/api/transform-messages.js`

**Interfaces:**
- Consumes: 现有 `inspectMultimodalPatch(nodeModulesRoot)` / `ensureMultimodalPatch(nodeModulesRoot)` 返回 `{engine, path, sha256, compatible, alreadyApplied, diagnostic}`。
- Produces: `multimodalPatchForVersion('0.2.1-rc.5')` → `app/patches/multimodal-0.2.1-rc.5.patch`；行为：模型 input 声明 audio/video 时保留 `FileBlock` 原件并在 openai-completions 路由序列化为 `input_audio`/`video_url`；工具图片带工具名、调用 ID 与原生句柄。

- [ ] **Step 1: 扩展失败测试**

在 `app/tests/multimodal.test.mjs` 的版本选择测试中加入：

```js
assert.match(multimodalPatchForVersion('0.2.1-rc.5'), /multimodal-0\.2\.1-rc\.5\.patch$/)
```
并把引擎 fixture 默认从 `.build/deepseek-harness-alpha-protocol` 改为 `fileURLToPath(new URL('../', import.meta.url))`（`engineRoot = appRoot`，`modules = join(appRoot,'node_modules')`），保留 `BLUEPRINT_MULTIMODAL_ENGINE_ROOT` 覆盖。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/multimodal.test.mjs`
Expected: FAIL（rc.5 未映射补丁 / `ensureMultimodalPatch` 报未核对版本）

- [ ] **Step 3: 移植补丁**

1. 以 `app/patches/multimodal-0.2.1-alpha.2.patch` 的注释与 hunk 为语义说明，对 rc.5 的四个目标文件重定位改动；保持原有实现（不改行为、不加新特性）。
2. 生成新补丁文件后，验证：
```bash
BLUEPRINT_PATCH=<patch.exe> node -e "import('./app/scripts/multimodal-patch.mjs').then(async m=>console.log(await m.ensureMultimodalPatch('./app/node_modules')))"
```
Expected: `alreadyApplied: true`，再次运行仍成功（幂等）。
3. `multimodal-patch.mjs` 的 `patchNames` 增加 `['0.2.1-rc.5', 'multimodal-0.2.1-rc.5.patch']`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/multimodal.test.mjs`
Expected: PASS（含音视频保留/序列化行为断言）

- [ ] **Step 5: 提交**

```bash
git add app/patches/multimodal-0.2.1-rc.5.patch app/scripts/multimodal-patch.mjs app/tests/multimodal.test.mjs
git commit -m "rc5: port multimodal audio/video patch"
```

---

## Task 5: 外部 worker 列表补丁移植（native-external）

**Files:**
- Create: `app/patches/native-external-0.2.1-rc.5.patch`
- Modify: `app/scripts/native-external-patch.mjs`（版本→文件映射）、`app/tests/native-external.test.mjs`
- 目标包：`@deepseek-ai/dsh-subagent/lib/index.js`、`@deepseek-ai/dsh-tool-subagent/lib/index.js`

**Interfaces:**
- Produces: `nativeExternalPatchForVersion('0.2.1-rc.5')`；`inspectNativeExternalPatch`/`ensureNativeExternalPatch` 签名不变；行为：`listExternalActivations(parentSessionId)` 可只读列出已公告的外部激活，`外部协助.js` 的 `读取外部协助/停止外部协助` 仍工作。

- [ ] **Step 1: 扩展失败测试**

在 `app/tests/native-external.test.mjs` 顶部把导入改为 `inspectNativeExternalPatch, ensureNativeExternalPatch, nativeExternalPatchForVersion`，并新增：

```js
test('rc.5 补丁映射存在且幂等', async () => {
  assert.match(nativeExternalPatchForVersion('0.2.1-rc.5'), /native-external-0\.2\.1-rc\.5\.patch$/)
  assert.equal((await inspectNativeExternalPatch(join(app, 'node_modules'))).compatible, true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/native-external.test.mjs`
Expected: FAIL（函数不存在 / rc.5 未映射）

- [ ] **Step 3: 移植补丁**

1. 把脚本的 `version` 常量改为 `const patchNames = new Map([...])` + `nativeExternalPatchForVersion(version)`，校验逻辑按传入引擎版本读取对应 `package.json`。
2. 按 alpha.2 补丁语义在 rc.5 的 `dsh-subagent`/`dsh-tool-subagent` 上重定位 hunk；保持"只读、不创建会话/不恢复执行"的契约。
3. 用 `ensureNativeExternalPatch(join(app,'node_modules'))` 应用并二次确认幂等。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/native-external.test.mjs`
Expected: PASS（外部协助读取/停止行为断言通过）

- [ ] **Step 5: 提交**

```bash
git add app/patches/native-external-0.2.1-rc.5.patch app/scripts/native-external-patch.mjs app/tests/native-external.test.mjs
git commit -m "rc5: port native external worker list patch"
```

---

## Task 6: 会话读恢复优化补丁移植（native-read）

**Files:**
- Create: `app/patches/native-read-0.2.1-rc.5.patch`
- Modify: `app/scripts/native-read-patch.mjs`、`app/tests/native-read-patch.test.mjs`
- 目标包：`@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js`

**Interfaces:**
- Produces: `nativeReadPatchForVersion('0.2.1-rc.5')`；`inspectNativeReadPatch`/`ensureNativeReadPatch` 签名不变；行为：目录观察合并、按 ID 并行查找、会话头文件身份缓存、`list` 用同一次观察计算语料修订（`corpusRevisionOf`）。

- [ ] **Step 1: 扩展失败测试**

在 `app/tests/native-read-patch.test.mjs` 增加：

```js
assert.match(nativeReadPatchForVersion('0.2.1-rc.5'), /native-read-0\.2\.1-rc\.5\.patch$/)
assert.equal((await inspectNativeReadPatch(join(app, 'node_modules'))).compatible, true)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/native-read-patch.test.mjs`
Expected: FAIL

- [ ] **Step 3: 移植补丁**

按 alpha.2 补丁语义（合并 `readdir` 观察、并行 `stat`、`corpusRevisionOf`）在 rc.5 的 `dsh-session-persistence-jsonl` 上重定位；脚本改为版本→文件映射；保持 `-F0` 参数。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/native-read-patch.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/patches/native-read-0.2.1-rc.5.patch app/scripts/native-read-patch.mjs app/tests/native-read-patch.test.mjs
git commit -m "rc5: port session read recovery patch"
```

---

## Task 7: 文档预览超时恢复补丁移植（preview-read-recovery）

**Files:**
- Create: `app/patches/preview-read-recovery-0.2.1-rc.5.patch`
- Modify: `app/scripts/preview-read-recovery-patch.mjs`、`app/tests/preview-read-recovery.test.mjs`
- 目标包：`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js`

**Interfaces:**
- Produces: `previewReadRecoveryPatchForVersion('0.2.1-rc.5')`；行为：读取超时取消旧请求、只重试一次、最终失败交给原生重试入口，并新增 `workspace-file/read-timeout` 错误文案。

- [ ] **Step 1: 扩展失败测试**

增加 `previewReadRecoveryPatchForVersion('0.2.1-rc.5')` 路径断言与 `inspectPreviewReadRecoveryPatch(join(app,'node_modules')).compatible` 断言；保留原有客户端行为断言（vm 加载 patch 后的 client.js）。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/preview-read-recovery.test.mjs`
Expected: FAIL

- [ ] **Step 3: 移植补丁**

按 alpha.2 补丁语义在 rc.5 的 documentpreview client 上重定位；脚本改为版本→文件映射。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/preview-read-recovery.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/patches/preview-read-recovery-0.2.1-rc.5.patch app/scripts/preview-read-recovery-patch.mjs app/tests/preview-read-recovery.test.mjs
git commit -m "rc5: port document preview read timeout recovery patch"
```

---

## Task 8: 工具参数 JSON 修补补丁移植（tool-json-repair）

**Files:**
- Create: `app/patches/tool-json-repair-0.2.1-rc.5.patch`
- Modify: `app/scripts/tool-json-repair-patch.mjs`、`app/tests/tool-json-repair-patch.test.mjs`
- 目标包：`@deepseek-ai/dsh-llm-deepseek/lib/index.js`

**Interfaces:**
- Produces: `toolJsonRepairPatchForVersion('0.2.1-rc.5')`；行为：字符串内真换行转义、结尾未收的引号/括号补齐、收尾后多余右括号去除、提前收尾的括号与后续键接回；修不好时错误信息包含工具名、文件与坏点。

- [ ] **Step 1: 扩展失败测试**

增加路径映射断言与 `inspectToolJsonRepairPatch(join(app,'node_modules')).compatible`；保留原有各 malformed JSON 用例（含 10-16/10-17/10-21 三类真实坏法）。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/tool-json-repair-patch.test.mjs`
Expected: FAIL

- [ ] **Step 3: 移植补丁**

在 rc.5 的 `dsh-llm-deepseek` 上重定位修补函数与调用点；脚本改为版本→文件映射。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/tool-json-repair-patch.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/patches/tool-json-repair-0.2.1-rc.5.patch app/scripts/tool-json-repair-patch.mjs app/tests/tool-json-repair-patch.test.mjs
git commit -m "rc5: port tool arguments JSON repair patch"
```

---

## Task 9: 系统 DSH provider 导入模块

**Files:**
- Create: `app/runtime/system-providers.mjs`、`app/tests/system-providers.test.mjs`
- Modify: `app/runtime/composition.mjs`、`app/runtime/backend.mjs`、`app/tests/composition.test.mjs`

**Interfaces:**
- Produces（`app/runtime/system-providers.mjs`）：
  - `SYSTEM_PROVIDER_ROW_IDS = ['agent-default-model', 'llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']`
  - `systemDshHome(environment = process.env) -> string`（`BLUEPRINT_SYSTEM_DSH_HOME` 或 `join(homedir(), '.dsh')`）
  - `systemDshProfile(environment = process.env) -> string`（`BLUEPRINT_SYSTEM_DSH_PROFILE` 或 `'desktop'`）
  - `readSystemProviderRows({ environment = process.env } = {}) -> Promise<{ found, home, profile, patchPath, rows, credentialsPath, warning }>`（不抛异常；YAML 损坏时 `warning` 字符串、`found:false`）
  - `providerPatchRows({ rows, credentialsPath }) -> object[]`（白名单行 + `{ id: 'credentials', config: { path: credentialsPath } }`，仅在凭据文件存在时）
- Consumes（`composition.mjs`）：`readDesktopComposition({ resourceRoot, sourceRoot, promptDir, resolvePlugin, systemProviderRows = [] })`，`patches = [...patches, ...systemProviderRows, ...overrides]`。
- Consumes（`backend.mjs`）：启动时 `const systemProviderRows = await readSystemProviderRows()` 传入；删除 `补已有连接重试策略` 的导入与调用。

- [ ] **Step 1: 写失败测试**

`app/tests/system-providers.test.mjs` 覆盖：临时 home 放 `profiles/desktop/cordis.patch.yml`（含 `desktop-shell`、`agent-default-model`、`llm-pi-ai`、`llm-deepseek` 与无关行）+ `.credentials.yaml` → `found:true`、rows 仅白名单 4 类、`credentialsPath` 存在；home 不存在 → `found:false, rows:[]`；YAML 损坏 → 不抛、`warning` 非空；`providerPatchRows` 追加 credentials 覆盖行（无凭据文件时不追加）。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/system-providers.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现模块与接线**

新建 `app/runtime/system-providers.mjs`（使用 `yaml` 的 `parse`）；改 `composition.mjs` 签名与 patch 顺序；改 `backend.mjs` 传入并删除重试策略调用。`app/tests/composition.test.mjs` 增加一条：传入 `systemProviderRows` 时，其行出现在 `result.patches` 中且位于 host.json overrides 之前、credentials 覆盖行存在。

Run: `cd app && node --test tests/system-providers.test.mjs tests/composition.test.mjs`
Expected: PASS

- [ ] **Step 4: 验证无系统 DSH 时安全启动路径**

Run: `BLUEPRINT_SYSTEM_DSH_HOME=<不存在目录> node -e "import('./app/runtime/system-providers.mjs').then(async m=>console.log(await m.readSystemProviderRows()))"`
Expected: `found:false`，不抛错。

- [ ] **Step 5: 提交**

```bash
git add app/runtime/system-providers.mjs app/tests/system-providers.test.mjs app/runtime/composition.mjs app/runtime/backend.mjs app/tests/composition.test.mjs
git commit -m "rc5: import providers and credentials from system DSH home"
```

---

## Task 10: Studio 连接 API 只读化（聊天 provider）

**Files:**
- Modify: `blueprint/packages/studio/src/连接.js`、`blueprint/packages/studio/src/index.js`
- Test: `blueprint/packages/studio/连接.test.js`

**Interfaces:**
- Produces: `createConnectionManager(ctx, { projectRoot, fetch })` → `{ list, modelCatalog, save, remove, discover, test }`（删除 `setDefault`）；聊天行 `list().providers` 增加 `source:'system'`、`editable:false`、`deletable:false`、`writable:false`；`save/remove/discover/test` 仅接受 `body.kind === 'media'`，聊天请求抛 `new Error('对话模型由系统 DSH 配置，Blueprint 不提供修改入口。')`。
- 删除导出：`补默认重试策略`、`补已有连接重试策略`；`connectionHandler` 去掉 `default` 方法；`studio/src/index.js` 不再引用 `补已有连接重试策略` 与被删方法。

- [ ] **Step 1: 更新失败测试**

`blueprint/packages/studio/连接.test.js`：删除对 `补默认重试策略/补已有连接重试策略` 的导入；新增/修改：系统聊天行带 `source:'system'` 且 `editable:false`；`save({kind:'chat'})` 与 `remove({kind:'chat'})` 抛"由系统 DSH 配置"；媒体 `save/remove/discover/test` 仍工作（复用现有媒体 fixture）。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test ../blueprint/packages/studio/连接.test.js`
Expected: FAIL

- [ ] **Step 3: 实现只读化**

修改 `连接.js`：`list()` 的聊天行固定只读字段；`save/remove/discover/test` 开头分流 `if (body.kind !== 'media') throw ...`；删除 `setDefault` 与两处重试策略函数；`connectionHandler` 方法表去掉 `default`。修改 `studio/src/index.js`：删除 `default` 的动作分派与任何 `补已有连接重试策略` 引用。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test ../blueprint/packages/studio/连接.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add blueprint/packages/studio/src/连接.js blueprint/packages/studio/src/index.js blueprint/packages/studio/连接.test.js
git commit -m "rc5: make chat provider connections read-only, keep media CRUD"
```

---

## Task 11: 主界面连接管理改为媒体-only

**Files:**
- Modify: `viewer/connections.js`、`viewer/studio.html`、`blueprint/packages/media/生成.mjs`、重新生成的 `blueprint/packages/media/client.js`
- Test: `app/tests/connections-readonly.test.mjs`（Create）

**Interfaces:**
- Consumes: `/studio/api/connections` 只读聊天行（Task 10）。
- Produces: 连接管理弹窗只展示媒体服务 CRUD；聊天 provider 以只读列表呈现（名称/模型/active），并给出"在系统 DSH 中配置"提示；不再出现"添加 API/验证并连接/获取模型"的聊天入口。

- [ ] **Step 1: 写失败测试**

`app/tests/connections-readonly.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const source = await readFile(new URL('../../viewer/connections.js', import.meta.url), 'utf8')

test('对话模型连接不再提供写入口，媒体服务保留', () => {
  assert.match(source, /系统 DSH/)
  assert.ok(source.includes("kind === 'media'"))
  assert.ok(!source.includes("connections/default"))
})
test('媒体页生成器仍可用', () => {
  execFileSync(process.execPath, [new URL('../../blueprint/packages/media/生成.mjs', import.meta.url).pathname], { stdio: 'pipe' })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/connections-readonly.test.mjs`
Expected: FAIL（无"系统 DSH"文案 / 仍渲染聊天写入口）

- [ ] **Step 3: 改 UI 并重新生成**

`viewer/connections.js`：`renderList` 中聊天行只读渲染（无编辑/删除按钮，标注"系统 DSH"）；"添加 API"只创建媒体服务；聊天形式的 `save/delete/discover/test` 调用移除；保留媒体表单与动作。`viewer/studio.html`：连接页签/按钮文案改为"媒体 API"，聊天模型说明改为"模型 provider 在系统 DSH 中配置"。若 `media/生成.mjs` 的接缝校验失败，更新其 seam 列表与文案替换（不得改媒体页行为）。运行 `node blueprint/packages/media/生成.mjs`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/connections-readonly.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add viewer/connections.js viewer/studio.html blueprint/packages/media/生成.mjs blueprint/packages/media/client.js app/tests/connections-readonly.test.mjs
git commit -m "rc5: settings dialog manages media services only"
```

---

## Task 12: 聊天侧引导移除 + 模型就绪改为目录判定

**Files:**
- Delete: `blueprint/packages/layout/模型引导.js`、`blueprint/packages/layout/模型引导.css`
- Modify: `blueprint/packages/layout/模型就绪.js`、`项目管理.js`、`助理.js`、`生成.mjs`（删除对已删文件的读取）、重新生成的 `client.js`、`blueprint/packages/layout/模型就绪.test.js`

**Interfaces:**
- Produces: `模型就绪(list)` 与 `连接可用(row)` 只看 `active` 与 `kind !== 'media'`（**不再要求 `key.configured`**，Key 由系统 DSH 管理）；删除 `默认服务商/引导服务/引导草稿/测试请求/获取模型请求/保存请求/Key提示/连接错误` 等只服务于引导弹窗的导出；`创建前模型检查(list, model)` 返回 `{ready: !!model?.provider || 模型就绪(list), provider, row: null}`。

- [ ] **Step 1: 更新失败测试**

`blueprint/packages/layout/模型就绪.test.js`：删除被移除导出的用例；新增：系统行 `active:true, key.configured:false` → `连接可用/模型就绪` 为 true；无 active 行 → false；媒体行不计入。`项目管理.js`/`助理.js` 的引导分支改为按 `模型就绪` 显示空态文案。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test ../blueprint/packages/layout/模型就绪.test.js`
Expected: FAIL

- [ ] **Step 3: 实现并重新生成**

改 `模型就绪.js` 语义与导出；删 `模型引导.js/.css`；`项目管理.js` 中 `模型引导门` 用法改为"无可用模型时显示提示，不弹连接对话框"；`助理.js` 同；`生成.mjs` 删除 `modelGuide`/`modelGuideCss` 的读取与嵌入；运行 `node blueprint/packages/layout/生成.mjs`，确认 `client.js` 无 `bp-connect` 语法残留（允许空态提示）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test ../blueprint/packages/layout/模型就绪.test.js tests/layout-generator.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add blueprint/packages/layout/模型就绪.js blueprint/packages/layout/模型就绪.test.js blueprint/packages/layout/项目管理.js blueprint/packages/layout/助理.js blueprint/packages/layout/生成.mjs blueprint/packages/layout/client.js
git rm blueprint/packages/layout/模型引导.js blueprint/packages/layout/模型引导.css
git commit -m "rc5: remove chat provider onboarding; readiness follows system catalog"
```

---

## Task 13: 默认模型与项目模型选择清理

**Files:**
- Modify: `blueprint/packages/studio/src/index.js`（`connections.list()` 使用处、`llm.models` RPC）、`viewer/studio.html`（新建项目表单/模型选择/首页引导卡）
- Test: `app/tests/model-catalog.test.mjs`

**Interfaces:**
- Produces: 新建项目默认模型 = `modelCatalog().default`（无 default 时取第一个 active provider 的第一个模型）；删除"设为新项目默认模型"入口与对 `/api/connections/default` 的调用；项目 `系统文档/模型.json` 仍是 `{provider, model, reasoningEffort}`。

- [ ] **Step 1: 更新失败测试**

`app/tests/model-catalog.test.mjs`：改为断言 loader 在目录无 default 时回退到第一个 active provider 的模型；并断言 `viewer/studio.html` 中不再包含 `'connections/default'` 调用文本。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && node --test tests/model-catalog.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现清理**

`studio/src/index.js` 删除 `default` 动作分派与默认模型写回；`viewer/studio.html` 新建项目表单模型选择改为基于 `llm.models` 目录（默认/回退规则见 Interfaces），删除"设为默认模型"按钮与 `connections/default` 请求。用 `Select-String -Path viewer/studio.html -Pattern 'connections/default'` 确认无残留。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && node --test tests/model-catalog.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add blueprint/packages/studio/src/index.js viewer/studio.html blueprint/packages/layout/表单生成.mjs app/tests/model-catalog.test.mjs
git commit -m "rc5: default model follows system catalog"
```

---

## Task 14: 外部 provider 资产、Windows 打包与端到端验收

**Files:**
- Modify: `app/tests/external-provider-assets.test.mjs`（版本 fixture 改 rc.5）、`app/README.md`（引擎版本/系统 provider/补丁前置说明）
- 可选：`app/scripts/rc5-acceptance.mjs`（新增验收脚本；不要求提交）

**Interfaces:**
- Consumes: 前 13 个任务的成果。
- Produces: rc.5 的完整 `prepare:runtime` 产物、Windows 安装包、验收记录。

- [ ] **Step 1: 更新外部 provider 资产测试**

把 `app/tests/external-provider-assets.test.mjs` 中固定的 alpha.2 版本替换为 `0.2.1-rc.5`（或从 `app/package.json` 读取引擎版本）；Run：`cd app && node --test tests/external-provider-assets.test.mjs`，Expected: PASS。

- [ ] **Step 2: 全量测试**

Run: `cd app && npm test`（需要 `patch.exe`；设置 `BLUEPRINT_PATCH`）
Expected: 全绿；如有失败逐条修复后重跑。

- [ ] **Step 3: 构建**

Run:
```bash
cd app
npm run prepare:runtime
npm run dist
```
Expected: `.build/runtime` 生成；Windows 产出 `app/dist/Blueprint-<版本>-x64.exe`；`runtime-manifest.json` 的引擎版本为 rc.5，5 个补丁均 `alreadyApplied`。

- [ ] **Step 4: 端到端验收（人工清单，记录结果）**

1. 用系统 DSH（`~/.dsh`，profile `desktop`）配置至少一个可用 provider；
2. 启动构建后的 Blueprint：首页/新建项目能列出系统 provider 的模型；默认模型正确；
3. 创建最小项目，让一个 run 完成一次真实模型调用，确认交回协议正常；
4. 打开一个 alpha.2 时代创建的旧项目，确认会话可加载（或出现明确报错而非静默损坏）；
5. 五项能力抽查：音视频附件输入；Codex/Claude 外部 worker 列表可见；文档预览超时恢复；坏工具 JSON 修补日志；会话列表读恢复；
6. 媒体服务新增/测试一次。
7. 用内置 Node 22.23.3 复跑一次生成器幂等与关键测试（本机默认 Node 24 与锁定版本不同），并对 rc.5 聊天区做桌面 smoke（interrupted 轮折叠、过程组展开、renderFactorySlot、被移除的 openSkill/renderMessageImages 路径）。
Expected: 以上全部通过，或逐条记录失败项并回到对应任务修复。

- [ ] **Step 5: 更新文档、提交并推送**

更新 `app/README.md`：引擎版本 `0.2.1-rc.5`、系统 DSH provider 来源与环境变量、`patch.exe` 前置条件、验收命令。提交：

```bash
git add app/tests/external-provider-assets.test.mjs app/scripts/external-provider-assets.mjs app/README.md app/package.json app/package-lock.json
git commit -m "rc5: external provider assets, packaging and acceptance"
git push -u try r1/rc5
```

---

## 自检记录（作者填写，执行者不用改）

- [x] Spec 覆盖：D1→Task1；D2→Task1；D3→Task4–8；D4→Task9；D5/D6→Task10–13；D7→Task2；D8→Task3/14；验收标准 1–6→Task14 与各任务测试。
- [x] 每个补丁任务都有独立测试与幂等断言；provider 导入有缺失/损坏/无凭据分支测试；UI 只读化有静态与生成器测试。
- [x] 类型/命名一致性：`*PatchForVersion`、`readSystemProviderRows`、`providerPatchRows`、`createConnectionManager` 返回字段在各任务间一致。
- [x] 五条 Review Focus 均映射到具体任务测试（Task 3/4–8/9/12/14）。
