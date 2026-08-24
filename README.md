Warbler

A Bun-native TypeScript framework designed to make backend development feel descriptive, structured, and productive.

Release: v0.1.0

Warbler is designed around a simple developer-experience goal:

Write the application behavior. Let the framework handle the repetitive infrastructure.

A Warbler application is organized around declarative Graphs:

Graph
  ↓
Handlers
  ↓
Guards / Middleware
  ↓
Services through DI
  ↓
Database
  ↓
Responses / Views

The developer describes how the application should behave without manually wiring every dependency, route, database connection, security check, or transport detail.

1. Application Graph

A Graph groups a part of the application.

It can define:

route prefix

routes or socket events

providers

Example:

```ts
import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/users.handlers";

export default defineHttpGraph({
  prefix: "/api",

  middlewares: [],

  providers: [],

  routes: {
    "GET /users": {
      name: "users.index",
      handler: handlers.index,
    },
  },
});
```

The graph gives Warbler enough information to understand how this application area is structured.

Instead of manually registering every route and service in different files, related application pieces stay together.

A project can contain multiple graphs.

For example:

Application
├── PublicGraph
├── AuthGraph
├── AdminGraph
└── SocketGraph

The public application-facing import path is:

```ts
import {
  defineHttpGraph,
  defineHandler,
  defineValidator,
  v,
  Provider,
} from "@warblerjs/framework";
```

The CLI creates new Graph boundaries with:

```text
warbler make:graph users
warbler make:graph users -a hexagonal
warbler make:graph chat -t socket
warbler make:graph realtime -a hexagonal -t http,socket
```

Supported architecture presets are `minimal`, `hexagonal`, `clean`, and `mvc`. The default
transport is `http`.

2. Controllers

Controllers contain application endpoints.

Example:

@Controller("/users")
export class UserController {
  @Get("/")
  async index() {
    return JsonRes({
      users: [],
    });
  }
}

Routes stay close to their handlers.

Another example:

@Controller("/auth")
export class AuthController {
  @Post("/login")
  async login(request: AppRequest) {
    // ...
  }
}

The developer does not manually create an HTTP server or route registry.

Warbler connects the controller to the graph and transport.

3. Route Parameters

Routes can expose parameters through the request API.

@Get("/:id")
async show(request: AppRequest) {
  const id = request.params.id;

  return JsonRes({
    id,
  });
}

4. Query Parameters

@Get("/search")
async search(request: AppRequest) {
  const query = request.query;

  return JsonRes(query);
}

Warbler prepares request information when required by the route.

5. Request Body

Example:

@Post("/")
async store(request: AppRequest) {
  const body = await request.json();

  return JsonRes(body);
}

The application works through Warbler's request API instead of manually implementing Bun request parsing everywhere.

6. Responses

Controllers can return framework responses.

For JSON:

return JsonRes({
  success: true,
});

For HTML:

return HtmlRes("<h1>Hello Warbler</h1>");

For server-rendered views:

return View("users.profile", {
  user,
});

Warbler can also support other response types such as files and streaming responses.

7. Guards

A Guard answers a simple question:

Is this request allowed to continue?

Example:

export const authenticatedGuard: Guard = async (context) => {
  return context.user !== null;
};

Then a controller or route can use the guard.

Conceptually:

@Get("/profile", {
  guards: [authenticatedGuard],
})
async profile() {
  // only executed when the guard succeeds
}

Guards are useful for:

authentication

authorization

roles

permissions

feature access

account status

application policy

The controller remains focused on the endpoint itself.

Instead of:

async profile(request) {
  const session = ...
  const user = ...
  if (!user) ...
  if (!user.active) ...
  if (!user.permissions.includes(...)) ...

  // controller logic
}

the security/access logic can live outside the controller.

8. Middleware

Middleware is used for behavior that should happen around many requests.

Typical examples:

session authentication

request context

logging

locale detection

request metadata

shared security logic

For example, a session middleware can:

request arrives
      ↓
read session cookie
      ↓
find active session
      ↓
resolve user
      ↓
attach authenticated context
      ↓
continue

Then controllers and guards can use the already prepared authentication information.

This avoids repeating session lookup logic in every endpoint.

9. Dependency Injection

Warbler provides dependency injection so services do not need to construct their dependencies manually.

Example service:

@Service({
  provide: "root",
})
export class UserService {
  // ...
}

A controller can use the service through Warbler DI.

Conceptually:

@Controller("/users")
export class UserController {
  private readonly users = inject(UserService);

  @Get("/")
  async index() {
    return this.users.findAll();
  }
}

The developer does not need to write:

const repository = new UserRepository(...);
const service = new UserService(repository);
const controller = new UserController(service);

Warbler manages the dependency graph.

10. Service Layers

A typical Warbler application can remain cleanly separated:

Controller
    ↓
Use Case / Service
    ↓
Repository
    ↓
Warbler Database

Example:

@Service({
  provide: "root",
})
export class RegisterUser {
  async execute(input: RegisterInput) {
    // application logic
  }
}

The controller becomes small:

@Post("/register")
async register(request: AppRequest) {
  const result = await this.registerUser.execute(
    await request.json()
  );

  return JsonRes(result);
}

11. Typed Application Results

Expected application failures do not always need exceptions.

Warbler provides Either.

Example:

const result = await login.execute(input);

return result.match({
  left: (error) => {
    return JsonRes({
      success: false,
      code: error.code,
    });
  },

  right: (data) => {
    return JsonRes({
      success: true,
      data,
    });
  },
});

This makes expected business failures explicit.

Examples:

EMAIL_EXISTS
INVALID_CREDENTIALS
ACCOUNT_DISABLED
TOKEN_EXPIRED

12. PostgreSQL Database

Warbler includes a lightweight PostgreSQL ORM built for Bun.

The generated client is available through:

WlbPg

Example:

const user = await WlbPg.user.findUnique({
  where: {
    id: userId,
  },
});

The API is designed to stay expressive without forcing developers to write SQL for normal application operations.

13. findUnique

Use findUnique when querying by a PostgreSQL unique value.

const user = await WlbPg.user.findUnique({
  where: {
    email,
  },
});

Typical unique selectors include:

primary key
unique column
compound unique constraint

14. findFirst

Use findFirst for normal filtering.

const session = await WlbPg.userSession.findFirst({
  where: {
    sessionHash,
    revokedAt: null,
  },
  orderBy: {
    createdAt: "desc",
  },
});

Filters can use operators:

const event = await WlbPg.eventRegistry.findFirst({
  where: {
    identifier: code,
    expiresAt: {
      gt: new Date(),
    },
  },
});

15. findMany

const users = await WlbPg.user.findMany({
  where: {
    isActive: true,
  },
  orderBy: {
    createdAt: "desc",
  },
  take: 50,
});

16. Select Only What You Need

const user = await WlbPg.user.findFirst({
  where: {
    email,
  },
  select: {
    id: true,
    email: true,
  },
});

The returned TypeScript type follows the selection.

Conceptually:

{
  id: string;
  email: string;
} | null

17. Database Relations

Warbler discovers PostgreSQL relationships from foreign keys during database generation.

The application does not need to manually define normal SQL joins.

For example:

vehicleManufacturer
        ↓
      models

can be generated from the database FK relationship.

Then the developer can write:

const manufacturer =
  await WlbPg.vehicleManufacturer.findFirst({
    where: {
      makeId,
      active: true,
    },

    select: {
      id: true,
      name: true,
      makeId: true,

      models: {
        where: {
          modelId,
          makeId,
        },

        select: {
          id: true,
          modelId: true,
          name: true,
          yearsFrom: true,
          yearsTo: true,
        },

        orderBy: {
          name: "asc",
        },
      },
    },
  });

The developer describes the data required.

Warbler handles the relationship.

18. Relation Filtering

Relations can also participate in filters.

Example:

const user = await WlbPg.user.findFirst({
  where: {
    posts: {
      some: {
        likes: {
          gt: 100,
        },
      },
    },
  },
});

The developer does not need to manually write a SQL JOIN or EXISTS query for common relation filtering.

19. Create

const user = await WlbPg.user.create({
  data: {
    email,
    passwordHash,
    isActive: true,
  },
});

Select returned fields when needed:

const user = await WlbPg.user.create({
  data: {
    email,
    passwordHash,
  },

  select: {
    id: true,
    email: true,
  },
});

20. createMany

const users = [
  {
    email: "one@example.com",
    passwordHash,
    isActive: true,
  },
  {
    email: "two@example.com",
    passwordHash,
    isActive: true,
  },
];

const result = await WlbPg.user.createMany({
  data: users,
});

For asynchronous preparation:

const users = await Promise.all(
  Array.from({ length: 200 }, async () => ({
    email: generateRandomEmail(),
    passwordHash: await createPasswordHash(),
    isActive: true,
  }))
);

await WlbPg.user.createMany({
  data: users,
});

If the same password is intentionally used for seed/benchmark data, hash it once:

const passwordHash = await password.hash("password");

const users = Array.from({ length: 200 }, () => ({
  email: generateRandomEmail(),
  passwordHash,
  isActive: true,
}));

await WlbPg.user.createMany({
  data: users,
});

21. Update

const user = await WlbPg.user.update({
  where: {
    id: userId,
  },

  data: {
    name: "New name",
  },
});

Atomic updates can express operations such as:

await WlbPg.user.update({
  where: {
    id: userId,
  },

  data: {
    loginCount: {
      increment: 1,
    },
  },
});

22. updateMany

await WlbPg.userSession.updateMany({
  where: {
    revokedAt: null,
    expiresAt: {
      lt: new Date(),
    },
  },

  data: {
    revokedAt: new Date(),
  },
});

Mass mutations require an intentional filter.

23. Upsert

const user = await WlbPg.user.upsert({
  where: {
    email,
  },

  create: {
    email,
    name: "Habib",
  },

  update: {
    name: "Habib",
  },
});

This expresses:

create if missing
otherwise update

without application-side existence-check boilerplate.

24. Delete

const deleted = await WlbPg.user.delete({
  where: {
    id: userId,
  },
});

Bulk deletes can use filters:

await WlbPg.userSession.deleteMany({
  where: {
    expiresAt: {
      lt: new Date(),
    },
  },
});

25. Nested Writes

Relations can be used while creating data.

Example:

await WlbPg.vehicleManufacturer.create({
  data: {
    name: "BMW",
    makeId: 16,

    models: {
      create: [
        {
          modelId: 100,
          makeId: 16,
          name: "X5",
        },
        {
          modelId: 101,
          makeId: 16,
          name: "X3",
        },
      ],
    },
  },
});

The relationship is already known from generated PostgreSQL metadata.

26. Transactions

Multiple database operations can be grouped safely:

const result = await WlbPg.transaction(async (tx) => {
  const user = await tx.user.create({
    data: {
      email,
      passwordHash,
    },
  });

  const session = await tx.userSession.create({
    data: {
      userId: user.id,
      sessionHash,
    },
  });

  return {
    user,
    session,
  };
});

If the callback succeeds:

commit

If it throws:

rollback

The same generated database API is available through tx.

This keeps transactional code familiar.

27. Database Migrations

Warbler includes PostgreSQL migration tooling.

A migration describes how the database moves forward and backward.

Conceptually:

export default {
  async up(db) {
    // create or modify schema
  },

  async down(db) {
    // reverse the migration
  },
};

Apply pending migrations:

warbler db:pg migration

Rollback the latest applied migration:

warbler db:pg rollback

Rollback uses the migration's down() definition.

28. Database Generation

After the PostgreSQL schema is ready, Warbler can generate database artifacts:

warbler db:pg generate

Generation can prepare:

table metadata

column types

unique constraints

foreign keys

relationships

generated model types

generated ORM client

The application then gets typed APIs such as:

WlbPg.user
WlbPg.userSession
WlbPg.vehicleManufacturer

The developer does not manually keep TypeScript database models synchronized with PostgreSQL.

29. Database Development Flow

A typical workflow is:

create migration
      ↓
apply migration
      ↓
generate database client
      ↓
use typed WlbPg API

Conceptually:

warbler db:pg migration
warbler db:pg generate

Then:

const user = await WlbPg.user.findFirst({
  where: {
    email,
  },
});

30. Crypto

Warbler provides framework crypto utilities for common backend needs.

Examples include:

password hashing
password verification
hashing
encryption
HMAC
secure random values
keys
encoding

Example:

const passwordHash =
  await password.hash(input.password);

Verify:

const valid =
  await password.verify(
    input.password,
    user.passwordHash
  );

The application does not need to choose unsafe low-level cryptographic defaults for common operations.

31. Sessions

A typical authentication flow can be expressed using Warbler services and database APIs.

login request
    ↓
controller
    ↓
login service/use case
    ↓
find user
    ↓
verify password
    ↓
create session
    ↓
set cookie

Session validation can then be handled centrally by shared request middleware instead of repeating it in every controller.

32. Server-Side Views

Warbler can render server-side views.

Example:

return View("auth.login", {
  title: "Login",
});

Templates can use application helpers such as:

{{ tr("auth.login") }}

{{ asset("app.css") }}

{{ route("users.show", user.id) }}

{{ csrfToken }}

{{{ csrfField }}}

Layouts and partials can be used to organize shared UI.

33. Frontend Resources

A Warbler application can keep frontend assets in application resources:

resources/
├── css/
├── js/
└── views/

The framework can bundle application assets into public output.

This allows a Warbler project to support:

backend APIs
SSR pages
frontend JavaScript
CSS
static resources

inside one application when desired.

34. Configuration

Application behavior is configured through typed configuration files.

For example, transport configuration can look conceptually like:

export default {
  network: {
    host: "0.0.0.0",
  },

  transports: {
    http: {
      enabled: true,
      port: 3000,
    },

    websocket: {
      enabled: true,
    },
  },
} as const;

Configuration stays in code and remains type-friendly.

35. Development

A Warbler application is intended to provide a simple development command:

warbler dev

Development tooling can handle framework startup and developer feedback.

36. Production Build

Warbler provides a build workflow for preparing the application for production.

warbler build

The goal is a deployable application containing the required server and frontend artifacts.

Production execution should remain simple.

Conceptually:

bun ./dist/server.js

37. CLI

Warbler's CLI is intended to provide the common application workflow.

Examples include:

warbler dev
warbler build
warbler start
warbler doctor
warbler inspect

Database commands include:

warbler db:pg migration
warbler db:pg rollback
warbler db:pg generate

The CLI keeps framework operations discoverable instead of requiring developers to remember unrelated scripts.

38. Typical Warbler Feature

A feature can remain easy to navigate:

users/
├── domain/
├── application/
├── infrastructure/
└── presentation/

For a smaller application, the structure can remain smaller.

Warbler does not require application logic to live inside controllers.

A common flow is:

HTTP request
    ↓
Middleware
    ↓
Guard
    ↓
Controller
    ↓
Service / Use Case
    ↓
Database
    ↓
Response

39. Example: Login Flow

Controller:

@Controller("/auth")
export class AuthController {
  private readonly login = inject(LoginUseCase);

  @Post("/login")
  async store(request: AppRequest) {
    const input = await request.json();

    const result = await this.login.execute(input);

    return result.match({
      left: (error) =>
        JsonRes({
          success: false,
          code: error.code,
        }),

      right: (data) =>
        JsonRes({
          success: true,
          user: data.user,
        }),
    });
  }
}

Use case:

@Service({
  provide: "root",
})
export class LoginUseCase {
  async execute(input: LoginInput) {
    const user = await WlbPg.user.findFirst({
      where: {
        email: input.email,
      },
    });

    if (!user) {
      return left({
        code: "INVALID_CREDENTIALS",
      });
    }

    const valid = await password.verify(
      input.password,
      user.passwordHash
    );

    if (!valid) {
      return left({
        code: "INVALID_CREDENTIALS",
      });
    }

    return right({
      user,
    });
  }
}

The developer can keep each concern in its appropriate layer without manually wiring infrastructure everywhere.

40. Example: Protected Request

A protected request can flow like:

GET /account
      ↓
session middleware
      ↓
session resolved
      ↓
authenticated guard
      ↓
AccountController
      ↓
AccountService
      ↓
WlbPg
      ↓
JSON / View

Controllers do not need to repeat session parsing and authentication code.

Warbler DX in One Example

@Graph({
  prefix: "/api",
  controllers: [UserController],
  providers: [UserService],
})
export class ApiGraph {}

@Service({
  provide: "root",
})
export class UserService {
  async activeUsers() {
    return WlbPg.user.findMany({
      where: {
        isActive: true,
      },

      select: {
        id: true,
        email: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });
  }
}

@Controller("/users")
export class UserController {
  private readonly users = inject(UserService);

  @Get("/")
  async index() {
    return JsonRes({
      users: await this.users.activeUsers(),
    });
  }
}

That is the direction of Warbler's developer experience:

declare the graph
declare the controller
inject the service
describe the database query
return the response

The framework handles the repetitive infrastructure between those steps.

Design Goal

Warbler's DX should feel like:

less wiring
less boilerplate
clear ownership
strong types
predictable conventions
one coherent framework

The developer should spend more time describing application behavior and less time assembling framework plumbing.

Version

Warbler v0.1.0

This is an early release.

The framework is still evolving and APIs may change before 1.0.0.
