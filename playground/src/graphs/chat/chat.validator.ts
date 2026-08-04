import { v, type InferValidatorOutput } from "@warbler/validators";

export const chatMessageValidator = {
  rules: {
    roomId: v.string("validators.invalid_room").trim().min(1, "validators.invalid_room"),
    content: v.string("validators.invalid_content").trim().min(1, "validators.invalid_content").max(2_000, "validators.content_too_long"),
  },
} as const;

export const roomJoinValidator = {
  rules: {
    roomId: v.string("validators.invalid_room").trim().min(1, "validators.invalid_room"),
  },
} as const;

export type ChatMessageInput = InferValidatorOutput<typeof chatMessageValidator>;
