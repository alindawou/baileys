import type { ConversationForm, FormDefinition, FormResult, FormReply } from "./conversation-form.js";
export type RouterMessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'poll' | 'reaction';
export interface RouterContext {
    sock: any;
    /** the raw incoming WAMessage */
    message: any;
    key: any;
    /** chat jid, where replies are sent */
    jid: string;
    /** author of the message (the contact, or the participant in a group), PN when known */
    sender?: string;
    isGroup: boolean;
    pushName?: string;
    type?: RouterMessageType;
    /** text, caption or clicked button id */
    text?: string;
    /** id of the clicked button / list row / native flow button */
    id?: string;
    location?: FormReply['location'];
    media?: FormReply['media'];
    /** set for commands */
    command?: string;
    args?: string[];
    argText?: string;
    prefix?: string;
    /** set for RegExp matches (hears, button) */
    match?: RegExpMatchArray;
    /** set when a menu option was chosen */
    menu?: string;
    option?: string;
    /** per-chat memory kept by the router */
    session: Record<string, any>;
    /** true once a handler matched */
    handled?: boolean;
    reply(content: string | Record<string, any>, options?: Record<string, any>): Promise<any>;
    react(emoji: string): Promise<any>;
    typing(ms?: number): Promise<void>;
    showMenu(name: string): Promise<any>;
    ask(form: FormDefinition | ConversationForm, options?: {
        intro?: string;
        answers?: Record<string, any>;
    }): Promise<FormResult>;
}
export type RouterHandler = (ctx: RouterContext) => unknown | Promise<unknown>;
export type RouterMiddleware = (ctx: RouterContext, next: () => Promise<void>) => unknown | Promise<unknown>;
export type RouterPattern = string | RegExp | ((value: string, ctx: RouterContext) => boolean);
export interface MenuOption {
    id?: string | number;
    text: string;
    description?: string;
    /** called when the option is chosen */
    run?: RouterHandler;
    /** menu to show when the option is chosen */
    menu?: string;
}
export interface MenuDefinition {
    text: string;
    footer?: string;
    /** list title */
    title?: string;
    /** text of the button opening the list */
    buttonText?: string;
    sectionTitle?: string;
    /** always send a list, even with ≤ 3 options */
    list?: boolean;
    /** also print "1. option" lines in the text, so the contact can answer with a number */
    numbered?: boolean;
    options: (string | MenuOption)[];
}
export interface RouterOptions {
    /** command prefixes, '' allows commands without prefix (default ['', '/', '!', '.']) */
    prefix?: string | string[];
    /** handle group messages (default false) */
    groups?: boolean;
    /** case insensitive commands and text matching (default true) */
    ignoreCase?: boolean;
    /** show "typing…" before running handlers (default false) */
    typing?: boolean;
    /** called when a handler throws (default: logged) */
    onError?: (error: unknown, ctx: RouterContext) => unknown;
}
export interface MessageRouter {
    use(middleware: RouterMiddleware): MessageRouter;
    command(names: string | string[], handler: RouterHandler, options?: {
        description?: string;
    }): MessageRouter;
    hears(pattern: RouterPattern, handler: RouterHandler): MessageRouter;
    button(pattern: RouterPattern, handler: RouterHandler): MessageRouter;
    on(type: RouterMessageType, handler: RouterHandler): MessageRouter;
    menu(name: string, definition: MenuDefinition): MessageRouter;
    fallback(handler: RouterHandler): MessageRouter;
    sendMenu(jid: string, name: string): Promise<any>;
    help(): string;
    start(): MessageRouter;
    stop(): MessageRouter;
    handle(message: any): Promise<void>;
}
export type MessageRouters = {
    createRouter: (options?: RouterOptions) => MessageRouter;
};
export declare const ROUTER_MESSAGE_TYPES: RouterMessageType[];
export declare const getRouterMessageType: (message: any) => RouterMessageType | undefined;
export declare const makeMessageRouter: (sock: any) => MessageRouters;
