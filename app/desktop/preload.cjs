const { contextBridge, ipcRenderer } = require('electron')

if (process.isMainFrame) {
  // 顶栏拖窗与红绿灯留位按这个标记生效。不用 dsh 的 data-platform：那是官方桌面壳的信号，
  // 设上后 dsh 会去找它的键盘桥接（window.dshDesktop），本壳没有，界面会起不来。
  const markPlatform = () => document.documentElement?.setAttribute('data-blueprint-desktop', process.platform)
  markPlatform()
  window.addEventListener('DOMContentLoaded', markPlatform, { once: true })
  contextBridge.exposeInMainWorld('blueprintDesktop', {
    platform: process.platform,
    chooseProjectDirectory: path => ipcRenderer.invoke('blueprint:choose-project-directory', path),
    authorizeProjectDirectory: path => ipcRenderer.invoke('blueprint:authorize-project-directory', path),
    previewURL: (session, path) => ipcRenderer.sendSync('blueprint:preview-url', session, path),
    // A refreshed window can briefly run against a main process awaiting restart.
    takeAttentionTarget: () => ipcRenderer.invoke('blueprint:attention-target').catch(() => null),
    viewAttention: sessionId => ipcRenderer.send('blueprint:attention-view', sessionId),
    onAttention: callback => {
      const listener = () => callback()
      ipcRenderer.on('blueprint:attention-open', listener)
      return () => ipcRenderer.removeListener('blueprint:attention-open', listener)
    },
  })
}
