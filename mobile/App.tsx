import { DailyRound } from "./src/features/Accounting";
import { colors } from "./src/ui/theme";
import CustomerDetail from "./src/features/CustomerDetail";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { randomUUID } from "expo-crypto";
import type { Session } from "@supabase/supabase-js";
import {
  BusinessInput,
  CustomerInput,
  type Customer,
  type CustomerPage,
  type Me,
  type Setup,
} from "@dailyloop/contracts";
import { api, mobileConfigured, signIn, supabase } from "./src/auth/client";
function Button({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary && s.primary,
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      <Text style={[s.buttonText, primary && { color: colors.surface }]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  phone = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  phone?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        style={s.input}
        keyboardType={phone ? "phone-pad" : "default"}
        maxLength={label === "Delivery address" ? 300 : phone ? 20 : 120}
      />
    </View>
  );
}
const logo = (
  <Image
    source={require("./assets/brand/dailyloop-logo.png")}
    style={{ width: 192, height: 48 }}
    resizeMode="contain"
    accessibilityLabel="DailyLoop"
  />
);
export default function App() {
  return (
    <SafeAreaProvider>
      <Workspace />
    </SafeAreaProvider>
  );
}
function Workspace() {
  const [session, setSession] = useState<Session | null | undefined>(undefined),
    [setup, setSetup] = useState<Setup | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [revision, setRevision] = useState(0),
    [customers, setCustomers] = useState<Customer[]>([]),
    [listLoading, setListLoading] = useState(false),
    [search, setSearch] = useState(""),
    [showForm, setShowForm] = useState(false);
  const [businessName, setBusinessName] = useState(""),
    [serviceType, setServiceType] = useState<"milk" | "tiffin" | "mixed">(
      "milk",
    ),
    [name, setName] = useState(""),
    [address, setAddress] = useState(""),
    [phone, setPhone] = useState("");
  const [roundOpen, setRoundOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const operation = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const authClient = supabase;
    if (!authClient) {
      setSession(null);
      return;
    }
    let mounted = true;
    authClient.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setError("Please sign in again.");
      setSession(data.session);
    });
    const listener = authClient.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });
    const state = AppState.addEventListener("change", (value) => {
      if (value === "active") authClient.auth.startAutoRefresh();
      else authClient.auth.stopAutoRefresh();
    });
    return () => {
      mounted = false;
      listener.data.subscription.unsubscribe();
      state.remove();
      authClient.auth.stopAutoRefresh();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Setup>("/v1/setup", null, { signal: controller.signal })
      .then(setSetup)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    setMe(null);
    setCustomers([]);
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    (async () => {
      await api("/auth/mobile-session", session, {
        body: {},
        signal: controller.signal,
      });
      setMe(await api<Me>("/v1/me", session, { signal: controller.signal }));
    })()
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, revision]);
  useEffect(() => {
    if (!me?.business || !session) return;
    const c = new AbortController();
    setListLoading(true);
    const timer = setTimeout(
      () =>
        api<CustomerPage>(
          "/v1/customers?" + new URLSearchParams({ search, limit: "100" }),
          session,
          { signal: c.signal },
        )
          .then((result) => setCustomers(result.items))
          .catch((e) => {
            if (e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!c.signal.aborted) setListLoading(false);
          }),
      250,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [me?.business?.id, search, revision, session]);
  function operationId(body: unknown) {
    const serialized = JSON.stringify(body);
    if (operation.current?.body !== serialized)
      operation.current = { body: serialized, key: randomUUID() };
    return operation.current.key;
  }
  async function saveBusiness() {
    if (!session || saving) return;
    const parsed = BusinessInput.safeParse({ name: businessName, serviceType });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("/v1/businesses", session, {
        body: parsed.data,
        operationId: operationId(parsed.data),
      });
      operation.current = null;
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function saveCustomer() {
    if (!session || saving) return;
    const parsed = CustomerInput.safeParse({ name, address, phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("/v1/customers", session, {
        body: parsed.data,
        operationId: operationId(parsed.data),
      });
      operation.current = null;
      setShowForm(false);
      setNotice("Customer saved to your business.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function login() {
    setSaving(true);
    setError("");
    try {
      await signIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    if (!session || saving) return;
    setSaving(true);
    setError("");
    try {
      await api("/auth/logout", session, { body: {} });
      await supabase?.auth.signOut({ scope: "local" });
      setMe(null);
      setCustomers([]);
      setNotice("");
    } catch {
      await supabase?.auth.signOut({ scope: "local" });
      setSession(null);
      setMe(null);
      setCustomers([]);
      setNotice("");
    } finally {
      setSaving(false);
    }
  }
  if (roundOpen && session && me?.features?.accounting)
    return (
      <DailyRound
        session={session}
        onBack={() => {
          setRoundOpen(false);
          setRevision((v) => v + 1);
        }}
      />
    );
  if (selectedCustomer && session && me?.business)
    return (
      <CustomerDetail
        customerId={selectedCustomer}
        accountingEnabled={me.features?.accounting}
        session={session}
        serviceType={me.business.serviceType}
        onBack={() => {
          setSelectedCustomer(null);
          setRevision((v) => v + 1);
        }}
      />
    );
  const canSignIn = mobileConfigured && setup?.signInAvailable;
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={s.header}>
        {logo}
        {session ? (
          <Button label="Sign out" disabled={saving} onPress={logout} />
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.kicker}>A LITTLE ORDER. A BETTER DAY.</Text>
        {session === undefined || loading ? (
          <ActivityIndicator
            color="#174d3b"
            accessibilityLabel="Opening your workspace"
          />
        ) : !session ? (
          <>
            <Text style={s.title}>More deliveries.{"\n"}Less loose ends.</Text>
            <Text style={s.description}>
              A private home for your customers and your daily delivery
              business.
            </Text>
            <View style={s.welcome}>
              <View style={s.roundMark}>
                <Image
                  source={require("./assets/brand/dailyloop-icon.png")}
                  style={{ width: 48, height: 48 }}
                  accessible={false}
                />
              </View>
              <Text style={s.cardTitle}>
                A fresh start for your daily business.
              </Text>
              <Text style={s.description}>
                Sign in to set up your workspace and start adding your
                customers.
              </Text>
              {canSignIn ? (
                <Button
                  primary
                  label={saving ? "Opening sign-in…" : "Continue with Google"}
                  disabled={saving}
                  onPress={login}
                />
              ) : (
                <>
                  <Text style={s.setupNote}>
                    Your workspace is being prepared. Secure sign-in will be
                    available when the project connection is complete.
                  </Text>
                  <Button
                    label="Check connection"
                    onPress={() => setRevision((v) => v + 1)}
                  />
                </>
              )}
            </View>
            <Text style={s.privacy}>
              Your business records are kept separate.{"\n"}Every delivery
              counts.
            </Text>
          </>
        ) : !me ? (
          <>
            <Text style={s.title}>Let’s reconnect.</Text>
            <Text style={s.description}>
              Your workspace could not be opened. Try again or sign out and sign
              in again.
            </Text>
            <Button
              label="Try again"
              onPress={() => setRevision((v) => v + 1)}
            />
          </>
        ) : !me.business ? (
          <>
            <Text style={s.title}>Make it yours.</Text>
            <Text style={s.description}>
              Start with your business name. Your customers come next.
            </Text>
            <Field
              label="Business name"
              value={businessName}
              onChange={setBusinessName}
            />
            <Text style={s.label}>What do you deliver?</Text>
            <View style={s.choices}>
              {(
                [
                  { id: "milk", label: "Milk" },
                  { id: "tiffin", label: "Tiffin" },
                  { id: "mixed", label: "Both" },
                ] as const
              ).map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: serviceType === option.id }}
                  onPress={() => setServiceType(option.id)}
                  style={[
                    s.choice,
                    serviceType === option.id && s.choiceActive,
                  ]}
                >
                  <Text style={s.choiceText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <Button
              primary
              label={saving ? "Creating workspace…" : "Create my workspace"}
              disabled={saving}
              onPress={saveBusiness}
            />
            <Text style={s.privacy}>India · INR · Asia/Kolkata</Text>
          </>
        ) : (
          <>
            <View style={s.registerHero}>
              <Text style={s.heroEyebrow}>{me.business.name}</Text>
              <Text style={s.heroTitle}>
                {me.business.serviceType === "milk"
                  ? "Every delivery."
                  : "Good food."}
                {"\n"}A smoother day.
              </Text>
              <Text style={s.heroBody}>
                Your customers and recurring deliveries, all in one rhythm.
              </Text>
              <View style={s.heroPill}>
                <Text style={s.heroPillText}>CUSTOMER REGISTER</Text>
              </View>
            </View>
            {me.features?.accounting ? (
              <Button
                label="Open daily round"
                onPress={() => setRoundOpen(true)}
              />
            ) : null}
            <Text style={s.cardTitle}>Your customers</Text>
            <Text style={s.description}>
              {listLoading ? "Updating register…" : `${customers.length} shown`}{" "}
              · Open a customer to manage their plans.
            </Text>
            <Button
              primary
              label="Add customer"
              onPress={() => {
                setName("");
                setAddress("");
                setPhone("");
                setError("");
                operation.current = null;
                setShowForm(true);
              }}
            />
            <TextInput
              accessibilityLabel="Search customers"
              placeholder="Search name or phone…"
              value={search}
              onChangeText={setSearch}
              style={s.search}
            />
            {notice ? (
              <Text style={s.success} accessibilityLiveRegion="polite">
                {notice}
              </Text>
            ) : null}
            {listLoading ? (
              <ActivityIndicator color="#174d3b" />
            ) : customers.length ? (
              customers.map((c) => (
                <Pressable
                  style={({ pressed }) => [
                    s.customer,
                    pressed && { backgroundColor: colors.soft },
                  ]}
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    c.name +
                    (me.features?.planLifecycle ? ", view delivery plans" : "")
                  }
                  disabled={!me.features?.planLifecycle}
                  onPress={() => setSelectedCustomer(c.id)}
                >
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{c.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.customerName}>{c.name}</Text>
                    <Text style={s.customerDetails}>{c.address}</Text>
                    {c.phone ? (
                      <Text style={s.customerDetails}>{c.phone}</Text>
                    ) : null}
                  </View>
                  <Text
                    style={s.customerArrow}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    ›
                  </Text>
                </Pressable>
              ))
            ) : (
              <View style={s.empty}>
                <Text style={s.cardTitle}>
                  {search
                    ? "No customers found"
                    : "Your first customer starts the loop."}
                </Text>
                <Text style={s.description}>
                  {search
                    ? "Try another name or phone number."
                    : "Add a name and delivery address to start your register."}
                </Text>
              </View>
            )}
          </>
        )}
        {error && !showForm ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Text style={s.footer}>DailyLoop · Every delivery counts.</Text>
      </ScrollView>
      <Modal
        visible={showForm}
        animationType="slide"
        onRequestClose={() => {
          if (!saving) setShowForm(false);
        }}
      >
        <SafeAreaView style={s.safe}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={s.modalHeader}>
              <Text style={s.cardTitle}>Add a customer</Text>
              <Button
                label="Close"
                disabled={saving}
                onPress={() => setShowForm(false)}
              />
            </View>
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.description}>A new face on your daily round.</Text>
              {error ? (
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
              ) : null}
              <Field label="Customer name" value={name} onChange={setName} />
              <Field
                label="Delivery address"
                value={address}
                onChange={setAddress}
              />
              <Field
                label="Phone (optional)"
                value={phone}
                onChange={setPhone}
                phone
              />
              <Button
                primary
                label={saving ? "Saving…" : "Save customer"}
                disabled={saving}
                onPress={saveCustomer}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  registerHero: {
    backgroundColor: colors.primary,
    borderRadius: 22,
    padding: 24,
    gap: 14,
  },
  heroEyebrow: { fontSize: 13, fontWeight: "500", color: colors.accent },
  heroTitle: {
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "600",
    letterSpacing: -0.8,
    color: colors.surface,
  },
  heroBody: { fontSize: 15, lineHeight: 23, color: colors.surface },
  heroPill: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
  heroPillText: {
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: "700",
    color: colors.primary,
  },
  customerArrow: { fontSize: 24, color: colors.muted },
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  content: { padding: 22, gap: 18, paddingBottom: 40 },
  kicker: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.muted,
    marginTop: 10,
  },
  title: {
    fontSize: 35,
    lineHeight: 43,
    fontWeight: "600",
    letterSpacing: -1.2,
    color: colors.ink,
  },
  description: { fontSize: 15, lineHeight: 23, color: colors.muted },
  welcome: {
    backgroundColor: colors.surface,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    gap: 20,
    marginTop: 10,
  },
  roundMark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.soft,
    justifyContent: "center",
    alignItems: "center",
  },
  roundMarkText: { fontSize: 28, color: colors.muted },
  cardTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.surface,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  setupNote: {
    padding: 16,
    backgroundColor: colors.soft,
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 21,
    color: colors.muted,
  },
  privacy: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 14,
  },
  footer: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    marginTop: 25,
  },
  error: {
    backgroundColor: colors.dangerSoft,
    padding: 15,
    borderRadius: 10,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 21,
  },
  success: {
    backgroundColor: colors.soft,
    padding: 14,
    borderRadius: 10,
    color: colors.ink,
    fontSize: 13,
  },
  field: { gap: 10 },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink },
  input: {
    backgroundColor: colors.surface,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    minHeight: 49,
    borderRadius: 10,
    color: colors.ink,
  },
  choices: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceActive: { backgroundColor: colors.soft, borderColor: colors.border },
  choiceText: { fontSize: 13, color: colors.ink },
  business: { fontSize: 13, color: colors.muted },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    borderRadius: 10,
    fontSize: 14,
    minHeight: 48,
    color: colors.ink,
  },
  customer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    borderRadius: 13,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.soft,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: colors.muted, fontSize: 15, fontWeight: "600" },
  customerName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  customerDetails: {
    fontSize: 14,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 5,
  },
  empty: {
    backgroundColor: colors.surface,
    padding: 30,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    gap: 14,
  },
  modalHeader: {
    backgroundColor: colors.surface,
    padding: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
});
