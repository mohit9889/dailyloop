ALTER TABLE app.customers ADD COLUMN archived_effective_on date;
ALTER TABLE app.audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
GRANT UPDATE(name,phone,address,version,archived_effective_on) ON app.customers TO dailyloop_runtime;
CREATE TABLE app.plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id),
 customer_id uuid NOT NULL, slot_key text NOT NULL, unit text NOT NULL CHECK(unit IN ('litre','meal')),
 start_on date NOT NULL, end_on date CHECK(end_on IS NULL OR end_on>=start_on), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id),
 UNIQUE(business_id,id), UNIQUE(business_id,customer_id,slot_key)
);
CREATE INDEX plans_customer ON app.plans(business_id,customer_id);
CREATE TABLE app.plan_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, plan_id uuid NOT NULL,
 effective_from date NOT NULL, label text NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
 quantity_milli integer NOT NULL CHECK(quantity_milli BETWEEN 1 AND 100000000),
 rate_paise bigint NOT NULL CHECK(rate_paise BETWEEN 1 AND 10000000),
 weekdays integer[] NOT NULL CHECK(cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,plan_id) REFERENCES app.plans(business_id,id), UNIQUE(plan_id,effective_from)
);
CREATE INDEX revisions_effective ON app.plan_revisions(business_id,plan_id,effective_from DESC);
CREATE TABLE app.pause_ranges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, plan_id uuid NOT NULL,
 from_on date NOT NULL, to_on date NOT NULL CHECK(to_on>=from_on),
 resume_on date CHECK(resume_on IS NULL OR resume_on BETWEEN from_on AND to_on),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,plan_id) REFERENCES app.plans(business_id,id), UNIQUE(business_id,plan_id,id)
);
CREATE INDEX pauses_dates ON app.pause_ranges(business_id,plan_id,from_on,to_on);
-- Overrides are append-only; plan_version identifies the last accepted intent.
CREATE TABLE app.date_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, plan_id uuid NOT NULL,
 service_on date NOT NULL, action text NOT NULL CHECK(action IN ('skip','resume','quantity','clear')),
 quantity_milli integer CHECK(quantity_milli BETWEEN 1 AND 100000000),
 plan_version integer NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((action='quantity' AND quantity_milli IS NOT NULL) OR (action<>'quantity' AND quantity_milli IS NULL)),
 FOREIGN KEY(business_id,plan_id) REFERENCES app.plans(business_id,id), UNIQUE(plan_id,service_on,plan_version)
);
CREATE INDEX overrides_date ON app.date_overrides(business_id,plan_id,service_on,plan_version DESC);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['plans','plan_revisions','pause_ranges','date_overrides'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I TO dailyloop_runtime USING(business_id=private.business_id() AND private.has_membership(business_id)) WITH CHECK(business_id=private.business_id() AND private.has_membership(business_id))',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO dailyloop_runtime',table_name);
 END LOOP;
END $$;
GRANT UPDATE(end_on,version) ON app.plans TO dailyloop_runtime;
GRANT UPDATE(resume_on) ON app.pause_ranges TO dailyloop_runtime;
-- No UPDATE/DELETE grant on revisions or date override history.
