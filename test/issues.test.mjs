// Regression tests for fixes ported from itsliaaa/baileys and WhiskeySockets/Baileys issues
// Run: npm test  (set OFFLINE=1 to skip network tests)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const lib = await import(`${ROOT}/lib/index.js`)
const { buildProfilePictureQueryContent } = await import(`${ROOT}/lib/Socket/chats.js`)
const { generateLoginNode } = await import(`${ROOT}/lib/Utils/validate-connection.js`)
const { proto } = await import(`${ROOT}/WAProto/index.js`)

test('library loads and exports makeWASocket', () => {
    assert.equal(typeof lib.default ?? lib.makeWASocket, 'function')
})

test('profile picture query nests the tc token inside <picture>', () => {
    const tc = [{ tag: 'tctoken', attrs: { t: '123' }, content: Buffer.from('x') }]
    const nodes = buildProfilePictureQueryContent('image', tc)
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].tag, 'picture')
    assert.deepEqual(nodes[0].content, tc)
    // sans token : pas de content
    assert.equal(buildProfilePictureQueryContent('preview', undefined)[0].content, undefined)
})

test('android browser advertises ANDROID platform without webInfo', () => {
    const base = { version: [2, 3000, 1041589577], countryCode: 'BJ', syncFullHistory: false }
    const decode = n => (n instanceof Uint8Array ? proto.ClientPayload.decode(n) : n)
    const android = decode(generateLoginNode('22900000000:1@s.whatsapp.net', { ...base, browser: lib.Browsers.android('Chrome') }))
    assert.equal(android.userAgent.platform, proto.ClientPayload.UserAgent.Platform.ANDROID)
    assert.equal(android.webInfo ?? null, null)
    const web = decode(generateLoginNode('22900000000:1@s.whatsapp.net', { ...base, browser: lib.Browsers.ubuntu('Chrome') }))
    assert.equal(web.userAgent.platform, proto.ClientPayload.UserAgent.Platform.WEB)
    assert.ok(web.webInfo)
})

test('a single AsyncLocalStorage is shared by all stores (no per-socket leak)', () => {
    const src = readFileSync(`${ROOT}/lib/Utils/auth-utils.js`, 'utf8')
    assert.equal(src.match(/new AsyncLocalStorage\(\)/g).length, 1)
    assert.ok(src.indexOf('new AsyncLocalStorage()') < src.indexOf('export const addTransactionCapability'))
})

test('transactions of two independent stores stay isolated', async () => {
    const mk = () => {
        const data = {}
        return {
            get: async (type, ids) => Object.fromEntries(ids.map(id => [id, data[`${type}-${id}`]])),
            set: async d => { for (const t in d) for (const id in d[t]) data[`${t}-${id}`] = d[t][id] },
            data
        }
    }
    const logger = lib.DEFAULT_CONNECTION_CONFIG.logger
    const a = mk(), b = mk()
    const ta = lib.addTransactionCapability(a, logger, { maxCommitRetries: 1, delayBetweenTriesMs: 1 })
    const tb = lib.addTransactionCapability(b, logger, { maxCommitRetries: 1, delayBetweenTriesMs: 1 })
    await Promise.all([
        ta.transaction(async () => { await ta.set({ session: { x: 'A' } }) }, 'k'),
        tb.transaction(async () => { await tb.set({ session: { x: 'B' } }) }, 'k')
    ])
    assert.equal(a.data['session-x'], 'A')
    assert.equal(b.data['session-x'], 'B')
})

test('jidEncode never produces "@undefined"', () => {
    assert.ok(!lib.jidEncode('15990716915843', undefined, 9).includes('undefined'))
})

test('sent media has no hidden "view channel" annotation', async () => {
    const upload = async () => ({ mediaUrl: 'https://mmg.whatsapp.net/x', directPath: '/x' })
    const img = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
    const msg = await lib.generateWAMessageContent({ image: img, caption: 't' }, { upload, logger: undefined })
    assert.ok(msg.imageMessage)
    assert.equal(msg.imageMessage.annotations?.length ?? 0, 0)
    const src = readFileSync(`${ROOT}/lib/Utils/messages.js`, 'utf8')
    assert.ok(!src.includes('mediaAnnotation'))
})

test('legacy buttons + viewOnce are wrapped in viewOnceMessage', async () => {
    const msg = await lib.generateWAMessageContent({
        text: 'Bonjour', footer: 'pied',
        buttons: [{ buttonId: '1', buttonText: { displayText: 'Oui' }, type: 1 }],
        viewOnce: true
    }, { upload: async () => ({}) })
    assert.ok(msg.viewOnceMessage?.message?.buttonsMessage, JSON.stringify(Object.keys(msg)))
})

test('payment, invoice and order messages are removed', async () => {
    const src = readFileSync(`${ROOT}/lib/Utils/messages.js`, 'utf8')
    for (const k of ['requestPaymentFrom', 'invoiceNote', 'paymentInviteServiceType', 'orderText'])
        assert.ok(!src.includes(k), k)
    const biz = readFileSync(`${ROOT}/lib/WABinary/generic-utils.js`, 'utf8')
    for (const k of ['review_and_pay', 'payment_info', 'wa_payment_transaction_details'])
        assert.ok(!biz.includes(k), k)
})

test('windows browser advertises WIN_HYBRID (WhiskeySockets#2741)', () => {
    const n = generateLoginNode('22900000000:1@s.whatsapp.net', { version: [2, 3000, 1043857760], browser: lib.Browsers.windows('Desktop'), syncFullHistory: true })
    assert.equal(n.webInfo.webSubPlatform, proto.ClientPayload.WebInfo.WebSubPlatform.WIN_HYBRID)
})

test('default WA version is the upstream validated one (WhiskeySockets#2731)', () => {
    assert.deepEqual(lib.DEFAULT_CONNECTION_CONFIG.version, [2, 3000, 1043857760])
})

test('fetchLatestBaileysVersion fetches a version online', { skip: !!process.env.OFFLINE }, async () => {
    const r = await lib.fetchLatestBaileysVersion()
    assert.equal(r.isLatest, true, String(r.error))
    assert.equal(r.version.length, 3)
    
})

test('message ids have no fork signature (3EB0 + 18 hex)', () => {
    for (let i = 0; i < 50; i++) assert.match(lib.generateMessageIDV2('22900000001:1@s.whatsapp.net'), /^3EB0[0-9A-F]{18}$/)
})
