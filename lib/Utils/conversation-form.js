import { Boom } from '@hapi/boom';
import { isJidGroup, isLidUser, isPnUser, jidNormalizedUser } from '../WABinary/index.js';
import { delay } from './generics.js';
/**
 * Conversational forms: ask a contact a sequence of questions in a private chat,
 * validate each answer and resolve with all the answers once the form is done.
 * Uses only regular messages (text, buttons, lists), so it renders on Android, iOS and Web.
 */
export const FORM_FIELD_TYPES = ['text', 'number', 'phone', 'email', 'date', 'choice', 'yesno', 'location', 'image', 'video', 'audio', 'document', 'media'];
export const DEFAULT_FORM_TEXTS = {
    intro: undefined,
    step: (index, total, question) => `*${index}/${total}* — ${question}`,
    hint: '_Type "cancel" to stop or "back" to go back._',
    invalid: '⚠️ Invalid answer, please try again.',
    invalidText: (min, max) => `⚠️ Your answer must be between ${min} and ${max} characters long.`,
    invalidNumber: (min, max) => `⚠️ Enter a number${min !== undefined ? ` ≥ ${min}` : ''}${max !== undefined ? ` and ≤ ${max}` : ''}.`,
    invalidPhone: '⚠️ Enter a valid phone number (e.g. +229 01 97 00 00 00).',
    invalidEmail: '⚠️ Enter a valid email address.',
    invalidDate: '⚠️ Enter a valid date in the DD/MM/YYYY format.',
    dateNotFuture: '⚠️ The date must be in the future.',
    datePast: '⚠️ The date must be in the past.',
    chooseOption: '⚠️ Choose an option from the menu.',
    invalidLocation: '⚠️ Share your location 📍 or type an address.',
    invalidMedia: (type) => `⚠️ Send a ${type} file.`,
    listButton: 'See options',
    listSection: 'Options',
    optionalHint: '_(optional: type "skip")_',
    yes: '✅ Yes',
    no: '❌ No',
    summaryTitle: '🧾 *Summary*',
    confirm: '✅ Confirm',
    restart: '✏️ Start over',
    cancel: '❌ Cancel',
    useConfirmButtons: '⚠️ Use the Confirm, Start over or Cancel buttons.',
    skipped: '—',
    cancelled: '❌ Form cancelled.',
    completed: '✅ Thank you, your answers have been saved!',
    timeout: '⌛ The form expired because no answer was received.'
};
const DEFAULT_KEYWORDS = {
    cancel: ['cancel', 'stop'],
    back: ['back'],
    skip: ['skip']
};
const YES_WORDS = ['yes', 'y', '1'];
const NO_WORDS = ['no', 'n', '2'];
const MAX_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const HANDLED_IDS_LIMIT = 1000;
const normalize = (text) => text.trim().toLowerCase();
const unwrapMessage = (message) => {
    let m = message || {};
    for (let i = 0; i < 5; i++) {
        const inner = m.ephemeralMessage?.message ||
            m.viewOnceMessage?.message ||
            m.viewOnceMessageV2?.message ||
            m.viewOnceMessageV2Extension?.message ||
            m.documentWithCaptionMessage?.message;
        if (!inner)
            break;
        m = inner;
    }
    return m;
};
/**
 * Extracts what the contact answered: a clicked button/list id, a text, a location or a media.
 */
export const extractFormReply = (msg) => {
    const m = unwrapMessage(msg.message);
    const location = m.locationMessage || m.liveLocationMessage;
    if (location) {
        return {
            location: {
                latitude: location.degreesLatitude,
                longitude: location.degreesLongitude,
                name: location.name || undefined,
                address: location.address || undefined
            }
        };
    }
    for (const type of ['image', 'video', 'audio', 'document', 'sticker']) {
        const media = m[`${type}Message`];
        if (media) {
            return {
                media: {
                    type,
                    mimetype: media.mimetype,
                    caption: media.caption || undefined,
                    fileName: media.fileName || undefined,
                    message: msg
                }
            };
        }
    }
    let nativeFlowId;
    const paramsJson = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (paramsJson) {
        try {
            nativeFlowId = JSON.parse(paramsJson).id;
        }
        catch { }
    }
    const id = m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.templateButtonReplyMessage?.selectedId ||
        nativeFlowId;
    if (id) {
        return { id: String(id), text: String(id) };
    }
    const text = m.conversation || m.extendedTextMessage?.text;
    if (text?.trim()) {
        return { text: text.trim() };
    }
    return undefined;
};
const toOptions = (field) => (field.options || []).map((option, index) => typeof option === 'string'
    ? { id: option, text: option }
    : { id: String(option.id ?? index + 1), text: option.text ?? String(option.id), description: option.description });
const parseDate = (text) => {
    let day, month, year;
    let match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (match) {
        [, day, month, year] = match;
    }
    else {
        match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!match)
            return undefined;
        [, year, month, day] = match;
    }
    const date = new Date(+year, +month - 1, +day);
    if (date.getFullYear() !== +year || date.getMonth() !== +month - 1 || date.getDate() !== +day) {
        return undefined;
    }
    return date;
};
const parsePhone = (text, defaultCountryCode) => {
    const raw = text.replace(/[\s\-.()]/g, '');
    let digits;
    if (raw.startsWith('+')) {
        digits = raw.slice(1);
    }
    else if (raw.startsWith('00')) {
        digits = raw.slice(2);
    }
    else if (defaultCountryCode && !raw.startsWith(defaultCountryCode)) {
        digits = `${defaultCountryCode}${raw}`;
    }
    else {
        digits = raw;
    }
    return /^\d{8,15}$/.test(digits) ? digits : undefined;
};
/**
 * Turns a raw reply into the field value, or returns { error } with the message to send back.
 */
export const parseFormFieldReply = (field, reply, texts = DEFAULT_FORM_TEXTS) => {
    const text = reply.text;
    switch (field.type) {
        case 'text': {
            const min = field.min ?? 1;
            const max = field.max ?? 4096;
            if (!text || text.length < min || text.length > max) {
                return { error: texts.invalidText(min, max) };
            }
            if (field.pattern && !new RegExp(field.pattern).test(text)) {
                return { error: field.error || texts.invalid };
            }
            return { value: text };
        }
        case 'number': {
            const value = text && /^-?\d+([.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN;
            if (Number.isNaN(value) ||
                (field.integer && !Number.isInteger(value)) ||
                (field.min !== undefined && value < field.min) ||
                (field.max !== undefined && value > field.max)) {
                return { error: field.error || texts.invalidNumber(field.min, field.max) };
            }
            return { value };
        }
        case 'phone': {
            const value = text && parsePhone(text, field.defaultCountryCode);
            return value ? { value } : { error: field.error || texts.invalidPhone };
        }
        case 'email': {
            const value = text?.toLowerCase();
            return value && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
                ? { value }
                : { error: field.error || texts.invalidEmail };
        }
        case 'date': {
            const value = text && parseDate(text);
            if (!value) {
                return { error: field.error || texts.invalidDate };
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (field.future && value < today) {
                return { error: texts.dateNotFuture };
            }
            if (field.past && value > today) {
                return { error: texts.datePast };
            }
            return { value };
        }
        case 'choice': {
            const options = toOptions(field);
            const wanted = text && normalize(text);
            const option = options.find(o => o.id === reply.id) ||
                options.find(o => normalize(o.id) === wanted || normalize(o.text) === wanted) ||
                (wanted && /^\d+$/.test(wanted) ? options[+wanted - 1] : undefined);
            return option ? { value: option.id, label: option.text } : { error: texts.chooseOption };
        }
        case 'yesno': {
            const wanted = text && normalize(text);
            if (reply.id === 'yes' || YES_WORDS.includes(wanted)) {
                return { value: true, label: texts.yes };
            }
            if (reply.id === 'no' || NO_WORDS.includes(wanted)) {
                return { value: false, label: texts.no };
            }
            return { error: texts.chooseOption };
        }
        case 'location': {
            if (reply.location) {
                return { value: reply.location };
            }
            if (field.allowText !== false && text) {
                return { value: { address: text } };
            }
            return { error: texts.invalidLocation };
        }
        default: {
            // media types
            const media = reply.media;
            const accepted = field.type === 'media' || media?.type === field.type;
            if (!media || !accepted) {
                return { error: texts.invalidMedia(field.type) };
            }
            if (field.mimetypes?.length && !field.mimetypes.some(type => media.mimetype?.startsWith(type))) {
                return { error: field.error || texts.invalidMedia(field.mimetypes.join(', ')) };
            }
            return { value: media };
        }
    }
};
const formatValue = (field, answers, labels, texts) => {
    const value = answers[field.key];
    if (value === null || value === undefined) {
        return texts.skipped;
    }
    if (labels[field.key]) {
        return labels[field.key];
    }
    if (value instanceof Date) {
        return value.toLocaleDateString('en-GB');
    }
    if (field.type === 'location') {
        return value.latitude !== undefined
            ? `📍 ${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}${value.name ? ` (${value.name})` : ''}`
            : value.address;
    }
    if (typeof value === 'object' && value.type) {
        return `📎 ${value.fileName || value.type}`;
    }
    return String(value);
};
const validateDefinition = (definition) => {
    if (!definition || !Array.isArray(definition.fields) || !definition.fields.length) {
        throw new Boom('A form needs at least one field', { statusCode: 400 });
    }
    const keys = new Set();
    for (const field of definition.fields) {
        if (!field.key || keys.has(field.key)) {
            throw new Boom(`Form field keys must be unique and non-empty (got "${field.key}")`, { statusCode: 400 });
        }
        keys.add(field.key);
        if (!field.question) {
            throw new Boom(`Form field "${field.key}" needs a question`, { statusCode: 400 });
        }
        if (!FORM_FIELD_TYPES.includes(field.type || 'text')) {
            throw new Boom(`Unknown form field type "${field.type}" for "${field.key}"`, { statusCode: 400 });
        }
        if (field.type === 'choice' && !field.options?.length) {
            throw new Boom(`Choice field "${field.key}" needs options`, { statusCode: 400 });
        }
    }
};
/**
 * Adds conversational forms on top of a socket.
 * Must be called when the socket is created so its listener runs before user listeners.
 */
export const makeConversationForms = (sock) => {
    const { ev, logger } = sock;
    /** chat key (normalized jid) -> session */
    const sessions = new Map();
    /** alias jid (PN or LID) -> chat key */
    const aliases = new Map();
    const handledIds = new Set();
    const markHandled = (id) => {
        handledIds.add(id);
        if (handledIds.size > HANDLED_IDS_LIMIT) {
            handledIds.delete(handledIds.values().next().value);
        }
    };
    const resolveAliases = async (jid) => {
        const result = new Set([jid]);
        const lidMapping = sock.signalRepository?.lidMapping;
        try {
            if (isPnUser(jid)) {
                const lid = await lidMapping?.getLIDForPN(jid);
                if (lid)
                    result.add(jidNormalizedUser(lid));
            }
            else if (isLidUser(jid)) {
                const pn = await lidMapping?.getPNForLID(jid);
                if (pn)
                    result.add(jidNormalizedUser(pn));
            }
        }
        catch (error) {
            logger?.debug({ jid, error }, 'form: could not resolve PN/LID alias');
        }
        return result;
    };
    const endSession = async (session, status, notice) => {
        if (sessions.get(session.key) !== session) {
            return;
        }
        clearTimeout(session.timer);
        sessions.delete(session.key);
        for (const alias of session.aliases) {
            if (aliases.get(alias) === session.key) {
                aliases.delete(alias);
            }
        }
        if (notice) {
            await sock.sendMessage(session.jid, { text: notice }).catch(error => logger?.warn({ error }, 'form: failed to send closing message'));
        }
        session.resolve({
            status,
            jid: session.jid,
            answers: session.answers,
            labels: session.labels,
            startedAt: session.startedAt,
            endedAt: new Date()
        });
    };
    const armTimeout = (session) => {
        clearTimeout(session.timer);
        if (session.form.timeoutMs > 0) {
            session.timer = setTimeout(() => {
                endSession(session, 'timeout', session.form.texts.timeout).catch(() => { });
            }, session.form.timeoutMs);
        }
    };
    const typing = async (session) => {
        if (!session.form.typing)
            return;
        try {
            await sock.sendPresenceUpdate('composing', session.jid);
            await delay(800 + Math.floor(Math.random() * 800));
            await sock.sendPresenceUpdate('paused', session.jid);
        }
        catch { }
    };
    // upcoming conditional fields are counted until they can be ruled out, so the total never grows
    const visibleFields = (session) => session.form.fields.filter((field, i) => i > session.step || !field.when || field.when(session.answers));
    const nextStep = (session, from) => {
        const fields = session.form.fields;
        for (let i = from; i < fields.length; i++) {
            if (!fields[i].when || fields[i].when(session.answers)) {
                return i;
            }
        }
        return fields.length;
    };
    const sendQuestion = async (session) => {
        const { form } = session;
        const texts = form.texts;
        await typing(session);
        armTimeout(session);
        if (session.step >= form.fields.length) {
            session.confirming = true;
            const lines = visibleFields(session).map(field => `• ${field.label || field.key}: ${formatValue(field, session.answers, session.labels, texts)}`);
            await sock.sendMessage(session.jid, {
                text: `${texts.summaryTitle}\n${lines.join('\n')}`,
                footer: form.title,
                buttons: [
                    { buttonId: 'confirm', buttonText: { displayText: texts.confirm }, type: 1 },
                    { buttonId: 'restart', buttonText: { displayText: texts.restart }, type: 1 },
                    { buttonId: 'cancel', buttonText: { displayText: texts.cancel }, type: 1 }
                ],
                viewOnce: true
            });
            return;
        }
        const field = form.fields[session.step];
        const shown = visibleFields(session);
        const total = shown.length;
        const index = shown.indexOf(field) + 1;
        const question = typeof field.question === 'function' ? field.question(session.answers) : field.question;
        let text = texts.step(index, total, question);
        if (field.optional) {
            text += `\n${texts.optionalHint}`;
        }
        const footer = form.title;
        if (field.type === 'yesno') {
            await sock.sendMessage(session.jid, {
                text,
                footer,
                buttons: [
                    { buttonId: 'yes', buttonText: { displayText: texts.yes }, type: 1 },
                    { buttonId: 'no', buttonText: { displayText: texts.no }, type: 1 }
                ],
                viewOnce: true
            });
        }
        else if (field.type === 'choice') {
            const options = toOptions(field);
            if (options.length <= MAX_BUTTONS && !field.list) {
                await sock.sendMessage(session.jid, {
                    text,
                    footer,
                    buttons: options.map(o => ({ buttonId: o.id, buttonText: { displayText: o.text }, type: 1 })),
                    viewOnce: true
                });
            }
            else {
                const sections = [];
                for (let i = 0; i < options.length; i += MAX_LIST_ROWS) {
                    sections.push({
                        title: sections.length ? `${texts.listSection} ${sections.length + 1}` : (field.label || texts.listSection),
                        rows: options.slice(i, i + MAX_LIST_ROWS).map(o => ({ title: o.text, rowId: o.id, description: o.description }))
                    });
                }
                await sock.sendMessage(session.jid, {
                    text,
                    footer,
                    title: form.title,
                    buttonText: field.buttonText || texts.listButton,
                    sections
                });
            }
        }
        else {
            await sock.sendMessage(session.jid, { text: session.step === 0 && texts.hint ? `${text}\n${texts.hint}` : text });
        }
    };
    const handleReply = async (session, reply) => {
        const { form } = session;
        const texts = form.texts;
        const word = reply.text && !reply.id ? normalize(reply.text) : undefined;
        if ((session.confirming && reply.id === 'cancel') || (word && form.keywords.cancel.includes(word))) {
            return endSession(session, 'cancelled', texts.cancelled);
        }
        if (session.confirming) {
            if (reply.id === 'confirm') {
                return endSession(session, 'completed', texts.completed);
            }
            if (reply.id === 'restart') {
                session.confirming = false;
                session.answers = {};
                session.labels = {};
                session.history = [];
                session.step = nextStep(session, 0);
                return sendQuestion(session);
            }
            armTimeout(session);
            await sock.sendMessage(session.jid, { text: texts.useConfirmButtons });
            return;
        }
        if (word && form.keywords.back.includes(word)) {
            if (session.history.length) {
                session.step = session.history.pop();
                const field = form.fields[session.step];
                delete session.answers[field.key];
                delete session.labels[field.key];
            }
            return sendQuestion(session);
        }
        const field = form.fields[session.step];
        let parsed;
        if (field.optional && word && form.keywords.skip.includes(word)) {
            parsed = { value: null };
        }
        else {
            parsed = parseFormFieldReply({ ...field, type: field.type || 'text' }, reply, texts);
        }
        if (!parsed.error && field.validate && parsed.value !== null) {
            const check = await field.validate(parsed.value, session.answers);
            if (check !== true && check !== undefined) {
                parsed = { error: typeof check === 'string' ? check : (field.error || texts.invalid) };
            }
        }
        if (parsed.error) {
            armTimeout(session);
            await sock.sendMessage(session.jid, { text: parsed.error });
            return;
        }
        session.answers[field.key] = parsed.value;
        if (parsed.label) {
            session.labels[field.key] = parsed.label;
        }
        session.history.push(session.step);
        await form.onAnswer?.(field.key, parsed.value, session.answers);
        session.step = nextStep(session, session.step + 1);
        if (session.step >= form.fields.length && !form.confirm) {
            return endSession(session, 'completed', texts.completed);
        }
        return sendQuestion(session);
    };
    ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify' || !sessions.size) {
            return;
        }
        for (const msg of messages) {
            if (msg.key.fromMe || !msg.message) {
                continue;
            }
            const candidates = [msg.key.remoteJid, msg.key.remoteJidAlt]
                .filter(jid => jid && !isJidGroup(jid))
                .map(jid => jidNormalizedUser(jid));
            const key = candidates.map(jid => aliases.get(jid)).find(Boolean);
            const session = key && sessions.get(key);
            if (!session) {
                continue;
            }
            const reply = extractFormReply(msg);
            if (!reply) {
                continue;
            }
            // flag synchronously, before user listeners run
            markHandled(msg.key.id);
            session.queue = session.queue
                .then(() => sessions.get(session.key) === session ? handleReply(session, reply) : undefined)
                .catch(error => logger?.error({ error, jid: session.jid }, 'form: failed to handle reply'));
        }
    });
    ev.on('connection.update', ({ connection }) => {
        if (connection === 'close') {
            for (const session of [...sessions.values()]) {
                endSession(session, 'closed').catch(() => { });
            }
        }
    });
    const createForm = (definition) => {
        validateDefinition(definition);
        const form = {
            title: definition.title,
            fields: definition.fields.map(field => ({ ...field, type: field.type || 'text' })),
            confirm: definition.confirm ?? true,
            timeoutMs: definition.timeoutMs ?? 10 * 60000,
            typing: definition.typing ?? true,
            onAnswer: definition.onAnswer,
            texts: { ...DEFAULT_FORM_TEXTS, ...definition.texts },
            keywords: {
                cancel: definition.keywords?.cancel ?? DEFAULT_KEYWORDS.cancel,
                back: definition.keywords?.back ?? DEFAULT_KEYWORDS.back,
                skip: definition.keywords?.skip ?? DEFAULT_KEYWORDS.skip
            }
        };
        return {
            /**
             * Starts the form with a contact and resolves when it ends.
             * @returns {Promise<{status: 'completed'|'cancelled'|'timeout'|'replaced'|'closed', jid, answers, labels, startedAt, endedAt}>}
             */
            ask: async (jid, options = {}) => {
                if (!jid || isJidGroup(jid)) {
                    throw new Boom('Forms can only be sent in private chats', { statusCode: 400 });
                }
                const chatJid = jidNormalizedUser(jid);
                const chatAliases = await resolveAliases(chatJid);
                for (const alias of chatAliases) {
                    const existing = sessions.get(aliases.get(alias));
                    if (existing) {
                        await endSession(existing, 'replaced');
                    }
                }
                return new Promise((resolve, reject) => {
                    const session = {
                        key: chatJid,
                        jid: chatJid,
                        aliases: chatAliases,
                        form,
                        step: 0,
                        answers: { ...options.answers },
                        labels: {},
                        history: [],
                        confirming: false,
                        queue: Promise.resolve(),
                        startedAt: new Date(),
                        resolve
                    };
                    session.step = nextStep(session, 0);
                    sessions.set(chatJid, session);
                    for (const alias of chatAliases) {
                        aliases.set(alias, chatJid);
                    }
                    const intro = options.intro ?? form.texts.intro;
                    session.queue = session.queue
                        .then(() => intro ? sock.sendMessage(chatJid, { text: intro }) : undefined)
                        .then(() => sendQuestion(session))
                        .catch(async (error) => {
                        await endSession(session, 'closed');
                        reject(error);
                    });
                });
            },
            cancel: (jid, notify = false) => cancelForm(jid, notify),
            isActive: (jid) => !!getSession(jid)
        };
    };
    const getSession = (jid) => {
        const key = aliases.get(jidNormalizedUser(jid)) || jidNormalizedUser(jid);
        return sessions.get(key);
    };
    const cancelForm = async (jid, notify = false) => {
        const session = getSession(jid);
        if (!session) {
            return false;
        }
        await endSession(session, 'cancelled', notify ? session.form.texts.cancelled : undefined);
        return true;
    };
    return {
        createForm,
        cancelForm,
        /** true if this incoming message was consumed as a form answer — skip it in your own handlers */
        isFormReply: (msg) => !!msg?.key?.id && handledIds.has(msg.key.id),
        /** active forms, for monitoring */
        getActiveForms: () => [...sessions.values()].map(s => ({
            jid: s.jid,
            title: s.form.title,
            step: s.step,
            confirming: s.confirming,
            answers: { ...s.answers },
            startedAt: s.startedAt
        }))
    };
};
