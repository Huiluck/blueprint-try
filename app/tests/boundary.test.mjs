import test from 'node:test'
import assert from 'node:assert/strict'
import { permitsRequest } from '../runtime/boundary.mjs'

test('本地入口要求本次应用凭据与同源来源', () => {
  const token = 'a'.repeat(64)
  const valid = { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100', cookie: `blueprint_session=${token}` }
  assert.equal(permitsRequest({ headers: valid }, 3100, token), true)
  assert.equal(permitsRequest({ headers: { host: valid.host, cookie: valid.cookie } }, 3100, token), true)
  for (const change of [{ cookie: '' }, { cookie: 'blueprint_session=' + 'b'.repeat(64) }, { host: 'attacker.example:3100' }, { origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal(permitsRequest({ headers: { ...valid, ...change } }, 3100, token), false)
  }
})
