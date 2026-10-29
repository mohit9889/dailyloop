import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { todayIST } from "@dailyloop/contracts";
import { fixture, ownerA, ownerB } from "./helpers.js";
import { statementCsv, csvCell } from "../src/exports/statement.js";
async function setup() {
  const f = await fixture();
  await f.request("owner-a", "POST", "/v1/businesses", {
    name: "Web test business",
    serviceType: "tiffin",
  });
  await f.request("owner-b", "POST", "/v1/businesses", {
    name: "Other owner business",
    serviceType: "milk",
  });
  const c = (
    await f.request("owner-a", "POST", "/v1/customers", {
      name: "=Unsafe spreadsheet name",
      address: "Test only",
    })
  ).json().data;
  return { ...f, c };
}
test("business settings use expected revision, audited transactions and retry keys", async () => {
  const f = await setup();
  try {
    const me = (await f.request("owner-a", "GET", "/v1/me")).json().data;
    const body = {
      name: "Updated tiffin business",
      serviceType: "mixed",
      expectedRevision: me.business.revision,
    };
    const key = randomUUID();
    const r = await f.request("owner-a", "PATCH", "/v1/business", body, key);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().data.name, body.name);
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/me")).json().data.business.name,
      body.name,
    );
    assert.deepEqual(
      (await f.request("owner-a", "PATCH", "/v1/business", body, key)).json(),
      r.json(),
    );
    assert.equal(
      (await f.request("owner-a", "PATCH", "/v1/business", body)).statusCode,
      409,
    );
    assert.equal(
      (await f.request("owner-b", "GET", "/v1/me")).json().data.business.name,
      "Other owner business",
    );
  } finally {
    await f.close();
  }
});
test("support/deletion requests are private, repeat-safe, cancellable and require fresh sign-in for deletion", async () => {
  const f = await setup();
  try {
    const key = randomUUID();
    const body = { kind: "support", message: "Need help with a statement" };
    const r = await f.request(
      "owner-a",
      "POST",
      "/v1/account/requests",
      body,
      key,
    );
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(
      (
        await f.request("owner-a", "POST", "/v1/account/requests", body, key)
      ).json(),
      r.json(),
    );
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          "/v1/account/requests",
          { ...body, message: "Different body" },
          key,
        )
      ).statusCode,
      409,
    );
    const id = r.json().data.id;
    assert.equal(
      (await f.request("owner-b", "GET", "/v1/account/requests")).json().data
        .items.length,
      0,
    );
    assert.equal(
      (
        await f.request(
          "owner-b",
          "POST",
          `/v1/account/requests/${id}/cancel`,
          {},
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/account/requests/${id}/cancel`,
          {},
        )
      ).json().data.status,
      "cancelled",
    );
    const deletion = {
      kind: "deletion",
      message: "Remove my testing account",
      confirmation: "DELETE MY ACCOUNT",
    };
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/account/requests", {
          ...deletion,
          confirmation: "wrong",
        })
      ).statusCode,
      422,
    );
    await f.pg.query(
      "UPDATE private.app_sessions SET authenticated_at=now()-interval '11 minutes' WHERE user_id=$1",
      [ownerA.id],
    );
    assert.equal(
      (await f.request("owner-a", "POST", "/v1/account/requests", deletion))
        .statusCode,
      403,
    );
    await f.pg.query(
      "UPDATE private.app_sessions SET authenticated_at=now() WHERE user_id=$1",
      [ownerA.id],
    );
    const a = await f.request(
      "owner-a",
      "POST",
      "/v1/account/requests",
      deletion,
    );
    assert.equal(a.statusCode, 201, a.body);
    const b = await f.request(
      "owner-a",
      "POST",
      "/v1/account/requests",
      deletion,
    );
    assert.equal(a.json().data.id, b.json().data.id);
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/customers")).json().data.items
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("full account export requires recent authentication and omits every session secret", async () => {
  const f = await setup();
  try {
    const r = await f.request("owner-a", "POST", "/v1/account/export", {});
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.match(String(r.headers["content-disposition"]), /attachment/);
    const data = r.json();
    assert.equal(data.tables.customers.length, 1);
    assert.equal(data.tables.customers[0].id, f.c.id);
    assert.ok(!r.body.includes("encrypted_tokens"));
    assert.ok(!r.body.includes("csrf_token"));
    assert.ok(!r.body.includes(ownerB.id));
    await f.pg.query(
      "UPDATE private.app_sessions SET authenticated_at=now()-interval '11 minutes' WHERE user_id=$1",
      [ownerA.id],
    );
    assert.equal(
      (await f.request("owner-a", "POST", "/v1/account/export", {})).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test("CSV/PDF export uses all entries at one revision, rejects tenant guesses and detects changed statements", async () => {
  const f = await setup();
  try {
    for (let i = 0; i < 3; i++)
      await f.request("owner-a", "POST", "/v1/receipts", {
        customerId: f.c.id,
        effectiveOn: todayIST(),
        amountPaise: "1000",
        method: "cash",
        reason: "Export test receipt " + i,
      });
    const q = `from=${todayIST()}&to=${todayIST()}`;
    const s = (
      await f.request(
        "owner-a",
        "GET",
        `/v1/customers/${f.c.id}/statement?${q}&limit=1`,
      )
    ).json().data;
    assert.equal(s.lines.length, 1);
    const csv = await f.request(
      "owner-a",
      "GET",
      `/v1/customers/${f.c.id}/statement.csv?${q}&limit=1&revision=${s.businessRevision}`,
    );
    assert.equal(csv.statusCode, 200, csv.body);
    assert.match(csv.body, /'=Unsafe/);
    assert.equal((csv.body.match(/Export test receipt/g) || []).length, 3);
    assert.match(csv.body, /Closing balance/);
    assert.equal(csv.headers["cache-control"], "no-store");
    assert.equal(
      (
        await f.request(
          "owner-b",
          "GET",
          `/v1/customers/${f.c.id}/statement.pdf?${q}&revision=${s.businessRevision}`,
        )
      ).statusCode,
      404,
    );
    const pdf = await f.request(
      "owner-a",
      "GET",
      `/v1/customers/${f.c.id}/statement.pdf?${q}&revision=${s.businessRevision}`,
    );
    assert.equal(pdf.statusCode, 200, pdf.body.slice(0, 100));
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.rawPayload.length > 3000);
    await f.request("owner-a", "POST", "/v1/receipts", {
      customerId: f.c.id,
      effectiveOn: todayIST(),
      amountPaise: "1",
      method: "cash",
      reason: "New entry after viewed statement",
    });
    assert.equal(
      (
        await f.request(
          "owner-a",
          "GET",
          `/v1/customers/${f.c.id}/statement.csv?${q}&revision=${s.businessRevision}`,
        )
      ).statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});
test("spreadsheet formula prefixes and quotes are treated as data", () => {
  for (const text of ["=1+1", ' +HYPERLINK("bad")', "\t@SUM(A1)", "-2+3"])
    assert.ok(csvCell(text).startsWith("\"'"));
  assert.equal(csvCell('a"b'), '"a""b"');
});

test("a signed-in owner without a business can request deletion without creating a business", async () => {
  const f = await fixture();
  try {
    const r = await f.request("owner-a", "POST", "/v1/account/requests", {
      kind: "deletion",
      message: "Remove this unused login",
      confirmation: "DELETE MY ACCOUNT",
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/me")).json().data.business,
      null,
    );
    assert.equal(
      (await f.request("owner-b", "GET", "/v1/account/requests")).json().data
        .items.length,
      0,
    );
  } finally {
    await f.close();
  }
});
