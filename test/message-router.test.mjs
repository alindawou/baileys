// Offline tests of sock.createRouter using a fake socket
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const lib = await import(`${ROOT}/lib/index.js`)
const { makeConversationForms, makeMessageRouter, getRouterMessageType } = lib

const PN = '22900000002@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'
const tick = () => new Promise(r => setTimeout(r, 20))

const fakeSock = () => {
   const ev = new EventEmitter()
   const sent = []
   const sock = {
      ev, logger: undefined, sent,
      sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'OUT' + sent.length } } },
      sendPresenceUpdate: async () => {},
      signalRepository: { lidMapping: { getLIDForPN: async () => null, getPNForLID: async () => null } }
   }
   Object.assign(sock, makeConversationForms(sock))
   Object.assign(sock, makeMessageRouter(sock))
   let n = 0
   sock.receive = async (message, { from = PN, participant, fromMe = false } = {}) => {
      const msg = { key: { id: 'IN' + ++n, remoteJid: from, participant, fromMe }, message, pushName: 'Boda' }
      ev.emit('messages.upsert', { type: 'notify', messages: [msg] })
      await tick()
      return msg
   }
   sock.text = (t, opts) => sock.receive({ conversation: t }, opts)
   sock.button = (id, opts) => sock.receive({ buttonsResponseMessage: { selectedButtonId: id } }, opts)
   sock.row = (id, opts) => sock.receive({ listResponseMessage: { singleSelectReply: { selectedRowId: id } } }, opts)
   sock.last = () => sent[sent.length - 1]?.content
   return sock
}

test('commands: with or without prefix, args, aliases, case insensitive', async () => {
   const sock = fakeSock()
   const calls = []
   const bot = sock.createRouter()
   bot.command(['order', 'buy'], ctx => calls.push([ctx.command, ctx.args, ctx.argText, ctx.prefix]))
   await sock.text('order 2 cakes')
   await sock.text('/BUY 3 pies')
   await sock.text('!order')
   await sock.text('reorder now')              // not a command
   assert.deepEqual(calls, [
      ['order', ['2', 'cakes'], '2 cakes', ''],
      ['buy', ['3', 'pies'], '3 pies', '/'],
      ['order', [], '', '!']
   ])
})

test('custom prefix only accepts prefixed commands', async () => {
   const sock = fakeSock()
   let count = 0
   sock.createRouter({ prefix: '/' }).command('help', () => count++)
   await sock.text('help')
   await sock.text('/help')
   assert.equal(count, 1)
})

test('hears (string, RegExp with ctx.match, predicate) and fallback', async () => {
   const sock = fakeSock()
   const bot = sock.createRouter()
   const seen = []
   bot.hears('hello', ctx => ctx.reply('Hi!'))
   bot.hears(/^price (\w+)$/i, ctx => seen.push(ctx.match[1]))
   bot.hears(text => text.length > 50, () => seen.push('long'))
   bot.fallback(ctx => ctx.reply('Unknown'))
   await sock.text('HELLO')
   assert.equal(sock.last().text, 'Hi!')
   await sock.text('price cake')
   await sock.text('x'.repeat(60))
   await sock.text('something else')
   assert.deepEqual(seen, ['cake', 'long'])
   assert.equal(sock.last().text, 'Unknown')
})

test('buttons by id or RegExp, list rows and native flow replies', async () => {
   const sock = fakeSock()
   const bot = sock.createRouter()
   const ids = []
   bot.button('yes', ctx => ids.push(ctx.id))
   bot.button(/^product:(\d+)$/, ctx => ids.push(ctx.match[1]))
   await sock.button('yes')
   await sock.row('product:42')
   await sock.receive({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"yes"}' } } })
   assert.deepEqual(ids, ['yes', '42', 'yes'])
})

test('message type handlers: location, image, contact', async () => {
   const sock = fakeSock()
   const bot = sock.createRouter()
   const seen = []
   bot.on('location', ctx => seen.push(['location', ctx.location.latitude]))
   bot.on('image', ctx => seen.push(['image', ctx.media.mimetype]))
   bot.on('contact', ctx => seen.push(['contact', ctx.type]))
   await sock.receive({ locationMessage: { degreesLatitude: 6.37, degreesLongitude: 2.39 } })
   await sock.receive({ imageMessage: { mimetype: 'image/jpeg' } })
   await sock.receive({ contactMessage: { displayName: 'A', vcard: 'BEGIN:VCARD' } })
   assert.deepEqual(seen, [['location', 6.37], ['image', 'image/jpeg'], ['contact', 'contact']])
   assert.equal(getRouterMessageType({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'a' } } } } }), 'text')
   assert.throws(() => bot.on('unknown', () => {}))
})

test('menus: buttons, list, sub menu, run, typed number or text', async () => {
   const sock = fakeSock()
   const bot = sock.createRouter()
   const ran = []
   bot.menu('main', {
      text: 'Welcome', footer: 'Shop', numbered: true,
      options: [
         { id: 'order', text: 'Order', menu: 'products' },
         { id: 'hours', text: 'Opening hours', run: ctx => ctx.reply('8am - 8pm') },
         { id: 'agent', text: 'Talk to an agent', run: ctx => ran.push('agent') }
      ]
   })
   bot.menu('products', {
      text: 'Choose a product', buttonText: 'Products',
      options: ['Cake', 'Pie', 'Cookies', { id: 'back', text: 'Back', menu: 'main' }]
   })
   bot.command('menu', ctx => ctx.showMenu('main'))

   await sock.text('menu')
   const main = sock.last()
   assert.match(main.text, /Welcome\n\n1\. Order\n2\. Opening hours\n3\. Talk to an agent/)
   assert.deepEqual(main.buttons.map(b => b.buttonId), ['menu:main:order', 'menu:main:hours', 'menu:main:agent'])

   await sock.button('menu:main:hours')
   assert.equal(sock.last().text, '8am - 8pm')

   await sock.button('menu:main:order')             // sub menu with 4 options → list
   const products = sock.last()
   assert.equal(products.buttonText, 'Products')
   assert.deepEqual(products.sections[0].rows.map(r => r.rowId), ['menu:products:Cake', 'menu:products:Pie', 'menu:products:Cookies', 'menu:products:back'])

   const picked = []
   bot.use(async (ctx, next) => { await next(); if (ctx.menu === 'products' && ctx.option !== 'back') picked.push(ctx.option) })
   await sock.row('menu:products:Pie')
   await sock.text('3')                             // typed number, last menu = products
   await sock.text('back')                          // typed option id → main menu again
   assert.deepEqual(picked, ['Pie', 'Cookies'])
   assert.match(sock.last().text, /Welcome/)
   await sock.text('talk to an agent')              // typed option text of the main menu
   assert.deepEqual(ran, ['agent'])

   assert.throws(() => bot.menu('bad', { text: 'x', options: [] }))
   assert.throws(() => bot.menu('dup', { text: 'x', options: ['a', 'a'] }))
})

test('middlewares run in order and can stop the chain', async () => {
   const sock = fakeSock()
   const bot = sock.createRouter()
   const order = []
   bot.use(async (ctx, next) => { order.push('m1'); await next(); order.push('m1 end') })
   bot.use(async (ctx, next) => { if (ctx.text === 'blocked') return ctx.reply('Not allowed'); await next() })
   bot.command('ping', ctx => { order.push('ping'); return ctx.reply('pong') })
   await sock.text('ping')
   assert.deepEqual(order, ['m1', 'ping', 'm1 end'])
   await sock.text('blocked')
   assert.equal(sock.last().text, 'Not allowed')
})

test('groups are ignored by default, sender is the participant when enabled', async () => {
   const sock = fakeSock()
   const privateOnly = []
   sock.createRouter().command('ping', ctx => privateOnly.push(ctx.jid))
   await sock.text('ping', { from: GROUP, participant: PN })
   assert.deepEqual(privateOnly, [])

   const sock2 = fakeSock()
   const seen = []
   sock2.createRouter({ groups: true }).command('ping', ctx => seen.push([ctx.jid, ctx.sender, ctx.isGroup]))
   await sock2.text('ping', { from: GROUP, participant: PN })
   assert.deepEqual(seen, [[GROUP, PN, true]])
})

test('own messages, status and newsletters are ignored', async () => {
   const sock = fakeSock()
   let count = 0
   sock.createRouter().fallback(() => count++)
   await sock.text('hi', { fromMe: true })
   await sock.text('hi', { from: 'status@broadcast' })
   await sock.text('hi', { from: '120363000000000000@newsletter' })
   assert.equal(count, 0)
})

test('ctx.ask starts a form, and replies to the form are not routed', async () => {
   const sock = fakeSock()
   const bot = sock.createRouter()
   let result
   const routed = []
   bot.command('signup', async ctx => {
      result = await ctx.ask({ typing: false, confirm: false, fields: [{ key: 'name', question: 'Your name?' }] })
      await ctx.reply(`Welcome ${result.answers.name}`)
   })
   bot.fallback(ctx => routed.push(ctx.text))
   await sock.text('signup')
   assert.match(sock.last().text, /Your name/)
   await sock.text('Boda')                           // consumed by the form, not by the fallback
   await tick()
   assert.equal(result.status, 'completed')
   assert.equal(sock.last().text, 'Welcome Boda')
   assert.deepEqual(routed, [])
   await sock.text('hello again')
   assert.deepEqual(routed, ['hello again'])
})

test('errors go to onError, per-chat session, help(), stop()', async () => {
   const sock = fakeSock()
   const errors = []
   const bot = sock.createRouter({ onError: (error, ctx) => errors.push([error.message, ctx.text]) })
   bot.command('boom', () => { throw new Error('failed') }, { description: 'always fails' })
   bot.command(['count', 'c'], ctx => { ctx.session.n = (ctx.session.n || 0) + 1; return ctx.reply(String(ctx.session.n)) }, { description: 'counter' })
   await sock.text('boom')
   assert.deepEqual(errors, [['failed', 'boom']])
   await sock.text('count')
   await sock.text('c')
   assert.equal(sock.last().text, '2')
   await sock.text('count', { from: '22900000003@s.whatsapp.net' })
   assert.equal(sock.last().text, '1')
   assert.equal(bot.help(), 'boom — always fails\ncount (c) — counter')
   bot.stop()
   await sock.text('count')
   assert.equal(sock.last().text, '1')
})

test('messages of the same chat are handled in order', async () => {
   const sock = fakeSock()
   const done = []
   sock.createRouter().hears(/^\d$/, async ctx => {
      await new Promise(r => setTimeout(r, ctx.text === '1' ? 40 : 1))
      done.push(ctx.text)
   })
   const msg = t => ({ key: { id: t, remoteJid: PN, fromMe: false }, message: { conversation: t } })
   sock.ev.emit('messages.upsert', { type: 'notify', messages: [msg('1'), msg('2')] })
   await new Promise(r => setTimeout(r, 80))
   assert.deepEqual(done, ['1', '2'])
})

test('makeWASocket exposes createRouter', () => {
   const sock = lib.makeWASocket({ auth: { creds: lib.initAuthCreds(), keys: { get: async () => ({}), set: async () => {} } }, logger: lib.DEFAULT_CONNECTION_CONFIG.logger.child({}, { level: 'silent' }) })
   assert.equal(typeof sock.createRouter, 'function')
   assert.equal(typeof sock.createForm, 'function')
   sock.end(undefined)
})
