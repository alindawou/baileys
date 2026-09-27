import { Boom } from '@hapi/boom';
import { isJidGroup, isJidNewsletter, isJidStatusBroadcast, jidNormalizedUser } from '../WABinary/index.js';
import { extractFormReply } from './conversation-form.js';
import { delay } from './generics.js';
import { getContentType, normalizeMessageContent } from './messages.js';
/**
 * Message router: dispatch incoming messages to command, text, button, menu and
 * message type handlers, so bots do not have to hand-write `messages.upsert` parsing.
 */
export const ROUTER_MESSAGE_TYPES = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'poll', 'reaction'];
const MENU_ID_PREFIX = 'menu:';
const MAX_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const LAST_MENU_TTL_MS = 30 * 60000;
const CONTENT_TYPES = {
    conversation: 'text',
    extendedTextMessage: 'text',
    imageMessage: 'image',
    videoMessage: 'video',
    ptvMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
    locationMessage: 'location',
    liveLocationMessage: 'location',
    contactMessage: 'contact',
    contactsArrayMessage: 'contact',
    pollCreationMessage: 'poll',
    pollCreationMessageV2: 'poll',
    pollCreationMessageV3: 'poll',
    reactionMessage: 'reaction'
};
const toMatcher = (pattern, ignoreCase) => {
    if (pattern instanceof RegExp) {
        return (value) => {
            const match = value?.match(pattern);
            return match ? { match } : undefined;
        };
    }
    if (typeof pattern === 'function') {
        return (value, ctx) => (pattern(value, ctx) ? {} : undefined);
    }
    const expected = ignoreCase ? String(pattern).toLowerCase() : String(pattern);
    return (value) => {
        const actual = ignoreCase ? value?.toLowerCase() : value;
        return actual === expected ? {} : undefined;
    };
};
/**
 * Returns the router message type ('text', 'image', 'location'...) of a message, or undefined.
 */
export const getRouterMessageType = (msg) => {
    const content = normalizeMessageContent(msg.message);
    const key = getContentType(content);
    return key ? CONTENT_TYPES[key] : undefined;
};
/**
 * Adds message routers on top of a socket.
 */
export const makeMessageRouter = (sock) => {
    const { ev, logger } = sock;
    const createRouter = (options = {}) => {
        const config = {
            prefix: options.prefix ?? ['', '/', '!', '.'],
            groups: options.groups ?? false,
            ignoreCase: options.ignoreCase ?? true,
            typing: options.typing ?? false,
            onError: options.onError
        };
        // longest prefix first so "!!" wins over "!"
        const prefixes = [].concat(config.prefix).sort((a, b) => b.length - a.length);
        const middlewares = [];
        const commands = [];
        const hears = [];
        const buttons = [];
        const typeHandlers = new Map();
        const menus = new Map();
        const lastMenus = new Map();
        const sessions = new Map();
        const queues = new Map();
        let fallbackHandler;
        let running = false;
        const sendMenu = async (jid, name) => {
            const menu = menus.get(name);
            if (!menu) {
                throw new Boom(`Unknown menu "${name}"`, { statusCode: 400 });
            }
            const options = menu.options;
            let text = menu.text;
            if (menu.numbered) {
                text += '\n\n' + options.map((o, i) => `${i + 1}. ${o.text}`).join('\n');
            }
            const id = (option) => `${MENU_ID_PREFIX}${name}:${option.id}`;
            let content;
            if (options.length <= MAX_BUTTONS && !menu.list) {
                content = {
                    text,
                    footer: menu.footer,
                    buttons: options.map(o => ({ buttonId: id(o), buttonText: { displayText: o.text }, type: 1 })),
                    viewOnce: true
                };
            }
            else {
                const sections = [];
                for (let i = 0; i < options.length; i += MAX_LIST_ROWS) {
                    sections.push({
                        title: menu.sectionTitle || menu.title || 'Options',
                        rows: options.slice(i, i + MAX_LIST_ROWS).map(o => ({ title: o.text, rowId: id(o), description: o.description }))
                    });
                }
                content = {
                    text,
                    footer: menu.footer,
                    title: menu.title,
                    buttonText: menu.buttonText || 'See options',
                    sections
                };
            }
            lastMenus.set(jid, { name, at: Date.now() });
            return sock.sendMessage(jid, content);
        };
        const findMenuOption = (jid, reply) => {
            if (reply.id?.startsWith(MENU_ID_PREFIX)) {
                const rest = reply.id.slice(MENU_ID_PREFIX.length);
                const separator = rest.indexOf(':');
                const menu = menus.get(rest.slice(0, separator));
                const option = menu?.options.find(o => o.id === rest.slice(separator + 1));
                return option && { menu, option };
            }
            // typed answer to the last menu: its number or its text (useful where buttons do not render)
            const last = lastMenus.get(jid);
            if (!reply.id && reply.text && last && Date.now() - last.at < LAST_MENU_TTL_MS) {
                const menu = menus.get(last.name);
                const wanted = reply.text.trim().toLowerCase();
                const option = /^\d+$/.test(wanted)
                    ? menu?.options[+wanted - 1]
                    : menu?.options.find(o => o.text.toLowerCase() === wanted || o.id.toLowerCase() === wanted);
                return option && { menu, option };
            }
            return undefined;
        };
        const parseCommand = (text) => {
            if (!text) {
                return undefined;
            }
            for (const prefix of prefixes) {
                if (!text.startsWith(prefix)) {
                    continue;
                }
                const body = text.slice(prefix.length).trim();
                const [word, ...args] = body.split(/\s+/);
                if (!word) {
                    continue;
                }
                const name = config.ignoreCase ? word.toLowerCase() : word;
                const command = commands.find(c => c.names.includes(name));
                if (command) {
                    return { command, name, args, argText: body.slice(word.length).trim(), prefix };
                }
            }
            return undefined;
        };
        const buildContext = (msg) => {
            const jid = msg.key.remoteJid;
            const reply = extractFormReply(msg) || {};
            const isGroup = !!isJidGroup(jid);
            const sender = isGroup ? (msg.key.participantAlt || msg.key.participant) : (msg.key.remoteJidAlt || jid);
            if (!sessions.has(jid)) {
                sessions.set(jid, {});
            }
            const ctx = {
                sock,
                message: msg,
                key: msg.key,
                jid,
                sender: sender && jidNormalizedUser(sender),
                isGroup,
                pushName: msg.pushName,
                type: getRouterMessageType(msg),
                text: reply.text ?? reply.media?.caption,
                id: reply.id,
                location: reply.location,
                media: reply.media,
                session: sessions.get(jid),
                reply: (content, sendOptions) => sock.sendMessage(jid, typeof content === 'string' ? { text: content } : content, sendOptions),
                react: (emoji) => sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }),
                typing: async (ms = 1200) => {
                    try {
                        await sock.sendPresenceUpdate('composing', jid);
                        await delay(ms);
                        await sock.sendPresenceUpdate('paused', jid);
                    }
                    catch { }
                },
                showMenu: (name) => sendMenu(jid, name),
                ask: (definition, askOptions) => (typeof definition.ask === 'function' ? definition : sock.createForm(definition)).ask(jid, askOptions)
            };
            return ctx;
        };
        const dispatch = async (ctx) => {
            const menuHit = findMenuOption(ctx.jid, { id: ctx.id, text: ctx.text });
            if (menuHit) {
                ctx.menu = menuHit.menu.name;
                ctx.option = menuHit.option.id;
                if (menuHit.option.run) {
                    await menuHit.option.run(ctx);
                }
                if (menuHit.option.menu) {
                    await sendMenu(ctx.jid, menuHit.option.menu);
                }
                return true;
            }
            if (ctx.id) {
                for (const button of buttons) {
                    const hit = button.match(ctx.id, ctx);
                    if (hit) {
                        ctx.match = hit.match;
                        await button.handler(ctx);
                        return true;
                    }
                }
            }
            if (!ctx.id) {
                const parsed = parseCommand(ctx.text);
                if (parsed) {
                    Object.assign(ctx, { command: parsed.name, args: parsed.args, argText: parsed.argText, prefix: parsed.prefix });
                    await parsed.command.handler(ctx);
                    return true;
                }
                for (const hear of hears) {
                    const hit = ctx.text !== undefined && hear.match(ctx.text, ctx);
                    if (hit) {
                        ctx.match = hit.match;
                        await hear.handler(ctx);
                        return true;
                    }
                }
            }
            const typeHandler = ctx.type && typeHandlers.get(ctx.type);
            if (typeHandler) {
                await typeHandler(ctx);
                return true;
            }
            if (fallbackHandler) {
                await fallbackHandler(ctx);
                return true;
            }
            return false;
        };
        const handle = async (msg) => {
            const ctx = buildContext(msg);
            try {
                if (config.typing) {
                    await ctx.typing();
                }
                let index = -1;
                const run = async (i) => {
                    if (i <= index) {
                        throw new Error('next() called multiple times');
                    }
                    index = i;
                    if (i < middlewares.length) {
                        return middlewares[i](ctx, () => run(i + 1));
                    }
                    ctx.handled = await dispatch(ctx);
                };
                await run(0);
            }
            catch (error) {
                if (config.onError) {
                    await config.onError(error, ctx);
                }
                else {
                    logger?.error({ error, jid: ctx.jid }, 'router: handler failed');
                }
            }
        };
        const listener = ({ messages, type }) => {
            if (!running || type !== 'notify') {
                return;
            }
            for (const msg of messages) {
                const jid = msg.key?.remoteJid;
                if (!msg.message || msg.key.fromMe || !jid ||
                    isJidStatusBroadcast(jid) || isJidNewsletter(jid) ||
                    (isJidGroup(jid) && !config.groups) ||
                    sock.isFormReply?.(msg) || sock.getActiveForms?.().some(f => f.jid === jidNormalizedUser(msg.key.remoteJidAlt || jid) || f.jid === jidNormalizedUser(jid))) {
                    continue;
                }
                // one chat at a time, in order
                const previous = queues.get(jid) || Promise.resolve();
                const next = previous.then(() => handle(msg));
                queues.set(jid, next);
                next.finally(() => {
                    if (queues.get(jid) === next) {
                        queues.delete(jid);
                    }
                });
            }
        };
        const router = {
            /** run before every handler: (ctx, next) => {} — call next() to continue */
            use: (middleware) => {
                middlewares.push(middleware);
                return router;
            },
            /** text command, e.g. "menu" or "/order 2 cakes" (ctx.args = ['2', 'cakes']) */
            command: (names, handler, commandOptions = {}) => {
                const list = [].concat(names).map(n => (config.ignoreCase ? String(n).toLowerCase() : String(n)));
                commands.push({ names: list, handler, description: commandOptions.description });
                return router;
            },
            /** free text matching a string, a RegExp (ctx.match) or a predicate */
            hears: (pattern, handler) => {
                hears.push({ match: toMatcher(pattern, config.ignoreCase), handler });
                return router;
            },
            /** reply to a button, list row or native flow button, by id or RegExp (ctx.match) */
            button: (pattern, handler) => {
                buttons.push({ match: toMatcher(pattern, false), handler });
                return router;
            },
            /** message type: 'text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'poll', 'reaction' */
            on: (type, handler) => {
                if (!ROUTER_MESSAGE_TYPES.includes(type)) {
                    throw new Boom(`Unknown message type "${type}"`, { statusCode: 400 });
                }
                typeHandlers.set(type, handler);
                return router;
            },
            /** menu sent with ctx.showMenu(name): buttons for up to 3 options, a list otherwise */
            menu: (name, definition) => {
                if (!definition?.text || !Array.isArray(definition.options) || !definition.options.length) {
                    throw new Boom(`Menu "${name}" needs a text and at least one option`, { statusCode: 400 });
                }
                const ids = new Set();
                const options = definition.options.map((option, index) => {
                    const normalized = typeof option === 'string' ? { id: option, text: option } : { ...option, id: String(option.id ?? index + 1) };
                    if (ids.has(normalized.id)) {
                        throw new Boom(`Duplicate option id "${normalized.id}" in menu "${name}"`, { statusCode: 400 });
                    }
                    ids.add(normalized.id);
                    return normalized;
                });
                menus.set(name, { ...definition, name, options });
                return router;
            },
            /** called when nothing else matched */
            fallback: (handler) => {
                fallbackHandler = handler;
                return router;
            },
            /** send a registered menu to a chat */
            sendMenu,
            /** commands with their description, one per line */
            help: () => commands
                .map(c => `${c.names[0]}${c.names.length > 1 ? ` (${c.names.slice(1).join(', ')})` : ''}${c.description ? ` — ${c.description}` : ''}`)
                .join('\n'),
            start: () => {
                if (!running) {
                    running = true;
                    ev.on('messages.upsert', listener);
                }
                return router;
            },
            stop: () => {
                if (running) {
                    running = false;
                    ev.off('messages.upsert', listener);
                }
                return router;
            },
            /** process a message manually (e.g. from your own listener or a test) */
            handle
        };
        return router.start();
    };
    return { createRouter };
};
