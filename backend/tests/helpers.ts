import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { Repository, type Identity } from "../src/db/repository.js";
import type { Database, Sql } from "../src/db/database.js";
import type { AuthProvider } from "../src/auth/provider.js";
import { secretBox } from "../src/auth/secrets.js";
export const ownerA: Identity = {
  id: randomUUID(),
  email: "a@example.test",
  providerSessionId: randomUUID(),
};
export const ownerB: Identity = {
  id: randomUUID(),
  email: "b@example.test",
  providerSessionId: randomUUID(),
};
export const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test",
  SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
});
const fakeAuth: AuthProvider = {
  async verify(token) {
    if (token === "owner-a") return ownerA;
    if (token === "owner-b") return ownerB;
    throw new Error("Invalid test token");
  },
  async startWeb() {
    return { url: "https://example.test/oauth", verifier: "verifier" };
  },
  async exchange() {
    return {
      accessToken: "owner-a",
      refreshToken: "refresh",
      expiresAt: Date.now() / 1000 + 3600,
    };
  },
  async refresh() {
    return {
      accessToken: "owner-a",
      refreshToken: "refresh",
      expiresAt: Date.now() / 1000 + 3600,
    };
  },
};
export async function fixture() {
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
      const next = new Promise<void>((r) => {
        release = r;
      });
      const previous = queue;
      queue = next;
      await previous;
      try {
        return await pg.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE dailyloop_runtime");
          return fn({
            async query(sql, params = []) {
              const result = await tx.query(sql, params);
              return { rows: result.rows as Record<string, unknown>[] };
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
  const repo = new Repository(db);
  const app = await buildApp(config, repo, fakeAuth);
  for (const token of ["owner-a", "owner-b"])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/auth/mobile-session",
          headers: { authorization: "Bearer " + token },
        })
      ).statusCode,
      200,
    );
  const request = (
    token: string,
    method: "GET" | "POST" | "PATCH" | "PUT",
    url: string,
    payload?: Record<string, unknown>,
    key = randomUUID(),
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: { authorization: "Bearer " + token, "idempotency-key": key },
    });
  return {
    app,
    repo,
    pg,
    db,
    request,
    async close() {
      await app.close();
      await db.close();
    },
  };
}
