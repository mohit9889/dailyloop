import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Statement } from "@dailyloop/contracts";
// Use INR instead of an unsupported currency glyph in tabular interchange.
export const decimalMoney = (value: string) => {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
};
export const csvCell = (value: unknown) => {
  if (value && typeof value === "object" && "decimal" in value) {
    const number = String(value.decimal);
    if (!/^-?\d+\.\d{2}$/.test(number)) throw new Error("Invalid CSV amount.");
    return '"' + number + '"';
  }
  let s = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function statementCsv(s: Statement) {
  const rows: unknown[][] = [
    ["DailyLoop customer statement"],
    ["Business", s.businessName],
    ["Customer", s.customer.name],
    ["Customer ID", s.customer.id],
    ["Period", s.from, s.to],
    ["Statement version", s.businessRevision],
    ["Generated UTC", s.generatedAt],
    ["Unresolved past deliveries", s.unresolved],
    ["Currency", "INR"],
    ["Opening before period", { decimal: decimalMoney(s.openingPaise) }],
    ["Charges", { decimal: decimalMoney(s.chargesPaise) }],
    ["Adjustments", { decimal: decimalMoney(s.adjustmentsPaise) }],
    ["Receipts", { decimal: decimalMoney(s.receiptsPaise) }],
    ["Receipt reversals", { decimal: decimalMoney(s.reversalsPaise) }],
    [
      "Closing balance (negative means credit)",
      { decimal: decimalMoney(s.closingPaise) },
    ],
    [],
    [
      "Service date",
      "Description",
      "Signed amount INR",
      "Recorded UTC",
      "Source reference",
    ],
    ...s.lines.map((l) => [
      l.date,
      l.description,
      { decimal: decimalMoney(l.amountPaise) },
      l.recordedAt,
      l.sourceId,
    ]),
  ];
  return (
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
  );
}
export async function statementPdf(s: Statement): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: "DailyLoop customer statement",
      Author: s.businessName,
      Subject: `${s.from} through ${s.to} · version ${s.businessRevision}`,
    },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont(
    "Noto",
    fileURLToPath(new URL("../../assets/fonts/NotoSans.ttf", import.meta.url)),
  );
  doc.font("Noto");
  const width = doc.page.width - 84;
  const heading = () => {
    SVGtoPDF(
      doc,
      readFileSync(
        new URL(
          "../../../desktop/public/brand/dailyloop-logo.svg",
          import.meta.url,
        ),
        "utf8",
      ),
      42,
      32,
      { width: 160, height: 40, preserveAspectRatio: "xMinYMin meet" },
    );
    doc.font("Noto").fontSize(11).text("Customer statement", 42, 76);
    doc.moveDown();
    doc
      .fillColor("#203D31")
      .fontSize(10)
      .text(s.businessName)
      .text(s.customer.name)
      .text(s.customer.address)
      .text(`Customer ${s.customer.id}`)
      .text(`Period ${s.from} through ${s.to}`)
      .text(`Version ${s.businessRevision} · Generated ${s.generatedAt} (UTC)`);
    doc.moveDown();
  };
  heading();
  doc
    .fontSize(10)
    .fillColor(s.unresolved ? "#765719" : "#203D31")
    .text(
      s.unresolved
        ? `PROVISIONAL: ${s.unresolved} past deliveries remain unresolved. Estimated amounts are excluded.`
        : "No unresolved past deliveries in this period.",
      { width },
    );
  doc.moveDown();
  for (const [label, amount] of [
    ["Opening before period", s.openingPaise],
    ["Charges", s.chargesPaise],
    ["Adjustments", s.adjustmentsPaise],
    ["Receipts (subtract)", s.receiptsPaise],
    ["Receipt reversals", s.reversalsPaise],
    ["Closing balance", s.closingPaise],
  ]) {
    doc
      .fillColor("#203D31")
      .fontSize(10)
      .text(`${label}: INR ${decimalMoney(amount)}`);
  }
  doc
    .fontSize(9)
    .text(
      "A negative closing balance is customer credit. This is a bookkeeping statement, not a tax invoice.",
    );
  doc.moveDown();
  const tableHeader = () => {
    const y = doc.y;
    doc.rect(42, y, width, 24).fill("#EDF3E8");
    doc
      .fillColor("#174D3B")
      .fontSize(9)
      .text("Date", 48, y + 6)
      .text("Description", 125, y + 6)
      .text("Amount INR", 435, y + 6, { width: 105, align: "right" });
    doc.y = y + 32;
  };
  tableHeader();
  for (const l of s.lines) {
    doc.fontSize(9);
    const amount = decimalMoney(l.amountPaise);
    const description = l.description;
    const rowHeight = Math.max(
      26,
      doc.heightOfString(description, { width: 280 }) + 14,
      doc.heightOfString(amount, { width: 90 }) + 14,
    );
    if (doc.y + rowHeight > doc.page.height - 70) {
      doc.addPage();
      doc.font("Noto");
      doc
        .fillColor("#174D3B")
        .fontSize(10)
        .text(
          `${s.customer.name} · ${s.from} through ${s.to} · v${s.businessRevision}`,
        );
      doc.moveDown();
      tableHeader();
    }
    const y = doc.y;
    doc
      .fillColor("#203D31")
      .fontSize(9)
      .text(l.date, 48, y, { width: 70 })
      .text(description, 125, y, { width: 280 })
      .text(amount, 435, y, { width: 105, align: "right" });
    doc.y = y + rowHeight;
    doc
      .moveTo(42, doc.y - 5)
      .lineTo(42 + width, doc.y - 5)
      .strokeColor("#DCE5DC")
      .stroke();
  }
  if (!s.lines.length)
    doc.fontSize(10).text("No entries in this period.", 42, doc.y, { width });
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Noto")
      .fillColor("#5A6D62")
      .fontSize(8)
      .text(`DailyLoop · ${i + 1} / ${pages.count}`, 42, doc.page.height - 26, {
        width,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return result;
}
