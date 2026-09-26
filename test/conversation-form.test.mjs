// Offline tests of sock.createForm using a fake socket
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const lib = await import(`${ROOT}/lib/index.js`)
const { makeConversationForms, parseFormFieldReply, extractFormReply, DEFAULT_FORM_TEXTS: T } = lib

const PN = '22900000002@s.whatsapp.net'
const LID = '100000000000002@lid'

const fakeSock = () => {
   const ev = new EventEmitter()
   const sent = []
   const sock = {
      ev, logger: undefined, sent,
      sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'OUT' + sent.length } } },
      sendPresenceUpdate: async () => {},
      signalRepository: { lidMapping: { getLIDForPN: async () => '100000000000002:0@lid', getPNForLID: async () => PN } }
   }
   Object.assign(sock, makeConversationForms(sock))
   let n = 0
   sock.reply = async (message, from = LID) => {
      const msg = { key: { id: 'IN' + ++n, remoteJid: from, fromMe: false }, message }
      ev.emit('messages.upsert', { type: 'notify', messages: [msg] })
      await new Promise(r => setTimeout(r, 20)) // let the queue process the reply
      return msg
   }
   sock.text = t => sock.reply({ conversation: t })
   sock.button = id => sock.reply({ buttonsResponseMessage: { selectedButtonId: id } })
   sock.row = id => sock.reply({ listResponseMessage: { singleSelectReply: { selectedRowId: id } } })
   sock.last = () => sent[sent.length - 1].content
   return sock
}
const tick = () => new Promise(r => setTimeout(r, 20))

test('parseFormFieldReply: built-in validations', () => {
   const p = (field, text, id) => parseFormFieldReply(field, { text, id }, T)
   assert.equal(p({ type: 'number', min: 1, max: 20 }, '3').value, 3)
   assert.equal(p({ type: 'number' }, '2,5').value, 2.5)
   assert.ok(p({ type: 'number', min: 1, max: 20 }, 'beaucoup').error)
   assert.ok(p({ type: 'number', integer: true }, '2.5').error)
   assert.equal(p({ type: 'phone', defaultCountryCode: '229' }, '01 97 00 00 00').value, '2290197000000')
   assert.equal(p({ type: 'phone', defaultCountryCode: '229' }, '+229 01 97 00 00 00').value, '2290197000000')
   assert.ok(p({ type: 'phone' }, 'abc').error)
   assert.equal(p({ type: 'email' }, 'Boda@Mail.com').value, 'boda@mail.com')
   assert.ok(p({ type: 'email' }, 'boda@').error)
   assert.equal(p({ type: 'date' }, '25/12/2030').value.getMonth(), 11)
   assert.ok(p({ type: 'date' }, '31/02/2030').error)
   assert.ok(p({ type: 'date', future: true }, '01/01/2000').error)
   const choice = { type: 'choice', options: [{ id: 'g', text: 'Cake' }, 'Pie'] }
   assert.equal(p(choice, 'g', 'g').value, 'g')
   assert.equal(p(choice, '2').value, 'Pie')
   assert.equal(p(choice, 'pie').value, 'Pie')
   assert.equal(p(choice, 'cake').label, 'Cake')
   assert.ok(p(choice, 'pizza').error)
   assert.equal(p({ type: 'yesno' }, 'yes').value, true)
   assert.equal(p({ type: 'yesno' }, 'no', 'no').value, false)
   assert.ok(p({ type: 'text', min: 3 }, 'ab').error)
})

test('extractFormReply: buttons, list, native flow, location, media, viewOnce', () => {
   assert.equal(extractFormReply({ message: { buttonsResponseMessage: { selectedButtonId: 'a' } } }).id, 'a')
   assert.equal(extractFormReply({ message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'b' } } } }).id, 'b')
   assert.equal(extractFormReply({ message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"c"}' } } } }).id, 'c')
   assert.equal(extractFormReply({ message: { locationMessage: { degreesLatitude: 6.4, degreesLongitude: 2.3 } } }).location.latitude, 6.4)
   assert.equal(extractFormReply({ message: { imageMessage: { mimetype: 'image/jpeg' } } }).media.type, 'image')
   assert.equal(extractFormReply({ message: { ephemeralMessage: { message: { conversation: ' hello ' } } } }).text, 'hello')
   assert.equal(extractFormReply({ message: { reactionMessage: {} } }), undefined)
})

test('full form: errors, back, list, location, confirmation (replies from LID)', async () => {
   const sock = fakeSock()
   const form = sock.createForm({
      title: 'Order', typing: false,
      fields: [
         { key: 'name', label: 'Name', question: 'Your name?', min: 3 },
         { key: 'product', label: 'Product', type: 'choice', question: 'Product?', options: [{ id: 'cake', text: 'Cake' }, { id: 'pie', text: 'Pie' }] },
         { key: 'size', label: 'Size', type: 'choice', question: 'Size?', options: ['S', 'M', 'L', 'XL'] },
         { key: 'quantity', label: 'Quantity', type: 'number', question: 'How many?', min: 1, max: 20, integer: true },
         { key: 'address', label: 'Address', type: 'location', question: 'Address?' }
      ]
   })
   const done = form.ask(PN, { intro: 'Hello!' })
   await tick()
   assert.equal(sock.sent[0].content.text, 'Hello!')
   assert.match(sock.last().text, /1\/5.*Your name/)
   assert.equal(sock.sent[0].jid, PN)

   const m1 = await sock.text('ab')
   assert.equal(sock.isFormReply(m1), true)
   assert.equal(sock.last().text, T.invalidText(3, 4096))
   await sock.text('Boda')
   assert.equal(sock.last().buttons.length, 2)                 // ≤ 3 options → buttons
   assert.ok(sock.last().viewOnce)
   await sock.button('cake')
   assert.equal(sock.last().sections[0].rows.length, 4)        // > 3 options → list
   await sock.text('back')                                    // back to the product question
   assert.match(sock.last().text, /Product/)
   await sock.button('pie')
   await sock.row('M')
   await sock.text('beaucoup')
   assert.match(sock.last().text, /number/)
   await sock.text('4')
   await sock.reply({ locationMessage: { degreesLatitude: 6.4091765, degreesLongitude: 2.3352802 } })
   const summary = sock.last()
   assert.match(summary.text, /Summary/)
   assert.match(summary.text, /Product: Pie/)
   assert.match(summary.text, /Quantity: 4/)
   assert.deepEqual(summary.buttons.map(b => b.buttonId), ['confirm', 'restart', 'cancel'])
   await sock.text('whatever')
   assert.equal(sock.last().text, T.useConfirmButtons)
   await sock.button('confirm')

   const r = await done
   assert.equal(r.status, 'completed')
   assert.deepEqual({ ...r.answers, address: undefined }, { name: 'Boda', product: 'pie', size: 'M', quantity: 4, address: undefined })
   assert.equal(r.answers.address.latitude, 6.4091765)
   assert.equal(r.labels.product, 'Pie')
   assert.equal(sock.last().text, T.completed)
   assert.equal(form.isActive(PN), false)
})

test('cancel at any time', async () => {
   const sock = fakeSock()
   const form = sock.createForm({ typing: false, fields: [{ key: 'a', question: 'A?' }, { key: 'b', question: 'B?' }] })
   const done = form.ask(PN)
   await tick()
   await sock.text('x-ok')
   await sock.text('Cancel')
   const r = await done
   assert.equal(r.status, 'cancelled')
   assert.equal(r.answers.a, 'x-ok')
   assert.equal(sock.last().text, T.cancelled)
})

test('optional field, conditional field, yes/no, no confirmation', async () => {
   const sock = fakeSock()
   const form = sock.createForm({
      typing: false, confirm: false,
      fields: [
         { key: 'delivery', type: 'yesno', question: 'Delivery?' },
         { key: 'address', question: 'Address?', when: a => a.delivery === true },
         { key: 'note', question: 'Any comment?', optional: true }
      ]
   })
   const done = form.ask(PN)
   await tick()
   assert.match(sock.last().text, /1\/3/)
   await sock.button('no')                     // no delivery → address skipped
   assert.match(sock.last().text, /2\/2.*comment/s)
   await sock.text('skip')
   const r = await done
   assert.equal(r.status, 'completed')
   assert.deepEqual(r.answers, { delivery: false, note: null })
   assert.equal('address' in r.answers, false)
})

test('custom validate, other contacts ignored, replies from PN', async () => {
   const sock = fakeSock()
   const form = sock.createForm({
      typing: false, confirm: false,
      fields: [{ key: 'code', question: 'Promo code?', validate: v => v === 'AFRIK' || 'Unknown code.' }]
   })
   const done = form.ask(PN)
   await tick()
   const other = await sock.reply({ conversation: 'AFRIK' }, '22900000000@s.whatsapp.net')
   assert.equal(sock.isFormReply(other), false)
   assert.equal(form.isActive(PN), true)
   await sock.reply({ conversation: 'test' }, PN)
   assert.equal(sock.last().text, 'Unknown code.')
   await sock.reply({ conversation: 'AFRIK' }, PN)
   assert.equal((await done).answers.code, 'AFRIK')
})

test('timeout and replacing a running form', async () => {
   const sock = fakeSock()
   const form = sock.createForm({ typing: false, timeoutMs: 60, fields: [{ key: 'a', question: 'A?' }] })
   const r1 = await form.ask(PN)
   assert.equal(r1.status, 'timeout')
   assert.equal(sock.last().text, T.timeout)

   const slow = sock.createForm({ typing: false, timeoutMs: 0, fields: [{ key: 'a', question: 'A?' }] })
   const first = slow.ask(PN)
   await tick()
   const second = slow.ask(LID)            // same contact through its LID
   assert.equal((await first).status, 'replaced')
   await tick()
   await sock.text('ok')
   await sock.button('confirm')
   assert.equal((await second).status, 'completed')
})

test('invalid definitions and group chats are rejected', async () => {
   const sock = fakeSock()
   assert.throws(() => sock.createForm({ fields: [] }))
   assert.throws(() => sock.createForm({ fields: [{ key: 'a', question: 'A' }, { key: 'a', question: 'B' }] }))
   assert.throws(() => sock.createForm({ fields: [{ key: 'a', question: 'A', type: 'foo' }] }))
   assert.throws(() => sock.createForm({ fields: [{ key: 'a', question: 'A', type: 'choice' }] }))
   await assert.rejects(sock.createForm({ fields: [{ key: 'a', question: 'A' }] }).ask('123@g.us'))
})

test('makeWASocket exposes createForm / isFormReply / cancelForm', () => {
   const sock = lib.makeWASocket({ auth: { creds: lib.initAuthCreds(), keys: { get: async () => ({}), set: async () => {} } }, logger: lib.DEFAULT_CONNECTION_CONFIG.logger.child({}, { level: 'silent' }) })
   for (const fn of ['createForm', 'isFormReply', 'cancelForm', 'getActiveForms', 'sendMessage']) assert.equal(typeof sock[fn], 'function', fn)
   sock.end(undefined)
})
