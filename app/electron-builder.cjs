module.exports = {
  appId: 'com.blueprint.desktop', productName: 'Blueprint', asar: true,
  directories: { app: '.build/shell', output: 'dist' },
  electronVersion: '44.5.1',
  files: ['desktop/**', 'package.json', '!node_modules/**/*'],
  // Copy the already verified runtime verbatim; builder's dependency collector
  // would otherwise move packages into ASAR and undo the multimodal patch.
  afterPack: async ({ appOutDir, packager }) => {
    const { cp } = require('node:fs/promises')
    const { join } = require('node:path')
    const shellRoot = packager.config.directories?.app || '.build/shell'
    const resources = process.platform === 'darwin'
      ? join(appOutDir, 'Blueprint.app/Contents/Resources')
      : join(appOutDir, 'resources')
    await cp(join(packager.projectDir, shellRoot, '../runtime'), join(resources, 'runtime'), { recursive: true })
    if (process.platform !== 'darwin') return
    // UNNotification requires a valid signature, including in local previews.
    // Keep local signing independent of a developer certificate or keychain.
    const { execFileSync } = require('node:child_process')
    const appPath = join(appOutDir, 'Blueprint.app')
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' })
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
  },
  npmRebuild: false,
  mac: {
    icon: '.build/blueprint.icns',
    category: 'public.app-category.productivity', target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    identity: null,
    extendInfo: {
      NSDocumentsFolderUsageDescription: 'Blueprint 在文稿中的 Blueprint/项目 保存和读取你的项目。',
      NSMicrophoneUsageDescription: '使用启用的音频工具时需要麦克风访问。',
      NSCameraUsageDescription: '使用启用的视频工具时需要相机访问。',
      NSScreenCaptureUsageDescription: '使用启用的屏幕工具时需要屏幕录制权限。',
    },
  },
  win: {
    icon: '.build/blueprint.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Blueprint-${version}-x64.${ext}',
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Blueprint',
    uninstallDisplayName: 'Blueprint',
    deleteAppDataOnUninstall: false,
  },
  // 安装窗口：背景写着第一次被 macOS 拦住时怎么打开，右下角放能复制命令的说明（installer/，背景由 scripts/dmg-background.mjs 生成）。
  // 坐标是图标中心，和背景图的 680×500 同一套。
  dmg: { title: 'Blueprint', background: 'installer/dmg-background.png', iconSize: 80, contents: [
    { x: 180, y: 150 }, { x: 500, y: 150, type: 'link', path: '/Applications' },
    { x: 590, y: 372, type: 'file', path: require('node:path').join(__dirname, 'installer/打不开请看.txt') },
  ] },
}
