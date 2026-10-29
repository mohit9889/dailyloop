import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { supabaseAuth } from "../src/auth/provider.js";
import { readConfig } from "../src/config.js";
test("Supabase verifier checks cryptographic signature, issuer, audience, expiry and session claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  const url = "http://127.0.0.1:" + address.port;
  const auth = supabaseAuth(
    readConfig({
      NODE_ENV: "test",
      SUPABASE_URL: url,
      SUPABASE_PUBLISHABLE_KEY: "test",
      SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    }),
  );
  const subject = randomUUID(),
    session = randomUUID();
  const sign = (
    issuer = url + "/auth/v1",
    audience = "authenticated",
    expiry = "1h",
    sessionId: string | undefined = session,
  ) =>
    new SignJWT({
      email: "owner@example.test",
      ...(sessionId ? { session_id: sessionId } : {}),
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(privateKey);
  try {
    const valid = await sign();
    assert.equal((await auth.verify(valid)).id, subject);
    assert.equal((await auth.verify(valid)).providerSessionId, session);
    await assert.rejects(auth.verify(await sign("https://attacker.test")));
    await assert.rejects(auth.verify(await sign(undefined, "other-audience")));
    await assert.rejects(auth.verify(await sign(undefined, undefined, "-1h")));
    await assert.rejects(
      auth.verify(await sign(undefined, undefined, undefined, "not-a-uuid")),
    );
    const parts = valid.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ sub: subject, session_id: session }),
    ).toString("base64url");
    await assert.rejects(auth.verify(parts.join(".")));
    const start = await auth.startWeb();
    assert.ok(start.url.includes("provider=google"));
    assert.ok(start.verifier.length > 20);
    assert.ok(start.url.includes("code_challenge="));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
