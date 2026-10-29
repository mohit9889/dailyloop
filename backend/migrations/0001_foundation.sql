-- Run with a migration identity. The serving role is deliberately not the owner.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dailyloop_runtime') THEN
  CREATE ROLE dailyloop_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA app, private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA app, private TO dailyloop_runtime;

CREATE TABLE app.businesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL UNIQUE,
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
 service_type text NOT NULL CHECK (service_type IN ('milk','tiffin','mixed')),
 currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK(timezone='Asia/Kolkata'),
 revision integer NOT NULL DEFAULT 1,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 user_id uuid NOT NULL UNIQUE,
 role text NOT NULL DEFAULT 'owner' CHECK(role='owner'),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(business_id,user_id)
);
CREATE TABLE app.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=20),
 address text NOT NULL CHECK(length(address) BETWEEN 1 AND 300),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,id)
);
CREATE INDEX customers_tenant_cursor ON app.customers(business_id,id);
CREATE TABLE app.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 actor_id uuid NOT NULL,
 action text NOT NULL,
 entity_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_date ON app.audit_events(business_id,occurred_at);
CREATE TABLE app.idempotency_records (
 business_id uuid NOT NULL REFERENCES app.businesses(id),
 user_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 request_hash text NOT NULL,
 response_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,user_id,operation_id)
);
CREATE TABLE private.app_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 provider_session_id uuid NOT NULL,
 platform text NOT NULL CHECK(platform IN ('web','mobile')),
 token_hash text UNIQUE,
 encrypted_tokens text,
 csrf_token text,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 UNIQUE(provider_session_id,platform)
);

CREATE FUNCTION private.user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('app.user_id',true),'')::uuid
$$;
CREATE FUNCTION private.business_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('app.business_id',true),'')::uuid
$$;
CREATE FUNCTION private.has_membership(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM app.memberships m JOIN app.businesses b ON b.id=m.business_id
 WHERE m.business_id=target AND m.user_id=private.user_id() AND m.active AND b.active)
$$;
ALTER TABLE app.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_owner ON app.businesses FOR SELECT TO dailyloop_runtime USING(private.has_membership(id));
CREATE POLICY memberships_self ON app.memberships FOR SELECT TO dailyloop_runtime USING(user_id=private.user_id() AND active);
CREATE POLICY customers_tenant ON app.customers TO dailyloop_runtime
 USING(business_id=private.business_id() AND private.has_membership(business_id))
 WITH CHECK(business_id=private.business_id() AND private.has_membership(business_id));
CREATE POLICY audit_tenant ON app.audit_events TO dailyloop_runtime
 USING(business_id=private.business_id() AND private.has_membership(business_id))
 WITH CHECK(business_id=private.business_id() AND actor_id=private.user_id() AND private.has_membership(business_id));
CREATE POLICY idempotency_tenant ON app.idempotency_records TO dailyloop_runtime
 USING(business_id=private.business_id() AND user_id=private.user_id() AND private.has_membership(business_id))
 WITH CHECK(business_id=private.business_id() AND user_id=private.user_id() AND private.has_membership(business_id));
GRANT SELECT ON app.businesses,app.memberships TO dailyloop_runtime;
GRANT SELECT,INSERT ON app.customers,app.audit_events,app.idempotency_records TO dailyloop_runtime;

-- Bootstrap is narrowly scoped to the authenticated transaction context.
CREATE FUNCTION private.bootstrap_business(p_name text,p_service text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.user_id(); bid uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Identity required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 SELECT business_id INTO bid FROM app.memberships WHERE user_id=uid;
 IF bid IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM app.businesses WHERE id=bid AND active AND name=p_name AND service_type=p_service) THEN RETURN bid; END IF;
  RAISE EXCEPTION 'Business already exists' USING ERRCODE='23505';
 END IF;
 INSERT INTO app.businesses(owner_id,name,service_type) VALUES(uid,p_name,p_service) RETURNING id INTO bid;
 INSERT INTO app.memberships(business_id,user_id) VALUES(bid,uid);
 INSERT INTO app.audit_events(business_id,actor_id,action,entity_id) VALUES(bid,uid,'business.created',bid);
 RETURN bid;
END $$;
CREATE FUNCTION private.bump_revision(bid uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result integer;
BEGIN
 IF bid IS DISTINCT FROM private.business_id() OR NOT private.has_membership(bid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 UPDATE app.businesses SET revision=revision+1 WHERE id=bid RETURNING revision INTO result;
 RETURN result;
END $$;
-- Session functions expose only parameter-bound lookup operations to the API role.
CREATE FUNCTION private.register_session(uid uuid,pid uuid,kind text,hash text,tokens text,csrf text,expiry timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.app_sessions(user_id,provider_session_id,platform,token_hash,encrypted_tokens,csrf_token,expires_at)
 VALUES(uid,pid,kind,hash,tokens,csrf,expiry)
 ON CONFLICT(provider_session_id,platform) DO NOTHING;
END $$;
CREATE FUNCTION private.web_session(hash text) RETURNS SETOF private.app_sessions
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM private.app_sessions WHERE token_hash=hash AND platform='web'
 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE
$$;
CREATE FUNCTION private.refresh_web_session(hash text,tokens text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE private.app_sessions SET encrypted_tokens=tokens WHERE token_hash=hash AND platform='web' AND revoked_at IS NULL
$$;
CREATE FUNCTION private.mobile_session(uid uuid,pid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.app_sessions WHERE user_id=uid AND provider_session_id=pid
 AND platform='mobile' AND revoked_at IS NULL AND expires_at>now())
$$;
CREATE FUNCTION private.revoke_session(uid uuid,pid uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE private.app_sessions SET revoked_at=now(),encrypted_tokens=NULL,token_hash=NULL
 WHERE user_id=uid AND provider_session_id=pid
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO dailyloop_runtime;
-- No UPDATE/DELETE grants on audit/idempotency/customer history in this increment.
