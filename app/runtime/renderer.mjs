/** 仅通过桌面宿主的父子进程 IPC 取得截图，不给模型命令开放宿主 API。 */
import { randomUUID } from 'node:crypto'

export function createDesktopRenderer(channel = process, timeoutMs = 35000) {
  const pending = new Map()
  const send = message => channel.send(message, error => { if (error) pending.get(message.id)?.finish(error) })
  const receive = message => {
    if (message?.type !== 'render-result') return
    const request = pending.get(message.id)
    if (!request) return
    if (message.error) return request.finish(new Error(message.error))
    try {
      if (typeof message.png !== 'string' || message.png.length > 24 * 1024 * 1024) throw new Error('截图超过大小限制')
      const png = Buffer.from(message.png, 'base64')
      if (!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw new Error('内置浏览器没有返回 PNG 截图')
      request.finish(null, png)
    } catch (error) { request.finish(error) }
  }
  const disconnected = () => { for (const request of [...pending.values()]) request.finish(new Error('桌面浏览器已断开')) }
  channel.on('message', receive)
  channel.on('disconnect', disconnected)
  return {
    render(request, signal) {
      if (signal?.aborted) return Promise.reject(signal.reason || new Error('截图已停止'))
      if (!channel.connected) return Promise.reject(new Error('桌面浏览器未连接'))
      return new Promise((resolve,reject) => {
        const id = randomUUID()
        const cancel = error => { if (channel.connected) send({type:'render-cancel',id}); finish(error) }
        const abort = () => cancel(new Error('截图已停止'))
        const timer = setTimeout(() => cancel(new Error('内置浏览器截图超时')),timeoutMs)
        const finish = (error,value) => {
          if (!pending.delete(id)) return
          clearTimeout(timer);signal?.removeEventListener('abort',abort)
          error ? reject(error) : resolve(value)
        }
        pending.set(id,{finish})
        signal?.addEventListener('abort',abort,{once:true})
        try { send({type:'render-page',id,...request}) } catch (error) { finish(error) }
      })
    },
    dispose() { disconnected();channel.removeListener('message',receive);channel.removeListener('disconnect',disconnected) },
  }
}
