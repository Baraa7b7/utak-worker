// UTAK Delivery Note — إذن تسليم
// Uses the shared renderPDFShell — no prices, no totals.

import type { Env } from "./config";
import { call, resolvePackagingNames, stripRef } from "./odoo";
import { sendText } from "./meta";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  htmlToPDF,
  buildGotenbergFooterHtml,
  GOTENBERG_FOOTER_MARGIN,
  renderPDFShell,
  issuedSealHTML,
  signDocToken,
  uploadPDFToR2,
  type LegalFooterInfo,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";
import { readCompanyInfo, type CompanyInfo } from "./company";
import { toLegalFooterAr } from "./legal-footer";
import { UI, resolveDocLang, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, itemCellHTML, labelForBillTo, labelForFrom, labelForTerms, taglineFor, thanksLine } from "./doc-shell";

export interface DeliveryNoteItem {
  name: string;
  pack: string;
  qty: number;
  name_en?: string;
  pack_en?: string;
}

export interface DeliveryNotePDFData {
  deliveryNumber: string;
  deliveryDate: Date;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  items: DeliveryNoteItem[];
  lang?: DocLang;
  /** Issued document (numbered, sent / recorded). Only issued documents print
   *  the company seal + signature — never a preview or a draft. */
  issued?: boolean;
}

// Placeholder — round B will replace with the actual signature/whatsapp blocks.
const DELIVERY_NOTE_FOOTER =
  "سيصلكم رابط لتوقيع الاستلام مع رسالة واتساب تأكيدية بعد إتمام التسليم.";

// ---- Body: 3 columns only — no prices ----
export function renderDeliveryNoteBodyHTML(
  items: DeliveryNoteItem[],
  m?: PageMetrics,
  lang: DocLang = "ar",
): string {
  const metrics = m ?? computePageMetrics(items.length);
  const isAr = lang === "ar";
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const rowsHtml = items
    .map(
      (item) => {
        const nameCell = isAr ? escapeHTML(item.name) : itemCellHTML(item.name, item.name_en, lang);
        const packCell = isAr ? escapeHTML(item.pack) : itemCellHTML(item.pack, item.pack_en, lang);
        return `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCell}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${packCell}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
    </tr>
  `;
      },
    )
    .join("");

  const L = (key: "colItem" | "colPackaging" | "colQty") => (isEn ? UI[key].en : UI[key].ar);
  const th = (label: string, w: string, alignEn = false) =>
    `<th style="width: ${w}; text-align: ${isEn ? (alignEn ? "right" : "left") : (alignEn ? "left" : "right")}; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">${escapeHTML(label)}</th>`;

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          ${th(L("colItem"), "55%")}
          ${th(L("colPackaging"), "30%")}
          ${th(L("colQty"), "15%", true)}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

export function renderDeliveryNoteHTML(data: DeliveryNotePDFData, company?: CompanyInfo): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  const legalFooterBar: LegalFooterInfo | undefined = company
    ? toLegalFooterAr(company)
    : undefined;
  return renderPDFShell({
    documentTitle: lang === "en" ? UI.deliveryNote.en : UI.deliveryNote.ar,
    documentNumber: data.deliveryNumber,
    documentDate: data.deliveryDate,
    billTo,
    from: data.lang ? fromPartyFor(lang, company) : undefined,
    bodyHTML: renderDeliveryNoteBodyHTML(data.items, pageMetrics, lang),
    // no totalsHTML for delivery notes
    footerNote: lang === "en" ? UI.deliveryNoteHint.en : DELIVERY_NOTE_FOOTER,
    showZatcaQR: false,
    legalFooterBar,
    pageMetrics,
    lang: data.lang ? lang : undefined,
    tagline: data.lang ? taglineFor(lang) : undefined,
    billToLabel: data.lang ? labelForBillTo(lang) : undefined,
    fromLabel: data.lang ? labelForFrom(lang) : undefined,
    termsLabel: data.lang ? labelForTerms(lang) : undefined,
    thanksLine: data.lang ? thanksLine(lang, company) : undefined,
    footerSealHTML: issuedSealHTML(data.issued, company),
    sealBesideTotals: true,
    documentDateStr: lang === "en" ? formatDateEn(data.deliveryDate) : undefined,
  });
}

export async function generateDeliveryNotePDF(
  data: DeliveryNotePDFData,
  env: Env,
): Promise<Uint8Array> {
  const company = await readCompanyInfo(env);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  return await htmlToPDF(renderDeliveryNoteHTML(data, company), env, {
    footerHtml: buildGotenbergFooterHtml(lang),
    marginBottom: GOTENBERG_FOOTER_MARGIN,
  });
}

export async function uploadDeliveryNoteToR2(
  env: Env,
  pdfBytes: Uint8Array,
  deliveryNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  return await uploadPDFToR2(env, {
    pdfBytes,
    folder: "delivery-notes",
    urlPrefix: "delivery-note-pdf",
    docNumber: deliveryNumber,
    workerOrigin,
  });
}

// ---- Build from a real Odoo x_delivery_stop record ----
export async function buildDeliveryNotePDFDataFromOdoo(
  env: Env,
  deliveryStopId: number,
): Promise<DeliveryNotePDFData | null> {
  type StopRow = {
    id: number;
    x_order_id: [number, string] | false;
    x_sequence: number | false;
    create_date: string | false;
  };
  const rows = await call<StopRow[]>(env, "x_delivery_stop", "read", {
    ids: [deliveryStopId],
    fields: ["id", "x_order_id", "x_sequence", "create_date"],
  });
  const stop = rows[0];
  if (!stop) return null;
  if (!stop.x_order_id) {
    throw new Error(`Delivery stop ${deliveryStopId} has no linked order`);
  }
  const orderId = stop.x_order_id[0];

  type OrderRow = {
    id: number;
    x_customer_id: [number, string] | false;
    x_delivery_neighborhood: string | false;
    x_line_ids: number[];
  };
  const [order] = await call<OrderRow[]>(env, "x_daily_order", "read", {
    ids: [orderId],
    fields: ["id", "x_customer_id", "x_delivery_neighborhood", "x_line_ids"],
  });
  if (!order) throw new Error(`Order ${orderId} for stop ${deliveryStopId} not found`);

  let custName = "عميل";
  let custPhone = "";
  if (order.x_customer_id) {
    type Partner = { id: number; name: string; phone: string | false; x_whatsapp_number: string | false };
    const [partner] = await call<Partner[]>(env, "res.partner", "read", {
      ids: [order.x_customer_id[0]],
      fields: ["id", "name", "phone", "x_whatsapp_number"],
    });
    if (partner) {
      custName = partner.name || custName;
      custPhone = partner.x_whatsapp_number || partner.phone || "";
    }
  }

  type LineRow = {
    id: number;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
    x_status: string;
  };
  const lines = (order.x_line_ids && order.x_line_ids.length)
    ? await call<LineRow[]>(env, "x_daily_order_line", "read", {
        ids: order.x_line_ids,
        fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status"],
      })
    : [];

  const usable = lines.filter((l) => l.x_status !== "unavailable");
  const packagingNames = await resolvePackagingNames(
    env,
    usable.map((l) => ({
      packaging_id: l.x_packaging_id ? l.x_packaging_id[0] : 0,
      product_id: l.x_product_tmpl_id ? l.x_product_tmpl_id[0] : 0,
    })),
  );
  const items: DeliveryNoteItem[] = usable.map((l, i) => ({
    name: l.x_product_tmpl_id ? stripRef(l.x_product_tmpl_id[1]) : "?",
    pack: packagingNames[i],
    qty: l.x_quantity,
  }));

  const rawDate = stop.create_date as string | false;
  const deliveryDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();
  const deliveryNumber = `DLV-${new Date().getFullYear()}-${String(deliveryStopId).padStart(4, "0")}`;

  return {
    deliveryNumber,
    deliveryDate,
    customer: {
      name: custName,
      address: order.x_delivery_neighborhood || "الرياض",
      phone: custPhone,
    },
    items,
    // Built only when the stop is dispatched: an issued delivery note.
    issued: true,
  };
}

// ---- Verify a `/delivery-note-pdf/{num}/{tok}.pdf` signed token ----
export async function verifyDeliveryNoteToken(
  secret: string,
  deliveryNumber: string,
  token: string,
): Promise<boolean> {
  const expected = await signDocToken(secret, deliveryNumber);
  return expected === token;
}

// ---- Orchestrate: build → PDF → R2 → WhatsApp driver → write-back ----
export interface DeliveryNoteDispatchResult {
  stopId: number;
  number: string;
  pdfUrl: string;
  pdfSize: number;
  messageId: string | null;
  /** Set when opts.defer: the driver text, to be sent after «بدء الدوام». */
  deferredText?: string;
}

export async function createAndDispatchDeliveryNoteForStop(
  env: Env,
  stopId: number,
  driverPhone: string,
  // 2026-09-24 (م11) — a free-form text before the driver has tapped «بدء
  // الدوام» lands outside the 24h window and is dropped by Meta. With defer,
  // the PDF is built and archived now and the text is returned for the
  // caller to queue with the stop locations.
  opts: { defer?: boolean } = {},
): Promise<DeliveryNoteDispatchResult | null> {
  const data = await buildDeliveryNotePDFDataFromOdoo(env, stopId);
  if (!data) {
    console.warn(`[delivery-note] stop ${stopId} not found`);
    return null;
  }

  const pdfBytes = await generateDeliveryNotePDF(data, env);
  const uploaded = await uploadDeliveryNoteToR2(
    env,
    pdfBytes,
    data.deliveryNumber,
    env.WORKER_ORIGIN,
  );

  // Look up the linked order id to include in the driver-facing message.
  let orderId = 0;
  try {
    const rows = await call<Array<{ x_order_id: [number, string] | false }>>(
      env,
      "x_delivery_stop",
      "read",
      { ids: [stopId], fields: ["x_order_id"] },
    );
    if (rows[0]?.x_order_id) orderId = rows[0].x_order_id[0];
  } catch {
    /* non-fatal — the message just loses the order number */
  }

  let messageId: string | null = null;
  let deferredText: string | undefined;
  if (!driverPhone) {
    console.warn(`[delivery-note] stop ${stopId} — no driver phone, skipping send`);
  } else if (opts.defer) {
    deferredText = [
      `📦 إذن تسليم للطلب ${orderId || data.deliveryNumber}`,
      `العميل: ${data.customer.name}`,
      `الحي: ${data.customer.address}`,
      ``,
      `الوثيقة: ${uploaded.publicUrl}`,
    ].join("\n");
  } else {
    const body = [
      `📦 إذن تسليم للطلب ${orderId || data.deliveryNumber}`,
      `العميل: ${data.customer.name}`,
      `الحي: ${data.customer.address}`,
      ``,
      `الوثيقة: ${uploaded.publicUrl}`,
    ].join("\n");
    try {
      const resp = await sendText(env, driverPhone, body);
      if (resp?.ok) {
        try {
          const j = (await resp.json()) as { messages?: Array<{ id?: string }> };
          messageId = j?.messages?.[0]?.id ?? null;
        } catch {
          /* ignore parse error — Meta returned non-JSON */
        }
      }
    } catch (e) {
      console.warn(
        `[delivery-note] send failed for stop ${stopId}`,
        (e as Error)?.message,
      );
    }
  }

  // Warn-and-continue: a write-back failure must not undo a driver message
  // that already left the worker.
  try {
    await call<boolean>(env, "x_delivery_stop", "write", {
      ids: [stopId],
      vals: {
        x_delivery_note_number: data.deliveryNumber,
        x_delivery_note_url: uploaded.publicUrl,
        ...(opts.defer ? {} : { x_dn_sent_at: nowOdoo() }),
      },
    });
  } catch (e) {
    console.warn(
      `[delivery-note] write-back failed for stop ${stopId}`,
      (e as Error)?.message,
    );
  }

  return {
    stopId,
    number: data.deliveryNumber,
    pdfUrl: uploaded.publicUrl,
    pdfSize: uploaded.size,
    messageId,
    deferredText,
  };
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---- Test data — 5 items, no prices ----
export const TEST_DELIVERY_NOTE_DATA: DeliveryNotePDFData = {
  deliveryNumber: "DLV-2026-0091",
  deliveryDate: new Date("2026-09-08T10:00:00Z"),
  customer: {
    name: "مطعم النخيل",
    contactPerson: "أ. محمد الشمري",
    address: "العليا، الرياض",
    phone: "+966 55 214 8830",
  },
  items: [
    { name: "طماطم شيري كرزية درجة أولى", pack: "كرتون ٨ كجم", qty: 5 },
    { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8 },
    { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4 },
    { name: "بطاطس", pack: "كيس ٢٥ كجم", qty: 4 },
    { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 4 },
  ],
};
