// @ts-nocheck
import { createApp } from '@warbler/core';
import ChatSocketGraph from './graph/chat/chat.graph';
import AuthGraph from './graph/auth/auth.graph';

 export default createApp({
    graphs: [
        AuthGraph,
        ChatSocketGraph
    ],

})
