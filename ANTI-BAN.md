# Guide Anti-Ban WhatsApp avec Baileys

## 1. Préparer le numéro ("réchauffage")

Avant toute automatisation, le numéro doit avoir un historique normal.

- Utiliser le numéro manuellement pendant **minimum 2 semaines** avant d'automatiser
- Envoyer et recevoir des messages normalement
- Rejoindre quelques groupes réels
- Avoir au moins **20-30 contacts** enregistrés dans le téléphone
- Ne jamais démarrer l'automatisation sur un numéro fraîchement créé

---

## 2. Limites d'envoi recommandées

| Situation | Limite conseillée |
|---|---|
| Numéro nouveau (< 1 mois) | 20 messages/jour max |
| Numéro moyen (1-6 mois) | 100-200 messages/jour |
| Numéro ancien (> 6 mois) | 500-1000 messages/jour |
| Broadcast vers inconnus | Éviter totalement |
| Broadcast vers contacts | Max 50/heure |

---

## 3. Délais entre les messages

Ne jamais envoyer en rafale. Ajouter un délai aléatoire entre chaque message.

```js
// Mauvais — envoi en rafale
for (const jid of contacts) {
    await sock.sendMessage(jid, { text: 'Bonjour' });
}

// Bon — délai aléatoire entre chaque envoi
const randomDelay = (min, max) =>
    new Promise(r => setTimeout(r, Math.random() * (max - min) + min));

for (const jid of contacts) {
    await sock.sendMessage(jid, { text: 'Bonjour' });
    await randomDelay(3000, 8000); // entre 3 et 8 secondes
}
```

Règles de délai selon le volume :

- **< 50 messages** : 3-8 secondes entre chaque
- **50-200 messages** : 5-15 secondes entre chaque
- **> 200 messages** : 10-30 secondes entre chaque + pause de 5 min toutes les 50

---

## 4. Varier le contenu des messages

WhatsApp détecte les messages identiques répétés.

```js
// Mauvais — même texte pour tout le monde
const message = 'Bonjour, découvrez notre offre !';

// Bon — varier le texte
const templates = [
    'Bonjour {name}, découvrez notre offre !',
    'Salut {name} ! Une offre pour toi.',
    'Hey {name}, tu as vu notre dernière promo ?'
];

const getMessage = (name) => {
    const template = templates[Math.floor(Math.random() * templates.length)];
    return template.replace('{name}', name);
};
```

---

## 5. Envoyer uniquement vers des contacts qui ont le numéro

WhatsApp distingue "message à un contact" et "message à un inconnu".

```js
// Vérifier si le numéro existe sur WhatsApp avant d'envoyer
const [result] = await sock.onWhatsApp(phoneNumber);

if (!result?.exists) {
    console.log(`${phoneNumber} n'est pas sur WhatsApp, on skip`);
    continue;
}

await sock.sendMessage(result.jid, { text: message });
```

---

## 6. Simuler un comportement humain

```js
// Simuler "en train d'écrire" avant d'envoyer
await sock.sendPresenceUpdate('composing', jid);
await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
await sock.sendPresenceUpdate('paused', jid);
await sock.sendMessage(jid, { text: message });

// Marquer les messages reçus comme lus (comportement normal)
await sock.readMessages([msg.key]);
```

---

## 7. Infrastructure réseau

| Ce qu'il faut | Ce qu'il faut éviter |
|---|---|
| IP résidentielle (box internet normale) | IP datacenter (AWS, DigitalOcean, OVH...) |
| IP fixe ou avec peu de changements | VPN qui tourne de datacenter |
| Une IP par numéro | Plusieurs numéros sur la même IP |

Si tu dois utiliser un serveur cloud, utilise un proxy résidentiel :
- Brightdata
- Oxylabs
- Smartproxy

---

## 8. Gérer les reconnexions proprement

Trop de reconnexions fréquentes = signal suspect.

```js
sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
            // Attendre avant de reconnecter (pas immédiatement)
            await new Promise(r => setTimeout(r, 5000));
            connectToWhatsApp();
        }
    }
});
```

---

## 9. Ne jamais faire ces choses

- Envoyer des messages à des numéros achetés en liste (scraping)
- Ajouter des gens dans des groupes sans leur accord
- Changer le numéro de `version` dans `Defaults/index.js` sans vérifier qu'elle est valide
- Faire tourner le même numéro sur plusieurs serveurs en même temps
- Répondre automatiquement à chaque message dans la seconde
- Envoyer plus de 1000 messages/jour même sur un vieux numéro
- Utiliser le même message texte exact pour des centaines de destinataires

---

## 10. Gérer un ban

### Ban temporaire (soft ban)
- Le compte peut toujours recevoir des messages mais ne peut plus en envoyer
- Durée : 24h à 7 jours
- Solution : arrêter toute activité, attendre, reprendre doucement

### Ban permanent
- Code `DisconnectReason.loggedOut` (401) dans `connection.update`
- Le numéro est définitivement désactivé sur WhatsApp
- Seul recours : contacter le support WhatsApp (souvent inefficace)

```js
sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    const code = lastDisconnect?.error?.output?.statusCode;

    if (code === 401) {
        console.error('COMPTE BANNI DÉFINITIVEMENT — arrêter le bot');
        process.exit(1);
    }

    if (code === 403) {
        console.warn('COMPTE BANNI TEMPORAIREMENT — attendre 24-48h');
    }
});
```

---

## 11. Architecture recommandée pour plusieurs numéros

Si tu as besoin de volume, utilise plusieurs numéros avec une queue centralisée.

```
Queue centralisée (Redis / SQLite)
        │
        ├── Numéro A (max 200 msgs/jour)  → IP résidentielle A
        ├── Numéro B (max 200 msgs/jour)  → IP résidentielle B
        └── Numéro C (max 200 msgs/jour)  → IP résidentielle C
```

Règles :
- 1 numéro = 1 process Node.js = 1 IP
- Rotation des numéros si l'un est banni
- Jamais 2 numéros sur le même serveur sans proxy séparé

---

## 12. Version WhatsApp Web à maintenir à jour

La version déclarée dans `lib/Defaults/index.js` doit rester valide.

```js
const version = [2, 3000, 1040735178]; // à mettre à jour régulièrement
```

Pour récupérer la version actuelle valide :

```js
import { fetchLatestBaileysVersion } from '@alindawou/baileys';

const { version, isLatest } = await fetchLatestBaileysVersion();
console.log(`Version: ${version}, À jour: ${isLatest}`);
```

Si la version est invalide, WhatsApp retourne `DisconnectReason.badSession`.
