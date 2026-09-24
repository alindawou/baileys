export type FormFieldType = 'text' | 'number' | 'phone' | 'email' | 'date' | 'choice' | 'yesno' | 'location' | 'image' | 'video' | 'audio' | 'document' | 'media';
export type FormChoiceOption = string | {
    id: string | number;
    text?: string;
    description?: string;
};
export type FormAnswers = Record<string, any>;
export interface FormField {
    /** key of the answer in the result */
    key: string;
    /** question sent to the contact (can depend on previous answers) */
    question: string | ((answers: FormAnswers) => string);
    /** default: 'text' */
    type?: FormFieldType;
    /** label shown in the summary (default: key) */
    label?: string;
    /** the contact can type "passer" to leave it empty (value = null) */
    optional?: boolean;
    /** only ask this field when it returns true */
    when?: (answers: FormAnswers) => boolean;
    /** extra check: return true when valid, or an error message to send back */
    validate?: (value: any, answers: FormAnswers) => boolean | string | void | Promise<boolean | string | void>;
    /** error message sent when the built-in check fails */
    error?: string;
    /** text: min/max length — number: min/max value */
    min?: number;
    max?: number;
    /** text: regex the answer must match */
    pattern?: string | RegExp;
    /** number: only integers */
    integer?: boolean;
    /** phone: prefix added when the contact omits it, e.g. '229' */
    defaultCountryCode?: string;
    /** date: must be today or later / today or earlier */
    future?: boolean;
    past?: boolean;
    /** choice: options (≤ 3 → buttons, otherwise a list) */
    options?: FormChoiceOption[];
    /** choice: always use a list, even with ≤ 3 options */
    list?: boolean;
    /** choice: text of the button opening the list */
    buttonText?: string;
    /** location: accept a typed address (default true) */
    allowText?: boolean;
    /** media: accepted mimetype prefixes, e.g. ['image/', 'application/pdf'] */
    mimetypes?: string[];
}
export interface FormTexts {
    intro?: string;
    step: (index: number, total: number, question: string) => string;
    hint?: string;
    invalid: string;
    invalidText: (min: number, max: number) => string;
    invalidNumber: (min?: number, max?: number) => string;
    invalidPhone: string;
    invalidEmail: string;
    invalidDate: string;
    dateNotFuture: string;
    datePast: string;
    chooseOption: string;
    invalidLocation: string;
    invalidMedia: (type: string) => string;
    listButton: string;
    listSection: string;
    optionalHint: string;
    yes: string;
    no: string;
    summaryTitle: string;
    confirm: string;
    restart: string;
    cancel: string;
    useConfirmButtons: string;
    skipped: string;
    cancelled?: string;
    completed?: string;
    timeout?: string;
}
export interface FormDefinition {
    /** shown in footers and in the summary */
    title?: string;
    fields: FormField[];
    /** send a summary with Confirm / Restart / Cancel buttons at the end (default true) */
    confirm?: boolean;
    /** inactivity timeout in ms, 0 to disable (default 10 minutes) */
    timeoutMs?: number;
    /** show "typing…" before each question (default true) */
    typing?: boolean;
    /** override any message (French by default) */
    texts?: Partial<FormTexts>;
    /** words the contact can type */
    keywords?: {
        cancel?: string[];
        back?: string[];
        skip?: string[];
    };
    /** called after each valid answer */
    onAnswer?: (key: string, value: any, answers: FormAnswers) => void | Promise<void>;
}
export type FormStatus = 'completed' | 'cancelled' | 'timeout' | 'replaced' | 'closed';
export interface FormResult {
    status: FormStatus;
    jid: string;
    answers: FormAnswers;
    /** display text of choice / yesno answers */
    labels: Record<string, string>;
    startedAt: Date;
    endedAt: Date;
}
export interface ConversationForm {
    /** start the form with a contact (private chat) and wait until it ends */
    ask(jid: string, options?: {
        intro?: string;
        answers?: FormAnswers;
    }): Promise<FormResult>;
    cancel(jid: string, notify?: boolean): Promise<boolean>;
    isActive(jid: string): boolean;
}
export interface FormReply {
    id?: string;
    text?: string;
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
    };
    media?: {
        type: string;
        mimetype?: string;
        caption?: string;
        fileName?: string;
        message: any;
    };
}
export declare const FORM_FIELD_TYPES: FormFieldType[];
export declare const DEFAULT_FORM_TEXTS: FormTexts;
export declare const extractFormReply: (msg: any) => FormReply | undefined;
export declare const parseFormFieldReply: (field: FormField, reply: FormReply, texts?: FormTexts) => {
    value?: any;
    label?: string;
    error?: string;
};
export type ConversationForms = {
    createForm: (definition: FormDefinition) => ConversationForm;
    cancelForm: (jid: string, notify?: boolean) => Promise<boolean>;
    isFormReply: (msg: any) => boolean;
    getActiveForms: () => {
        jid: string;
        title?: string;
        step: number;
        confirming: boolean;
        answers: FormAnswers;
        startedAt: Date;
    }[];
};
export declare const makeConversationForms: (sock: any) => ConversationForms;
