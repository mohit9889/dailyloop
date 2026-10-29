-- Web settings and owner requests. Existing sessions are NOT treated as recently authenticated.
ALTER TABLE private.app_sessions ADD COLUMN authenticated_at timestamptz NOT NULL DEFAULT '-infinity';
CREATE OR REPLACE FUNCTION private.register_session(uid uuid,pid uuid,kind text,hash text,tokens text,csrf text,expiry timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.app_sessions(user_id,provider_session_id,platform,token_hash,encrypted_tokens,csrf_token,expires_at,authenticated_at)
 VALUES(uid,pid,kind,hash,tokens,csrf,expiry,now())
 ON CONFLICT(provider_session_id,platform) DO NOTHING;
END $$;
CREATE FUNCTION private.recent_session(uid uuid,pid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.app_sessions WHERE user_id=uid AND provider_session_id=pid
 AND revoked_at IS NULL AND expires_at>now() AND authenticated_at>now()-interval '10 minutes')
$$;
REVOKE ALL ON FUNCTION private.recent_session(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.recent_session(uuid,uuid) TO dailyloop_runtime;
GRANT UPDATE(name,service_type) ON app.businesses TO dailyloop_runtime;
CREATE TABLE app.owner_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 business_id uuid REFERENCES app.businesses(id), kind text NOT NULL CHECK(kind IN ('support','deletion')),
 message text NOT NULL CHECK(length(message) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled','resolved')),
 operation_id uuid NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,operation_id)
);
CREATE INDEX owner_requests_user ON app.owner_requests(user_id,created_at DESC,id);
CREATE UNIQUE INDEX one_open_deletion ON app.owner_requests(user_id) WHERE kind='deletion' AND status='open';
ALTER TABLE app.owner_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_requests_self ON app.owner_requests TO dailyloop_runtime
 USING(user_id=private.user_id())
 WITH CHECK(user_id=private.user_id() AND (business_id IS NULL OR private.has_membership(business_id)));
GRANT SELECT,INSERT ON app.owner_requests TO dailyloop_runtime;
GRANT UPDATE(status,updated_at) ON app.owner_requests TO dailyloop_runtime;
-- Operator-only erasure journal. No application role privileges.
CREATE TABLE private.deletion_tombstones (
 user_hash text PRIMARY KEY, request_id uuid NOT NULL,
 erased_at timestamptz NOT NULL DEFAULT now()
);
CREATE POLICY business_settings_update ON app.businesses FOR UPDATE TO dailyloop_runtime
 USING(private.has_membership(id)) WITH CHECK(private.has_membership(id));

CREATE INDEX ledger_chronological ON app.ledger_entries(business_id,customer_id,effective_on,recorded_at,id);
