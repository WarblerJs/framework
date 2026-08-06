import { describe, expect, test } from "bun:test";
import { Container, Provider, createToken, inject, runInInjectionContext, tokenName } from "../src";

describe("token-based injection", () => {
  test("resolves an abstract class token to a concrete implementation", () => {
    abstract class UserRepositoryPort {
      abstract findById(id: string): string;
    }
    class PgUserRepository extends UserRepositoryPort {
      findById(id: string): string {
        return `user:${id}`;
      }
    }
    const container = new Container().register({ token: UserRepositoryPort, useClass: PgUserRepository });
    const repository = container.resolve(UserRepositoryPort);
    expect(repository).toBeInstanceOf(PgUserRepository);
    expect(repository.findById("1")).toBe("user:1");
  });

  test("createToken preserves generic typing without casts", () => {
    class Cache {
      get(): string { return "hit"; }
    }
    const CACHE = createToken<Cache>("CACHE");
    const container = new Container().register({ token: CACHE, useFactory: () => new Cache() });
    const cache = container.resolve(CACHE);
    expect(cache.get()).toBe("hit");
    expect(tokenName(CACHE)).toBe("CACHE");
  });

  test("resolves a bare symbol token", () => {
    const USER_REPOSITORY = Symbol("USER_REPOSITORY");
    class PgUserRepository {}
    const container = new Container().register({ token: USER_REPOSITORY, useClass: PgUserRepository });
    expect(container.resolve<PgUserRepository>(USER_REPOSITORY)).toBeInstanceOf(PgUserRepository);
  });

  test("resolves a bare string token", () => {
    class MemoryCache {}
    const container = new Container().register({ token: "cache", useClass: MemoryCache });
    expect(container.resolve<MemoryCache>("cache")).toBeInstanceOf(MemoryCache);
    const resolved = runInInjectionContext(container, () => inject<MemoryCache>("cache"));
    expect(resolved).toBeInstanceOf(MemoryCache);
  });

  test("Provider() is an identity helper usable inline at registration", () => {
    const APP_NAME = createToken<string>("APP_NAME");
    const definition = Provider({ provide: APP_NAME, useValue: "Warbler" });
    const container = new Container().register(definition);
    expect(container.resolve(APP_NAME)).toBe("Warbler");
  });
});
