import { createHash, randomBytes } from "node:crypto";
import type {
  Business,
  BusinessInput,
  Customer,
  CustomerInput,
  Page,
} from "@dailyloop/contracts";
import { ApiError } from "../errors.js";
import { userContext, type Database, type Sql } from "./database.js";
export type Identity = {
  id: string;
  email: string | null;
  providerSessionId: string;
};
export type WebSession = {
  user_id: string;
  provider_session_id: string;
  encrypted_tokens: string;
  csrf_token: string;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function business(r: Record<string, unknown>): Business {
  return {
    id: String(r.id),
    name: String(r.name),
    serviceType: r.service_type as Business["serviceType"],
    currency: "INR",
    timezone: "Asia/Kolkata",
    revision: Number(r.revision),
  };
}
export function customer(r: Record<string, unknown>): Customer {
  return {
    id: String(r.id),
    businessId: String(r.business_id),
    name: String(r.name),
    phone: String(r.phone),
    address: String(r.address),
    version: Number(r.version),
    createdAt: new Date(r.created_at as string).toISOString(),
    archivedEffectiveOn: r.archived_effective_on
      ? r.archived_effective_on instanceof Date
        ? r.archived_effective_on.toISOString().slice(0, 10)
        : String(r.archived_effective_on).slice(0, 10)
      : null,
  };
}
export class Repository {
  constructor(public db: Database) {}
  async ready() {
    await this.db.transaction(async (t) => {
      const role = await t.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      if (role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls)
        throw new Error("Serving role must not bypass RLS.");
      const owner = await t.query(
        "SELECT 1 FROM pg_tables WHERE schemaname='app' AND tableowner=current_user LIMIT 1",
      );
      if (owner.rows.length)
        throw new Error("Serving role must not own application tables.");
      await t.query("SELECT id FROM app.businesses LIMIT 0");
    });
  }
  async planLifecycleAvailable() {
    return this.db.transaction(async (t) =>
      Boolean(
        (
          await t.query(
            "SELECT to_regclass('app.plans') IS NOT NULL AS available",
          )
        ).rows[0].available,
      ),
    );
  }
  async me(user: Identity) {
    return this.db.transaction(async (t) => {
      await userContext(t, user.id);
      const r = await t.query(
        "SELECT b.* FROM app.businesses b JOIN app.memberships m ON m.business_id=b.id WHERE m.user_id=$1 AND m.active AND b.active",
        [user.id],
      );
      return {
        user: { id: user.id, email: user.email },
        business: r.rows[0] ? business(r.rows[0]) : null,
      };
    });
  }
  async createBusiness(user: Identity, input: BusinessInput) {
    return this.db.transaction(async (t) => {
      await userContext(t, user.id);
      try {
        const created = await t.query(
          "SELECT private.bootstrap_business($1,$2) AS id",
          [input.name, input.serviceType],
        );
        const r = await t.query("SELECT * FROM app.businesses WHERE id=$1", [
          created.rows[0].id,
        ]);
        return business(r.rows[0]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          throw new ApiError(
            409,
            "BUSINESS_EXISTS",
            "A business already exists for this account.",
          );
        throw e;
      }
    });
  }
  async tenant<T>(user: Identity, fn: (tx: Sql, b: Business) => Promise<T>) {
    return this.db.transaction(async (t) => {
      await userContext(t, user.id);
      const r = await t.query(
        "SELECT b.* FROM app.businesses b JOIN app.memberships m ON m.business_id=b.id WHERE m.user_id=$1 AND m.active AND b.active",
        [user.id],
      );
      if (!r.rows[0])
        throw new ApiError(
          403,
          "BUSINESS_REQUIRED",
          "Set up your business first.",
        );
      const b = business(r.rows[0]);
      await userContext(t, user.id, b.id);
      return fn(t, b);
    });
  }
  async customers(user: Identity, page: Page) {
    return this.tenant(user, async (t, b) => {
      const r = await t.query(
        "SELECT * FROM app.customers WHERE business_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) AND (name ILIKE $3 ESCAPE '\\' OR phone ILIKE $3 ESCAPE '\\') ORDER BY id LIMIT $4",
        [
          b.id,
          page.after || null,
          "%" + page.search.replace(/[\\%_]/g, "\\$&") + "%",
          page.limit + 1,
        ],
      );
      return {
        items: r.rows.slice(0, page.limit).map(customer),
        nextCursor:
          r.rows.length > page.limit ? String(r.rows[page.limit - 1].id) : null,
      };
    });
  }
  async getCustomer(user: Identity, id: string) {
    return this.tenant(user, async (t, b) => {
      const r = await t.query(
        "SELECT * FROM app.customers WHERE business_id=$1 AND id=$2",
        [b.id, id],
      );
      if (!r.rows[0])
        throw new ApiError(404, "NOT_FOUND", "Customer not found.");
      return customer(r.rows[0]);
    });
  }
  async createCustomer(
    user: Identity,
    input: CustomerInput,
    operationId: string,
  ) {
    return this.tenant(user, async (t, b) => {
      // One owner business: this lock serializes retries without a table-owner role.
      await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        b.id,
      ]);
      const requestHash = hash(
        JSON.stringify({ route: "POST /v1/customers", input }),
      );
      const prev = await t.query(
        "SELECT * FROM app.idempotency_records WHERE business_id=$1 AND user_id=$2 AND operation_id=$3",
        [b.id, user.id, operationId],
      );
      if (prev.rows[0]) {
        if (prev.rows[0].request_hash !== requestHash)
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This operation ID was already used with different details.",
          );
        return prev.rows[0].response_json as Customer;
      }
      const r = await t.query(
        "INSERT INTO app.customers(business_id,name,phone,address) VALUES($1,$2,$3,$4) RETURNING *",
        [b.id, input.name, input.phone, input.address],
      );
      const result = customer(r.rows[0]);
      await t.query(
        "INSERT INTO app.audit_events(business_id,actor_id,action,entity_id) VALUES($1,$2,$3,$4)",
        [b.id, user.id, "customer.created", result.id],
      );
      await t.query("SELECT private.bump_revision($1)", [b.id]);
      await t.query(
        "INSERT INTO app.idempotency_records(business_id,user_id,operation_id,request_hash,response_json) VALUES($1,$2,$3,$4,$5)",
        [b.id, user.id, operationId, requestHash, JSON.stringify(result)],
      );
      return result;
    });
  }
  async registerMobile(user: Identity) {
    await this.db.transaction((t) =>
      t.query(
        "SELECT private.register_session($1,$2,$3,NULL,NULL,NULL,now()+interval '30 days')",
        [user.id, user.providerSessionId, "mobile"],
      ),
    );
    if (!(await this.mobileActive(user)))
      throw new ApiError(401, "SESSION_REVOKED", "Sign in again to continue.");
  }
  async mobileActive(user: Identity) {
    return this.db.transaction(async (t) =>
      Boolean(
        (
          await t.query("SELECT private.mobile_session($1,$2) AS active", [
            user.id,
            user.providerSessionId,
          ])
        ).rows[0].active,
      ),
    );
  }
  async registerWeb(user: Identity, encryptedTokens: string) {
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url");
    await this.db.transaction((t) =>
      t.query(
        "SELECT private.register_session($1,$2,$3,$4,$5,$6,now()+interval '7 days')",
        [
          user.id,
          user.providerSessionId,
          "web",
          hash(token),
          encryptedTokens,
          csrf,
        ],
      ),
    );
    return { token, csrf };
  }
  async webSession<T>(
    token: string,
    fn: (
      session: WebSession,
      update: (tokens: string) => Promise<void>,
    ) => Promise<T>,
  ) {
    return this.db.transaction(async (t) => {
      const tokenHash = hash(token);
      const r = await t.query("SELECT * FROM private.web_session($1)", [
        tokenHash,
      ]);
      if (!r.rows[0])
        throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
      return fn(r.rows[0] as unknown as WebSession, async (tokens) => {
        await t.query("SELECT private.refresh_web_session($1,$2)", [
          tokenHash,
          tokens,
        ]);
      });
    });
  }
  async revoke(user: Identity) {
    await this.db.transaction((t) =>
      t.query("SELECT private.revoke_session($1,$2)", [
        user.id,
        user.providerSessionId,
      ]),
    );
  }
}
