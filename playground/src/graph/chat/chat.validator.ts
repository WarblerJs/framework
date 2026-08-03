// @ts-nocheck
import { v } from '@warbler/validator';
export const sendMessageValidator = { 
    rules: {
        username: v.string('transIndex').required(),
        password: v.string('transIndex').required().min(6),
    },
    map(request: AppRequest) {
        return {
            username: request.body.username,
            password: request.body.password,
        };
    },
    key(request: AppRequest) {
        return {
            username: 'name',
            password: 'pass',
        };
    }
};