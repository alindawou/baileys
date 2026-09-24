import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeConversationForms } from '../Utils/conversation-form.js';
import { makeCommunitiesSocket } from './communities.js';
// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    const sock = makeCommunitiesSocket(newConfig);
    // conversational forms: registered now so their listener runs before user listeners
    return Object.assign(sock, makeConversationForms(sock));
};
export default makeWASocket;
//# sourceMappingURL=index.js.map