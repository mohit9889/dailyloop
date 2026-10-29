import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { randomUUID } from "expo-crypto";
import type { Session } from "@supabase/supabase-js";
import {
  ConfirmDelivery,
  CorrectDelivery,
  OpeningInput,
  ReceiptInput,
  ReversalInput,
  todayIST,
  decimalToScaled,
  formatPaise,
  type Round,
  type RoundStop,
  type Statement,
  type MoneyEvent,
  type DeliveryRecord,
} from "@dailyloop/contracts";
import { api } from "../auth/client";
import { colors } from "../ui/theme";
const msg = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again.";
type Draft = { path: string; body: unknown; summary: string };
function B({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
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
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text style={[s.buttonText, primary && { color: colors.surface }]}>
        {label}
      </Text>
    </Pressable>
  );
}
function F({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        style={s.input}
        keyboardType={numeric ? "decimal-pad" : "default"}
        maxLength={numeric ? 16 : 300}
      />
    </View>
  );
}
function D({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  const change = (v: Date) =>
    onChange(
      `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`,
    );
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <B
        label={value}
        disabled={disabled}
        onPress={() => {
          if (Platform.OS === "android")
            DateTimePickerAndroid.open({
              value: date,
              mode: "date",
              maximumDate: new Date(),
              onChange: (e, v) => {
                if (e.type === "set" && v) change(v);
              },
            });
          else setShow((v) => !v);
        }}
      />
      {show ? (
        <DateTimePicker
          value={date}
          mode="date"
          maximumDate={new Date()}
          onChange={(_, v) => {
            if (v) change(v);
          }}
        />
      ) : null}
    </View>
  );
}
function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {options.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === v }}
            onPress={() => onChange(v)}
            style={[s.button, value === v && s.chosen]}
          >
            <Text style={s.buttonText}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
function Review({
  draft,
  saving,
  onEdit,
  onSave,
}: {
  draft: Draft;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
}) {
  return (
    <View style={[s.card, s.review]} accessibilityLiveRegion="polite">
      <Text style={s.heading}>Review before saving</Text>
      <Text style={s.body}>{draft.summary}</Text>
      <Text style={s.body}>
        Confirm customer, date and amount. Receipts are manual bookkeeping, not
        payment processing.
      </Text>
      <B label="Edit details" disabled={saving} onPress={onEdit} />
      <B
        label={saving ? "Saving…" : "Confirm and save"}
        primary
        disabled={saving}
        onPress={onSave}
      />
    </View>
  );
}
export function DailyRound({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [date, setDate] = useState(todayIST()),
    [page, setPage] = useState<Round | null>(null),
    [after, setAfter] = useState<string | undefined>(),
    [tick, setTick] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<RoundStop | null>(null),
    [quantity, setQuantity] = useState("1"),
    [status, setStatus] = useState<"delivered" | "skipped" | "missed">(
      "delivered",
    ),
    [reason, setReason] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null),
    [saving, setSaving] = useState(false),
    [history, setHistory] = useState<DeliveryRecord[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const key = useRef("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setPage(null);
    setError("");
    api<Round>(
      "/v1/rounds?" +
        new URLSearchParams({ date, ...(after ? { after } : {}) }),
      session,
      { signal: c.signal },
    )
      .then(setPage)
      .catch((e) => {
        if (e.name !== "AbortError") setError(msg(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [session.access_token, date, after, tick]);
  async function loadHistory(stop: RoundStop, cursor?: string) {
    if (!stop.record) return;
    try {
      const r = await api<{
        items: DeliveryRecord[];
        nextCursor: string | null;
      }>(
        `/v1/deliveries/${stop.record.id}/history${cursor ? "?after=" + cursor : ""}`,
        session,
      );
      setHistory((old) => (cursor ? [...old, ...r.items] : r.items));
      setHistoryCursor(r.nextCursor);
    } catch (e) {
      setError(msg(e));
    }
  }
  function choose(stop: RoundStop) {
    setSelected(stop);
    setStatus(stop.record?.status || "delivered");
    setQuantity(
      String(
        (stop.record?.quantityMilli ?? stop.schedule.quantityMilli) / 1000,
      ),
    );
    setReason("");
    setDraft(null);
    setError("");
    setHistory([]);
    setHistoryCursor(null);
    if (stop.record) void loadHistory(stop);
  }
  function review() {
    if (!selected || !page) return;
    try {
      const quantityMilli =
        status === "delivered" ? decimalToScaled(quantity, 1000) : 0;
      if (
        (selected.record?.unit || selected.schedule.unit) === "meal" &&
        quantityMilli % 1000
      )
        throw new Error("Meals must be whole numbers.");
      const values = { status, quantityMilli, reason };
      const body = selected.record
        ? CorrectDelivery.parse({
            ...values,
            expectedVersion: selected.record.version,
          })
        : ConfirmDelivery.parse({
            ...values,
            planId: selected.planId,
            serviceOn: date,
            scheduleRevision: page.businessRevision,
            expectedVersion: 0,
          });
      const rate = selected.record?.ratePaise || selected.schedule.ratePaise,
        amount = (
          (BigInt(quantityMilli) * BigInt(rate) + 500n) /
          1000n
        ).toString();
      key.current = randomUUID();
      setDraft({
        path: selected.record
          ? `/v1/deliveries/${selected.record.id}/corrections`
          : "/v1/deliveries/confirm",
        body,
        summary: `${selected.customerName} · ${date}\n${selected.record?.label || selected.schedule.label} · ${status}\nActual ${quantityMilli / 1000} ${selected.schedule.unit} · ${formatPaise(amount)}${selected.record ? " · replaces " + formatPaise(selected.record.chargePaise) : ""}`,
      });
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await api(draft.path, session, {
        body: draft.body,
        operationId: key.current,
      });
      setDraft(null);
      setSelected(null);
      setTick((v) => v + 1);
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.content}
      >
        <B label="Back to customers" disabled={saving} onPress={onBack} />
        <Text style={s.title}>Your daily round</Text>
        <Text style={s.body}>
          Record what actually arrived. Planned service is not revenue.
        </Text>
        <D
          label="Service date"
          value={date}
          disabled={saving}
          onChange={(v) => {
            setDate(v);
            setAfter(undefined);
            setSelected(null);
            setDraft(null);
          }}
        />
        <B
          label="Refresh round"
          disabled={saving}
          onPress={() => {
            setSelected(null);
            setDraft(null);
            setTick((v) => v + 1);
          }}
        />
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {page?.stops.map((stop) => (
          <View style={s.card} key={stop.planId}>
            <Text style={s.badge}>
              {stop.record?.status ||
                (stop.schedule.status === "scheduled"
                  ? "Not recorded"
                  : stop.schedule.status)}
            </Text>
            <Text style={s.heading}>{stop.customerName}</Text>
            <Text style={s.body}>{stop.address}</Text>
            <Text style={s.heading}>
              {stop.record?.label || stop.schedule.label}
            </Text>
            <Text style={s.body}>
              {stop.record ? "Actual" : "Planned"}:{" "}
              {(stop.record?.quantityMilli ?? stop.schedule.quantityMilli) /
                1000}{" "}
              {stop.schedule.unit} ·{" "}
              {formatPaise(stop.record?.ratePaise || stop.schedule.ratePaise)} /
              unit
            </Text>
            {stop.record ? (
              <Text style={s.heading}>
                Charge {formatPaise(stop.record.chargePaise)}
              </Text>
            ) : null}
            <B
              label={stop.record ? "Correct / view history" : "Record delivery"}
              disabled={
                saving ||
                date > todayIST() ||
                (!stop.record && stop.schedule.status !== "scheduled")
              }
              onPress={() => choose(stop)}
            />
          </View>
        ))}
        {page && !page.stops.length && !loading ? (
          <Text style={s.body}>No service on this page for this date.</Text>
        ) : null}
        {after ? (
          <B label="First page" onPress={() => setAfter(undefined)} />
        ) : null}
        {page?.nextCursor ? (
          <B
            label="Next plans"
            onPress={() => {
              setAfter(page.nextCursor!);
              setSelected(null);
              setDraft(null);
            }}
          />
        ) : null}
        {selected ? (
          <View style={s.card}>
            <Text style={s.heading}>
              {selected.customerName} ·{" "}
              {selected.record?.label || selected.schedule.label}
            </Text>
            <Text style={s.body}>
              {date} ·{" "}
              {selected.record
                ? "Correction retains the original price."
                : "Confirm the actual outcome."}
            </Text>
            {!draft ? (
              <>
                <Choices
                  label="Outcome"
                  options={["delivered", "skipped", "missed"] as const}
                  value={status}
                  onChange={setStatus}
                />
                <F
                  label={`Actual quantity (${selected.schedule.unit})`}
                  numeric
                  value={quantity}
                  onChange={setQuantity}
                />
                <Text style={s.body}>
                  Skipped/missed save zero quantity and no charge. Meals must be
                  whole numbers.
                </Text>
                <F label="Reason" value={reason} onChange={setReason} />
                <B label="Review outcome" onPress={review} />
              </>
            ) : (
              <Review
                draft={draft}
                saving={saving}
                onEdit={() => setDraft(null)}
                onSave={() => void save()}
              />
            )}
            <B
              label="Close"
              disabled={saving}
              onPress={() => {
                setSelected(null);
                setDraft(null);
              }}
            />
            {history.length ? (
              <>
                <Text style={s.heading}>Saved event history</Text>
                {history.map((h) => (
                  <Text key={h.eventId} style={s.body}>
                    {h.recordedAt} · {h.status} · {h.quantityMilli / 1000}{" "}
                    {h.unit} · {formatPaise(h.chargePaise)}
                    {"\n"}
                    {h.reason} · Actor {h.actorId}
                  </Text>
                ))}
                {historyCursor ? (
                  <B
                    label="More history"
                    onPress={() => void loadHistory(selected, historyCursor)}
                  />
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
export function CustomerAccount({
  customerId,
  session,
}: {
  customerId: string;
  session: Session;
}) {
  const [from, setFrom] = useState(todayIST().slice(0, 7) + "-01"),
    [to, setTo] = useState(todayIST()),
    [statement, setStatement] = useState<Statement | null>(null),
    [receipts, setReceipts] = useState<MoneyEvent[]>([]),
    [receiptCursor, setReceiptCursor] = useState<string | null>(null),
    [tick, setTick] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [kind, setKind] = useState<"receipt" | "opening" | "reverse" | null>(null),
    [amount, setAmount] = useState(""),
    [effective, setEffective] = useState(todayIST()),
    [reason, setReason] = useState(""),
    [method, setMethod] = useState<"cash" | "upi" | "bank">("cash"),
    [direction, setDirection] = useState<"debit" | "credit">("debit"),
    [reversing, setReversing] = useState<MoneyEvent | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [saving, setSaving] = useState(false);
  const key = useRef("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setStatement(null);
    setDraft(null);
    setKind(null);
    setError("");
    const q = new URLSearchParams({ from, to });
    Promise.all([
      api<Statement>(`/v1/customers/${customerId}/statement?` + q, session, {
        signal: c.signal,
      }),
      api<{ items: MoneyEvent[]; nextCursor: string | null }>(
        `/v1/customers/${customerId}/receipts?` + q,
        session,
        { signal: c.signal },
      ),
    ])
      .then(([s, r]) => {
        setStatement(s);
        setReceipts(r.items);
        setReceiptCursor(r.nextCursor);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(msg(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [customerId, session.access_token, from, to, tick]);
  async function moreLines() {
    if (!statement?.nextCursor) return;
    try {
      const r = await api<Statement>(
        `/v1/customers/${customerId}/statement?` +
          new URLSearchParams({ from, to, after: statement.nextCursor }),
        session,
      );
      if (r.businessRevision !== statement.businessRevision) {
        setTick((v) => v + 1);
        throw Error("Statement changed. Refreshed from first page.");
      }
      setStatement({ ...r, lines: [...statement.lines, ...r.lines] });
    } catch (e) {
      setError(msg(e));
    }
  }
  async function moreReceipts() {
    if (!receiptCursor) return;
    try {
      const r = await api<{ items: MoneyEvent[]; nextCursor: string | null }>(
        `/v1/customers/${customerId}/receipts?` +
          new URLSearchParams({ from, to, after: receiptCursor }),
        session,
      );
      setReceipts((v) => [...v, ...r.items]);
      setReceiptCursor(r.nextCursor);
    } catch (e) {
      setError(msg(e));
    }
  }
  function open(k: "receipt" | "opening" | "reverse", r?: MoneyEvent) {
    setKind(k);
    setAmount("");
    setReason("");
    setDraft(null);
    setReversing(r || null);
    setEffective(
      k === "opening" && statement?.openingBalance
        ? statement.openingBalance.cutoverOn
        : todayIST(),
    );
    setDirection(
      statement?.openingBalance &&
        BigInt(statement.openingBalance.amountPaise) < 0n
        ? "credit"
        : "debit",
    );
    setError("");
  }
  function review() {
    if (!statement) return;
    try {
      let body: unknown, path: string, summary: string;
      if (kind === "reverse" && reversing) {
        body = ReversalInput.parse({ expectedVersion: 1, reason });
        path = `/v1/receipts/${reversing.id}/reversal`;
        summary = `Reverse receipt · ${reversing.effectiveOn} · ${formatPaise(reversing.amountPaise)} · ${reason}`;
      } else {
        const amountPaise = String(decimalToScaled(amount, 100));
        if (kind === "receipt") {
          body = ReceiptInput.parse({
            customerId,
            effectiveOn: effective,
            amountPaise,
            method,
            reason,
          });
          path = "/v1/receipts";
          summary = `Receipt · ${effective} · ${formatPaise(amountPaise)} · ${method} · ${reason}`;
        } else {
          const signed =
            direction === "credit" ? "-" + amountPaise : amountPaise;
          body = OpeningInput.parse({
            expectedVersion: statement.openingBalance?.version || 0,
            cutoverOn: effective,
            amountPaise: signed,
            reason,
          });
          path = `/v1/customers/${customerId}/opening-balance`;
          summary = `Opening ${direction} · ${effective} · ${formatPaise(signed)} · ${reason}`;
        }
      }
      key.current = randomUUID();
      setDraft({
        path,
        body,
        summary: statement.customer.name + "\n" + summary,
      });
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await api(draft.path, session, {
        body: draft.body,
        operationId: key.current,
      });
      setDraft(null);
      setKind(null);
      setTick((v) => v + 1);
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <View style={s.section}>
      <Text style={s.title}>Customer account</Text>
      {statement ? (
        <Text style={s.body}>
          {statement.customer.name} · {statement.businessName}
        </Text>
      ) : null}
      <Text style={s.body}>
        Manual receipts and reconciled statements. This does not collect or
        verify a bank payment.
      </Text>
      <D label="From" value={from} disabled={saving} onChange={setFrom} />
      <D label="Through" value={to} disabled={saving} onChange={setTo} />
      <B
        label="Refresh account"
        disabled={saving}
        onPress={() => setTick((v) => v + 1)}
      />
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {statement ? (
        <>
          <View style={[s.card, s.primary]}>
            <Text style={s.balanceLabel}>
              {BigInt(statement.closingPaise) < 0n
                ? "Customer credit"
                : "Balance due"}
            </Text>
            <Text style={s.balance}>{formatPaise(statement.closingPaise)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.body}>
              Opening before period: {formatPaise(statement.openingPaise)}
            </Text>
            <Text style={s.body}>
              Charges: {formatPaise(statement.chargesPaise)}
            </Text>
            <Text style={s.body}>
              Adjustments: {formatPaise(statement.adjustmentsPaise)}
            </Text>
            <Text style={s.body}>
              Receipts: {formatPaise(statement.receiptsPaise)}
            </Text>
            <Text style={s.body}>
              Receipt reversals: {formatPaise(statement.reversalsPaise)}
            </Text>
          </View>
          <Text style={s.body}>
            {statement.unresolved
              ? `Provisional: ${statement.unresolved} unresolved past deliveries; estimated value excluded.`
              : "No unresolved past deliveries in this period."}
          </Text>
          <Text style={s.meta}>
            Revision {statement.businessRevision} · {statement.generatedAt}
          </Text>
          <B
            label="Record receipt"
            disabled={saving}
            onPress={() => open("receipt")}
          />
          <B
            label={
              statement.openingBalance
                ? "Correct opening balance"
                : "Set opening balance"
            }
            disabled={saving}
            onPress={() => open("opening")}
          />
          {kind ? (
            <View style={s.card}>
              <Text style={s.heading}>
                {kind === "reverse"
                  ? "Reverse full receipt"
                  : kind === "opening"
                    ? "Opening balance / cutover"
                    : "Record receipt"}
              </Text>
              {!draft ? (
                <>
                  {kind !== "reverse" ? (
                    <>
                      <F
                        label="Amount (₹)"
                        value={amount}
                        onChange={setAmount}
                        numeric
                      />
                      {kind === "receipt" ? (
                        <Choices
                          label="Method"
                          options={["cash", "upi", "bank"] as const}
                          value={method}
                          onChange={setMethod}
                        />
                      ) : (
                        <>
                          <Choices
                            label="Opening type"
                            options={["debit", "credit"] as const}
                            value={direction}
                            onChange={setDirection}
                          />
                          <Text style={s.body}>
                            Debit means the customer owes you; credit means an
                            advance. Earlier activity before this cutover cannot
                            be charged again. Cutover stays fixed after
                            creation.
                          </Text>
                        </>
                      )}
                      <D
                        label={
                          kind === "receipt" ? "Receipt date" : "Cutover date"
                        }
                        value={effective}
                        onChange={setEffective}
                        disabled={
                          kind === "opening" &&
                          Boolean(statement.openingBalance)
                        }
                      />
                    </>
                  ) : (
                    <Text style={s.body}>
                      {reversing?.effectiveOn} ·{" "}
                      {formatPaise(reversing?.amountPaise || "0")}
                    </Text>
                  )}
                  <F label="Reason" value={reason} onChange={setReason} />
                  <B label="Review transaction" onPress={review} />
                </>
              ) : (
                <Review
                  draft={draft}
                  saving={saving}
                  onEdit={() => setDraft(null)}
                  onSave={() => void save()}
                />
              )}
              <B
                label="Cancel"
                disabled={saving}
                onPress={() => {
                  setKind(null);
                  setDraft(null);
                }}
              />
            </View>
          ) : null}
          <Text style={s.heading}>Statement entries</Text>
          {statement.lines.map((l) => (
            <View style={s.card} key={l.id}>
              <Text style={s.heading}>
                {l.date} · {formatPaise(l.amountPaise)}
              </Text>
              <Text style={s.body}>{l.description}</Text>
              <Text style={s.meta}>{l.recordedAt}</Text>
            </View>
          ))}
          {!statement.lines.length ? (
            <Text style={s.body}>No entries in this period.</Text>
          ) : null}
          {statement.nextCursor ? (
            <B label="More entries" onPress={() => void moreLines()} />
          ) : null}
          <Text style={s.heading}>Receipt history</Text>
          {receipts.map((r) => (
            <View style={s.card} key={r.id}>
              <Text style={s.heading}>
                {r.kind} · {formatPaise(r.amountPaise)}
                {r.reversed ? " · Reversed" : ""}
              </Text>
              <Text style={s.body}>
                {r.effectiveOn} · {r.method} · {r.reason}
              </Text>
              <Text style={s.meta}>
                {r.recordedAt} · Actor {r.actorId}
              </Text>
              {r.kind === "receipt" && !r.reversed ? (
                <B
                  label="Review full reversal"
                  disabled={saving}
                  onPress={() => open("reverse", r)}
                />
              ) : null}
            </View>
          ))}
          {receiptCursor ? (
            <B label="More receipts" onPress={() => void moreReceipts()} />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 22, gap: 18, paddingBottom: 40 },
  section: {
    gap: 18,
    marginTop: 28,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 24,
  },
  title: { fontSize: 28, fontWeight: "600", color: colors.ink },
  heading: { fontSize: 18, fontWeight: "600", color: colors.ink },
  body: { fontSize: 14, lineHeight: 23, color: colors.muted },
  meta: { fontSize: 13, lineHeight: 21, color: colors.muted },
  card: {
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  buttonText: { fontSize: 14, fontWeight: "600", color: colors.primary },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  chosen: { backgroundColor: colors.soft, borderColor: colors.primary },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink },
  input: {
    minHeight: 48,
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  error: {
    padding: 16,
    fontSize: 14,
    lineHeight: 22,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
  },
  badge: {
    fontSize: 13,
    color: colors.primary,
    backgroundColor: colors.soft,
    padding: 8,
    alignSelf: "flex-start",
    borderRadius: 12,
  },
  review: { backgroundColor: colors.soft, borderColor: colors.primary },
  balanceLabel: { fontSize: 14, color: colors.surface },
  balance: { fontSize: 30, fontWeight: "600", color: colors.surface },
});
