# Windows 沙箱隔离收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Blueprint 在 Windows 上的受限写边界可复现、可验证，并且在沙箱供给失败时绝不退化为不受限执行；修掉剩余两个隔离测试的失败，使全量套件达到 253 pass / 0 fail / 16 skip（269 tests）。

**Architecture:** 以 `@deepseek-ai/dsh-sandbox-windows-acl` 的 runner 契约（`--workspace/--temp/--mode/--` + 退出码 127 与 `windows-acl-run:` 失败签名）为一个新接缝，先写一个探针脚本 + 测试把“工作区内可写 / 外不可写 / 只读不可写 / 供给失败必须 fail-closed”固化成可重复证据；再按证据分两路收口：(a) 使用仓库树等非 FullControl 目录当工作区时，目录继承的 DACL 缺少 `WRITE_OWNER` 导致 `SetNamedSecurityInfoW Win32 5`，用 rc.5 随包诊断脚本在**非受限** PowerShell 中修复（当前全量测试数据根在 `%TEMP%` 下不需要）；(b) 受限子进程无法创建命名管道，而 Git 外部过滤器必须经 MSYS `sh` 执行，属 rc.5 文档化限制，按平台拆分 `native-worktree` 中的过滤器断言。最后加一条 fail-closed 回归测试并更新验收记录。

**Tech Stack:** Node.js 22.23.3（`node --test`、`node --import ./scripts/native-node-protocol-check.mjs?register`）、`@deepseek-ai/dsh-sandbox-windows-acl@0.2.1-rc.5`、`dsh-sandbox-local`、`dsh-ptc-runtime-node`、PowerShell 5.1+、Git for Windows。

**Spec:** `docs/superpowers/specs/2026-11-06-rc5-engine-migration.md`（设计）与 `docs/superpowers/specs/2026-11-07-rc5-migration-spec.md`（Out of Scope / Further Notes）、`docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md` §3（已知限制 1）与 §5（下一步建议 1）。

## Lead 复核记录（2026-11-07，Stage A）

- 起点：`r1/rc5` / `b6d1144`；宿主 Node v24.15.0；测试数据根 `%TEMP%\Blueprint 测试数据`（`app/scripts/test-runner.mjs` 与 `app/tests/project-fixture-root.mjs` 已统一）。
- Task 1 探针证据（`app/.build/windows-sandbox-probe/`）：workspace-write 下 `inside=written`、`outside=EPERM`、`runnerExit=0`、stderr 无 `windows-acl-run:`；read-only 下 `inside` 非 `written`。结论：ACL 供给与工作区/外部边界在本机（`%TEMP%` 下用户 FullControl 工作区）可用。
- 仓库树工作区负例：同一探针对 `app/.build/windows-sandbox-probe/sandbox/workspace` 复现 `windows-acl-run: SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`（`repo-tree-workspace-write.log`）；受控给该临时目录补 `LHUILAPTOP\Lhui:(OI)(CI)F` 后同一探针通过（`repo-tree-with-fullcontrol.log`，随后删除该目录，检出 ACL 未改）。成因：仓库树目录继承 `Authenticated Users:(M)`、缺 WRITE_OWNER。结论：`%TEMP%` 数据根不受影响；把仓库树目录当工作区时仍需 Task 2 的 ACL 修复。
- `native-ralph` 真实签名（临时插桩副本实测，副本已删除不提交）：`{"own":"written","machine":"written","host":"EPERM"}`。结论：失败点不是供给失败，而是项目根内“机器账本”（`系统文档/任务.db`）对 PTC 子进程可写——Windows ACL runner 只表达“可写根”，无法复现 macOS Seatbelt 的 `机器保护` 单文件 deny（`blueprint/packages/node/src/项目隔离.js` 的 `隔离规则`/`窗口隔离`；rc.5 sandbox README Known Limitations）。
- `SetNamedSecurityInfoW Win32 5` 的含义：只发生在缺 WRITE_OWNER 的非 FullControl 目录（历史上的仓库根 `项目`、以及上面的仓库树负例）；当前全量测试数据根在 `%TEMP%` 下供给正常，故 Task 2 对测试基线默认不需要执行，但若把仓库树/其他非 FullControl 目录当工作区使用，仍按 Task 2 执行诊断脚本修复。
- fail-closed 取证：Task 4 的用例已在 Stage A 用 scratch 副本预跑，结论：fail-closed 实质成立（PTC 未执行、目标文件不存在、错误以 result.error 暴露）；当前通道是 result.error.kind="worker-exit"（坏 workspaceRoot 在 realpath 处 ENOENT），不是 "sandbox-unavailable"。（证据 `app/.build/windows-sandbox-probe/fail-closed.log`）
- 交接清单 `docs/agents/lead-handoff-2026-11-07-rc5-migration.md` §3.4 对 `native-ralph` 的“ACL 供给失败”归因已被本记录取代。

## Global Constraints

- 受限子进程**绝不能**在 ACL/token 供给失败时以不受限身份运行；任何 `windows-acl-run: <detail>` / 退出码 127 都必须以错误暴露，不得吞掉或 fallback。
- 受限子进程无法创建命名管道（rc.5 文档化限制：libuv 管道 stdio 对受限孙进程不可用，MSYS `sh` 的信号管道同样如此），测试适配不算放宽产品边界，不得把它当产品回归。
- 所有测试都通过解析钩子运行：`cd app && node --import ./scripts/native-node-protocol-check.mjs?register --test <files>`；数据目录使用 `%TEMP%\Blueprint 测试数据`（或 `.build` 下受控目录）并在用例结束清理。
- 不得直接手改 `app/node_modules` 后不留痕；引擎层改动必须走 `app/patches/*.patch` + `app/scripts/*-patch.mjs` + `prepare.mjs` 接线（与五个既有补丁同一机制）。本计划默认不改引擎，只做环境修复与测试适配。
- 提交前 `git status` 干净；分支 `r1/rc5`，完成后推送 `try` 并评论 issue #1。
- 允许的 skip 仅限平台专属与缺少可选 primary runtime 资产；不允许新增“环境坏了就 skip”的宽泛跳过。
- 诊断脚本必须在**非受限**（普通用户）PowerShell 中运行；受限会话里运行会把它自身的限制误报为缺失权限。用户不提供时记录为未诊断，不得用受限运行结果冒充。

## Review Focus

- ACL 供给失败（`SetNamedSecurityInfoW Win32 5`）时是否真的阻止 spawn——这是最可能咬人的 fail-open 场景。
- 受限孙进程 `spawn(..., { stdio: 'pipe' })` 的 EPERM 与 MSYS `sh` 命名管道失败：测试或产品是否把“限制导致的失败”误判为“过滤器没执行”。
- 工作区根与私有临时根重叠、临时根位于工作区内部、跨卷路径、FAT 卷。
- 旧项目/数据目录被其他 AppContainer 工具（`S-1-15-2-*` ACE）打过包 SID 授权，导致受限子进程读不可用。
- 在受限会话里创建出来的目录被后续修复脚本当作“用户目录”处理时的边界（`-AllowRoot` 不得放大到祖先）。

---

### Task 1: 沙箱探针与边界测试（reproducible boundary evidence）

**Files:**
- Create: `app/scripts/windows-sandbox-probe.mjs`
- Create: `app/tests/windows-sandbox.test.mjs`

**Interfaces:**
- Produces: `runWindowsSandboxProbe(options) => Promise<ProbeResult>`，其中
  `options = { workspace: string, temp: string, mode?: 'workspace-write' | 'read-only', childTimeoutMs?: number }`，
  `ProbeResult = { platform: string, mode: string, workspace: string, temp: string, child: { inside: string, outside: string }, runnerExit: number | null, runnerStderr: string }`。
  探针以模块导出 + CLI 双形态提供；CLI 为 `node scripts/windows-sandbox-probe.mjs --workspace <dir> --temp <dir> [--mode workspace-write|read-only]`，stdout 输出 `ProbeResult` 的 JSON。
- Consumes: `@deepseek-ai/dsh-sandbox-windows-acl/runner` 的 argv 契约（`node runner.js --workspace <dir> --temp <dir> --mode <mode> -- <command> <args...>`）。

- [ ] **Step 1: Write the failing test**

`app/tests/windows-sandbox.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWindowsSandboxProbe } from '../scripts/windows-sandbox-probe.mjs'

const winOnly = { skip: process.platform !== 'win32' ? 'windows-acl 仅 win32' : false }

test('windows-acl: 工作区可写、邻目录不可写', winOnly, async t => {
  const base = await mkdtemp(join(tmpdir(), 'windows-sandbox-probe-'))
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const workspace = join(base, 'workspace'), temp = join(base, 'private-temp')
  const result = await runWindowsSandboxProbe({ workspace, temp })
  assert.ok(!result.runnerStderr.includes('windows-acl-run:'), `供给失败必须大声失败：${result.runnerStderr}`)
  assert.equal(result.child.inside, 'written', JSON.stringify(result))
  assert.notEqual(result.child.outside, 'written', JSON.stringify(result))
})

test('windows-acl: read-only 下工作区也不可写', winOnly, async t => {
  const base = await mkdtemp(join(tmpdir(), 'windows-sandbox-probe-'))
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const result = await runWindowsSandboxProbe({ workspace: join(base, 'workspace'), temp: join(base, 'private-temp'), mode: 'read-only' })
  assert.ok(!result.runnerStderr.includes('windows-acl-run:'), `供给失败必须大声失败：${result.runnerStderr}`)
  assert.notEqual(result.child.inside, 'written', JSON.stringify(result))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --import ./scripts/native-node-protocol-check.mjs?register --test tests/windows-sandbox.test.mjs`
Expected: FAIL —— 探针模块不存在（`ERR_MODULE_NOT_FOUND`），先红。

- [ ] **Step 3: Implement the probe**

`app/scripts/windows-sandbox-probe.mjs` 的职责：
1. 解析 CLI/options；`workspace` 与 `temp` 必须已存在（不存在则 `mkdir`）。
2. 在 `temp` 下写一个子脚本 `probe-child.cjs`：对 `{ inside: join(workspace,'probe-inside.txt'), outside: join(dirname(workspace),'probe-outside.txt') }` 逐个 `writeFileSync`，把每个结果记为 `'written'` 或 `error.code`，最后 `stdout.write(JSON.stringify(results))`。
3. 用 `spawnSync(process.execPath, [runnerPath, '--workspace', workspace, '--temp', temp, '--mode', mode, '--', process.execPath, childPath])` 运行；`runnerPath` 从 `createRequire(import.meta.url).resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner')` 取；超时用 `childTimeoutMs ?? 15000`。
4. 解析 stdout 的 JSON 为 `child`；`runnerStderr` 取 stderr 前 4KB；`runnerExit = status`。
5. `export async function runWindowsSandboxProbe(...)`；文件底部 `if (process.argv[1] === fileURLToPath(import.meta.url))` 时执行 CLI 并打印 JSON。

- [ ] **Step 4: Run test to confirm the real boundary signature**

Run: `cd app && node --import ./scripts/native-node-protocol-check.mjs?register --test tests/windows-sandbox.test.mjs`
Expected: PASS（当前环境：ACL 供给成功、边界有效；`workspace-write` 下 `inside=written`、`outside=EPERM`）。若出现 `windows-acl-run:`/Win32 5 或断言失败，保存完整输出并记录签名，不得修改断言修绿。

把两次探针的完整 JSON 与 stderr 保存到 `app/.build/windows-sandbox-probe/`（gitignored）供 Task 2 条件执行与 Lead 复核记录使用。

- [ ] **Step 5: Commit**

```bash
git add app/scripts/windows-sandbox-probe.mjs app/tests/windows-sandbox.test.mjs
git commit -m "test(windows): add reproducible ACL sandbox boundary probe"
```

---

### Task 2: 修复本机 ACL 供给（仅当使用非 FullControl 工作区、探针复现 Win32 5 时）

> 2026-11-07 Stage A 复核：`%TEMP%` 下的 FullControl 工作区供给正常；仓库树等非 FullControl 目录会复现 `windows-acl-run: ... Win32 5`（见 Lead 复核记录）。全量测试数据根在 `%TEMP%`，故本任务默认不执行；当把仓库树/其他非 FullControl 目录当工作区使用，或 Task 1 探针复现 Win32 5 时才执行 Step 1–2。

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md`（§3 已知限制 1 与 §5 下一步建议 1，修复完成后更新）
- No product code.

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-sandbox-windows-acl` 随包诊断脚本 `assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1`，契约：`-Path <failing-path> -AllowRoot <authorized-root> -Out <persistent-recovery-dir>`，一次调用同时诊断与修复，所有改动存入 `-Out` 并打印 `ROLLBACK`。

- [ ] **Step 1: Run the repair in an UNCONFINED PowerShell**

> 仅当复现 Win32 5 时执行本步骤；未复现时本任务整体跳过并把“未复现”写进状态文档，不执行 ACL 修复。

在**普通用户 PowerShell**（非 DSH 受限会话）中执行，一次一个路径，按失败顺序处理：

```powershell
& 'C:\MyDocs\Program\Explore\blueprint\app\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\assets\diagnose-windows-sandbox-acl\scripts\diagnose-windows-sandbox-acl.ps1' -Path 'C:\MyDocs\Program\Explore\blueprint\项目' -AllowRoot 'C:\MyDocs\Program\Explore\blueprint' -Out 'C:\MyDocs\Program\Explore\blueprint\app\.build\acl-recovery'
exit $LASTEXITCODE
```

再对测试数据根执行一次（`-Path "$env:TEMP\Blueprint 测试数据" -AllowRoot "$env:TEMP"`，`-Out` 同上但子目录换名）。运行后立刻读 `RECAP`：`nextAction` 必须是 `verify_original_confined_operation`；出现 `stop` / `restore_pending_then_stop` 时停止，把阻塞对象、缺失权限、报告路径原样记录，转 Task 3 的 fail-closed 路径并把修复命令写进状态文档，不要手工改 ACL。

- [ ] **Step 2: Re-run the probe test and require green**

Run: `cd app && node --import ./scripts/native-node-protocol-check.mjs?register --test tests/windows-sandbox.test.mjs`
Expected: PASS（两条用例都过；`runnerStderr` 无 `windows-acl-run:`）。

若仍出现 `Win32 5`，对**探针实际失败的那个目录**（从 JSON 的 `workspace`/`temp` 复制完整路径）再跑一次同一命令（一次一个路径，`-AllowRoot` 仍是其用户可拥有的最近祖先），最多两次；仍失败则停，进入 Task 3。

- [ ] **Step 3: Re-run the two remaining isolation tests**

Run: `cd app && $env:BLUEPRINT_DATA_HOME = "$env:TEMP\Blueprint 测试数据"; node --import ./scripts/native-node-protocol-check.mjs?register --test tests/native-ralph.test.mjs tests/native-worktree.test.mjs`
Expected: `native-ralph` 全部 PASS；`native-worktree` 仍可能因命名管道限制失败（Task 3 处理）——记录当前失败签名。

- [ ] **Step 4: Update status doc and commit**

在 `docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md` §3 已知限制 1 中：写明修复命令、`-Out` 报告位置、修复后 `windows-sandbox.test.mjs` 的证据，并把“项目隔离在 Windows 下不可验证”改为“已修复（本机）”；§5 第 1 条改为“已在 r1/rc5 收口”。

```bash
git add docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md
git commit -m "docs: record Windows ACL repair for sandbox isolation"
```

---

### Task 2b: native-ralph 机器账本写保护（Decision Gate：已决定 B1，2026-11-07）

`native-ralph.test.mjs` 的「PTC 真实 Node 进程…」失败于项目根内机器账本可写（见 Lead 复核记录），不是环境/ACL 供给问题。两个选项需用户拍板后再进入 P0 收口：

- **B1 文档化 + 平台门控（推荐先做，约 1 小时）**：win32 上保留 `own` + `host` 两条边界断言，机器账本断言仅非 win32 执行；状态文档 §3 记录“Windows ACL 后端只限写范围，项目根内机器账本无单文件写保护；PTC 默认关闭”；另开后续 issue 跟踪产品级加固。可达 0 fail。
- **B2 产品修复（新计划，约 1–2 天）**：为 Windows 隔离增加“受保护机器文件拒绝写”能力（受控 SID + deny ACE + 清理 + fail-closed，安全敏感），需独立计划与复核。

> **2026-11-07 决定：采用 B1（用户确认）**。实施：`native-ralph` 在 win32 门控机器账本断言、保留 `own`/`host` 边界；状态文档 §3 记录该平台限制；产品级加固另开 [issue #2](https://github.com/Huiluck/blueprint-try/issues/2)（`ready-for-human`）跟踪。B2 不进入本 P0；Task 5 验收目标仍为 `269 tests / 253 pass / 0 fail / 16 skip`。

---

### Task 3: 适配「受限子进程不能建命名管道」的 worktree 过滤器断言

**Files:**
- Modify: `app/tests/native-worktree.test.mjs`（`真实 profile、Git 与 Seatbelt` 用例，过滤器配置与两条过滤器断言处）

**Interfaces:**
- Consumes: `f.create` / `f.ok` / `f.source` / `f.root` 等既有 fixture 接口，不改 fixture。

- [ ] **Step 1: Write the platform-aware assertion split**

在 `app/tests/native-worktree.test.mjs` 的该用例中：
1. 把 `await writeFile(join(f.source, '.gitattributes'), '*.txt filter=blueprint-native-check -text\n')` 起的过滤器配置块（`.gitattributes`、`git add`、`git commit`、`filter.*.clean/smudge/required`、`filter`/`marker`/`clean` 变量）包进 `if (process.platform !== 'win32') { ... }`。
2. 两条过滤器断言同样只在非 win32 执行：
   - `assert.rejects(access(marker), { code: 'ENOENT' }, '官方检出没有执行仓库 smudge 过滤器')`
   - `assert.deepEqual(await readFile(join(f.root, '作品/.git/config')), configuration, '检出不改仓库过滤器配置')`
3. 在 `if` 前加一行注释：`// rc.5 文档化限制：受限子进程无法创建命名管道，Git 外部过滤器经 MSYS sh 执行必然失败；win32 上只验证工作树行为，不验证过滤器语义。`
4. win32 分支仍保留 `const configuration = await readFile(...)` 吗？——改为该变量在 win32 分支不可用；把 `configuration` 读取也移入非 win32 块。

- [ ] **Step 2: Run the worktree test**

Run: `cd app && $env:BLUEPRINT_DATA_HOME = "$env:TEMP\Blueprint 测试数据"; node --import ./scripts/native-node-protocol-check.mjs?register --test tests/native-worktree.test.mjs`
Expected: PASS（Windows 下 4/4；过滤器相关断言跳过，worktree 行为断言全部保留并通过）。

- [ ] **Step 3: Commit**

```bash
git add app/tests/native-worktree.test.mjs
git commit -m "test(windows): keep worktree behavior assertions, gate git-filter checks"
```

---

### Task 4: fail-closed 回归：供给失败时 PTC 不得以不受限身份执行

> 2026-11-07 Stage A 已用 scratch 副本预跑本用例（证据见 Lead 复核记录）：fail-closed 实质成立（PTC 未执行、目标文件不存在、错误以结果对象暴露），但当前通道是 `result.error.kind="worker-exit"`（坏 workspaceRoot 在 realpath 处 ENOENT），不是 `"sandbox-unavailable"`。正式回归测试应按 rc.5 契约断言：`result.value` 非 `"written"`、`result.error` 存在、目标文件 ENOENT；错误分类专名化列为可后续加固项，不阻塞 P0。

**Files:**
- Modify: `app/tests/native-ralph.test.mjs`（在 `PTC 真实 Node 进程保留项目写入…` 用例后新增一条用例）

**Interfaces:**
- Consumes: 既有 fixture `fixture(t)`、`在项目终端执行域`、`f.ctx.ptcRuntime.resolve/run`、`f.ctx.sandboxPolicy.resolve`。

- [ ] **Step 1: Write the failing/guard test**

新增用例（名称固定）：

```js
test('沙箱工作区不可供给时 PTC 拒绝执行，不得写出边界', async t => {
  const f = await fixture(t)
  const 目标 = join(f.work, '不应写出.txt')
  const 坏工作区 = join(f.work, '不存在的沙箱根')
  const result = await 在项目终端执行域(f.ctx, f.parent, async () => {
    const spec = await f.ctx.ptcRuntime.resolve({ bindings: [], cwd: f.work,
      program: `const fs = process.getBuiltinModule('node:fs'); try { fs.writeFileSync(${JSON.stringify(目标)}, '越界'); return 'written' } catch (error) { return error.code }`,
      sandboxPolicy: { ...f.ctx.sandboxPolicy.resolve({ session: f.parent.session }), workspaceRoot: 坏工作区 },
      signal: new AbortController().signal })
    return f.ctx.ptcRuntime.run(spec)
  })
  // 供给失败必须表现为错误（resolve 抛错或 run 返回 isError），而不是成功写出。
  assert.notEqual(result.value, 'written', JSON.stringify(result))
  await assert.rejects(readFile(目标), { code: 'ENOENT' })
})
```

- [ ] **Step 2: Run and inspect**

Run: `cd app && $env:BLUEPRINT_DATA_HOME = "$env:TEMP\Blueprint 测试数据"; node --import ./scripts/native-node-protocol-check.mjs?register --test tests/native-ralph.test.mjs`
Expected: PASS（rc.5 的 `sandbox-local` 对无 chain/runner 失败 fail-closed；若 `ptcRuntime.resolve` 直接抛错，把断言改为 `await assert.rejects(...)` 并保持“目标文件不存在”断言）。

- [ ] **Step 3: If it fails (fail-open), stop and fix at the product seam**

若 `result.value === 'written'`：不要放宽测试。改为在 `blueprint/packages/node/src/执行能力.js` 的 PTC 调用处做前置校验——当 `sandboxPolicy.mode !== 'danger-full-access'` 且 `ctx.sandbox` 的供给自检不可用（`ctx.sandbox.confine` 对 `workspaceRoot` 抛错）时，直接返回 `{ isError: true, code: 'sandbox-unavailable' }`，不调用 `ptcRuntime.run`；补一条单测覆盖该分支。提交：

```bash
git add blueprint/packages/node/src/执行能力.js app/tests/native-ralph.test.mjs
git commit -m "fix(windows): fail closed when sandbox provisioning is unavailable"
```

- [ ] **Step 4: Commit (when already fail-closed)**

```bash
git add app/tests/native-ralph.test.mjs
git commit -m "test(windows): pin fail-closed behavior for unavailable sandbox provisioning"
```

---

### Task 5: 回归、状态文档、推送与 issue 更新

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md`（§2.3 测试数字、§3 已知限制、§5）
- Modify: `docs/superpowers/specs/2026-11-07-rc5-migration-spec.md` 的 Further Notes（可选，若需要更新“下一步”顺序）

- [ ] **Step 1: Run the isolation-focused regression**

Run:
```powershell
cd app
$env:BLUEPRINT_DATA_HOME = "$env:TEMP\Blueprint 测试数据"
node --import ./scripts/native-node-protocol-check.mjs?register --test tests/windows-sandbox.test.mjs tests/native-ralph.test.mjs tests/native-worktree.test.mjs tests/native-execution-features.test.mjs tests/native-goal.test.mjs tests/project-reasoning.test.mjs
```
Expected: 全部 PASS，0 fail；`native-execution-features` 的 Office/MCP 仍是显式 skip。

- [ ] **Step 2: Run the full suite in a normal (unconfined) user terminal**

Run: `cd app && $env:BLUEPRINT_DATA_HOME = "$env:TEMP\Blueprint 测试数据"; npm test`
Expected: `# tests 269`、`# pass 253`、`# fail 0`、`# skipped 16`（skip 为平台专属 + 缺 primary runtime 资产；新增探针 2 条 + fail-closed 1 条，若最终用例数因实现差异不同，以实际总数为准，但必须 `# fail 0`、`# skipped 16`）。

- [ ] **Step 3: Update the status record**

更新 §2.3 为 253/269；§3 已知限制 1 改为“ACL 供给在 `%TEMP%` 数据根正常、仓库树等非 FullControl 工作区仍缺 WRITE_OWNER（附探针证据与条件修复命令）”，并记录 `native-ralph` 机器账本按 Stage B 决策处理；§5 勾掉第 1 条，保留 primary runtime 资产、依赖清理、真机验收三条。

- [ ] **Step 4: Commit and push**

```bash
git add docs/superpowers/specs/2026-11-06-rc5-engine-migration-status.md
git commit -m "docs: record Windows sandbox isolation closure"
git push try r1/rc5
```

- [ ] **Step 5: Comment on the published spec issue**

用 `gh issue comment 1 -R Huiluck/blueprint-try --body-file <报告文件>` 记录：探针命令、ACL 修复命令与 `-Out` 报告位置、测试数字（269/253/0/16）、两个原失败用例的处理方式（一个环境修复、一个文档化限制适配）、剩余三项后续计划。

---

## P0 执行顺序（Stage A 复核后）

Stage A 已完成（探针与取证见上文 Lead 复核记录）。Task 2（本机 ACL 修复）默认跳过，只有使用非 FullControl 工作区或探针复现 Win32 5 时才执行。Stage B 决策已完成（Task 2b 采用 B1），按 Task 3 → Task 4 → Task 5 收口；验收目标为 `269 tests / 253 pass / 0 fail / 16 skip`。

---

## Self-Review

**Spec coverage:** 本计划覆盖状态文档 §5 建议 1（Windows 沙箱隔离）及其证据链；建议 2（primary runtime 资产）、3（依赖/许可证清理）、4（干净环境真机验收）分别留给后续独立计划，符合 writing-plans 的 scope check。

**Step scan:** 每个 step 都是单一动作：写测试/跑测试看红/实现探针/跑测试看签名/提交；Task 2 的 step 是条件执行的一次性命令（需要用户在非受限终端运行）且带精确参数与判定标准；Task 3/4 的改动点、条件与断言均已写死；无“处理边缘情况”式空话。

**Type consistency:** `runWindowsSandboxProbe` 的 options/ProbeResult 字段在 Task 1 定义、Task 2 直接消费；`windows-acl-run:` 签名、退出码 127、`--workspace/--temp/--mode/--` 契约与 rc.5 包 README/源码一致；`sandboxPolicy.resolve({session})`、`ptcRuntime.resolve/run` 的用法与 `native-ralph` 既有用例一致。

**Review Focus:** 五个最可能咬人的输入/条件已列出，且分别由 `windows-sandbox.test.mjs`（供给失败/边界失败/只读）、`native-worktree.test.mjs`（命名管道限制）、`native-ralph.test.mjs` 新增用例（fail-closed）覆盖。

**Proportion:** 5 个任务 + 1 个决策门（Task 2b）、约 3–4 小时工作量；计划长度约为状态文档对应章节的 3 倍，代码块只保留测试契约和探针输出形状，没有转录实现体。
