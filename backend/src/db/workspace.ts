import { createHash } from "node:crypto";
import type {
  BusinessEditInput,
  OwnerRequestInput,
  OwnerRequest,
} from "@dailyloop/contracts";
import { AccountingRepository } from "./accounting.js";
import type { Identity } from "./repository.js";
import { userContext, type Sql } from "./database.js";
import { ApiError } from "../errors.js";
const asRequest = (r: Record<string, unknown>): OwnerRequest => ({
  id: String(r.id),
  kind: r.kind as OwnerRequest["kind"],
  message: String(r.message),
  status: r.status as OwnerRequest["status"],
  createdAt: new Date(r.created_at as string).toISOString(),
  updatedAt: new Date(r.updated_at as string).toISOString(),
});
export const businessTables = [
  "businesses",
  "memberships",
  "customers",
  "plans",
  "plan_revisions",
  "pause_ranges",
  "date_overrides",
  "delivery_occurrences",
  "delivery_events",
  "money_events",
  "opening_balances",
  "ledger_entries",
  "audit_events",
] as const;
export class WorkspaceRepository extends AccountingRepository {
  async workspaceAvailable() {
    return this.db.transaction(async (t) =>
      Boolean(
        (
          await t.query(
            "SELECT to_regclass('app.owner_requests') IS NOT NULL AS available",
          )
        ).rows[0].available,
      ),
    );
  }
  async recent(t: Sql, user: Identity) {
    if (
      !(
        await t.query("SELECT private.recent_session($1,$2) AS recent", [
          user.id,
          user.providerSessionId,
        ])
      ).rows[0].recent
    )
      throw new ApiError(
        403,
        "REAUTH_REQUIRED",
        "For this action, sign out and sign in again, then retry within 10 minutes.",
      );
  }
  async editBusiness(user: Identity, input: BusinessEditInput, key: string) {
    return this.mutate(user, key, "business.edit", input, async (t, b) => {
      if (input.expectedRevision !== (await this.revision(t, b.id)))
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          "Business details changed. Refresh before saving.",
        );
      await t.query(
        "UPDATE app.businesses SET name=$1,service_type=$2 WHERE id=$3",
        [input.name, input.serviceType, b.id],
      );
      return {
        value: {
          ...b,
          name: input.name,
          serviceType: input.serviceType,
          revision: input.expectedRevision + 1,
        },
        entityId: b.id,
        action: "business.edited",
        details: { name: input.name, serviceType: input.serviceType },
      };
    });
  }
  async requests(user: Identity, after?: string) {
    return this.db.transaction(async (t) => {
      await userContext(t, user.id);
      const r = await t.query(
        "SELECT * FROM app.owner_requests WHERE user_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 51",
        [user.id, after || null],
      );
      return {
        items: r.rows.slice(0, 50).map(asRequest),
        nextCursor: r.rows.length > 50 ? String(r.rows[49].id) : null,
      };
    });
  }
  async ownerRequest(user: Identity, input: OwnerRequestInput, key: string) {
    return this.db.transaction(async (t) => {
      await userContext(t, user.id);
      await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "owner-requests/" + user.id,
      ]);
      const hash = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const previous = (
        await t.query(
          "SELECT * FROM app.owner_requests WHERE user_id=$1 AND operation_id=$2",
          [user.id, key],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash)
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Operation already used with different details.",
          );
        return asRequest(previous);
      }
      if (input.kind === "deletion") {
        await this.recent(t, user);
        const old = (
          await t.query(
            "SELECT * FROM app.owner_requests WHERE user_id=$1 AND kind='deletion' AND status='open'",
            [user.id],
          )
        ).rows[0];
        if (old) return asRequest(old);
      }
      if (
        Number(
          (
            await t.query(
              "SELECT count(*)::int AS n FROM app.owner_requests WHERE user_id=$1 AND status='open'",
              [user.id],
            )
          ).rows[0].n,
        ) >= 5
      )
        throw new ApiError(
          422,
          "REQUEST_LIMIT",
          "You already have five open requests. Please follow up on an existing request.",
        );
      const membership = (
        await t.query(
          "SELECT business_id FROM app.memberships WHERE user_id=$1 AND active",
          [user.id],
        )
      ).rows[0];
      const bid = membership ? String(membership.business_id) : null;
      await userContext(t, user.id, bid || undefined);
      const r = await t.query(
        "INSERT INTO app.owner_requests(user_id,business_id,kind,message,operation_id,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [user.id, bid, input.kind, input.message, key, hash],
      );
      if (bid)
        await t.query(
          "INSERT INTO app.audit_events(business_id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
          [
            bid,
            user.id,
            "owner.requested",
            r.rows[0].id,
            JSON.stringify({ kind: input.kind }),
          ],
        );
      return asRequest(r.rows[0]);
    });
  }
  async cancelRequest(user: Identity, id: string) {
    return this.db.transaction(async (t) => {
      await userContext(t, user.id);
      await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "owner-requests/" + user.id,
      ]);
      const r = await t.query(
        "UPDATE app.owner_requests SET status='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('open','cancelled') RETURNING *",
        [id, user.id],
      );
      if (!r.rows[0])
        throw new ApiError(404, "NOT_FOUND", "Open request not found.");
      return asRequest(r.rows[0]);
    });
  }
  async exportAccount(user: Identity) {
    return this.read(user, async (t, b) => {
      await this.recent(t, user);
      let count = 0;
      const tables: Record<string, unknown[]> = {};
      for (const name of businessTables) {
        const where = name === "businesses" ? "id=$1" : "business_id=$1";
        const r = await t.query(
          `SELECT row_to_json(t)::text AS json FROM app.${name} t WHERE ${where} LIMIT 100001`,
          [b.id],
        );
        count += r.rows.length;
        if (count > 100000)
          throw new ApiError(
            422,
            "EXPORT_LIMIT",
            "This account is too large for an online export. Request an operator export through support.",
          );
        tables[name] = r.rows.map((x) => JSON.parse(String(x.json)));
      }
      const requests = (
        await t.query(
          "SELECT id,kind,message,status,created_at,updated_at FROM app.owner_requests WHERE user_id=$1 ORDER BY created_at",
          [user.id],
        )
      ).rows;
      return {
        format: "dailyloop-account-v1",
        exportedAt: new Date().toISOString(),
        businessRevision: b.revision,
        user: { id: user.id, email: user.email },
        tables,
        requests,
      };
    });
  }
}
