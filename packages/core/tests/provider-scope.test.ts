import { describe, expect, test } from "bun:test";
import {
  Container,
  DuplicateProviderError,
  Factory,
  Gateway,
  ProviderScope,
  ProviderScopeError,
  Repository,
  Resolver,
  Service,
  compileProviderScopes,
  createProviderContainers,
  getProviderMetadata,
  inject,
} from "../src";

describe("provider visibility metadata", () => {
  test("defaults every injectable decorator to GRAPH", () => {
    @Service() class ServiceProvider {}
    @Repository() class RepositoryProvider {}
    @Factory() class FactoryProvider {}
    @Resolver() class ResolverProvider {}
    @Gateway() class GatewayProvider {}

    for (const provider of [ServiceProvider, RepositoryProvider, FactoryProvider, ResolverProvider, GatewayProvider]) {
      const metadata = getProviderMetadata(provider);
      expect(metadata?.provide).toBe(ProviderScope.GRAPH);
      expect(metadata?.token).toBe(provider);
      expect(metadata?.dependencies).toEqual([]);
      expect(Object.isFrozen(metadata)).toBe(true);
      expect(Object.isFrozen(metadata?.dependencies)).toBe(true);
    }
  });

  test("supports explicit GRAPH and ROOT scope", () => {
    @Service({ provide: ProviderScope.GRAPH }) class Local {}
    @Service({ provide: ProviderScope.ROOT }) class Global {}
    @Service({ scope: "transient" }) class LegacyTransient {}
    expect(getProviderMetadata(Local)?.provide).toBe("graph");
    expect(getProviderMetadata(Global)?.provide).toBe("root");
    expect(getProviderMetadata(LegacyTransient)?.scope).toBe("transient");
  });

  test("provider subclasses receive their own immutable metadata", () => {
    @Service({ provide: ProviderScope.ROOT }) class Base {}
    class Derived extends Base {}
    expect(getProviderMetadata(Derived)?.token).toBe(Derived);
    expect(getProviderMetadata(Derived)?.provide).toBe(ProviderScope.ROOT);
  });
});

describe("provider scope compilation", () => {
  test("resolves Graph providers locally and root providers through direct fallback", () => {
    @Service() class UserService {}
    @Service({ provide: ProviderScope.ROOT }) class JwtService {}
    class UserGraph {}
    class AdminGraph {}
    const compiled = compileProviderScopes([
      { graph: UserGraph, providers: [UserService, JwtService] },
      { graph: AdminGraph, providers: [] },
    ]);
    const containers = createProviderContainers(compiled);
    const users = containers.get(UserGraph);
    const admin = containers.get(AdminGraph);
    expect(users?.resolve(UserService)).toBeInstanceOf(UserService);
    expect(users?.resolve(JwtService)).toBe(admin?.resolve(JwtService));
    expect(admin?.has(UserService)).toBe(false);
  });

  test("rejects a dependency owned by another Graph", () => {
    @Service() class UserService {}
    @Service() class AdminService {}
    class UserGraph {}
    class AdminGraph {}
    expect(() => compileProviderScopes([
      { graph: UserGraph, providers: [UserService] },
      { graph: AdminGraph, providers: [AdminService], dependencies: new Map([[AdminService, [UserService]]]) },
    ])).toThrow(ProviderScopeError);
  });

  test("allows a root dependency from every Graph", () => {
    @Service({ provide: ProviderScope.ROOT }) class Logger {}
    @Service() class UserService {}
    @Service() class AdminService {}
    class UserGraph {}
    class AdminGraph {}
    expect(() => compileProviderScopes([
      { graph: UserGraph, providers: [Logger, UserService], dependencies: new Map([[UserService, [Logger]]]) },
      { graph: AdminGraph, providers: [AdminService], dependencies: new Map([[AdminService, [Logger]]]) },
    ])).not.toThrow();
  });

  test("rejects duplicate provider registration instead of overwriting", () => {
    class Provider {}
    expect(() => new Container().register(Provider).register(Provider)).toThrow(DuplicateProviderError);
  });

  test("resolves large compiled tables without Graph scans", () => {
    class Graph {}
    const providers = Array.from({ length: 2_000 }, (_, index) => class { static readonly index = index; });
    const compiled = compileProviderScopes([{ graph: Graph, providers }]);
    const table = compiled.graphs.get(Graph)?.providers;
    expect(table?.size).toBe(2_000);
    expect(table?.get(providers[1_999]!)).toBe(providers[1_999]);
  });

  test("inject resolves same-Graph dependencies at runtime", () => {
    class Repository {}
    class ServiceWithDependency { public readonly repository = inject(Repository); }
    const container = new Container().registerAll([Repository, ServiceWithDependency]);
    expect(container.resolve(ServiceWithDependency).repository).toBe(container.resolve(Repository));
  });
});
