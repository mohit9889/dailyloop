/** Isolated browser QA only. Never part of a deployment or production build. */
import { AccountingRepository } from "../src/db/accounting.js";
import { todayIST } from "@dailyloop/contracts";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { Repository } from "../src/db/repository.js";
import type { Database, Sql } from "../src/db/database.js";
import type { AuthProvider } from "../src/auth/provider.js";
if (process.env.NODE_ENV !== "test" || process.env.DAILYLOOP_UI_FIXTURE !== "1")
  throw new Error("This fixture requires explicit test-only activation.");
const pg = new PGlite();
for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  await pg.exec(
    await readFile(new URL("../migrations/" + name, import.meta.url), "utf8"),
  );
}
let queue = Promise.resolve();
const db: Database = {
  async transaction(fn) {
    let release!: () => void;
    const previous = queue;
    queue = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      return await pg.transaction(async (t) => {
        await t.exec("SET LOCAL ROLE dailyloop_runtime");
        return fn({
          async query(sql, params = []) {
            const r = await t.query(sql, params);
            return { rows: r.rows as Record<string, unknown>[] };
          },
        } as Sql);
      });
    } finally {
      release();
    }
  },
  async close() {
    await pg.close();
  },
};
const identity = {
  id: randomUUID(),
  email: "owner@example.test",
  providerSessionId: randomUUID(),
};
const auth: AuthProvider = {
  async verify(token) {
    if (token !== "test-owner") throw new Error("Invalid fixture identity");
    return identity;
  },
  async startWeb() {
    return {
      url: "http://127.0.0.1:4100/auth/google/callback?code=fixture-code",
      verifier: "fixture-verifier",
    };
  },
  async exchange(code, verifier) {
    if (code !== "fixture-code" || verifier !== "fixture-verifier")
      throw new Error("Invalid fixture flow");
    return {
      accessToken: "test-owner",
      refreshToken: "test-refresh",
      expiresAt: Date.now() / 1000 + 3600,
    };
  },
  async refresh() {
    return {
      accessToken: "test-owner",
      refreshToken: "test-refresh",
      expiresAt: Date.now() / 1000 + 3600,
    };
  },
};
const config = readConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "http://127.0.0.1:4100",
  DATABASE_URL: "fixture",
  SUPABASE_URL: "https://fixture.example.test",
  SUPABASE_PUBLISHABLE_KEY: "fixture",
  SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
});
const app = await buildApp(config, new Repository(db), auth);
if (process.env.DAILYLOOP_UI_SEED === "accounting") {
  const repo = new AccountingRepository(db);
  await repo.createBusiness(identity, {
    name: "Accounting QA · Test records",
    serviceType: "tiffin",
  });
  const customer = await repo.createCustomer(
    identity,
    { name: "[TEST] Ananya", phone: "", address: "Test Garden Apartments" },
    randomUUID(),
  );
  for (const [label, rate] of [
    ["Lunch thali", "9000"],
    ["Dinner thali", "10000"],
  ])
    await repo.createPlan(
      identity,
      customer.id,
      {
        label,
        unit: "meal",
        quantityMilli: 1000,
        ratePaise: rate,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startOn: todayIST(),
      },
      randomUUID(),
    );
}
if (process.env.DAILYLOOP_UI_DROP_RECEIPT_RESPONSE === "1") {
  let interrupted=false;
  const failure=JSON.stringify({error:{code:'TEST_RESPONSE_LOST',message:'TEST: server accepted this receipt, but its response was interrupted. Retry the pending save.'}});
  app.server.prependListener('request',(req,res)=>{
    if(interrupted||req.method!=='POST'||req.url!=='/v1/receipts')return;
    let fault=false;const end=res.end.bind(res),head=res.writeHead.bind(res);
    const failHeaders={'content-type':'application/json','content-length':Buffer.byteLength(failure)};
    res.writeHead=((status:number,...args:unknown[])=>{if(!interrupted&&status===201){interrupted=true;fault=true;return head(503,failHeaders);}return Reflect.apply(head,res,[status,...args]);}) as typeof res.writeHead;
    res.end=((...args:unknown[])=>{if(!interrupted&&res.statusCode===201&&!res.headersSent){interrupted=true;fault=true;head(503,failHeaders);}return fault?end(failure):Reflect.apply(end,res,args);}) as typeof res.end;
  });
}
await app.listen({ host: "127.0.0.1", port: 4100 });
console.log(
  "Isolated browser fixture: http://127.0.0.1:4100 (in-memory test records only)",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
