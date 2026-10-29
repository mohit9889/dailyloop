import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { secretBox } from "../src/auth/secrets.js";
import { readConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { fixture, ownerA, ownerB, config } from "./helpers.js";
test("PostgreSQL RLS and API isolate two businesses, including guessed customer IDs", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject({ url: "/v1/me" })).statusCode, 401);
    for (const token of ["owner-a", "owner-b"])
      assert.equal(
        (
          await f.request(token, "POST", "/v1/businesses", {
            name: token,
            serviceType: "milk",
          })
        ).statusCode,
        201,
      );
    const created = await f.request("owner-a", "POST", "/v1/customers", {
      name: "Ananya",
      address: "A-204",
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().data.id;
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/customers")).json().data.items
        .length,
      1,
    );
    assert.equal(
      (await f.request("owner-b", "GET", "/v1/customers")).json().data.items
        .length,
      0,
    );
    assert.equal(
      (await f.request("owner-b", "GET", "/v1/customers/" + id)).statusCode,
      404,
    );
    await f.db.transaction(async (t) => {
      assert.equal(
        (await t.query("SELECT * FROM app.customers")).rows.length,
        0,
      );
      await t.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
        [ownerB.id, created.json().data.businessId],
      );
      assert.equal(
        (await t.query("SELECT * FROM app.customers")).rows.length,
        0,
      );
    });
  } finally {
    await f.close();
  }
});
test("customer retry returns one record; changed payload with same operation key is rejected", async () => {
  const f = await fixture();
  try {
    await f.request("owner-a", "POST", "/v1/businesses", {
      name: "Morning service",
      serviceType: "milk",
    });
    const key = randomUUID(),
      body = { name: "Customer", address: "Test address" };
    const first = await f.request(
        "owner-a",
        "POST",
        "/v1/customers",
        body,
        key,
      ),
      second = await f.request("owner-a", "POST", "/v1/customers", body, key);
    assert.equal(first.statusCode, 201, first.body);
    assert.deepEqual(first.json(), second.json());
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          "/v1/customers",
          { ...body, name: "Changed" },
          key,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/customers")).json().data.items
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("input validation, setup requirements and revoked native sessions fail closed", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/customers", {
          name: "Customer",
          address: "Address",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/businesses", {
          name: "Test",
          serviceType: "invalid",
        })
      ).statusCode,
      422,
    );
    await f.repo.revoke(ownerA);
    assert.equal((await f.request("owner-a", "GET", "/v1/me")).statusCode, 401);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/auth/mobile-session",
          headers: { authorization: "Bearer owner-a" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
  const app = await buildApp(readConfig({ NODE_ENV: "test" }));
  try {
    assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 503);
    assert.equal((await app.inject({ url: "/v1/me" })).statusCode, 503);
    assert.equal((await app.inject({ url: "/api/workspace" })).statusCode, 404);
  } finally {
    await app.close();
  }
});
test("web cookies require CSRF and origin; logout revokes the server session", async () => {
  const f = await fixture();
  try {
    const box = secretBox(config.SESSION_ENCRYPTION_KEY!);
    const session = await f.repo.registerWeb(
      ownerA,
      box.seal({
        accessToken: "owner-a",
        refreshToken: "refresh",
        expiresAt: Date.now() / 1000 + 3600,
      }),
    );
    const cookie = "dailyloop_session=" + session.token;
    const me = await f.app.inject({ url: "/v1/me", headers: { cookie } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().data.csrfToken, session.csrf);
    const payload = { name: "Secure business", serviceType: "milk" };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/businesses",
          headers: { cookie, "idempotency-key": randomUUID() },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/businesses",
          headers: {
            cookie,
            origin: config.APP_ORIGIN,
            "x-csrf-token": session.csrf,
            "idempotency-key": randomUUID(),
          },
          payload,
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/auth/logout",
          headers: {
            cookie,
            origin: config.APP_ORIGIN,
            "x-csrf-token": session.csrf,
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/v1/me", headers: { cookie } })).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});
test("session encryption detects modification; production refuses insecure origins", () => {
  const box = secretBox(randomBytes(32).toString("base64"));
  const sealed = box.seal({ secret: "value" });
  assert.deepEqual(box.open(sealed), { secret: "value" });
  const parts = sealed.split(".");
  const bytes = Buffer.from(parts[2], "base64url");
  bytes[0] ^= 1;
  parts[2] = bytes.toString("base64url");
  assert.throws(() => box.open(parts.join(".")));
  assert.throws(() => readConfig({ NODE_ENV: "production" }), /HTTPS/);
});
