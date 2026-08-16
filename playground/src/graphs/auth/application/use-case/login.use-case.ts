import { inject, left, right, Service, type Either } from "@warbler/core";
import { hash, password, random } from "@warbler/crypto";
import { AuthRepositoryPort } from "../../domain/ports/auth.repository.port";
import { SessionRepositoryPort } from "../../domain/ports/session.repository.port";
import type { LoginResult } from "../dto/login-result";
import type { LoginUserData } from "../dto/login-user-data";
import type { AuthTranslationKey } from "../types/auth-translation-key";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

@Service()
export class LoginUseCase {
    readonly #repository = inject(AuthRepositoryPort);
    readonly #sessions = inject(SessionRepositoryPort);

    async execute(data: LoginUserData): Promise<Either<AuthTranslationKey, LoginResult>> {
        const user = await this.#repository.findUserByEmail(data.email);

        if (!user) {
            return left("emailOrPassNotCorrect");
        }

        const isPasswordCorrect = await password.verify(
            data.password,
            user.passwordHash,
        );

        if (!isPasswordCorrect) {
            return left("emailOrPassNotCorrect");
        }

        const sessionId = random.base64url(SESSION_TOKEN_BYTES);
        const sessionHash = hash.sha256(sessionId);
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

        await this.#sessions.createSession({
            userId: user.id,
            sessionHash,
            expiresAt,
        });

        return right({
            user,
            sessionId,
        });
    }
}
