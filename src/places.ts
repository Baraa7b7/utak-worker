// § 48 و (2026-10-01) — where pricing lives in Odoo: UTAK ← «💲 التسعير», the
// first item of the UTAK menu, and its five screens. Every text of the worker
// that tells Baraa where to look names the place from here (the old places —
// «💰 أسعار اليوم», «📊 لوحة التسعير», «⚙️ إعدادات التسعير», «💰 التكاليف
// التشغيلية», «الأسعار اليومية», «عروض المصادر اليومية» — are hidden menus).

export const PRICING_MENU = "💲 التسعير";
const place = (screen: string): string => `«${PRICING_MENU}» ← «${screen}»`;

/** The day's prices: the header, the lines, «قرار براء», «🔄 إعادة الحساب», «نشر المعتمد الآن». */
export const PLACE_TODAY = place("📊 اليوم");
/** The list of the days (and their chart); a day opens on the same screen as «📊 اليوم». */
export const PLACE_DAYS = place("📅 الأيام السابقة");
/** The suppliers' purchase replies, the market observations, the log of the price asks. */
export const PLACE_SOURCES = place("📥 عروض المصادر");
/** The produce: «نشط للبيع», the packaging and its weight, the category, the supplier. */
export const PLACE_PRODUCTS = place("📦 الأصناف");
/** The waste, the minimum profit a carton, the expected cartons, the outlier ratio, the operating costs. */
export const PLACE_SETTINGS = place("⚙️ الإعدادات");
