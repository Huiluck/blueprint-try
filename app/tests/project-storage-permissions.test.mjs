import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import config from '../electron-builder.cjs'

const source = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8')
const start = source.indexOf("  ipcMain.handle('blueprint:authorize-project-directory'"), end = source.indexOf("  ipcMain.handle('blueprint:attention-target'", start)
assert.ok(start >= 0 && end > start)
function fixture({ trusted = true, canceled = false } = {}) {
  const handlers = new Map(), dialogs = [], mainWindow = {}
  vm.runInNewContext(source.slice(start, end), { ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trusted: () => trusted, window: mainWindow, app: { getPath: () => '/文稿' },
    dialog: { showOpenDialog: async (parent, options) => { dialogs.push({ parent, options }); return { canceled, filePaths: ['/文稿/Blueprint/项目'] } } } })
  return { call: path => handlers.get('blueprint:authorize-project-directory')({}, path), dialogs, mainWindow }
}

test('目录授权只允许可信主窗口，明确请求原文件夹；取消不改变选择', async () => {
  const denied = fixture({ trusted: false })
  await assert.rejects(denied.call('/文稿/Blueprint/项目'), /只允许主窗口/)
  assert.equal(denied.dialogs.length, 0)
  const allowed = fixture()
  assert.equal(await allowed.call('/文稿/Blueprint/项目'), '/文稿/Blueprint/项目')
  assert.equal(allowed.dialogs[0].parent, allowed.mainWindow)
  assert.equal(allowed.dialogs[0].options.defaultPath, '/文稿/Blueprint/项目')
  assert.equal(allowed.dialogs[0].options.buttonLabel, '允许访问')
  assert.equal(await fixture({ canceled: true }).call('/文稿/Blueprint/项目'), null)
})

test('桌面包声明文稿目录用途，preload 只暴露受控授权请求', () => {
  assert.match(config.mac.extendInfo.NSDocumentsFolderUsageDescription, /保存和读取/)
  const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8')
  assert.ok(preload.includes("authorizeProjectDirectory: path => ipcRenderer.invoke('blueprint:authorize-project-directory', path)"))
})
