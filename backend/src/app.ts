import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  ConfirmDelivery,
  CorrectDelivery,
  ReceiptInput,
  ReversalInput,
  OpeningInput,
  Period,
  ServiceDate,
  BusinessEditInput,
  OwnerRequestInput,
  BusinessInput,
  CustomerInput,
  Page,
  PlanCreate,
  PlanRevisionInput,
  PauseInput,
  ResumeInput,
  OverrideInput,
  EndPlanInput,
  EditCustomerInput,
  ArchiveCustomerInput,
  SchedulePreviewInput,
  NewPlanPreviewInput,
} from "@dailyloop/contracts";
import { WorkspaceRepository } from "./db/workspace.js";
import { statementCsv, statementPdf } from "./exports/statement.js";
import { AccountingRepository } from "./db/accounting.js";
import { LifecycleRepository } from "./db/lifecycle.js";
import type { Config } from "./config.js";
import { missingConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { Repository, type Identity } from "./db/repository.js";
import type { AuthProvider, Tokens } from "./auth/provider.js";
import { secretBox } from "./auth/secrets.js";
function same(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function buildApp(
  config: Config,
  repository?: Repository,
  auth?: AuthProvider,
) {
  const lifecycle = repository
    ? new LifecycleRepository(repository.db)
    : undefined;
  const accounting = repository
    ? new AccountingRepository(repository.db)
    : undefined;
  const workspace = repository
    ? new WorkspaceRepository(repository.db)
    : undefined;
  const app = Fastify({
    logger:
      config.NODE_ENV === "production"
        ? {
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
            ],
          }
        : false,
    bodyLimit: 16384,
    requestTimeout: 15000,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const configured =
    missingConfig(config).length === 0 && Boolean(repository && auth);
  const secure = config.NODE_ENV === "production",
    sessionCookie = secure ? "__Host-dailyloop_session" : "dailyloop_session",
    oauthCookie = secure ? "__Host-dailyloop_oauth" : "dailyloop_oauth";
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
  const box = config.SESSION_ENCRYPTION_KEY
    ? secretBox(config.SESSION_ENCRYPTION_KEY)
    : undefined;
  function requireSetup() {
    if (!configured)
      throw new ApiError(
        503,
        "SETUP_REQUIRED",
        "DailyLoop is waiting for its secure project configuration.",
      );
  }
  async function identity(
    request: import("fastify").FastifyRequest,
    write = false,
  ): Promise<{ user: Identity; csrf?: string }> {
    requireSetup();
    const authorization = request.headers.authorization;
    if (authorization) {
      if (!authorization.startsWith("Bearer "))
        throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
      const user = await auth!.verify(authorization.slice(7));
      if (!(await repository!.mobileActive(user)))
        throw new ApiError(401, "SESSION_REQUIRED", "Sign in to continue.");
      return { user };
    }
    const token = request.cookies[sessionCookie];
    if (!token) throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
    return repository!.webSession(token, async (session, update) => {
      let tokens: Tokens;
      try {
        tokens = box!.open<Tokens>(session.encrypted_tokens);
      } catch {
        throw new ApiError(401, "UNAUTHORIZED", "Please sign in again.");
      }
      if (tokens.expiresAt < Date.now() / 1000 + 30) {
        tokens = await auth!.refresh(tokens.refreshToken);
        await update(box!.seal(tokens));
      }
      const user = await auth!.verify(tokens.accessToken);
      if (
        user.id !== session.user_id ||
        user.providerSessionId !== session.provider_session_id
      )
        throw new ApiError(401, "UNAUTHORIZED", "Please sign in again.");
      if (write) {
        const csrf = request.headers["x-csrf-token"];
        if (
          request.headers.origin !== config.APP_ORIGIN ||
          typeof csrf !== "string" ||
          !same(csrf, session.csrf_token)
        )
          throw new ApiError(
            403,
            "CSRF_REJECTED",
            "Refresh the page and try again.",
          );
      }
      return { user, csrf: session.csrf_token };
    });
  }
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      reply.code(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: error.issues
            .slice(0, 3)
            .map((issue) => issue.message)
            .join(" "),
          fieldErrors: z.flattenError(error).fieldErrors,
        },
        requestId: request.id,
      });
      return;
    }
    const known = error instanceof ApiError;
    const status = known
      ? error.status
      : (error as { statusCode?: number }).statusCode || 500;
    if (!known && status >= 500)
      request.log.error(
        { message: "Request failed", requestId: request.id },
        "Internal failure",
      );
    reply.code(status).send({
      error: {
        code: known
          ? error.code
          : status === 429
            ? "RATE_LIMITED"
            : status < 500
              ? "BAD_REQUEST"
              : "INTERNAL_ERROR",
        message: known
          ? error.message
          : status === 429
            ? "Too many requests. Try again shortly."
            : status < 500
              ? "Invalid request."
              : "The operation could not be completed.",
      },
      requestId: request.id,
    });
  });
  app.addHook("onRequest", async (req, reply) => {
    if (
      config.MAINTENANCE_MODE &&
      req.url.startsWith("/v1/") &&
      !req.url.startsWith("/v1/public")
    )
      return reply.code(503).send({
        error: {
          code: "MAINTENANCE",
          message:
            "DailyLoop is temporarily in maintenance. Your records are unchanged. Try again later.",
        },
        requestId: req.id,
      });
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (config.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=7776000");
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
      );
    }
    return payload;
  });
  app.get("/health/live", async () => ({ ok: true }));
  app.get("/health/ready", async (_request, reply) => {
    if (!configured)
      return reply.code(503).send({ ok: false, code: "SETUP_REQUIRED" });
    try {
      await repository!.ready();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, code: "DATABASE_NOT_READY" });
    }
  });
  app.get("/v1/setup", async () => ({
    data: {
      configured,
      signInAvailable: configured,
      missing: missingConfig(config),
      budget: "free-tier-first",
    },
  }));
  app.get(
    "/auth/google/start",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      requireSetup();
      const start = await auth!.startWeb();
      reply.setCookie(
        oauthCookie,
        box!.seal({ verifier: start.verifier, createdAt: Date.now() }),
        { ...cookieOptions, maxAge: 600 },
      );
      return reply.redirect(start.url);
    },
  );
  app.get(
    "/auth/google/callback",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    async (req, reply) => {
      requireSetup();
      reply.clearCookie(oauthCookie, cookieOptions);
      const code = z
        .object({ code: z.string().min(1).max(3000) })
        .safeParse(req.query);
      const stored = req.cookies[oauthCookie];
      if (!code.success || !stored)
        return reply.redirect(config.APP_ORIGIN + "/?auth=failed");
      try {
        const flow = box!.open<{ verifier: string; createdAt: number }>(stored);
        if (Date.now() - flow.createdAt > 600000)
          throw new Error("Expired flow");
        const tokens = await auth!.exchange(code.data.code, flow.verifier);
        const user = await auth!.verify(tokens.accessToken);
        const session = await repository!.registerWeb(user, box!.seal(tokens));
        reply.setCookie(sessionCookie, session.token, {
          ...cookieOptions,
          maxAge: 604800,
        });
        return reply.redirect(config.APP_ORIGIN + "/");
      } catch {
        return reply.redirect(config.APP_ORIGIN + "/?auth=failed");
      }
    },
  );
  app.post(
    "/auth/mobile-session",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    async (req) => {
      requireSetup();
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      if (!token)
        throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
      const user = await auth!.verify(token);
      await repository!.registerMobile(user);
      return { data: { ok: true } };
    },
  );
  app.post("/auth/logout", async (req, reply) => {
    const { user } = await identity(req, true);
    await repository!.revoke(user);
    reply.clearCookie(sessionCookie, cookieOptions);
    return { data: { ok: true } };
  });
  app.get("/v1/me", async (req) => {
    const { user, csrf } = await identity(req);
    return {
      data: {
        ...(await repository!.me(user)),
        features: {
          planLifecycle: await repository!.planLifecycleAvailable(),
          accounting: await accounting!.available(),
          workspace: await workspace!.workspaceAvailable(),
        },
        ...(csrf ? { csrfToken: csrf } : {}),
      },
    };
  });
  app.post("/v1/businesses", async (req, reply) => {
    const { user } = await identity(req, true);
    z.uuid().parse(req.headers["idempotency-key"]);
    const input = BusinessInput.parse(req.body);
    const result = await repository!.createBusiness(user, input);
    return reply.code(201).send({ data: result });
  });
  app.get("/v1/customers", async (req) => {
    const { user } = await identity(req);
    return { data: await repository!.customers(user, Page.parse(req.query)) };
  });
  app.get("/v1/customers/:id", async (req) => {
    const { user } = await identity(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return { data: await repository!.getCustomer(user, id) };
  });
  app.post("/v1/customers", async (req, reply) => {
    const { user } = await identity(req, true);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    const input = CustomerInput.parse(req.body);
    return reply
      .code(201)
      .send({ data: await repository!.createCustomer(user, input, key) });
  });
  async function plansReady() {
    if (!(await repository!.planLifecycleAvailable()))
      throw new ApiError(
        503,
        "MIGRATION_REQUIRED",
        "Recurring plans are being prepared. Please try again later.",
      );
  }
  app.patch("/v1/customers/:id", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.updateCustomer(
        user,
        id,
        EditCustomerInput.parse(req.body),
        key,
      ),
    };
  });
  app.post("/v1/customers/:id/archive", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.archiveCustomer(
        user,
        id,
        ArchiveCustomerInput.parse(req.body),
        key,
      ),
    };
  });
  app.get("/v1/customers/:id/plans", async (req) => {
    const { user } = await identity(req);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return { data: await lifecycle!.plans(user, id) };
  });
  app.post("/v1/customers/:id/plans", async (req, reply) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return reply.code(201).send({
      data: await lifecycle!.createPlan(
        user,
        id,
        PlanCreate.parse(req.body),
        key,
      ),
    });
  });
  app.post("/v1/plans/:id/revisions", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.saveChange(
        user,
        id,
        { type: "revision", input: PlanRevisionInput.parse(req.body) },
        key,
      ),
    };
  });
  app.post("/v1/plans/:id/pauses", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.saveChange(
        user,
        id,
        { type: "pause", input: PauseInput.parse(req.body) },
        key,
      ),
    };
  });
  app.post("/v1/plans/:id/pauses/:pauseId/resume", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id, pauseId } = z
      .object({ id: z.uuid(), pauseId: z.uuid() })
      .parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.saveChange(
        user,
        id,
        { type: "resume", pauseId, input: ResumeInput.parse(req.body) },
        key,
      ),
    };
  });
  app.put("/v1/plans/:id/override", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.saveChange(
        user,
        id,
        { type: "override", input: OverrideInput.parse(req.body) },
        key,
      ),
    };
  });
  app.post("/v1/plans/:id/end", async (req) => {
    const { user } = await identity(req, true);
    await plansReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await lifecycle!.saveChange(
        user,
        id,
        { type: "end", input: EndPlanInput.parse(req.body) },
        key,
      ),
    };
  });
  app.post("/v1/schedule/preview", async (req) => {
    const { user } = await identity(req);
    await plansReady();
    return {
      data: await lifecycle!.preview(
        user,
        SchedulePreviewInput.parse(req.body),
      ),
    };
  });
  app.post("/v1/schedule/preview-new", async (req) => {
    const { user } = await identity(req);
    await plansReady();
    return {
      data: await lifecycle!.previewNew(
        user,
        NewPlanPreviewInput.parse(req.body),
      ),
    };
  });
  async function accountingReady() {
    if (!(await accounting!.available()))
      throw new ApiError(
        503,
        "MIGRATION_REQUIRED",
        "Delivery and accounting setup is pending. Existing customer and plan features remain available.",
      );
  }
  app.get("/v1/rounds", async (req) => {
    const { user } = await identity(req);
    await accountingReady();
    const q = z
      .object({ date: ServiceDate, after: z.uuid().optional() })
      .parse(req.query);
    return { data: await accounting!.round(user, q.date, q.after) };
  });
  app.post("/v1/deliveries/confirm", async (req, reply) => {
    const { user } = await identity(req, true);
    await accountingReady();
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return reply.code(201).send({
      data: await accounting!.confirm(
        user,
        ConfirmDelivery.parse(req.body),
        key,
      ),
    });
  });
  app.post("/v1/deliveries/:id/corrections", async (req) => {
    const { user } = await identity(req, true);
    await accountingReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await accounting!.correct(
        user,
        id,
        CorrectDelivery.parse(req.body),
        key,
      ),
    };
  });
  app.get("/v1/deliveries/:id/history", async (req) => {
    const { user } = await identity(req);
    await accountingReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z.object({ after: z.uuid().optional() }).parse(req.query);
    return { data: await accounting!.history(user, id, q.after) };
  });
  app.post("/v1/receipts", async (req, reply) => {
    const { user } = await identity(req, true);
    await accountingReady();
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return reply.code(201).send({
      data: await accounting!.receipt(user, ReceiptInput.parse(req.body), key),
    });
  });
  app.post("/v1/receipts/:id/reversal", async (req) => {
    const { user } = await identity(req, true);
    await accountingReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = ReversalInput.parse(req.body);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return { data: await accounting!.reverse(user, id, input.reason, key) };
  });
  app.post("/v1/customers/:id/opening-balance", async (req) => {
    const { user } = await identity(req, true);
    await accountingReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await accounting!.opening(
        user,
        id,
        OpeningInput.parse(req.body),
        key,
      ),
    };
  });
  app.get("/v1/customers/:id/receipts", async (req) => {
    const { user } = await identity(req);
    await accountingReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return {
      data: await accounting!.receipts(user, id, Period.parse(req.query)),
    };
  });
  app.get("/v1/customers/:id/statement", async (req) => {
    const { user } = await identity(req);
    await accountingReady();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return {
      data: await accounting!.statement(user, id, Period.parse(req.query)),
    };
  });
  app.get("/v1/public", async () => ({
    data: {
      supportEmail: config.SUPPORT_EMAIL,
      supportPlaceholder: config.SUPPORT_EMAIL.endsWith(".example"),
      privacyVersion: "2026-10-29",
      budget: "free-tier-first",
    },
  }));
  async function workspaceReady() {
    if (!(await workspace!.workspaceAvailable()))
      throw new ApiError(
        503,
        "MIGRATION_REQUIRED",
        "Account settings are awaiting setup. Existing records are unchanged.",
      );
  }
  app.patch("/v1/business", async (req) => {
    const { user } = await identity(req, true);
    await workspaceReady();
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    return {
      data: await workspace!.editBusiness(
        user,
        BusinessEditInput.parse(req.body),
        key,
      ),
    };
  });
  app.get("/v1/account/requests", async (req) => {
    const { user } = await identity(req);
    await workspaceReady();
    const q = z.object({ after: z.uuid().optional() }).parse(req.query);
    return { data: await workspace!.requests(user, q.after) };
  });
  app.post(
    "/v1/account/requests",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { user } = await identity(req, true);
      await workspaceReady();
      const key = z.uuid().parse(req.headers["idempotency-key"]);
      return reply.code(201).send({
        data: await workspace!.ownerRequest(
          user,
          OwnerRequestInput.parse(req.body),
          key,
        ),
      });
    },
  );
  app.post("/v1/account/requests/:id/cancel", async (req) => {
    const { user } = await identity(req, true);
    await workspaceReady();
    z.uuid().parse(req.headers["idempotency-key"]);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return { data: await workspace!.cancelRequest(user, id) };
  });
  app.post(
    "/v1/account/export",
    { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { user } = await identity(req, true);
      await workspaceReady();
      z.uuid().parse(req.headers["idempotency-key"]);
      const data = await workspace!.exportAccount(user);
      return reply
        .header(
          "Content-Disposition",
          'attachment; filename="dailyloop-account.json"',
        )
        .type("application/json; charset=utf-8")
        .send(JSON.stringify(data));
    },
  );
  for (const format of ["csv", "pdf"] as const)
    app.get(
      `/v1/customers/:id/statement.${format}`,
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const { user } = await identity(req);
        await accountingReady();
        const { id } = z.object({ id: z.uuid() }).parse(req.params);
        const revision = z
          .object({ revision: z.coerce.number().int().positive() })
          .parse(req.query).revision;
        const data = await accounting!.exportStatement(
          user,
          id,
          Period.parse(req.query),
          revision,
        );
        const filename = `dailyloop-statement-${data.from}-${data.to}.${format}`;
        reply.header(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        return format === "csv"
          ? reply.type("text/csv; charset=utf-8").send(statementCsv(data))
          : reply.type("application/pdf").send(await statementPdf(data));
      },
    );
  const staticRoot = fileURLToPath(
    new URL("../../desktop/dist/", import.meta.url),
  );
  // dist/app.js and src/app.ts have the same depth relative to the monorepo root.
  if (existsSync(staticRoot))
    await app.register(staticFiles, {
      root: staticRoot,
      prefix: "/",
      wildcard: false,
    });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.url.startsWith("/v1") ||
      req.url.startsWith("/api") ||
      req.url.startsWith("/auth") ||
      req.url.startsWith("/health") ||
      req.method !== "GET" ||
      !existsSync(staticRoot + "/index.html")
    )
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Not found." },
        requestId: req.id,
      });
    return reply.sendFile("index.html");
  });
  return app;
}
