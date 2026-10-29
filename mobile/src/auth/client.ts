import "react-native-url-polyfill/auto";
import { createClient, type Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { secureSessionStorage } from "./storage";
import { Platform } from "react-native";
WebBrowser.maybeCompleteAuthSession();
const url = process.env.EXPO_PUBLIC_SUPABASE_URL,
  key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const mobileConfigured = Boolean(url && key);
export const supabase = mobileConfigured
  ? createClient(url!, key!, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: secureSessionStorage,
      },
    })
  : null;
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (__DEV__
    ? Platform.OS === "android"
      ? "http://10.0.2.2:4000"
      : "http://127.0.0.1:4000"
    : "");
export async function signIn() {
  if (!supabase || !API_URL)
    throw new Error("Project connection is being prepared.");
  const redirectTo = Linking.createURL("auth/callback");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error("Sign-in is unavailable. Try again.");
  const response = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (response.type !== "success") return;
  const parsed = Linking.parse(response.url);
  const code = parsed.queryParams?.code;
  if (typeof code !== "string")
    throw new Error("Sign-in could not be completed.");
  const result = await supabase.auth.exchangeCodeForSession(
    code,
    typeof parsed.queryParams?.sb_flow_id === "string"
      ? { flowId: parsed.queryParams.sb_flow_id }
      : undefined,
  );
  if (result.error)
    throw new Error("Sign-in could not be completed. Try again.");
}
export async function api<T>(
  path: string,
  session: Session | null,
  options: {
    body?: unknown;
    operationId?: string;
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PATCH" | "PUT";
  } = {},
): Promise<T> {
  if (!API_URL) throw new Error("Project connection is being prepared.");
  const response = await fetch(API_URL + path, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    signal: options.signal,
    headers: {
      ...(session ? { Authorization: "Bearer " + session.access_token } : {}),
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.operationId
        ? { "Idempotency-Key": options.operationId }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server may be starting. Try again shortly.");
  }
  if (!response.ok)
    throw new Error(result.error?.message || "Could not complete the request.");
  return result.data as T;
}
