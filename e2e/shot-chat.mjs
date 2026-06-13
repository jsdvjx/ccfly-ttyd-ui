// shot-chat.mjs — 连到已登录的 CDP Chrome,打开 cc.hn 某会话,强制 chat 视图,截图。
import puppeteer from 'puppeteer-core'

const SID = process.argv[2] || 'b717ce86-d5e8-4856-856e-c4924e3a61c8'
const DEVICE = process.argv[3] || 'jinxingdeMBP.lan'
const ORIGIN = 'https://jyi.cc'
const OUT = '/tmp/chat-view.png'

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 2 })

// 先到源站设 localStorage(强制 chat 视图),再用 /d/<device>/<session> 路径深链。
await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.setItem('ccfly:view', 'chat'))
await page.goto(`${ORIGIN}/d/${encodeURIComponent(DEVICE)}/${SID}`, {
  waitUntil: 'domcontentloaded',
})

// 等 transcript 出现(.ccfly-chat 渲染);最多 20s。
try {
  await page.waitForSelector('.ccfly-chat', { timeout: 20000 })
} catch {
  console.log('WARN: .ccfly-chat not found — maybe still term mode; trying toggle')
}
// 若仍在 term 态,点「对话」切换。
const toggled = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find((x) => x.textContent.trim() === '对话')
  if (b) {
    b.click()
    return true
  }
  return false
})
if (toggled) await new Promise((r) => setTimeout(r, 1500))

// 给 jsonl 一点时间灌入。
await new Promise((r) => setTimeout(r, 3500))

const turns = await page.evaluate(
  () => document.querySelectorAll('.ccfly-chat .turn, .turn').length,
)
const hasChat = await page.evaluate(() => !!document.querySelector('.ccfly-chat'))
console.log(`chat mounted=${hasChat} turns=${turns}`)

await page.screenshot({ path: OUT, fullPage: false })
console.log('shot ->', OUT)
// 裁一块 transcript 中部看细节(时间线点 / IN-OUT / 粗细对比)。
await page.screenshot({
  path: '/tmp/chat-zoom.png',
  clip: { x: 230, y: 70, width: 760, height: 470 },
})
console.log('zoom -> /tmp/chat-zoom.png')
await page.close()
await browser.disconnect()
