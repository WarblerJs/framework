import { expect, test } from "bun:test";
import { startCaptured } from "./helpers";

interface CapturedHttp {
  readonly routes: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          (request: Request) => Response | Promise<Response>
        >
      >
    >
  >;
}

test("generated native HTTP routes invoke declarative handlers", async () => {
  let captured: CapturedHttp | undefined;

  const runtime = await startCaptured("http", (bindings) => {
    captured = bindings as CapturedHttp;
  });

  try {
    const routes = captured?.routes;
    if (routes === undefined) {
      throw new Error("HTTP routes were not supplied");
    }

    const customersHandler = routes["/customers"]?.GET;
    if (customersHandler === undefined) {
      throw new Error("Customers route was not generated");
    }

    const customers = await customersHandler(
      new Request("http://127.0.0.1/customers"),
    );

    expect(customers.status).toBe(200);
    expect(await customers.json()).toEqual({
      message: "customers",
    });

    const ordersHandler = routes["/orders"]?.GET;
    if (ordersHandler === undefined) {
      throw new Error("Orders route was not generated");
    }

    const orders = await ordersHandler(
      new Request("http://127.0.0.1/orders"),
    );

    expect(orders.status).toBe(200);
    expect(await orders.json()).toEqual({
      message: "orders",
    });
  } finally {
    await runtime.stop();
  }
}, 15_000);