// electron-builder 的图标转换工具在 Windows 上会因 WASM 内存失败；自己生成多尺寸 ICO。
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'

const SIZES = [16, 32, 48, 64, 128, 256]

export async function writeWindowsIcon(source, target) {
  const images = await Promise.all(SIZES.map(size => sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  let offset = header.length + images.length * 16
  const entries = images.map((image, index) => {
    const size = SIZES[index], entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2); entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.length, 8); entry.writeUInt32LE(offset, 12)
    offset += image.length
    return entry
  })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.concat([header, ...entries, ...images]))
  return target
}
