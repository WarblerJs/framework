# @warbler/transport

`@warbler/transport` defines the implementation-neutral contracts shared by Warbler transports. It contains no network implementation, runtime discovery, configuration loading, filesystem access, or Bun API dependency.

Every transport adapter implements `start` and `stop`. Both operations use `MaybePromise`, allowing synchronous implementations to remain synchronous while supporting transports whose native lifecycle is asynchronous.

`TransportHandle` enforces the lifecycle:

```text
created → starting → running → stopping → stopped
```

Invalid transitions and implementation failures produce typed transport errors. A stopped handle is terminal and cannot be restarted.

`TransportRegistry` stores adapters by stable `TransportKind` identifiers. Registration rejects duplicate and invalid kinds, lookup is backed by a private `Map`, and unknown kinds throw `TransportNotFoundError`.

The main entry point contains the stable public contracts. Focused `adapter`, `errors`, `registry`, `state`, and `types` subpath exports are also available.
