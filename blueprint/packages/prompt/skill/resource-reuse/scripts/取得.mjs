#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, unlink, link, access, copyFile, rm, constants } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const 用法 = [
  '用法：node 取得.mjs <HTTPS文件网址> <项目内目标文件> [来源页面]',
  '　　　node 取得.mjs --pick <候选单> <序号> <项目内目标> [--filename <itch 免费页列出的完整文件名>] [--url <页面上找到的HTTPS文件网址>]',
].join('\n')
const 核验说明 = '已取得非空文件并检查已识别格式的文件头；解码、导入、运行及作品效果另验。'

function checkFile(bytes, path) {
  if (!bytes.length) throw new Error('下载结果为空')
  const extension = extname(path).toLowerCase()
  const head = bytes.subarray(0, 512).toString('utf8').trimStart()
  if (!['.html', '.htm'].includes(extension) && /^(<!doctype html|<html\b)/i.test(head)) {
    throw new Error('取得的是 HTML 页面，尚未取得素材文件')
  }
  const magic = {
    '.png': b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    '.jpg': b => b[0] === 255 && b[1] === 216,
    '.jpeg': b => b[0] === 255 && b[1] === 216,
    '.zip': b => b[0] === 80 && b[1] === 75,
    '.glb': b => b.length >= 12 && b.toString('ascii', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length,
    '.hdr': b => /^#\?(RADIANCE|RGBE)/.test(b.subarray(0, 32).toString()),
    '.wav': b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE',
    '.ttf': b => b.length > 12 && (b.readUInt32BE(0) === 0x00010000 || b.toString('ascii', 0, 4) === 'true'),
    '.otf': b => b.toString('ascii', 0, 4) === 'OTTO',
    '.woff2': b => b.toString('ascii', 0, 4) === 'wOF2',
  }
  if (magic[extension] && !magic[extension](bytes)) throw new Error(`文件内容不符合 ${extension} 格式`)
  if (extension === '.svg' && !/<svg\b/.test(bytes.toString('utf8'))) throw new Error('文件中没有 SVG')
  if (['.json', '.gltf'].includes(extension)) JSON.parse(bytes.toString('utf8'))
}

async function 不存在(...paths) {
  for (const path of paths) {
    try { await access(path); throw new Error(`目标已存在，请换一个名称：${path}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function 跑(command, args) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? accept(stdout) : reject(new Error(stderr.trim() || `${command} 退出码 ${code}`)))
  })
}

/** 下载一份到 output（不覆盖），返回文件那一半的记录；失败不留半个文件。 */
async function 下载到(url, output) {
  if (new URL(url).protocol !== 'https:') throw new Error('文件网址需要使用 HTTPS')
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.下载中-${randomUUID()}`
  try {
    const response = JSON.parse(await 跑('curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '180', '--proto', '=https', '--proto-redir', '=https', '--user-agent', 'Blueprint-Resource-Reuse/1.0', '--output', temporary, '--write-out', '%{json}', url]))
    const bytes = await readFile(temporary)
    checkFile(bytes, output)
    // link 的目标须不存在，避免两次并发调用互相覆盖素材。
    await link(temporary, output)
    return {
      requestedUrl: url, effectiveUrl: response.url_effective, httpStatus: response.http_code,
      contentType: response.content_type, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), file: output,
    }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}

/** 记录写不进去就撤掉已落地的文件，素材和来源记录总是成对出现。 */
async function 写记录(recordPath, record, 已落地) {
  try { await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }) }
  catch (error) { await Promise.all(已落地.map(path => rm(path, { recursive: true, force: true }))); throw error }
  console.log(JSON.stringify(record, null, 2))
}

async function 按网址(url, destination, page = url) {
  const output = resolve(destination)
  const recordPath = `${output}.来源.json`
  await 不存在(output, recordPath)
  const 文件 = await 下载到(url, output)
  await 写记录(recordPath, { sourcePage: page, ...文件, downloadedAt: new Date().toISOString(), verification: 核验说明 }, [output])
}

/** itch 免费包：交给已实测的 itch-free-package 取到临时目录，再搬到目标。 */
async function 取itch(候选, filename, output) {
  if (!filename) throw new Error(`这是 itch 素材页，原件要用 --filename 填页面列出的完整文件名：${候选.页面}`)
  const 临时 = await mkdtemp(join(tmpdir(), 'itch取件-'))
  try {
    const helper = fileURLToPath(new URL('./动画音视频/取得素材.py', import.meta.url))
    await 跑('python3', [helper, 'itch-free-package', '--page-url', 候选.页面, '--filename', filename, '--output-dir', 临时])
      // 只留 Python 报错的最后一句人话，不把整段调用栈交给模型。
      .catch(error => { throw new Error(error.message.trim().split('\n').at(-1).replace(/^\w+Error: /, '')) })
    const 记 = JSON.parse(await readFile(join(临时, '取得记录.json'), 'utf8')).at(-1).files[0]
    const 原 = join(临时, 记.path)
    checkFile(await readFile(原), output)
    await mkdir(dirname(output), { recursive: true })
    await copyFile(原, output, constants.COPYFILE_EXCL)
    return {
      requestedUrl: 记.request_url, effectiveUrl: 记.resolved_url, httpStatus: 记.http_status,
      contentType: 记.content_type, bytes: 记.size_bytes, sha256: 记.sha256, file: output,
      packageFilename: filename,
    }
  } finally {
    await rm(临时, { recursive: true, force: true })
  }
}

/** 候选单里的一条：取文件，来源、作者、许可从候选单抄进来源记录。 */
async function 按候选(list, number, destination, { filename, url } = {}) {
  const 单 = JSON.parse(await readFile(resolve(list), 'utf8'))
  const 候选 = (单.结果 || []).find(x => String(x.编号) === String(number))
  if (!候选) throw new Error(`候选单里没有序号 ${number}：${list}`)
  const output = resolve(destination)
  const 来源 = {
    sourcePage: 候选.页面 || '', site: 候选.来源 || '', title: 候选.名字 || '',
    author: 候选.作者 || '未知', license: 候选.版权 || '来源未提供', licensePage: 候选.授权页 || '',
    licenseStatus: 候选.授权状态 || '', query: 单.词 || '', candidateList: resolve(list), candidateNumber: 候选.编号,
  }
  const 落地 = async (fileKind, 取) => {
    const recordPath = `${output}.来源.json`
    await 不存在(output, recordPath)
    const 文件 = await 取()
    await 写记录(recordPath, { ...来源, fileKind, ...文件, downloadedAt: new Date().toISOString(), verification: 核验说明 }, [output])
  }

  if (url) return 落地('页面上找到的文件', () => 下载到(url, output))
  const 文件们 = (候选.文件 || []).filter(f => f.网址)
  if (文件们.length === 1) return 落地(文件们[0].变体 || '站点给的文件', () => 下载到(文件们[0].网址, output))
  if (文件们.length > 1) {
    // 一项资源几份文件（如 glTF 连着 bin 和贴图）：目标当文件夹，按「名」里的相对路径摆，记录放在文件夹里。
    const recordPath = join(output, `${basename(output)}.来源.json`)
    await 不存在(output)
    const 落 = []
    try {
      for (const f of 文件们) {
        const 名 = normalize(f.名 || basename(new URL(f.网址).pathname))
        if (isAbsolute(名) || 名.startsWith('..')) throw new Error(`文件名带了目录外的路径：${f.名}`)
        落.push(await 下载到(f.网址, join(output, 名)))
      }
    } catch (error) { await rm(output, { recursive: true, force: true }); throw error }
    return 写记录(recordPath, { ...来源, fileKind: '一组文件', files: 落, downloadedAt: new Date().toISOString(), verification: 核验说明 }, [output])
  }
  if (候选.来源标识 === 'itch') return 落地('itch 免费包原件', () => 取itch(候选, filename, output))
  if (候选.来源标识 === 'freesound' && 候选.试听) return 落地('站点试听转码版（原文件要登录才能下）', () => 下载到(候选.试听, output))
  throw new Error(`这条候选只有页面，没有可直接取的文件：${候选.页面}。在页面上找到文件地址后加 --url 再取。`)
}

export function 参数(argv) {
  if (argv[0] !== '--pick') {
    if (argv.length < 2 || argv.length > 3 || argv.some(a => a.startsWith('--'))) throw new Error(用法)
    return { 模式: '网址', url: argv[0], destination: argv[1], page: argv[2] }
  }
  const [, list, number, destination, ...rest] = argv
  if (!list || !number || !destination) throw new Error(用法)
  const o = { 模式: '候选', list, number, destination }
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i + 1]
    if (!['--filename', '--url'].includes(rest[i]) || !v || v.startsWith('--')) throw new Error(用法)
    o[rest[i].slice(2)] = v; i++
  }
  return o
}

async function main() {
  const o = 参数(process.argv.slice(2))
  if (o.模式 === '网址') await 按网址(o.url, o.destination, o.page)
  else await 按候选(o.list, o.number, o.destination, o)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
