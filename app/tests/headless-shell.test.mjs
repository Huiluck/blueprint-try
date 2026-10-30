import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { prepareHeadlessShell } from '../scripts/browser-assets.mjs'

const json = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), '无头专用版准备-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')
  await json(join(modules, 'playwright-core/browsers.json'), { browsers: [
    { name: 'chromium', revision: '1243', browserVersion: '153.0.8010.12' },
    { name: 'chromium-headless-shell', revision: '1243', browserVersion: '153.0.8010.12' },
  ] })
  await json(join(modules, 'playwright-core/package.json'), { name: 'playwright-core' })
  await json(join(modules, 'playwright/package.json'), { name: 'playwright' })
  return { root, modules, directory: join(root, '浏览器') }
}

test('无头专用版跟固定的 Playwright 版本走，只装 shell，装好后给出可执行文件', async t => {
  const f = await fixture(t), calls = []
  const install = async ({ directory, playwrightRoot }) => {
    calls.push({ directory, playwrightRoot })
    const bin = join(directory, 'chromium_headless_shell-1243', `chrome-headless-shell-mac-${process.arch}`)
    await mkdir(bin, { recursive: true }); await writeFile(join(bin, 'chrome-headless-shell'), '')
  }
  const shell = await prepareHeadlessShell({ directory: f.directory, modules: f.modules, install })
  assert.deepEqual(calls, [{ directory: f.directory, playwrightRoot: join(f.modules, 'playwright') }])
  assert.equal(shell.name, 'chromium_headless_shell-1243')
  assert.equal(shell.directory, join(f.directory, 'chromium_headless_shell-1243'))
  assert.equal(shell.version, '153.0.8010.12')
})

test('安装后没有可执行文件就失败，不把空目录打进 App', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareHeadlessShell({ directory: f.directory, modules: f.modules, install: async () => {} }), /缺少可执行文件/)
})
