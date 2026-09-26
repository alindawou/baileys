import { readFileSync } from 'fs'
try {
   readFileSync('.env', 'utf8').split('\n').forEach(line => {
      const [k, v] = line.split('=')
      if (k && v) process.env[k.trim()] = v.trim()
   })
} catch {}
import { makeWASocket, delay, DisconnectReason, useMultiFileAuthState } from './lib/index.js'
import { Boom } from '@hapi/boom'
import pino from 'pino'

const myPhoneNumber = process.env.PHONE_NUMBER
if (!myPhoneNumber) {
   console.error('❌ PHONE_NUMBER is missing. Create a .env file with PHONE_NUMBER=your_number')
   process.exit(1)
}

const TEST_JID = `${process.env.TEST_NUMBER || myPhoneNumber}@s.whatsapp.net`
const logger = pino({ level: 'silent' })
let testSent = false

const pause = (min, max) => delay(Math.floor(Math.random() * (max - min + 1)) + min)

const sendTestMessages = async (sock) => {
   if (testSent) return
   testSent = true

   console.log('\n📤 Starting test sequence to', TEST_JID, '...\n')

   // 1. Text simple
   await sock.sendMessage(TEST_JID, { text: '👋 Hello! This is a test from @alindawou/baileys.' })
   console.log('✅ 1/10 Text sent')
   await pause(5000, 8000)

   // 2. Location
   await sock.sendMessage(TEST_JID, {
      location: {
         degreesLatitude: 6.3703,
         degreesLongitude: 2.3912,
         name: '📍 Cotonou, Benin'
      }
   })
   console.log('✅ 2/10 Location sent')
   await pause(5000, 8000)

   // 3. Live Location
   await sock.sendMessage(TEST_JID, {
      liveLocation: {
         degreesLatitude: 6.3703,
         degreesLongitude: 2.3912,
         accuracyInMeters: 10,
         caption: '📡 Live location test'
      }
   })
   console.log('✅ 3/10 Live Location sent')
   await pause(5000, 8000)

   // 4. Poll
   await sock.sendMessage(TEST_JID, {
      poll: {
         name: '🗳️ What is your favorite language?',
         values: ['JavaScript', 'PHP', 'Python', 'Rust'],
         selectableCount: 1
      }
   })
   console.log('✅ 4/10 Poll sent')
   await pause(5000, 8000)

   // 5. Contact card
   await sock.sendMessage(TEST_JID, {
      contacts: {
         displayName: 'Alindawou Dev',
         contacts: [{
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Alindawou Dev\nTEL;type=CELL;type=VOICE;waid=${myPhoneNumber}:+${myPhoneNumber}\nEND:VCARD`
         }]
      }
   })
   console.log('✅ 5/10 Contact sent')
   await pause(5000, 8000)

   // 6. Image with URL
   await sock.sendMessage(TEST_JID, {
      image: { url: 'https://picsum.photos/800/600' },
      caption: '🖼️ Image test from @alindawou/baileys'
   })
   console.log('✅ 6/10 Image sent')
   await pause(6000, 10000)

   // 7. Buttons
   await sock.sendMessage(TEST_JID, {
      buttons: [
         { buttonId: 'btn1', buttonText: { displayText: '✅ Yes' }, type: 1 },
         { buttonId: 'btn2', buttonText: { displayText: '❌ No' }, type: 1 },
         { buttonId: 'btn3', buttonText: { displayText: '🤷 Maybe' }, type: 1 }
      ],
      text: '🔘 Button message test',
      footer: '@alindawou/baileys'
   })
   console.log('✅ 7/10 Buttons sent')
   await pause(5000, 8000)

   // 8. List message
   await sock.sendMessage(TEST_JID, {
      sections: [{
         title: '⚙️ Options',
         rows: [
            { title: '📦 Feature 1', rowId: 'f1', description: 'First feature' },
            { title: '🚀 Feature 2', rowId: 'f2', description: 'Second feature' },
            { title: '🔥 Feature 3', rowId: 'f3', description: 'Third feature' }
         ]
      }],
      buttonText: 'Voir les options',
      text: '📋 List message test',
      footer: '@alindawou/baileys',
      title: 'Choose an option'
   })
   console.log('✅ 8/10 List sent')
   await pause(5000, 8000)

   // 9. Reaction
   const sent = await sock.sendMessage(TEST_JID, { text: '💬 React to this message ⬇️' })
   await pause(2000, 3000)
   await sock.sendMessage(TEST_JID, {
      react: { text: '🔥', key: sent.key }
   })
   console.log('✅ 9/10 Reaction sent')
   await pause(5000, 8000)

   // 10. Interactive buttons (cta_url / cta_copy render on Android, iOS and Web)
   await sock.sendMessage(TEST_JID, {
      text: '🧩 Interactive message test',
      footer: '@alindawou/baileys',
      nativeFlow: [
         { text: '🌐 Source', url: 'https://github.com/alindawou/baileys' },
         { text: '📋 Copy', copy: '@alindawou/baileys' }
      ]
   })
   console.log('✅ 10/10 Interactive sent')

   console.log('\n🎉 All tests completed successfully!\n')
}

const connectToWhatsApp = async () => {
   const { state, saveCreds } = await useMultiFileAuthState('session')
   const sock = makeWASocket({ logger, auth: state })

   sock.ev.on('creds.update', saveCreds)

   sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update

      if (connection === 'connecting' && !sock.authState.creds.registered) {
         await delay(1500)
         const code = await sock.requestPairingCode(myPhoneNumber)
         console.log('🔗 Pairing code :', code)
      } else if (connection === 'close') {
         const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
         console.log('⚠️ Connection closed because', lastDisconnect?.error?.message, ', reconnecting:', shouldReconnect)
         if (shouldReconnect) connectToWhatsApp()
      } else if (connection === 'open') {
         console.log('✅ Successfully connected to WhatsApp')
         await delay(3000)
         await sendTestMessages(sock)
      }
   })

   sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const message of messages) {
         if (!message.message) continue
         if (message.key.fromMe) continue
         console.log('🔔 Got new message from', message.key.remoteJid)
      }
   })
}

connectToWhatsApp()
