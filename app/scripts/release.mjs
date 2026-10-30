// 发一个新版，一条命令：改版本号 → 打包 → 把同一份源码导出到公开仓库的本地副本、提交并打标签 → （加 --publish）推送并建 GitHub Release。
// AGPL 要求每个发出去的安装包都找得到对应源码：打包和导出用同一份工作区，Release 挂在同名标签上。
//
//   npm --prefix app run release                         版本号末位加一，打包、导出、提交，不上传
//   npm --prefix app run release -- --publish            同上，再推送源码、上传安装包
//   --version 1.2.0    指定版本号        --no-bump     沿用当前版本号
//   --notes "……"       这一版改了什么    --skip-build  用已经打好的同版本安装包（只在打包后没改过代码时用）
//   --remote <地址>    第一次发布时接上公开仓库（GitHub 上建好的空仓库地址）
//
// 公开仓库的本地副本在 发布/Blueprint，是一个和开发仓库分开的 git 仓库；开发仓库这边只改版本号，不提交。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSource } from './export.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicRepo = resolve(appRoot, '../发布/Blueprint')

export function releaseOptions(argv) {
  const options = { bump: true, build: true, publish: false }
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]
    if (option === '--version') options.version = argv[++index]
    else if (option === '--no-bump') options.bump = false
    else if (option === '--skip-build') options.build = false
    else if (option === '--notes') options.notes = argv[++index]
    else if (option === '--remote') options.remote = argv[++index]
    else if (option === '--publish') options.publish = true
    else throw new Error(`不认识的参数：${option}`)
  }
  if (options.version !== undefined && !/^\d+\.\d+\.\d+$/.test(options.version)) throw new Error('版本号写成 1.2.3 这样。')
  return options
}

const run = (command, args, cwd = appRoot) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const read = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const git = (...args) => read('git', args, publicRepo)
const tryRead = (command, args, cwd) => { try { return read(command, args, cwd) } catch { return undefined } }
const succeeds = (command, args, cwd) => tryRead(command, args, cwd) !== undefined

async function setVersion(version) {
  for (const name of ['package.json', 'package-lock.json']) {
    const path = join(appRoot, name), data = JSON.parse(await readFile(path, 'utf8'))
    data.version = version
    if (data.packages?.['']) data.packages[''].version = version
    await writeFile(path, JSON.stringify(data, null, 2) + '\n')
  }
}

// 发布/Blueprint 必须是公开仓库自己的 git 副本；不存在就新建，是别的东西就停下，不覆盖。
async function preparePublicRepo(remote) {
  const exists = await stat(publicRepo).then(() => true, () => false)
  if (exists && tryRead('git', ['rev-parse', '--show-toplevel'], publicRepo) !== await realpath(publicRepo)) {
    throw new Error(`${publicRepo} 不是公开仓库的副本（可能是以前的导出），请先挪走它再发布。`)
  }
  if (!exists) {
    await mkdir(publicRepo, { recursive: true })
    git('init', '-q', '-b', 'main')
    // 公开提交用 GitHub 的匿名邮箱，不把本机名和私人邮箱写进公开历史。
    const login = tryRead('gh', ['api', 'user', '-q', '.login']), id = tryRead('gh', ['api', 'user', '-q', '.id'])
    git('config', 'user.name', login || 'Blueprint')
    git('config', 'user.email', login && id ? `${id}+${login}@users.noreply.github.com` : 'blueprint@users.noreply.github.com')
  }
  if (remote) {
    if (tryRead('git', ['remote', 'get-url', 'origin'], publicRepo)) git('remote', 'set-url', 'origin', remote)
    else git('remote', 'add', 'origin', remote)
  }
}

// 公开前最后一道：导出里不能有密钥样式的字符串。两三天发一版，改动多，靠人眼看不过来。
// sk- 前面不能紧挨字母数字、后面要带数字：网址里的 task-based-… 这类词不算。
const secretPattern = /(?<![A-Za-z0-9])sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/
export async function findSecrets(dir, root = dir, hits = []) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) { await findSecrets(path, root, hits); continue }
    if ((await stat(path)).size > 5 * 1024 * 1024) continue
    const bytes = await readFile(path)
    if (!bytes.subarray(0, 8000).includes(0) && secretPattern.test(bytes.toString('utf8'))) hits.push(path.slice(root.length + 1))
  }
  return hits
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function releaseNotes(version, dmg, digest, notes) {
  return [
    '## 下载 · Download', '',
    `\`${dmg}\`：Apple Silicon（M 系列芯片）的 Mac，macOS 13 及以上。Intel Mac 和 Windows 暂不支持。`,
    `For Apple Silicon Macs on macOS 13 or later. Intel Macs and Windows are not supported yet.`, '',
    '## 第一次打开 · First launch', '',
    'Blueprint 还没有苹果开发者签名，第一次打开会被 macOS 拦下。打开 DMG 后，安装窗口里写着打开方法；窗口里的「打不开请看.txt」有能复制的命令。',
    'Blueprint is not signed with an Apple Developer ID yet. The DMG window shows how to open it, and 打不开请看.txt has the steps in English.', '',
    ...(notes ? ['## 本版变化 · Changes', '', notes, ''] : []),
    `SHA-256 (${dmg}): \`${digest}\``, '',
  ].join('\n')
}

export async function release(options) {
  const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const [major, minor, patch] = manifest.version.split('.').map(Number)
  const version = options.version || (options.bump ? `${major}.${minor}.${patch + 1}` : manifest.version)
  const tag = `v${version}`, dmg = `Blueprint-${version}-arm64.dmg`, dmgPath = join(appRoot, 'dist', dmg)

  // 先查会让后面白跑的事，再动版本号和打包。
  await preparePublicRepo(options.remote)
  const tagged = tryRead('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], publicRepo)
  if (options.publish && !tryRead('git', ['remote', 'get-url', 'origin'], publicRepo)) {
    throw new Error('公开仓库还没接上 GitHub：先在 GitHub 建一个空的公开仓库，再加 --remote <仓库地址> 运行一次。')
  }
  if (options.publish && !succeeds('gh', ['auth', 'status'])) throw new Error('上传要用 gh 登录 GitHub：先运行 gh auth login。')

  if (version !== manifest.version) { await setVersion(version); console.log(`版本号改为 ${version}（开发仓库没有提交，你自己提交）。`) }
  if (options.build) run('npm', ['run', 'dist'])
  if (!await stat(dmgPath).then(() => true, () => false)) throw new Error(`没有找到安装包 ${dmgPath}，请去掉 --skip-build 重新打包。`)
  const app = join(appRoot, 'dist/mac-arm64/Blueprint.app')
  const built = read('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')])
  if (built !== version) throw new Error(`安装包里的版本是 ${built}，不是 ${version}，请重新打包。`)
  read('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])

  // 导出到临时目录，再整个换进公开仓库副本（保留它的 .git），删掉的文件也会跟着删。
  const staging = await mkdtemp(join(tmpdir(), 'Blueprint 发布导出-'))
  try {
    const exported = await exportSource(join(staging, 'Blueprint'))
    const secrets = await findSecrets(exported)
    if (secrets.length) throw new Error(`导出的源码里有像密钥的字符串，没有提交。请先去掉：\n  ${secrets.join('\n  ')}`)
    for (const entry of await readdir(publicRepo)) if (entry !== '.git') await rm(join(publicRepo, entry), { recursive: true, force: true })
    await cp(exported, publicRepo, { recursive: true })
  } finally { await rm(staging, { recursive: true, force: true }) }
  git('add', '-A')
  const changed = git('status', '--porcelain') !== ''
  if (tagged) {
    if (changed || tagged !== tryRead('git', ['rev-parse', 'HEAD'], publicRepo)) throw new Error(`公开仓库里已经有 ${tag}，但源码和它不一样。请换一个版本号。`)
    console.log(`公开仓库里的 ${tag} 和现在的源码一致，不再重复提交。`)
  } else {
    if (changed) git('commit', '-q', '-m', `Blueprint ${version}`)
    git('tag', tag)
    console.log(`公开仓库已提交并打上标签 ${tag}：${publicRepo}`)
  }

  const digest = await sha256(dmgPath), notesPath = join(appRoot, 'dist', `Blueprint-${version}-发布说明.md`)
  await writeFile(notesPath, releaseNotes(version, dmg, digest, options.notes))
  if (!options.publish) {
    console.log(`\n安装包：${dmgPath}\n发布说明：${notesPath}\n确认没问题后，加 --publish 再运行一次就会推送源码、上传安装包（不会重新提交）：`)
    console.log(`  npm --prefix app run release -- --no-bump --skip-build --publish`)
    return { version, tag, dmgPath, notesPath, published: false }
  }
  run('git', ['push', '-u', 'origin', 'main'], publicRepo)
  run('git', ['push', 'origin', tag], publicRepo)
  run('gh', ['release', 'create', tag, dmgPath, '--title', `Blueprint ${version}`, '--notes-file', notesPath], publicRepo)
  console.log(`\n已发布 ${tag}。`)
  return { version, tag, dmgPath, notesPath, published: true }
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  release(releaseOptions(process.argv.slice(2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
