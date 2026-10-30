/** 截图浏览器的独立网络：公网地址先校验，再固定 IP 连接，不能借域名回到宿主。 */
const http = require('node:http')
const net = require('node:net')

async function createPublicProxy(resolveAddresses, signal) {
  const sockets = new Set()
  const track = socket => { sockets.add(socket); socket.once('close',()=>sockets.delete(socket)); socket.on('error',()=>{}); return socket }
  const target = async value => {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.username || url.password) throw new Error('不支持的截图网络地址')
    const addresses = await resolveAddresses(url.hostname,signal)
    signal.throwIfAborted()
    return {url,address:addresses[0]}
  }
  const server = http.createServer(async(req,res)=>{
    let remote
    try {
      const {url,address} = await target(req.url)
      const headers = {...req.headers,host:url.host}
      delete headers['proxy-authorization'];delete headers['proxy-connection'];delete headers.connection
      remote = http.request({hostname:address.address,family:address.family,port:url.port||80,path:url.pathname+url.search,method:req.method,headers,signal},response=>{
        res.writeHead(response.statusCode,response.headers);response.pipe(res)
      })
      remote.on('socket',track);remote.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()})
      req.pipe(remote);res.once('close',()=>remote.destroy())
    } catch { res.writeHead(403).end() }
  })
  server.on('connection',track)
  server.on('connect',async(req,client,head)=>{
    try {
      const {url,address} = await target('http://'+req.url)
      const remote = track(net.connect({host:address.address,family:address.family,port:Number(/:(\d+)$/.exec(req.url)?.[1])||443}))
      remote.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client)})
      remote.once('error',()=>client.destroy());client.once('close',()=>remote.destroy())
    } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n') }
  })
  const close = () => { server.close();for(const socket of sockets)socket.destroy();signal.removeEventListener('abort',close) }
  signal.addEventListener('abort',close,{once:true})
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    signal.throwIfAborted()
    return {port:server.address().port,close}
  } catch(error) { close();throw error }
}

/** 预览请求限于当前会话的只读路径；其他网络经固定地址代理。 */
function allowRenderRequest(url,method,previewRoot) {
  try {
    const u = new URL(url)
    if (['data:','blob:'].includes(u.protocol)) return true
    if (!['http:','https:','ws:','wss:'].includes(u.protocol) || u.username || u.password) return false
    if (u.hostname === 'localhost') return !!previewRoot && u.href.startsWith(previewRoot) && ['GET','HEAD'].includes(method)
    // 127.0.0.1、内网、DNS 重绑定等由代理在连接前拒绝，不存在直接连接的回退。
    return true
  } catch { return false }
}
module.exports = {createPublicProxy,allowRenderRequest}
