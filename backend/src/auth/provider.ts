import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Identity } from "../db/repository.js";
import { ApiError } from "../errors.js";
export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
export interface AuthProvider {
  verify(token: string): Promise<Identity>;
  startWeb(): Promise<{ url: string; verifier: string }>;
  exchange(code: string, verifier: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
}
export function supabaseAuth(config: Config): AuthProvider {
  const url = config.SUPABASE_URL!,
    key = config.SUPABASE_PUBLISHABLE_KEY!;
  const jwks = createRemoteJWKSet(
    new URL(url + "/auth/v1/.well-known/jwks.json"),
    { timeoutDuration: 8000 },
  );
  function client(storage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  }) {
    return createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: Boolean(storage),
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    });
  }
  function tokens(
    session: {
      access_token: string;
      refresh_token: string;
      expires_at?: number;
    } | null,
  ): Tokens {
    if (!session?.expires_at)
      throw new ApiError(
        401,
        "AUTH_FAILED",
        "Sign-in could not be completed. Please try again.",
      );
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
    };
  }
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: url + "/auth/v1",
          audience: "authenticated",
          algorithms: ["ES256", "RS256"],
        });
        if (payload.is_anonymous === true) throw new Error("Anonymous owner");
        return {
          id: z.uuid().parse(payload.sub),
          email: typeof payload.email === "string" ? payload.email : null,
          providerSessionId: z.uuid().parse(payload.session_id),
        };
      } catch {
        throw new ApiError(
          401,
          "UNAUTHORIZED",
          "Your session has expired. Please sign in again.",
        );
      }
    },
    async startWeb() {
      const values = new Map<string, string>();
      const auth = client({
        getItem: (k) => values.get(k) || null,
        setItem: (k, v) => {
          values.set(k, v);
        },
        removeItem: (k) => {
          values.delete(k);
        },
      });
      const { data, error } = await auth.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: config.APP_ORIGIN + "/auth/google/callback",
          skipBrowserRedirect: true,
        },
      });
      const verifier = [...values.entries()].find(([k]) =>
        k.endsWith("-code-verifier"),
      )?.[1];
      if (error || !data.url || !verifier)
        throw new ApiError(
          503,
          "AUTH_UNAVAILABLE",
          "Sign-in is unavailable. Please try again.",
        );
      return { url: data.url, verifier };
    },
    async exchange(code, verifier) {
      const auth = client({
        getItem: (k) => (k.endsWith("-code-verifier") ? verifier : null),
        setItem: () => {},
        removeItem: () => {},
      });
      const { data, error } = await auth.auth.exchangeCodeForSession(code);
      if (error)
        throw new ApiError(
          401,
          "AUTH_FAILED",
          "Sign-in could not be completed. Please try again.",
        );
      return tokens(data.session);
    },
    async refresh(refreshToken) {
      const { data, error } = await client().auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error)
        throw new ApiError(
          401,
          "SESSION_EXPIRED",
          "Please sign in again to continue.",
        );
      return tokens(data.session);
    },
  };
}
