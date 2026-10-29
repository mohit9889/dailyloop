-- Additive M3 ledger. Prior migrations and existing records remain unchanged.
ALTER TABLE app.plans ADD CONSTRAINT plans_tenant_customer_id UNIQUE(business_id,customer_id,id);
ALTER TABLE app.plan_revisions ADD CONSTRAINT revisions_tenant_id UNIQUE(business_id,id);
CREATE TABLE app.delivery_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id),
 customer_id uuid NOT NULL, plan_id uuid NOT NULL, service_on date NOT NULL,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), current_event_id uuid,
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id),
 FOREIGN KEY(business_id,customer_id,plan_id) REFERENCES app.plans(business_id,customer_id,id),
 UNIQUE(business_id,plan_id,service_on), UNIQUE(business_id,customer_id,id)
);
CREATE TABLE app.delivery_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid NOT NULL,
 occurrence_id uuid NOT NULL, previous_event_id uuid UNIQUE,
 occurrence_version integer NOT NULL CHECK(occurrence_version>0),
 status text NOT NULL CHECK(status IN ('delivered','skipped','missed')),
 quantity_milli integer NOT NULL CHECK(quantity_milli BETWEEN 0 AND 100000000),
 rate_paise bigint NOT NULL CHECK(rate_paise BETWEEN 1 AND 10000000),
 charge_paise bigint NOT NULL CHECK(charge_paise BETWEEN 0 AND 1000000000000),
 unit text NOT NULL CHECK(unit IN ('meal','litre')), label text NOT NULL,
 revision_id uuid NOT NULL,
 FOREIGN KEY(business_id,revision_id) REFERENCES app.plan_revisions(business_id,id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 actor_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='delivered' AND quantity_milli>0) OR (status<>'delivered' AND quantity_milli=0 AND charge_paise=0)),
 CHECK(unit<>'meal' OR quantity_milli%1000=0),
 CHECK(charge_paise=(quantity_milli::bigint*rate_paise+500)/1000),
 FOREIGN KEY(business_id,customer_id,occurrence_id) REFERENCES app.delivery_occurrences(business_id,customer_id,id),
 UNIQUE(business_id,customer_id,id), UNIQUE(occurrence_id,occurrence_version), UNIQUE(business_id,customer_id,occurrence_id,id),
 FOREIGN KEY(business_id,customer_id,occurrence_id,previous_event_id) REFERENCES app.delivery_events(business_id,customer_id,occurrence_id,id)
);
ALTER TABLE app.delivery_occurrences ADD CONSTRAINT current_delivery_event FOREIGN KEY(business_id,customer_id,id,current_event_id) REFERENCES app.delivery_events(business_id,customer_id,occurrence_id,id);
CREATE INDEX occurrences_customer_date ON app.delivery_occurrences(business_id,customer_id,service_on,id);
CREATE INDEX delivery_event_history ON app.delivery_events(business_id,occurrence_id,recorded_at,id);
CREATE TABLE app.money_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('opening','receipt','reversal')),
 amount_paise bigint NOT NULL CHECK((amount_paise<>0 OR kind IN ('opening','reversal')) AND amount_paise BETWEEN -1000000000000 AND 1000000000000),
 method text CHECK(method IN ('cash','upi','bank')), effective_on date NOT NULL,
 reverses_event_id uuid UNIQUE, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 actor_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='receipt' AND amount_paise>0 AND method IS NOT NULL AND reverses_event_id IS NULL)
 OR (kind='opening' AND method IS NULL AND reverses_event_id IS NULL)
 OR (kind='reversal' AND method IS NULL AND reverses_event_id IS NOT NULL)),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id),
 UNIQUE(business_id,customer_id,id),
 FOREIGN KEY(business_id,customer_id,reverses_event_id) REFERENCES app.money_events(business_id,customer_id,id)
);
CREATE INDEX money_customer_date ON app.money_events(business_id,customer_id,effective_on,id);
CREATE TABLE app.opening_balances (
 business_id uuid NOT NULL, customer_id uuid NOT NULL, cutover_on date NOT NULL,
 current_event_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(business_id,customer_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id),
 FOREIGN KEY(business_id,customer_id,current_event_id) REFERENCES app.money_events(business_id,customer_id,id)
);
CREATE TABLE app.ledger_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid NOT NULL,
 effective_on date NOT NULL, signed_amount_paise bigint NOT NULL CHECK(signed_amount_paise BETWEEN -1000000000000 AND 1000000000000),
 delivery_event_id uuid, money_event_id uuid,
 posting_role text NOT NULL CHECK(posting_role IN ('charge','charge_reversal','opening','receipt','money_reversal','opening_reversal')),
 description text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((delivery_event_id IS NOT NULL AND money_event_id IS NULL AND posting_role IN ('charge','charge_reversal')) OR (delivery_event_id IS NULL AND money_event_id IS NOT NULL AND posting_role IN ('opening','receipt','money_reversal','opening_reversal'))),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id),
 FOREIGN KEY(business_id,customer_id,delivery_event_id) REFERENCES app.delivery_events(business_id,customer_id,id),
 FOREIGN KEY(business_id,customer_id,money_event_id) REFERENCES app.money_events(business_id,customer_id,id),
 UNIQUE(delivery_event_id,posting_role), UNIQUE(money_event_id)
);
CREATE INDEX ledger_customer_date ON app.ledger_entries(business_id,customer_id,effective_on,id);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['delivery_occurrences','delivery_events','money_events','opening_balances','ledger_entries'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I TO dailyloop_runtime USING(business_id=private.business_id() AND private.has_membership(business_id)) WITH CHECK(business_id=private.business_id() AND private.has_membership(business_id))',n);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO dailyloop_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(version,current_event_id) ON app.delivery_occurrences,app.opening_balances TO dailyloop_runtime;
-- History and postings intentionally have no UPDATE or DELETE grants.
