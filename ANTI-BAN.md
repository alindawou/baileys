# WhatsApp Anti-Ban Guide for Baileys

## 1. Prepare the number ("warm-up")

Before any automation, the number must have a normal history.

- Use the number manually for **at least 2 weeks** before automating it
- Send and receive messages normally
- Join a few real groups
- Have at least **20-30 contacts** saved in the phone
- Never start automating a freshly created number

---

## 2. Recommended sending limits

| Situation | Recommended limit |
|---|---|
| New number (< 1 month) | 20 messages/day max |
| Average number (1-6 months) | 100-200 messages/day |
| Old number (> 6 months) | 500-1000 messages/day |
| Broadcast to strangers | Avoid completely |
| Broadcast to contacts | Max 50/hour |

---

## 3. Delays between messages

Never send in bursts. Add a random delay between each message.

```js
// Bad — sending in bursts
for (const jid of contacts) {
    await sock.sendMessage(jid, { text: 'Hello' });
}

// Good — random delay between each message
const randomDelay = (min, max) =>
    new Promise(r => setTimeout(r, Math.random() * (max - min) + min));

for (const jid of contacts) {
    await sock.sendMessage(jid, { text: 'Hello' });
    await randomDelay(3000, 8000); // between 3 and 8 seconds
}
```

Delay rules by volume:

- **< 50 messages**: 3-8 seconds between each
- **50-200 messages**: 5-15 seconds between each
- **> 200 messages**: 10-30 seconds between each + a 5 min pause every 50

---

## 4. Vary the message content

WhatsApp detects identical repeated messages.

```js
// Bad — same text for everyone
const message = 'Hello, check out our offer!';

// Good — vary the text
const templates = [
    'Hello {name}, check out our offer!',
    'Hi {name}! An offer for you.',
    'Hey {name}, have you seen our latest deal?'
];

const getMessage = (name) => {
    const template = templates[Math.floor(Math.random() * templates.length)];
    return template.replace('{name}', name);
};
```

---

## 5. Only message contacts who have your number

WhatsApp distinguishes "message to a contact" from "message to a stranger".

```js
// Check that the number exists on WhatsApp before sending
const [result] = await sock.onWhatsApp(phoneNumber);

if (!result?.exists) {
    console.log(`${phoneNumber} is not on WhatsApp, skipping`);
    continue;
}

await sock.sendMessage(result.jid, { text: message });
```

---

## 6. Behave like a human

```js
// Show "typing…" before sending
await sock.sendPresenceUpdate('composing', jid);
await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
await sock.sendPresenceUpdate('paused', jid);
await sock.sendMessage(jid, { text: message });

// Mark received messages as read (normal behavior)
await sock.readMessages([msg.key]);
```

---

## 7. Network infrastructure

| Do | Avoid |
|---|---|
| Residential IP (regular home internet box) | Datacenter IP (AWS, DigitalOcean, OVH...) |
| Static IP or one that rarely changes | VPN running through a datacenter |
| One IP per number | Several numbers on the same IP |

If you must use a cloud server, use a residential proxy:
- Brightdata
- Oxylabs
- Smartproxy

---

## 8. Handle reconnections properly

Too many frequent reconnections = suspicious signal.

```js
sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
            // Wait before reconnecting (not immediately)
            await new Promise(r => setTimeout(r, 5000));
            connectToWhatsApp();
        }
    }
});
```

---

## 9. Never do these things

- Send messages to purchased or scraped number lists
- Add people to groups without their consent
- Change the `version` in `Defaults/index.js` without checking it is valid
- Run the same number on several servers at the same time
- Automatically reply to every message within a second
- Send more than 1000 messages/day, even from an old number
- Send the exact same text to hundreds of recipients

---

## 10. Handling a ban

### Temporary ban (soft ban)
- The account can still receive messages but can no longer send them
- Duration: 24h to 7 days
- Solution: stop all activity, wait, then resume slowly

### Permanent ban
- Code `DisconnectReason.loggedOut` (401) in `connection.update`
- The number is permanently disabled on WhatsApp
- Only option: contact WhatsApp support (often ineffective)

```js
sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    const code = lastDisconnect?.error?.output?.statusCode;

    if (code === 401) {
        console.error('ACCOUNT PERMANENTLY BANNED — stop the bot');
        process.exit(1);
    }

    if (code === 403) {
        console.warn('ACCOUNT TEMPORARILY BANNED — wait 24-48h');
    }
});
```

---

## 11. Recommended architecture for several numbers

If you need volume, use several numbers with a centralized queue.

```
Centralized queue (Redis / SQLite)
        │
        ├── Number A (max 200 msgs/day)  → residential IP A
        ├── Number B (max 200 msgs/day)  → residential IP B
        └── Number C (max 200 msgs/day)  → residential IP C
```

Rules:
- 1 number = 1 Node.js process = 1 IP
- Rotate numbers if one gets banned
- Never 2 numbers on the same server without separate proxies

---

## 12. Keep the WhatsApp Web version up to date

The version declared in `lib/Defaults/index.js` must stay valid.

```js
const version = [2, 3000, 1043857760]; // update regularly
```

To get the current valid version:

```js
import { fetchLatestBaileysVersion } from '@alindawou/baileys';

const { version, isLatest } = await fetchLatestBaileysVersion();
console.log(`Version: ${version}, up to date: ${isLatest}`);
```

If the version is invalid, WhatsApp rejects the connection during the handshake.
