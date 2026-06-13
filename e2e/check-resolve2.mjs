import puppeteer from 'puppeteer-core'
const DEV = '0c865c07cf3cc8c113077b3e'
const b = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
  protocolTimeout: 60000,
})
const p = await b.newPage()
await p.goto('https://jyi.cc', { waitUntil: 'domcontentloaded' })
async function metaPath(page, sess) {
  return await page.evaluate(
    async (DEV, sess) => {
      const r = await fetch('/x/' + DEV + '/sse/jsonl?session=' + sess + '&tail=1')
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (let i = 0; i < 8; i++) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        if (buf.includes('event: meta')) break
      }
      reader.cancel()
      const m = buf.match(/data: (\{.*\})/)
      return m ? JSON.parse(m[1]).path : 'raw:' + buf.slice(0, 120)
    },
    DEV,
    sess,
  )
}
// 取 /sessions 里 cwd=/Users/jinxing 的若干 session,逐个看 cc-<sid8> 解析到哪个文件。
const rows = await p.evaluate(async (DEV) => {
  const j = await (await fetch('/x/' + DEV + '/sessions')).json()
  const r = Array.isArray(j) ? j : j.sessions || []
  return r
    .filter((x) => x.cwd === '/Users/jinxing')
    .slice(0, 5)
    .map((x) => ({ sid: x.session_id, live: x.live, last_ts: x.last_ts }))
}, DEV)
const out = []
for (const r of rows) {
  const cc = 'cc-' + r.sid.slice(0, 8)
  const path = await metaPath(p, cc)
  const resolvedSid = (path.match(/([0-9a-f-]{36})\.jsonl$/) || [])[1] || path
  out.push({
    requested_sid: r.sid,
    tmux: cc,
    resolved_sid: resolvedSid,
    MATCH: resolvedSid === r.sid,
  })
}
console.log(JSON.stringify(out, null, 2))
await p.close()
await b.disconnect()
