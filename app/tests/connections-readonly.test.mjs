import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const source = await readFile(new URL('../../viewer/connections.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const generator = fileURLToPath(new URL('../../blueprint/packages/media/生成.mjs', import.meta.url))
const client = fileURLToPath(new URL('../../blueprint/packages/media/client.js', import.meta.url))

test('对话模型只读，媒体服务保留完整增删改测入口', () => {
  // 具体界面文案，不是文件头注释里的「系统 DSH」：文案删掉要能被发现。
  assert.match(source, /对话模型在系统 DSH 中配置/)
  assert.ok(source.includes("kind === 'media'"))
  assert.ok(!source.includes('connections/default'))
  // 旧聊天表单的写入口与专属文案必须删干净，不能只藏起来。
  for (const gone of ['添加 API 连接', '测试连接', '设为新项目默认', '接口协议', '发送少量 token 的真实模型请求']) {
    assert.ok(!source.includes(gone), `connections.js 仍有聊天写入口：${gone}`)
  }
  // 媒体表单、动作和媒体页生成器依赖的接缝还在。
  for (const kept of [
    'function renderMediaForm()', 'function paintMediaModels()', 'data-action="discover"', 'data-action="save"', 'data-action="delete"',
    "window.BlueprintConnections = { open }", "document.createElement('dialog')", 'document.body.append(dialog)',
    "const $ = id => document.getElementById(id)", "new URL('api/connections', location.href).pathname",
    'dialog.showModal()', "document.addEventListener('click'",
  ]) assert.ok(source.includes(kept), `connections.js 缺少：${kept}`)
  // 删除只接受媒体行，聊天行不出现删除按钮。
  assert.ok(source.includes('!是媒体(p) || !p.deletable'))
  // 删除 payload 保留 id/revision，并带上 kind: 'media'。
  assert.match(source, /request\('delete',\s*\{[^}]*kind:\s*'media'[^}]*\}\)/, '媒体删除请求缺少 kind: media')
})

test('主界面入口改叫媒体 API，并说明对话模型在系统 DSH 中配置', () => {
  assert.match(html, /媒体 API/)
  assert.match(html, /对话模型在系统 DSH 中配置/)
  assert.ok(!html.includes('connections/default'))
})

test('媒体页生成器可运行、幂等，且提交的产物与生成结果一致', async () => {
  // 生成器按 LF 写，检出端可能因 text=auto 得到 CRLF；比对时只忽略行尾。
  const normalize = text => text.replace(/\r\n/g, '\n')
  const committed = await readFile(client, 'utf8')
  try {
    execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
    const first = await readFile(client, 'utf8')
    assert.equal(normalize(first), normalize(committed), 'blueprint/packages/media/client.js 已陈旧：运行 node blueprint/packages/media/生成.mjs 后提交')
    execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
    assert.equal(normalize(await readFile(client, 'utf8')), normalize(first), '媒体页生成器不幂等：连续两次生成结果不同')
  } finally {
    // 测试不留下未提交改动。
    await writeFile(client, committed)
  }
})

test('媒体页生成器拒绝聊天写入口回流', async () => {
  const original = await readFile(new URL('../../viewer/connections.js', import.meta.url), 'utf8')
  try {
    await writeFile(new URL('../../viewer/connections.js', import.meta.url), original + '\n// connections/default\n')
    const result = spawnSync(process.execPath, [generator], { cwd: repo, encoding: 'utf8' })
    assert.notEqual(result.status, 0, '生成器不能放过聊天写入口')
    assert.match(result.stderr, /仍有对话模型写入口/)
  } finally {
    await writeFile(new URL('../../viewer/connections.js', import.meta.url), original)
  }
})

test('媒体页生成器的「系统 DSH」接缝是界面文案，不是文件头注释', async () => {
  const path = new URL('../../viewer/connections.js', import.meta.url)
  const original = await readFile(path, 'utf8')
  try {
    // 只留文件头注释里的「系统 DSH」，删掉三处界面文案；生成器必须拒绝，不能拿注释糊弄过去。
    const stripped = original.replaceAll('对话模型在系统 DSH 中配置', '对话模型在别处配置')
    assert.ok(stripped.includes('对话模型归系统 DSH 管'), '前置条件：文件头注释仍含「系统 DSH」')
    await writeFile(path, stripped)
    const result = spawnSync(process.execPath, [generator], { cwd: repo, encoding: 'utf8' })
    assert.notEqual(result.status, 0, '界面文案删掉后生成器仍然成功：接缝命中的是注释')
    assert.match(result.stderr, /接缝不合/)
  } finally {
    await writeFile(path, original)
  }
})
