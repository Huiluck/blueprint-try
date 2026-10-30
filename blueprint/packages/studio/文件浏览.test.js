import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 列目录 } from './src/文件夹.js'

test('超过 4000 个后代不影响顶层完整显示；只列一层，大目录本身也不截断', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-files-'))
  try {
    for(const n of ['素材','游戏','工作','.git','node_modules']) await mkdir(join(root,n))
    await writeFile(join(root,'.DS_Store'), '')
    await writeFile(join(root,'总图景.md'), 'readable')
    for(let i=0;i<4205;i+=100) await Promise.all(Array.from({length:Math.min(100,4205-i)},(_,j)=>writeFile(join(root,'工作',`${i+j}.txt`),'')))
    const top = await 列目录(root)
    assert.equal(top.数,5)
    for(const n of ['素材','游戏','工作','node_modules']) assert.ok(top.树.some(x=>x.名===n && x.夹))
    assert.ok(!top.树.some(x=>x.名==='.git'))
    assert.ok(top.树.every(x=>!('子' in x)), '未展开时没有递归内容')
    const work = await 列目录(root,'工作')
    assert.equal(work.数,4205)
    assert.ok(work.树.some(x=>x.名==='4204.txt'))
    const file = await 列目录(root,'工作')
    assert.equal(file.树.filter(x=>!x.夹).length,4205)
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('按真实层级浏览，超过八层仍可展开；增删与空目录从磁盘读取，文件夹优先且自然排序', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-files-'))
  try {
    const deep = Array(12).fill('下一层').join('/')
    await mkdir(join(root,deep),{recursive:true})
    assert.equal((await 列目录(root,deep)).数,0)
    for(const name of ['10.md','2.md','1.md']) await writeFile(join(root,deep,name),'正文')
    assert.deepEqual((await 列目录(root,deep)).树.map(x=>x.名),['1.md','2.md','10.md'])
    await rm(join(root,deep,'2.md'))
    assert.equal((await 列目录(root,deep)).数,2)
    assert.equal((await 列目录(root)).树[0].夹,true)
    await assert.rejects(列目录(root,'不存在'))
    await assert.rejects(列目录(root,deep+'/1.md'))
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('拒绝绝对位置、父目录与出界符号链接；根内相对位置和带空格目录正常读取', async () => {
  const root = await mkdtemp(join(tmpdir(),'studio-files-'))
  const outside = await mkdtemp(join(tmpdir(),'studio-outside-'))
  try {
    await mkdir(join(root,' 带空格 '))
    await writeFile(join(root,' 带空格 ','文件.md'),'正文')
    await symlink(outside,join(root,'外面'))
    assert.equal((await 列目录(root,' 带空格 ')).树[0].名,'文件.md')
    for(const p of ['../','素材/../../','/tmp','素材\\..','外面','\0']) await assert.rejects(列目录(root,p))
  } finally { await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true}) }
})
