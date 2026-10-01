// One-off: renders قائمة الدخل التقديرية (Projected Income Statement) PDF
// via the locked renderPDFShell + Gotenberg pipeline. Attachment for the
// ZATCA VAT registration filing.
//
// NOT bundled with the worker (scripts/**/*.ts sits outside tsconfig include
// and outside wrangler main). Not committed — .env.zatca-oneoff and the
// output PDF are both ignored.
//
// Env (read from .env.zatca-oneoff, never logged):
//   GOTENBERG_URL, GOTENBERG_USER, GOTENBERG_PASSWORD

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  BRAND_COLORS,
  renderPDFShell,
  type PageMetrics,
  type PartyInfo,
} from "../../src/pdf-template";

// ---------------------------------------------------------------------------
// env loader — mirrors scripts/sim-fixture.ts; secrets stay off argv/logs
// ---------------------------------------------------------------------------
(function loadEnvFile() {
  const path = resolve(process.cwd(), ".env.zatca-oneoff");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
})();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `FATAL: ${name} missing from .env.zatca-oneoff and shell environment`,
    );
    process.exit(2);
  }
  return v;
}

const GOTENBERG_URL = requireEnv("GOTENBERG_URL");
const GOTENBERG_USER = requireEnv("GOTENBERG_USER");
const GOTENBERG_PASSWORD = requireEnv("GOTENBERG_PASSWORD");

// ---------------------------------------------------------------------------
// Locked data (must not drift from the task spec)
// ---------------------------------------------------------------------------
type Row =
  | {
      kind: "line";
      label: string;
      monthly: number;
      yearly: number;
      isSubtotal?: boolean;
    }
  | { kind: "subheader"; label: string }
  | { kind: "net"; label: string; monthly: number; yearly: number };

const revenueBlock: Row[] = [
  {
    kind: "line",
    label: "المبيعات (إيرادات بيع الخضار والفواكه بالجملة)",
    monthly: 40000,
    yearly: 480000,
  },
  {
    kind: "line",
    label: "إجمالي الإيرادات",
    monthly: 40000,
    yearly: 480000,
    isSubtotal: true,
  },
  {
    kind: "line",
    label: "تكلفة البضاعة المباعة (مشتريات من السوق والموردين)",
    monthly: 30000,
    yearly: 360000,
  },
  {
    kind: "line",
    label: "مجمل الربح",
    monthly: 10000,
    yearly: 120000,
    isSubtotal: true,
  },
];

const opexHeader: Row = { kind: "subheader", label: "المصاريف التشغيلية" };

const opexLines: Row[] = [
  { kind: "line", label: "الرواتب والأجور", monthly: 8000, yearly: 96000 },
  {
    kind: "line",
    label: "النقل والتوصيل (شاحنات مبردة بالتعاقد)",
    monthly: 3000,
    yearly: 36000,
  },
  { kind: "line", label: "الإيجار والعنوان التجاري", monthly: 1000, yearly: 12000 },
  {
    kind: "line",
    label: "الرسوم الحكومية والتراخيص",
    monthly: 833,
    yearly: 10000,
  },
  { kind: "line", label: "مواد التغليف والتعبئة", monthly: 800, yearly: 9600 },
  {
    kind: "line",
    label: "الأنظمة والاشتراكات التقنية",
    monthly: 500,
    yearly: 6000,
  },
  { kind: "line", label: "التسويق", monthly: 500, yearly: 6000 },
  { kind: "line", label: "مصاريف أخرى", monthly: 400, yearly: 4800 },
];

const opexTotal: Row = {
  kind: "line",
  label: "إجمالي المصاريف التشغيلية",
  monthly: 15033,
  yearly: 180400,
  isSubtotal: true,
};

const netRow: Row = {
  kind: "net",
  label: "صافي الربح / (الخسارة) المتوقع",
  monthly: -5033,
  yearly: -60400,
};

// ---------------------------------------------------------------------------
// Math validation — halts if any spec figure fails to reconcile
// ---------------------------------------------------------------------------
(function validateMath() {
  const errs: string[] = [];

  const revYearly = 480000;
  const cogsYearly = 360000;
  const grossYearly = revYearly - cogsYearly;
  if (grossYearly !== 120000) {
    errs.push(`gross profit yearly: ${grossYearly} !== 120000`);
  }

  const opexMonthlySum = opexLines.reduce(
    (s, r) => s + (r.kind === "line" ? r.monthly : 0),
    0,
  );
  const opexYearlySum = opexLines.reduce(
    (s, r) => s + (r.kind === "line" ? r.yearly : 0),
    0,
  );
  if (opexMonthlySum !== 15033) {
    errs.push(`opex monthly sum: ${opexMonthlySum} !== 15033`);
  }
  if (opexYearlySum !== 180400) {
    errs.push(`opex yearly sum: ${opexYearlySum} !== 180400`);
  }

  const netMonthly = 10000 - 15033;
  const netYearly = 120000 - 180400;
  if (netMonthly !== -5033) errs.push(`net monthly: ${netMonthly} !== -5033`);
  if (netYearly !== -60400) errs.push(`net yearly: ${netYearly} !== -60400`);

  if (errs.length) {
    console.error("FATAL: math validation failed:\n  " + errs.join("\n  "));
    process.exit(3);
  }
})();

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
function fmtNum(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US");
  return n < 0 ? `(${abs})` : abs;
}

function renderRow(r: Row): string {
  if (r.kind === "subheader") {
    return `<tr>
      <td colspan="3" style="padding: 12px 4px 6px 4px; font-size: 11px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em; text-align: right; border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">${r.label}</td>
    </tr>`;
  }
  if (r.kind === "net") {
    return `<tr>
      <td style="padding: 12px 4px; font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.primary}; text-align: right; border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; background: rgba(30,90,65,0.06);">${r.label}</td>
      <td style="padding: 12px 4px; font-size: 13px; font-weight: 500; color: ${BRAND_COLORS.primary}; text-align: left; direction: ltr; border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; background: rgba(30,90,65,0.06);">${fmtNum(r.monthly)}</td>
      <td style="padding: 12px 4px; font-size: 13px; font-weight: 500; color: ${BRAND_COLORS.primary}; text-align: left; direction: ltr; border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; background: rgba(30,90,65,0.06);">${fmtNum(r.yearly)}</td>
    </tr>`;
  }
  const weight = r.isSubtotal ? "500" : "400";
  const bg = r.isSubtotal ? "rgba(30,90,65,0.035)" : "transparent";
  const prefix = r.isSubtotal ? "= " : "";
  return `<tr style="background: ${bg};">
    <td style="padding: 7px 4px; font-size: 12px; font-weight: ${weight}; text-align: right; border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">${prefix}${r.label}</td>
    <td style="padding: 7px 4px; font-size: 12px; font-weight: ${weight}; text-align: left; direction: ltr; border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">${fmtNum(r.monthly)}</td>
    <td style="padding: 7px 4px; font-size: 12px; font-weight: ${weight}; text-align: left; direction: ltr; border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">${fmtNum(r.yearly)}</td>
  </tr>`;
}

const allRows: Row[] = [
  ...revenueBlock,
  opexHeader,
  ...opexLines,
  opexTotal,
  netRow,
];

const bodyHTML = `
  <!-- projected badge -->
  <div style="display: flex; justify-content: center; margin-bottom: 12px;">
    <div style="padding: 5px 14px; font-size: 11px; font-weight: 500; color: ${BRAND_COLORS.primary}; background: rgba(30,90,65,0.08); border: 0.5px solid ${BRAND_COLORS.primary}; border-radius: 4px; letter-spacing: 0.04em;">
      تقديرية — لأول ١٢ شهراً من تاريخ التسجيل في ضريبة القيمة المضافة
    </div>
  </div>

  <!-- three-column table -->
  <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
    <thead>
      <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
        <th style="width: 60%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em; padding: 8px 4px;">البند</th>
        <th style="width: 20%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em; padding: 8px 4px;">شهرياً (ريال)</th>
        <th style="width: 20%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em; padding: 8px 4px;">سنوياً (ريال)</th>
      </tr>
    </thead>
    <tbody>${allRows.map(renderRow).join("")}</tbody>
  </table>

  <!-- notes -->
  <div style="margin-top: 16px; font-size: 10px; color: ${BRAND_COLORS.inkMuted}; line-height: 1.7;">
    <div style="font-weight: 500; color: ${BRAND_COLORS.ink}; margin-bottom: 4px; font-size: 10.5px; letter-spacing: 0.08em;">ملاحظات</div>
    <ol style="margin: 0; padding-right: 18px;">
      <li>الشركة حديثة التأسيس (سجل تجاري صادر في سبتمبر ٢٠٢٦) ولم تبدأ نشاطها التجاري بعد، ولا توجد لها مبيعات أو قوائم مالية فعلية سابقة.</li>
      <li>المبيعات مقدَّرة على أساس حد أدنى ١٠ عملاء من قطاع الأعمال (مطاعم ومحلات)، بمعدل طلبية أسبوعية بمتوسط ١٬٠٠٠ ريال للعميل.</li>
      <li>تكلفة البضاعة مقدَّرة بنسبة ٧٥٪ من المبيعات، وفق هامش ربح إجمالي متوقع ٢٥٪.</li>
      <li>جميع المبالغ بالريال السعودي ولا تشمل ضريبة القيمة المضافة، وجميع المبيعات خاضعة للضريبة بالنسبة الأساسية.</li>
      <li>هذه القائمة تقديرية لأغراض دعم طلب التسجيل، والأرقام الفعلية قد تختلف.</li>
    </ol>
  </div>

`;

// ---------------------------------------------------------------------------
// Shell parameters
// ---------------------------------------------------------------------------
const billTo: PartyInfo = {
  name: "هيئة الزكاة والضريبة والجمارك",
  contactName: "مرفق طلب التسجيل في ضريبة القيمة المضافة",
};

const from: PartyInfo = {
  name: "يو تاك UTAK — شركة ذات مسؤولية محدودة",
  contactName: "المدير: البراء عبدالوهاب الوصابي",
  address: "الرياض، المملكة العربية السعودية",
};

// Custom metrics tuned for a single-page A4 statement (invoice defaults
// leave too much whitespace once badge + notes + signature block are stacked).
const pageMetrics: PageMetrics = {
  dense: false,
  gap: "18px",
  preTable: "18px",
  postTable: "12px",
  tailMin: "0px",
  thPad: "8px 0",
  rowHeight: "22px",
};

const rawHTML = renderPDFShell({
  documentTitle: "قائمة الدخل التقديرية",
  documentNumber: "EST-2026-001",
  documentDate: new Date("2026-09-22T12:00:00Z"),
  billTo,
  from,
  bodyHTML,
  // Locked shell forces a "شروط الدفع" label + "شكراً لثقتكم" line in the
  // footer. Neutralise the label's body text so it reads as a document-purpose
  // note instead of payment terms.
  footerNote:
    "قائمة تقديرية مُقدَّمة دعماً لطلب التسجيل في ضريبة القيمة المضافة. الأرقام الفعلية قد تختلف عن التقديرات.",
  showZatcaQR: false,
  pageMetrics,
});

// renderPDFShell exposes no party-label override — the "فاتورة إلى / BILL TO"
// string is hard-coded in the locked shell. Rewrite it in the generated HTML
// (verbatim, single occurrence) before handing off to Gotenberg. Fails loud
// if the shell ever renames the label so the mismatch surfaces here instead
// of on a shipped PDF.
const LOCKED_LABEL = "فاتورة إلى / BILL TO";
const NEW_LABEL = "إلى / TO";
const labelCount = rawHTML.split(LOCKED_LABEL).length - 1;
if (labelCount !== 1) {
  console.error(
    `FATAL: expected exactly 1 occurrence of "${LOCKED_LABEL}" in shell HTML, found ${labelCount}. The locked shell has changed — inspect src/pdf-template.ts before proceeding.`,
  );
  process.exit(4);
}
const html = rawHTML.replace(LOCKED_LABEL, NEW_LABEL);

// ---------------------------------------------------------------------------
// Render + save
//
// Gotenberg POST is inlined here (not htmlToPDF from src/pdf-template.ts)
// because Workers-era btoa() rejects non-Latin1 credentials — the password
// may contain UTF-8 bytes. Node's Buffer handles that natively without
// touching src/. Body form fields mirror htmlToPDF exactly.
// ---------------------------------------------------------------------------
async function main() {
  const formData = new FormData();
  formData.append(
    "files",
    new Blob([html], { type: "text/html" }),
    "index.html",
  );
  formData.append("paperWidth", "8.27");
  formData.append("paperHeight", "11.69");
  formData.append("marginTop", "0");
  formData.append("marginBottom", "0");
  formData.append("marginLeft", "0");
  formData.append("marginRight", "0");
  formData.append("printBackground", "true");
  formData.append("waitDelay", "2s");

  const auth =
    "Basic " +
    Buffer.from(`${GOTENBERG_USER}:${GOTENBERG_PASSWORD}`, "utf8").toString(
      "base64",
    );
  const resp = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: "POST",
    headers: { Authorization: auth },
    body: formData,
  });
  if (!resp.ok) {
    const err = await resp.text();
    // Never echo `auth` or the raw creds; only status + Gotenberg's own reply.
    throw new Error(`Gotenberg ${resp.status}: ${err.slice(0, 400)}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());

  const outPath = resolve(
    homedir(),
    "Desktop",
    "UTAK_قائمة_الدخل_التقديرية.pdf",
  );
  writeFileSync(outPath, bytes);
  console.log(
    JSON.stringify({
      ok: true,
      pdfPath: outPath,
      bytes: bytes.byteLength,
    }),
  );
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).message}`);
  process.exit(1);
});
