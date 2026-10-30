#!/usr/bin/env node
// 保留旧入口，让旧会话得到可执行的迁移提示；截图已经由 App 内置工具承接。
const args = process.argv.slice(2), request = {}
const fields = {'--宽':'width','--width':'width','--高':'height','--height':'height','--等':'wait','--wait':'wait','--存':'output','--out':'output'}
for(let i=0;i<args.length;i++) {
  const key = fields[args[i]]
  if(key)request[key] = key==='output' ? args[++i] : Number(args[++i])
  else if(!request.entry)request.entry = args[i]
}
console.error('网页截图已迁移到 App 内置 render_page 工具，无需 Chrome 或命令升权。请调用 render_page：\n'+JSON.stringify(request))
process.exitCode = 1
