// Windows 的 ACL 沙箱要求工作区由当前用户拥有；测试数据放用户临时目录，和安装版的数据目录属性一致。
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const environment = { ...process.env }
if (!environment.BLUEPRINT_DATA_HOME) {
  environment.BLUEPRINT_DATA_HOME = join(tmpdir(), 'Blueprint 测试数据')
}
mkdirSync(join(environment.BLUEPRINT_DATA_HOME, '项目'), { recursive: true })

const child = spawn(process.execPath, [
  '--import', './scripts/native-node-protocol-check.mjs?register',
  '--test', 'tests/**/*.test.mjs',
  ...process.argv.slice(2),
], { stdio: 'inherit', env: environment })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
