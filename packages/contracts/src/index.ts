import { z } from "zod";

export const Id = z.uuid();
export const ServiceDate = z.iso.date();
export const Paise = z.string().regex(/^-?\d+$/);
export const BusinessInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    serviceType: z.enum(["milk", "tiffin", "mixed"]),
  })
  .strict();
export const CustomerInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z
      .string()
      .trim()
      .max(20)
      .refine(
        (v) => !v || /^[+\d ()-]{7,20}$/.test(v),
        "Enter a valid phone number.",
      )
      .default(""),
    address: z.string().trim().min(1).max(300),
  })
  .strict();
export const Business = BusinessInput.extend({
  id: Id,
  currency: z.literal("INR"),
  timezone: z.literal("Asia/Kolkata"),
  revision: z.number().int(),
});
export const Customer = CustomerInput.extend({
  id: Id,
  businessId: Id,
  version: z.number().int(),
  createdAt: z.string(),
  archivedEffectiveOn: ServiceDate.nullable(),
});
export const Me = z.object({
  user: z.object({ id: Id, email: z.string().nullable() }),
  business: Business.nullable(),
  csrfToken: z.string().optional(),
  features: z
    .object({
      planLifecycle: z.boolean(),
      accounting: z.boolean().optional(),
      workspace: z.boolean().optional(),
    })
    .optional(),
});
export const Setup = z.object({
  configured: z.boolean(),
  signInAvailable: z.boolean(),
  missing: z.array(z.string()),
  budget: z.literal("free-tier-first"),
});
export const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: Id.optional(),
  search: z.string().trim().max(100).default(""),
});
export const CustomerPage = z.object({
  items: z.array(Customer),
  nextCursor: Id.nullable(),
});
export type BusinessInput = z.infer<typeof BusinessInput>;
export type Business = z.infer<typeof Business>;
export type CustomerInput = z.infer<typeof CustomerInput>;
export type Customer = z.infer<typeof Customer>;
export type Me = z.infer<typeof Me>;
export type Setup = z.infer<typeof Setup>;
export type CustomerPage = z.infer<typeof CustomerPage>;
export type Page = z.infer<typeof Page>;
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
  requestId: string;
};

export const Reason = z
  .string()
  .trim()
  .min(3, "Add a reason (at least 3 characters).")
  .max(300);
export const Version = z.number().int().min(1);
export const Weekdays = z
  .array(z.number().int().min(0).max(6))
  .min(1, "Choose at least one delivery day.")
  .max(7)
  .refine((v) => new Set(v).size === v.length, "Choose each weekday once.");
export const QuantityMilli = z.number().int().min(1).max(100000000);
export const RatePaise = z
  .string()
  .regex(/^[1-9]\d*$/, "Enter a positive rate.")
  .refine((v) => BigInt(v) <= 10000000n, "Rate cannot exceed ₹100,000.");
export const PlanCreate = z
  .object({
    label: z.string().trim().min(1).max(120),
    unit: z.enum(["litre", "meal"]),
    quantityMilli: QuantityMilli,
    ratePaise: RatePaise,
    weekdays: Weekdays,
    startOn: ServiceDate,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.unit === "meal" && v.quantityMilli % 1000)
      ctx.addIssue({
        code: "custom",
        path: ["quantityMilli"],
        message: "Meal quantities must be whole numbers.",
      });
  });
export const PlanRevisionInput = z
  .object({
    expectedVersion: Version,
    effectiveFrom: ServiceDate,
    label: z.string().trim().min(1).max(120),
    quantityMilli: QuantityMilli,
    ratePaise: RatePaise,
    weekdays: Weekdays,
    reason: Reason,
  })
  .strict();
export const PauseInput = z
  .object({
    expectedVersion: Version,
    fromOn: ServiceDate,
    toOn: ServiceDate,
    reason: Reason,
  })
  .strict()
  .refine((v) => v.fromOn <= v.toOn, {
    message: "End date must be on or after start date.",
    path: ["toOn"],
  });
export const ResumeInput = z
  .object({ expectedVersion: Version, resumeOn: ServiceDate, reason: Reason })
  .strict();
export const OverrideInput = z
  .object({
    expectedVersion: Version,
    serviceOn: ServiceDate,
    action: z.enum(["skip", "resume", "quantity", "clear"]),
    quantityMilli: QuantityMilli.optional(),
    reason: Reason,
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === "quantity") !== (v.quantityMilli !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["quantityMilli"],
        message:
          v.action === "quantity"
            ? "Enter the quantity for this date."
            : "Quantity is only allowed for a quantity change.",
      });
  });
export const EndPlanInput = z
  .object({ expectedVersion: Version, endOn: ServiceDate, reason: Reason })
  .strict();
export const ArchiveCustomerInput = z
  .object({
    expectedVersion: Version,
    effectiveOn: ServiceDate,
    reason: Reason,
  })
  .strict();
export const EditCustomerInput = CustomerInput.extend({
  expectedVersion: Version,
  reason: Reason,
}).strict();
export type PlanCreate = z.infer<typeof PlanCreate>;
export type PlanRevisionInput = z.infer<typeof PlanRevisionInput>;
export type PauseInput = z.infer<typeof PauseInput>;
export type ResumeInput = z.infer<typeof ResumeInput>;
export type OverrideInput = z.infer<typeof OverrideInput>;
export type EndPlanInput = z.infer<typeof EndPlanInput>;
export type ArchiveCustomerInput = z.infer<typeof ArchiveCustomerInput>;
export type EditCustomerInput = z.infer<typeof EditCustomerInput>;
export type PlanRevision = {
  id: string;
  effectiveFrom: string;
  label: string;
  quantityMilli: number;
  ratePaise: string;
  weekdays: number[];
  reason: string;
};
export type PauseRange = {
  id: string;
  fromOn: string;
  toOn: string;
  resumeOn: string | null;
  reason: string;
};
export type DateOverride = {
  id: string;
  serviceOn: string;
  action: "skip" | "resume" | "quantity" | "clear";
  quantityMilli: number | null;
  planVersion: number;
  reason: string;
};
export type RecurringPlan = {
  id: string;
  customerId: string;
  unit: "litre" | "meal";
  startOn: string;
  endOn: string | null;
  version: number;
  revisions: PlanRevision[];
  pauses: PauseRange[];
  overrides: DateOverride[];
};
export type CustomerPlans = {
  customer: Customer;
  plans: RecurringPlan[];
  today: string;
};
export type ScheduleDay = {
  date: string;
  status:
    | "scheduled"
    | "not_scheduled"
    | "paused"
    | "skipped"
    | "ended"
    | "archived"
    | "not_started";
  label: string;
  unit: "litre" | "meal";
  quantityMilli: number;
  ratePaise: string;
  source: "weekday" | "override" | "pause" | "lifetime";
  revisionId: string | null;
};
export const ScheduleChange = z.discriminatedUnion("type", [
  z.object({ type: z.literal("revision"), input: PlanRevisionInput }),
  z.object({ type: z.literal("pause"), input: PauseInput }),
  z.object({ type: z.literal("override"), input: OverrideInput }),
  z.object({ type: z.literal("end"), input: EndPlanInput }),
  z.object({ type: z.literal("resume"), pauseId: Id, input: ResumeInput }),
]);
export const SchedulePreviewInput = z
  .object({
    planId: Id,
    from: ServiceDate,
    to: ServiceDate,
    change: ScheduleChange.optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End date must follow start date.",
  });
export type SchedulePreviewInput = z.infer<typeof SchedulePreviewInput>;
export type SchedulePreview = {
  planId: string;
  planVersion: number;
  businessRevision: number;
  before: ScheduleDay[];
  after: ScheduleDay[];
};
export function todayIST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function shiftDate(day: string, offset: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function decimalToScaled(value: string, scale: 100 | 1000): number {
  const digits = scale === 100 ? 2 : 3;
  const pattern = new RegExp("^\\d+(?:\\.\\d{1," + digits + "})?$");
  if (!pattern.test(value.trim()))
    throw new Error(
      "Use a positive number with at most " + digits + " decimal places.",
    );
  const [whole, fraction = ""] = value.trim().split(".");
  const result = Number(
    BigInt(whole) * BigInt(scale) + BigInt(fraction.padEnd(digits, "0")),
  );
  if (!Number.isSafeInteger(result) || result <= 0 || result > 100000 * scale)
    throw new Error("Value must be positive and no more than 100,000.");
  return result;
}
export function formatPaise(value: string) {
  const amount = BigInt(value),
    negative = amount < 0n,
    absolute = negative ? -amount : amount;
  return (
    (negative ? "-" : "") +
    "₹" +
    (absolute / 100n).toLocaleString("en-IN") +
    "." +
    (absolute % 100n).toString().padStart(2, "0")
  );
}

export const NewPlanPreviewInput = z
  .object({
    customerId: Id,
    plan: PlanCreate,
    from: ServiceDate,
    to: ServiceDate,
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End date must follow start date.",
  });
export type NewPlanPreviewInput = z.infer<typeof NewPlanPreviewInput>;

// M3: all monetary JSON values are decimal integer strings.
export const FinancialAmount = z
  .string()
  .regex(/^-?[1-9]\d*$/)
  .refine((v) => {
    const n = BigInt(v);
    return n >= -1000000000000n && n <= 1000000000000n;
  }, "Amount is outside the supported range.");
export const FinancialDate = ServiceDate.refine(
  (v) => v <= todayIST(),
  "Choose today or an earlier date.",
).refine((v) => v >= "2000-01-01", "Choose a date from 2000 onward.");
export const Outcome = z.enum(["delivered", "skipped", "missed"]);
export const DeliveryValues = z
  .object({
    status: Outcome,
    quantityMilli: z.number().int().min(0).max(100000000),
    reason: Reason,
  })
  .strict()
  .refine(
    (v) =>
      v.status === "delivered" ? v.quantityMilli > 0 : v.quantityMilli === 0,
    "Delivered needs a positive quantity; skipped/missed use zero.",
  );
export const ConfirmDelivery = z
  .object({
    planId: Id,
    serviceOn: FinancialDate,
    scheduleRevision: z.number().int().positive(),
    expectedVersion: z.literal(0),
    ...DeliveryValues.shape,
  })
  .strict()
  .refine(
    (v) =>
      v.status === "delivered" ? v.quantityMilli > 0 : v.quantityMilli === 0,
    "Check the outcome and actual quantity.",
  );
export const CorrectDelivery = z
  .object({ expectedVersion: Version, ...DeliveryValues.shape })
  .strict()
  .refine(
    (v) =>
      v.status === "delivered" ? v.quantityMilli > 0 : v.quantityMilli === 0,
    "Check the outcome and actual quantity.",
  );
export const ReceiptInput = z
  .object({
    customerId: Id,
    effectiveOn: FinancialDate,
    amountPaise: FinancialAmount.refine(
      (v) => BigInt(v) > 0,
      "Receipt must be positive.",
    ),
    method: z.enum(["cash", "upi", "bank"]),
    reason: Reason,
  })
  .strict();
export const ReversalInput = z
  .object({ reason: Reason, expectedVersion: z.literal(1) })
  .strict();
export const OpeningInput = z
  .object({
    expectedVersion: z.number().int().min(0),
    cutoverOn: FinancialDate,
    amountPaise: FinancialAmount.or(z.literal("0")),
    reason: Reason,
  })
  .strict();
export const Period = z
  .object({
    from: ServiceDate,
    to: ServiceDate,
    after: Id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(
    (v) =>
      v.from <= v.to &&
      v.from >= "2000-01-01" &&
      v.to <= todayIST() &&
      (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 365,
    "Choose an ordered period up to 366 days, ending today or earlier.",
  );
export type ConfirmDelivery = z.infer<typeof ConfirmDelivery>;
export type CorrectDelivery = z.infer<typeof CorrectDelivery>;
export type ReceiptInput = z.infer<typeof ReceiptInput>;
export type OpeningInput = z.infer<typeof OpeningInput>;
export type Period = z.infer<typeof Period>;
export type DeliveryRecord = {
  id: string;
  planId: string;
  customerId: string;
  customerName: string;
  serviceOn: string;
  version: number;
  eventId: string;
  status: z.infer<typeof Outcome>;
  quantityMilli: number;
  ratePaise: string;
  chargePaise: string;
  unit: "meal" | "litre";
  label: string;
  reason: string;
  actorId: string;
  recordedAt: string;
};
export type RoundStop = {
  planId: string;
  customerId: string;
  customerName: string;
  address: string;
  schedule: ScheduleDay;
  record: DeliveryRecord | null;
};
export type Round = {
  date: string;
  businessRevision: number;
  stops: RoundStop[];
  nextCursor: string | null;
};
export type MoneyEvent = {
  id: string;
  customerId: string;
  kind: "opening" | "receipt" | "reversal";
  amountPaise: string;
  method: string | null;
  effectiveOn: string;
  reversesEventId: string | null;
  reason: string;
  actorId: string;
  recordedAt: string;
  reversed: boolean;
};
export type LedgerLine = {
  id: string;
  date: string;
  amountPaise: string;
  role: string;
  description: string;
  recordedAt: string;
  sourceId: string;
};
export type Statement = {
  customer: Customer;
  businessName: string;
  from: string;
  to: string;
  openingPaise: string;
  chargesPaise: string;
  adjustmentsPaise: string;
  receiptsPaise: string;
  reversalsPaise: string;
  closingPaise: string;
  unresolved: number;
  businessRevision: number;
  generatedAt: string;
  lines: LedgerLine[];
  nextCursor: string | null;
  openingBalance: {
    version: number;
    cutoverOn: string;
    amountPaise: string;
  } | null;
};

export const BusinessEditInput = BusinessInput.extend({
  expectedRevision: z.number().int().positive(),
}).strict();
export const OwnerRequestInput = z
  .object({
    kind: z.enum(["support", "deletion"]),
    message: z.string().trim().min(3).max(2000),
    confirmation: z.string().optional(),
  })
  .strict()
  .refine(
    (v) => v.kind !== "deletion" || v.confirmation === "DELETE MY ACCOUNT",
    "Type DELETE MY ACCOUNT to request deletion.",
  );
export type BusinessEditInput = z.infer<typeof BusinessEditInput>;
export type OwnerRequestInput = z.infer<typeof OwnerRequestInput>;
export type OwnerRequest = {
  id: string;
  kind: "support" | "deletion";
  message: string;
  status: "open" | "cancelled" | "resolved";
  createdAt: string;
  updatedAt: string;
};
