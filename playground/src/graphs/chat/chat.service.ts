import { Service, inject } from "@warbler/core";
import ApplicationLogger from "../home/application-logger";
import ChatRepository from "./chat.repository";

@Service()
export default class ChatService {
  readonly #repository = inject(ChatRepository);
  readonly #logger = inject(ApplicationLogger);

  createMessage(roomId: string, content: string) {
    this.#logger.log("chat.message");
    return this.#repository.create(roomId, content);
  }
}
