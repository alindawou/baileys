import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeConversationForms } from '../Utils/conversation-form.js';
import { makeMessageRouter } from '../Utils/message-router.js';
import { makeCommunitiesSocket } from './communities.js';
// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    const sock = makeCommunitiesSocket(newConfig);
    // forms and routers: registered now so their listeners run before user listeners
    Object.assign(sock, makeConversationForms(sock));
    return Object.assign(sock, makeMessageRouter(sock));
};
export default makeWASocket;
//# sourceMappingURL=index.js.map