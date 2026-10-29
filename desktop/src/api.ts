export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
};
export type Plan = {
  id: string;
  customerId: string;
  label: string;
  unit: string;
  quantityMilli: number;
  ratePaise: number;
  start: string;
  weekdays: number[];
};
export type Delivery = {
  id: string;
  status: string;
  quantityMilli: number;
  chargePaise: number;
};
export type Round = Plan & { customer: Customer; delivery: Delivery | null };
export type Payment = {
  id: string;
  customerId: string;
  date: string;
  amountPaise: number;
  method: string;
  note: string;
};
export type Workspace = {
  customers: Customer[];
  plans: Plan[];
  round: Round[];
  payments: Payment[];
  today: string;
  date: string;
};
export type Statement = {
  customer: Customer;
  from: string;
  to: string;
  openingPaise: number;
  chargesPaise: number;
  paymentsPaise: number;
  closingPaise: number;
  pending: number;
  rows: {
    id: string;
    date: string;
    description: string;
    chargePaise: number;
    paymentPaise: number;
  }[];
};
export const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    signal,
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Could not complete the request.");
  return data;
}
