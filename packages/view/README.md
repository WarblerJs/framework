# @warblerjs/view

Compile-first Warbler template renderer. `compileViewProject()` discovers and parses templates,
validates the immutable dependency graph, bundles configured browser assets, and returns an
artifact that `activateCompiledViews()` publishes atomically. `View(name, data)` renders only
from that artifact; request handling performs no template filesystem access or parsing.

Supported syntax:

```html
{{ expression }}
{!! rawExpression !!}

@if (condition) {
  ...
} @else if (condition) {
  ...
} @else {
  ...
}

@for (item, index of items; track item.id) {
  ...
}

@switch (value) {
  @case ('one') {
    ...
  }
  @default {
    ...
  }
}

@import('partials.header')

@extends('layouts.main')
@section('content') {
  ...
}
@yield('content', 'fallback')
```

Example:

```ts
import {
  createCompiledViewArtifact,
  renderCompiledView,
} from "@warblerjs/view";

const artifact = createCompiledViewArtifact({
  templates: {
    "home.index": `
      @for (user of users) {
        <h1>{{ user.name }}</h1>
      }
    `,
  },
});

const html = await renderCompiledView({
  artifact,
  name: "home.index",
  data: {
    users: [{ name: "Noah" }],
  },
});
```

Application controllers can return a native HTML response:

```ts
import { View } from "@warblerjs/view";

return View("home.index", { users });
```

`{{ value }}` is escaped. `{!! value !!}` deliberately emits raw HTML and must not receive
untrusted content.

## Framework built-ins

`View()`/`renderCompiledView()` accept an optional `builtins` map (`ViewResponseOptions.builtins`
/ `RenderCompiledViewOptions.builtins`) — a second, function-capable scope resolved alongside
`data` inside `{{ }}`/`{{{ }}}` expressions, using the exact same evaluator. This is how
`@warblerjs/http`'s `view()` makes `tr()`, `asset()`, `route()`, `csrfField`, and `csrfToken`
available to every template automatically; `@warblerjs/view` itself has no opinion on what a
built-in is — it just resolves names, the same as `data`. See `@warblerjs/http`'s README for the
concrete built-in list, reserved-name rules, and error handling.

Tailwind CSS v4 uses the official CLI when enabled in the existing View configuration:

```ts
assets: {
  styles: {
    entries: { app: "resources/css/app.css" },
    tailwind: true,
  },
}
```

The CSS entry remains CSS-first and may use `@import "tailwindcss"`, `@plugin`, `@theme`,
`@custom-variant`, and `@source`. Warbler invokes no Tailwind watcher; its existing serialized
development queue builds and atomically replaces `public/app.css`.
