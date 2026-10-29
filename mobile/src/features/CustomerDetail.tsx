import { CustomerAccount } from "./Accounting";
import { colors } from "../ui/theme";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { randomUUID } from "expo-crypto";
import type { Session } from "@supabase/supabase-js";
import {
  PlanCreate,
  PlanRevisionInput,
  PauseInput,
  ResumeInput,
  OverrideInput,
  EndPlanInput,
  EditCustomerInput,
  ArchiveCustomerInput,
  todayIST,
  shiftDate,
  decimalToScaled,
  formatPaise,
  type Customer,
  type CustomerPlans,
  type RecurringPlan,
  type SchedulePreview,
  type SchedulePreviewInput,
} from "@dailyloop/contracts";
import { api } from "../auth/client";
type Kind =
  | "create"
  | "revision"
  | "pause"
  | "override"
  | "end"
  | "resume"
  | "edit"
  | "archive";
type Editor = { kind: Kind; plan?: RecurringPlan; pauseId?: string };
const titles: Record<Kind, string> = {
  create: "New delivery plan",
  revision: "Change recurring plan",
  pause: "Pause deliveries",
  override: "One-day change",
  end: "End delivery plan",
  resume: "Resume deliveries",
  edit: "Edit customer",
  archive: "Archive customer",
};
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const decimal = (v: string) => {
  const n = BigInt(v);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
};
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
  numeric = false,
  phone = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  phone?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : phone ? "phone-pad" : "default"}
        maxLength={
          label === "Delivery address"
            ? 300
            : label === "Reason for change"
              ? 300
              : 120
        }
      />
    </View>
  );
}
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [y, m, d] = value.split("-").map(Number);
  const selected = new Date(y, m - 1, d, 12);
  const change = (date: Date) =>
    onChange(
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-"),
    );
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Button
        label={value + "  ▾"}
        onPress={() => {
          if (Platform.OS === "android")
            DateTimePickerAndroid.open({
              value: selected,
              mode: "date",
              onChange: (event, date) => {
                if (event.type === "set" && date) change(date);
              },
            });
          else setOpen((v) => !v);
        }}
      />
      {open && Platform.OS === "ios" ? (
        <>
          <DateTimePicker
            value={selected}
            mode="date"
            display="spinner"
            onChange={(_event, date) => {
              if (date) change(date);
            }}
          />
          <Button label="Done" onPress={() => setOpen(false)} />
        </>
      ) : null}
    </View>
  );
}
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.choices}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.id === value }}
            style={[s.choice, o.id === value && s.chosen]}
            onPress={() => onChange(o.id)}
          >
            <Text style={s.choiceText}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
function ScheduleRows({
  preview,
  compare = false,
}: {
  preview: SchedulePreview;
  compare?: boolean;
}) {
  return (
    <View style={{ gap: 10 }}>
      {preview.after.map((row, i) => (
        <View key={row.date} style={s.scheduleRow}>
          <View style={s.between}>
            <Text style={s.rowDate}>{row.date}</Text>
            <Text style={[s.status, row.status === "scheduled" && s.scheduled]}>
              {row.status.replaceAll("_", " ")}
            </Text>
          </View>
          {compare && preview.before[i] ? (
            <Text style={s.small}>
              Before: {preview.before[i].status.replaceAll("_", " ")}
              {preview.before[i].status === "scheduled"
                ? ` · ${preview.before[i].quantityMilli / 1000} ${row.unit} · ${formatPaise(preview.before[i].ratePaise)}`
                : ""}
            </Text>
          ) : null}
          <Text style={s.body}>
            {row.status === "scheduled"
              ? `${row.quantityMilli / 1000} ${row.unit} · ${formatPaise(row.ratePaise)} / ${row.unit}`
              : "No planned delivery"}
          </Text>
        </View>
      ))}
    </View>
  );
}
export default function CustomerDetail({
  customerId,
  accountingEnabled,
  session,
  serviceType,
  onBack,
}: {
  customerId: string;
  accountingEnabled?: boolean;
  session: Session;
  serviceType: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<CustomerPlans | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<Editor | null>(null),
    [planId, setPlanId] = useState(""),
    [from, setFrom] = useState(todayIST),
    [preview, setPreview] = useState<SchedulePreview | null>(null),
    [scheduleError, setScheduleError] = useState(""),
    [loadingPreview, setLoadingPreview] = useState(false),
    [history, setHistory] = useState<Record<string, number>>({});
  useEffect(() => {
    const c = new AbortController();
    api<CustomerPlans>(`/v1/customers/${customerId}/plans`, session, {
      signal: c.signal,
    })
      .then((result) => {
        setData(result);
        setError("");
        setPlanId((old) =>
          result.plans.some((p) => p.id === old)
            ? old
            : result.plans[0]?.id || "",
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [customerId, revision, session]);
  useEffect(() => {
    setPreview(null);
    setScheduleError("");
    if (!planId) return;
    const c = new AbortController();
    setLoadingPreview(true);
    api<SchedulePreview>("/v1/schedule/preview", session, {
      body: { planId, from, to: shiftDate(from, 6) },
      signal: c.signal,
    })
      .then(setPreview)
      .catch((e) => {
        if (e.name !== "AbortError") setScheduleError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoadingPreview(false);
      });
    return () => c.abort();
  }, [planId, from, revision, session]);
  function open(value: Editor) {
    setNotice("");
    setEditor(value);
  }
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Button label="‹ Customers" onPress={onBack} />
        <Text style={s.headerTitle}>Customer plans</Text>
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <>
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
            <Button
              label="Try again"
              onPress={() => setRevision((v) => v + 1)}
            />
          </>
        ) : null}
        {!data ? (
          <ActivityIndicator color="#174d3b" />
        ) : (
          <>
            <View style={s.customerSummary}>
              <Text style={s.kicker}>A FAMILIAR FACE ON YOUR ROUND</Text>
              <Text style={s.title}>{data.customer.name}</Text>
              <Text style={s.body}>
                {data.customer.address}
                {data.customer.phone ? "\n" + data.customer.phone : ""}
              </Text>
              {data.customer.archivedEffectiveOn ? (
                <Text style={s.warning}>
                  Archived from {data.customer.archivedEffectiveOn}. Earlier
                  history is retained.
                </Text>
              ) : null}
              <View style={s.choices}>
                <Button
                  label="Edit details"
                  onPress={() => open({ kind: "edit" })}
                />
                {!data.customer.archivedEffectiveOn ? (
                  <Button
                    label="Archive"
                    onPress={() => open({ kind: "archive" })}
                  />
                ) : null}
              </View>
            </View>
            {notice ? (
              <Text style={s.success} accessibilityLiveRegion="polite">
                {notice}
              </Text>
            ) : null}
            <Text style={s.sectionTitle}>
              Recurring plans · {data.plans.length}
            </Text>
            <Text style={s.small}>
              Each morning, evening, lunch or dinner slot has its own plan.
            </Text>
            <Button
              primary
              label="＋ Add delivery plan"
              disabled={Boolean(
                data.customer.archivedEffectiveOn &&
                data.customer.archivedEffectiveOn <= data.today,
              )}
              onPress={() => open({ kind: "create" })}
            />
            {!data.plans.length ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>
                  Start with their first delivery.
                </Text>
                <Text style={s.body}>
                  Choose a quantity, rate and delivery days.
                </Text>
              </View>
            ) : (
              data.plans.map((p) => {
                const current =
                    [...p.revisions]
                      .reverse()
                      .find((r) => r.effectiveFrom <= data.today) ||
                    p.revisions[0],
                  upcoming = p.revisions.filter(
                    (r) => r.effectiveFrom > data.today,
                  ),
                  inactive = Boolean(
                    (p.endOn && p.endOn < data.today) ||
                    (data.customer.archivedEffectiveOn &&
                      data.customer.archivedEffectiveOn <= data.today),
                  );
                return (
                  <View style={s.card} key={p.id}>
                    <View style={s.between}>
                      <Text style={s.cardTitle}>{current.label}</Text>
                      <Text style={s.status}>
                        {p.endOn && p.endOn < data.today
                          ? "Ended"
                          : "Recurring"}
                      </Text>
                    </View>
                    <Text style={s.quantity}>
                      {current.quantityMilli / 1000} {p.unit} ·{" "}
                      {formatPaise(current.ratePaise)} / {p.unit}
                    </Text>
                    <Text style={s.body}>
                      {current.weekdays.length === 7
                        ? "Every day"
                        : current.weekdays.map((d) => days[d]).join(" · ")}
                    </Text>
                    <Text style={s.small}>
                      Starts {p.startOn}
                      {p.endOn ? " · Last delivery " + p.endOn : ""}
                    </Text>
                    {upcoming.length ? (
                      <Text style={s.planNote}>
                        Next change: {upcoming[0].effectiveFrom} ·{" "}
                        {upcoming[0].quantityMilli / 1000} {p.unit} at{" "}
                        {formatPaise(upcoming[0].ratePaise)}
                      </Text>
                    ) : null}
                    <Button
                      label="View schedule below ↓"
                      onPress={() => setPlanId(p.id)}
                    />
                    {!inactive ? (
                      <>
                        <View style={s.choices}>
                          <Button
                            label="Change plan"
                            onPress={() => open({ kind: "revision", plan: p })}
                          />
                          <Button
                            label="Pause"
                            onPress={() => open({ kind: "pause", plan: p })}
                          />
                        </View>
                        <Button
                          label="One-day change"
                          onPress={() => open({ kind: "override", plan: p })}
                        />
                        {!p.endOn ? (
                          <Button
                            label="End plan"
                            onPress={() => open({ kind: "end", plan: p })}
                          />
                        ) : null}
                      </>
                    ) : null}
                    {p.pauses.map((pause) => (
                      <View key={pause.id} style={s.pause}>
                        <Text style={s.small}>
                          Pause: {pause.fromOn} — {pause.toOn}
                          {pause.resumeOn ? "\nResumed " + pause.resumeOn : ""}
                        </Text>
                        <Text style={s.small}>{pause.reason}</Text>
                        {!pause.resumeOn &&
                        pause.toOn >= data.today &&
                        !inactive ? (
                          <Button
                            label="Resume this pause"
                            onPress={() =>
                              open({
                                kind: "resume",
                                plan: p,
                                pauseId: pause.id,
                              })
                            }
                          />
                        ) : null}
                      </View>
                    ))}
                    <Button
                      label={
                        history[p.id]
                          ? "Hide revision history"
                          : `Revision history (${p.revisions.length})`
                      }
                      onPress={() =>
                        setHistory((old) => ({
                          ...old,
                          [p.id]: old[p.id] ? 0 : 20,
                        }))
                      }
                    />
                    {history[p.id] ? (
                      <>
                        {p.revisions
                          .slice(-history[p.id])
                          .reverse()
                          .map((r) => (
                            <View key={r.id} style={s.history}>
                              <Text style={s.rowDate}>
                                From {r.effectiveFrom} · {r.label}
                              </Text>
                              <Text style={s.small}>
                                {r.quantityMilli / 1000} {p.unit} ·{" "}
                                {formatPaise(r.ratePaise)} ·{" "}
                                {r.weekdays.map((d) => days[d]).join(", ")}
                              </Text>
                              <Text style={s.small}>{r.reason}</Text>
                            </View>
                          ))}
                        {history[p.id] < p.revisions.length ? (
                          <Button
                            label="Show earlier revisions"
                            onPress={() =>
                              setHistory((old) => ({
                                ...old,
                                [p.id]: old[p.id] + 20,
                              }))
                            }
                          />
                        ) : null}
                        {p.overrides.length ? (
                          <Text style={s.small}>Latest one-day changes:</Text>
                        ) : null}
                        {p.overrides
                          .slice(-10)
                          .reverse()
                          .map((o) => (
                            <Text style={s.small} key={o.id}>
                              {o.serviceOn} ·{" "}
                              {o.action === "clear"
                                ? "Normal schedule restored"
                                : o.action}{" "}
                              · {o.reason}
                            </Text>
                          ))}
                      </>
                    ) : null}
                  </View>
                );
              })
            )}
            {data.plans.length ? (
              <View style={s.scheduleSection}>
                <Text style={s.sectionTitle}>Planned deliveries</Text>
                <Text style={s.small}>
                  Actual deliveries and charges are recorded separately.
                </Text>
                <Choice
                  label="Plan"
                  options={data.plans.map((p) => ({
                    id: p.id,
                    label: p.revisions.at(-1)!.label,
                  }))}
                  value={planId}
                  onChange={setPlanId}
                />
                <DateField
                  label="Week starting"
                  value={from}
                  onChange={setFrom}
                />
                {loadingPreview ? (
                  <ActivityIndicator color="#174d3b" />
                ) : scheduleError ? (
                  <Text accessibilityRole="alert" style={s.error}>
                    {scheduleError}
                  </Text>
                ) : preview ? (
                  <ScheduleRows preview={preview} />
                ) : null}
              </View>
            ) : null}
            {editor ? (
              <LifecycleForm
                key={
                  editor.kind +
                  "-" +
                  (editor.plan?.id || data.customer.id) +
                  "-" +
                  (editor.pauseId || "")
                }
                editor={editor}
                customer={data.customer}
                planCount={data.plans.length}
                serviceType={serviceType}
                session={session}
                onClose={() => setEditor(null)}
                onSaved={() => {
                  setEditor(null);
                  setNotice("Saved. Your delivery schedule is up to date.");
                  setRevision((v) => v + 1);
                }}
              />
            ) : null}
          </>
        )}
        {data && accountingEnabled ? (
          <CustomerAccount customerId={customerId} session={session} />
        ) : null}
        <Text style={s.footer}>DailyLoop · Every delivery counts.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
function LifecycleForm({
  editor,
  customer,
  planCount,
  serviceType,
  session,
  onClose,
  onSaved,
}: {
  editor: Editor;
  customer: Customer;
  planCount: number;
  serviceType: string;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { kind, plan } = editor,
    latest = plan?.revisions.at(-1),
    today = todayIST(),
    pause = plan?.pauses.find((p) => p.id === editor.pauseId);
  const start = plan && plan.startOn > today ? plan.startOn : today;
  const [draft, setDraft] = useState<Record<string, string>>({
    name: customer.name,
    address: customer.address,
    phone: customer.phone,
    label: latest?.label || "",
    unit: plan?.unit || (serviceType === "tiffin" ? "meal" : "litre"),
    quantity: latest ? String(latest.quantityMilli / 1000) : "1",
    rate: latest ? decimal(latest.ratePaise) : "",
    startOn: today,
    effectiveFrom:
      latest && shiftDate(latest.effectiveFrom, 1) > shiftDate(today, 1)
        ? shiftDate(latest.effectiveFrom, 1)
        : shiftDate(today, 1),
    fromOn: start,
    toOn: shiftDate(start, 6),
    resumeOn: pause && pause.fromOn > today ? pause.fromOn : today,
    serviceOn: start,
    endOn: start,
    effectiveOn: today,
    action: "skip",
    reason: "",
  });
  const [weekdays, setWeekdays] = useState(
      latest?.weekdays || [0, 1, 2, 3, 4, 5, 6],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [review, setReview] = useState<{
      path: string;
      body: unknown;
      method: "POST" | "PATCH" | "PUT";
      preview?: SchedulePreview;
    } | null>(null);
  const operation = useRef<{ body: string; key: string } | null>(null);
  const set = (key: string) => (value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  async function prepare() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let path = "",
        body: unknown,
        method: "POST" | "PATCH" | "PUT" = "POST",
        change: SchedulePreviewInput["change"];
      if (kind === "edit") {
        path = `/v1/customers/${customer.id}`;
        method = "PATCH";
        body = EditCustomerInput.parse({
          name: draft.name,
          address: draft.address,
          phone: draft.phone,
          expectedVersion: customer.version,
          reason: draft.reason,
        });
      } else if (kind === "archive") {
        path = `/v1/customers/${customer.id}/archive`;
        body = ArchiveCustomerInput.parse({
          expectedVersion: customer.version,
          effectiveOn: draft.effectiveOn,
          reason: draft.reason,
        });
      } else if (kind === "create" || kind === "revision") {
        const common = {
          label: draft.label,
          quantityMilli: decimalToScaled(draft.quantity, 1000),
          ratePaise: String(decimalToScaled(draft.rate, 100)),
          weekdays,
        };
        if (kind === "create") {
          path = `/v1/customers/${customer.id}/plans`;
          body = PlanCreate.parse({
            ...common,
            unit: draft.unit,
            startOn: draft.startOn,
          });
        } else {
          path = `/v1/plans/${plan!.id}/revisions`;
          const input = PlanRevisionInput.parse({
            ...common,
            expectedVersion: plan!.version,
            effectiveFrom: draft.effectiveFrom,
            reason: draft.reason,
          });
          body = input;
          change = { type: "revision", input };
        }
      } else if (kind === "pause") {
        path = `/v1/plans/${plan!.id}/pauses`;
        const input = PauseInput.parse({
          expectedVersion: plan!.version,
          fromOn: draft.fromOn,
          toOn: draft.toOn,
          reason: draft.reason,
        });
        body = input;
        change = { type: "pause", input };
      } else if (kind === "resume") {
        path = `/v1/plans/${plan!.id}/pauses/${editor.pauseId}/resume`;
        const input = ResumeInput.parse({
          expectedVersion: plan!.version,
          resumeOn: draft.resumeOn,
          reason: draft.reason,
        });
        body = input;
        change = { type: "resume", pauseId: editor.pauseId!, input };
      } else if (kind === "override") {
        path = `/v1/plans/${plan!.id}/override`;
        method = "PUT";
        const input = OverrideInput.parse({
          expectedVersion: plan!.version,
          serviceOn: draft.serviceOn,
          action: draft.action,
          ...(draft.action === "quantity"
            ? { quantityMilli: decimalToScaled(draft.quantity, 1000) }
            : {}),
          reason: draft.reason,
        });
        body = input;
        change = { type: "override", input };
      } else {
        path = `/v1/plans/${plan!.id}/end`;
        const input = EndPlanInput.parse({
          expectedVersion: plan!.version,
          endOn: draft.endOn,
          reason: draft.reason,
        });
        body = input;
        change = { type: "end", input };
      }
      let preview: SchedulePreview | undefined;
      if (kind === "create") {
        const input = body as PlanCreate;
        preview = await api<SchedulePreview>(
          "/v1/schedule/preview-new",
          session,
          {
            body: {
              customerId: customer.id,
              plan: input,
              from: input.startOn,
              to: shiftDate(input.startOn, 6),
            },
          },
        );
      } else if (change) {
        const date =
          kind === "revision"
            ? "effectiveFrom"
            : kind === "pause"
              ? "fromOn"
              : kind === "resume"
                ? "resumeOn"
                : kind === "end"
                  ? "endOn"
                  : "serviceOn";
        let from = draft[date];
        if (kind === "revision" || kind === "resume")
          from = from > today ? shiftDate(from, -1) : today;
        let to = shiftDate(from, 6);
        if (kind === "pause" && draft.toOn < to) to = draft.toOn;
        if (kind === "override") to = from;
        preview = await api<SchedulePreview>("/v1/schedule/preview", session, {
          body: { planId: plan!.id, from, to, change },
        });
      }
      setReview({ path, body, method, preview });
    } catch (e) {
      setError(
        e instanceof Error && "issues" in e
          ? String((e as { issues: { message: string }[] }).issues[0]?.message)
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ path: review.path, body: review.body });
      if (operation.current?.body !== body)
        operation.current = { body, key: randomUUID() };
      await api(review.path, session, {
        body: review.body,
        method: review.method,
        operationId: operation.current.key,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.header}>
            <Text style={s.modalTitle}>{titles[kind]}</Text>
            <Button label="Close" disabled={busy} onPress={onClose} />
          </View>
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.kicker}>{customer.name}</Text>
            {error ? (
              <Text style={s.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            {review ? (
              <>
                <Text style={s.sectionTitle}>Review before saving</Text>
                <Text style={s.small}>
                  Confirm the dates, quantities and rates below. The full date
                  range entered will be saved.
                </Text>
                {review.preview ? (
                  <ScheduleRows
                    preview={review.preview}
                    compare={Boolean(review.preview.before.length)}
                  />
                ) : (
                  <Text style={kind === "archive" ? s.warning : s.body}>
                    {kind === "archive"
                      ? `Archive ${customer.name} from ${draft.effectiveOn}. All ${planCount} recurring plans stop from that date. This cannot currently be undone.`
                      : `Update contact details for ${draft.name}.`}
                  </Text>
                )}
                <Button
                  label="Edit details"
                  disabled={busy}
                  onPress={() => setReview(null)}
                />
                <Button
                  primary
                  label={busy ? "Saving…" : "Confirm and save"}
                  disabled={busy}
                  onPress={confirm}
                />
              </>
            ) : (
              <>
                {kind === "edit" ? (
                  <>
                    <Field
                      label="Customer name"
                      value={draft.name}
                      onChange={set("name")}
                    />
                    <Field
                      label="Delivery address"
                      value={draft.address}
                      onChange={set("address")}
                    />
                    <Field
                      label="Phone (optional)"
                      value={draft.phone}
                      onChange={set("phone")}
                      phone
                    />
                  </>
                ) : null}
                {kind === "create" || kind === "revision" ? (
                  <>
                    <Field
                      label="Plan name / delivery slot"
                      value={draft.label}
                      onChange={set("label")}
                    />
                    <Field
                      label="Quantity"
                      value={draft.quantity}
                      onChange={set("quantity")}
                      numeric
                    />
                    {kind === "create" ? (
                      <Choice
                        label="Unit"
                        options={[
                          { id: "litre", label: "Litre · milk" },
                          { id: "meal", label: "Meal · whole numbers" },
                        ]}
                        value={draft.unit}
                        onChange={set("unit")}
                      />
                    ) : (
                      <Text style={s.small}>Unit: {plan!.unit}</Text>
                    )}
                    <Field
                      label="Rate per unit (₹)"
                      value={draft.rate}
                      onChange={set("rate")}
                      numeric
                    />
                    <Text style={s.label}>Delivery days</Text>
                    <View style={s.choices}>
                      {days.map((d, i) => (
                        <Pressable
                          key={d}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: weekdays.includes(i) }}
                          onPress={() =>
                            setWeekdays((old) =>
                              old.includes(i)
                                ? old.filter((v) => v !== i)
                                : [...old, i].sort(),
                            )
                          }
                          style={[s.choice, weekdays.includes(i) && s.chosen]}
                        >
                          <Text style={s.choiceText}>{d}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {kind === "create" ? (
                      <DateField
                        label="Starts on"
                        value={draft.startOn}
                        onChange={set("startOn")}
                      />
                    ) : (
                      <>
                        <DateField
                          label="New quantity / rate applies from"
                          value={draft.effectiveFrom}
                          onChange={set("effectiveFrom")}
                        />
                        <Text style={s.small}>
                          Earlier revisions are retained. The new date must
                          follow {latest!.effectiveFrom}.
                        </Text>
                      </>
                    )}
                  </>
                ) : null}
                {kind === "pause" ? (
                  <>
                    <DateField
                      label="Pause from"
                      value={draft.fromOn}
                      onChange={set("fromOn")}
                    />
                    <DateField
                      label="Through (inclusive)"
                      value={draft.toOn}
                      onChange={set("toOn")}
                    />
                  </>
                ) : null}
                {kind === "resume" ? (
                  <>
                    <Text style={s.small}>
                      Selected pause: {pause?.fromOn} — {pause?.toOn}. Earlier
                      paused dates stay unchanged. Other overlapping pauses may
                      still apply.
                    </Text>
                    <DateField
                      label="Resume on"
                      value={draft.resumeOn}
                      onChange={set("resumeOn")}
                    />
                  </>
                ) : null}
                {kind === "override" ? (
                  <>
                    <DateField
                      label="Delivery date"
                      value={draft.serviceOn}
                      onChange={set("serviceOn")}
                    />
                    <Choice
                      label="Change this date only"
                      options={[
                        { id: "skip", label: "Skip" },
                        { id: "quantity", label: "Different quantity" },
                        { id: "resume", label: "Deliver even if paused" },
                        { id: "clear", label: "Normal schedule" },
                      ]}
                      value={draft.action}
                      onChange={set("action")}
                    />
                    {draft.action === "quantity" ? (
                      <Field
                        label={"Quantity (" + plan!.unit + ")"}
                        numeric
                        value={draft.quantity}
                        onChange={set("quantity")}
                      />
                    ) : null}
                    <Text style={s.small}>
                      One-day changes can override a pause or weekday. They
                      cannot restart an ended plan or archived customer.
                    </Text>
                  </>
                ) : null}
                {kind === "end" ? (
                  <>
                    <DateField
                      label="Last delivery date (inclusive)"
                      value={draft.endOn}
                      onChange={set("endOn")}
                    />
                    <Text style={s.small}>
                      Deliveries stop after this date. Plan history is retained.
                    </Text>
                  </>
                ) : null}
                {kind === "archive" ? (
                  <>
                    <DateField
                      label="Archive from"
                      value={draft.effectiveOn}
                      onChange={set("effectiveOn")}
                    />
                    <Text style={s.warning}>
                      All {planCount} plans stop from this date. Earlier history
                      remains. Archiving cannot currently be undone.
                    </Text>
                  </>
                ) : null}
                {kind !== "create" ? (
                  <Field
                    label="Reason for change"
                    value={draft.reason}
                    onChange={set("reason")}
                  />
                ) : null}
                <Button
                  primary
                  label={busy ? "Preparing preview…" : "Review changes"}
                  disabled={busy}
                  onPress={prepare}
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  customerSummary: {
    backgroundColor: colors.surface,
    padding: 22,
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTitle: { fontSize: 13, color: colors.ink },
  content: { padding: 22, gap: 18, paddingBottom: 40 },
  kicker: {
    fontSize: 13,
    color: colors.ink,
    fontWeight: "700",
    letterSpacing: 1.3,
  },
  title: {
    fontSize: 29,
    fontWeight: "600",
    letterSpacing: -0.7,
    color: colors.ink,
  },
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  small: { fontSize: 14, lineHeight: 19, color: colors.ink },
  sectionTitle: {
    fontSize: 21,
    fontWeight: "600",
    color: colors.ink,
    marginTop: 14,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
  },
  card: {
    backgroundColor: colors.surface,
    borderTopWidth: 3,
    borderTopColor: colors.primary,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    gap: 13,
  },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  quantity: { fontSize: 15, color: colors.ink, fontWeight: "500" },
  status: {
    alignSelf: "flex-start",
    fontSize: 13,
    textTransform: "capitalize",
    color: colors.ink,
    padding: 7,
    borderRadius: 12,
    backgroundColor: colors.soft,
  },
  scheduled: { backgroundColor: colors.soft, color: colors.ink },
  planNote: {
    fontSize: 13,
    color: colors.ink,
    padding: 12,
    lineHeight: 19,
    backgroundColor: colors.soft,
    borderRadius: 9,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    justifyContent: "center",
  },
  chosen: { backgroundColor: colors.soft, borderColor: colors.border },
  choiceText: { fontSize: 13, color: colors.ink },
  button: {
    backgroundColor: colors.surface,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  pause: {
    padding: 12,
    borderRadius: 9,
    backgroundColor: colors.soft,
    gap: 10,
  },
  history: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
    gap: 6,
  },
  rowDate: { fontSize: 13, fontWeight: "500", color: colors.ink },
  scheduleSection: {
    gap: 18,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 24,
  },
  scheduleRow: {
    backgroundColor: colors.surface,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    gap: 9,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
  },
  field: { gap: 9 },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink },
  input: {
    backgroundColor: colors.surface,
    fontSize: 16,
    padding: 13,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.ink,
  },
  error: {
    padding: 15,
    borderRadius: 10,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 21,
  },
  success: {
    padding: 15,
    borderRadius: 10,
    backgroundColor: colors.soft,
    color: colors.primary,
    fontSize: 13,
    lineHeight: 20,
  },
  warning: {
    padding: 15,
    borderRadius: 10,
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    fontSize: 13,
    lineHeight: 20,
  },
  footer: {
    fontSize: 13,
    color: colors.ink,
    textAlign: "center",
    marginTop: 25,
  },
});
