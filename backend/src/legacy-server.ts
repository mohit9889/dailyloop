import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store, DomainError, todayIST } from "./store.js";
const directory = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(directory, { recursive: true });
const store = new Store(
  process.env.DAILYLOOP_DB || directory + "dailyloop.sqlite",
);
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/health") {
      res.end(JSON.stringify({ ok: true, mode: "local-development" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/workspace") {
      res.end(
        JSON.stringify(
          store.snapshot(url.searchParams.get("date") || todayIST()),
        ),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/statement") {
      res.end(
        JSON.stringify(
          store.statement(
            url.searchParams.get("customerId") || "",
            url.searchParams.get("from") || "",
            url.searchParams.get("to") || "",
          ),
        ),
      );
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found." }));
      return;
    }
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
      ].includes(origin)
    ) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "Origin not allowed." }));
      return;
    }
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new DomainError("Send JSON data.");
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 16384)
        throw new DomainError("Request too large.");
    }
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      throw new DomainError("Invalid JSON.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new DomainError("Expected an object.");
    const methods: Record<string, (x: Record<string, unknown>) => unknown> = {
      "/api/customers": (x) => store.addCustomer(x),
      "/api/plans": (x) => store.addPlan(x),
      "/api/deliveries": (x) => store.recordDelivery(x),
      "/api/payments": (x) => store.addPayment(x),
    };
    if (!methods[url.pathname]) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found." }));
      return;
    }
    const result = methods[url.pathname](input);
    res.statusCode = 201;
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error instanceof DomainError ? error.status : 500;
    res.end(
      JSON.stringify({
        error:
          error instanceof DomainError
            ? error.message
            : "The operation could not be saved.",
      }),
    );
    if (!(error instanceof DomainError)) console.error(error);
  }
});
server.listen(4000, process.env.DAILYLOOP_HOST || "127.0.0.1", () =>
  console.log("DailyLoop local API: http://127.0.0.1:4000"),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
