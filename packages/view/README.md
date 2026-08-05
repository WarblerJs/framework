# @warbler/view

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
} from "@warbler/view";

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
import { View } from "@warbler/view";

return View("home.index", { users });
```

`{{ value }}` is escaped. `{!! value !!}` deliberately emits raw HTML and must not receive
untrusted content.
