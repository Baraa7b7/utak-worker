# تحليل الإرسال — البوابة الموحّدة (STATUS § 33)

اللقطة: 2026-09-25T13:22:57.709Z (قراءة فقط). أسطر الرفض منذ 2026-09-11 16:22، والمحاولات منذ 2026-09-18 16:22 (الرياض).

## (1) رفض Meta في 14 يوماً: 48 سطراً في القنوات

| # | الوقت | الرقم | الرمز | المحاولة | السبب | المسار | البوابة |
|---|---|---|---|---|---|---|---|
| 1964 | 2026-09-20 07:19 | …6832 | window-refused | - | Baraa's Discuss reply outside the window (refused, not sent) | wa-inbox-reply | held for the contact, sent at the next message |
| 1974 | 2026-09-20 15:54 | …0888 | window-refused | - | Baraa's Discuss reply outside the window (refused, not sent) | wa-inbox-reply | held for the contact, sent at the next message |
| 1976 | 2026-09-20 15:54 | …6832 | window-refused | - | Baraa's Discuss reply outside the window (refused, not sent) | wa-inbox-reply | held for the contact, sent at the next message |
| 1997 | 2026-09-21 01:09 | …7704 | 131047 | - | reply to a message Meta re-delivered 71h late | bot reply (§ 29) | held: the window is computed from Meta's timestamp, a late message does not open it |
| 2000 | 2026-09-21 01:10 | …6832 | window-refused | - | Baraa's Discuss reply outside the window (refused, not sent) | wa-inbox-reply | held for the contact, sent at the next message |
| 2011 | 2026-09-21 01:55 | …6832 | 131047 | - | free-form text outside the window — late status (7h54m) for the 18:00 «لا توجد فواتير» text of 09-20 | 18:00 «nothing to collect» text | held (window closed by Meta's timestamp) — never sent |
| 2022 | 2026-09-21 03:18 | …9474 | 131047 | - | reply to a message Meta re-delivered 55h late | bot reply (§ 29) | held: the window is computed from Meta's timestamp, a late message does not open it |
| 2024 | 2026-09-21 03:50 | …9474 | 131047 | - | free-form text outside the window — late status (55h) for the manual quotation document S00005 of 09-18 (row 16, written 09-21 00:50:07) | 18:00 «nothing to collect» text | held (window closed by Meta's timestamp) — never sent |
| 2028 | 2026-09-21 05:11 | …7704 | 131047 | - | reply to a message Meta re-delivered 75h late | bot reply (§ 29) | held: the window is computed from Meta's timestamp, a late message does not open it |
| 2029 | 2026-09-21 05:35 | …0002 | 131047 | - | free-form text outside the window — late status (11h34m) for the 18:00 «لا توجد فواتير» text of 09-20 | 18:00 «nothing to collect» text | held (window closed by Meta's timestamp) — never sent |
| 2030 | 2026-09-21 06:08 | …6832 | 131047 | - | a duplicate status delivery | status webhook | handled once (no second line): the same status as #2011 delivered again (no session send to him in between was outside the window) |
| 2039 | 2026-09-21 08:00 | …7756 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2040 | 2026-09-21 08:00 | …7756 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2044 | 2026-09-21 08:00 | …7756 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2112 | 2026-09-21 14:32 | …6370 | 131047 | - | reply to a message Meta re-delivered 101h late | bot reply (§ 29) | held: the window is computed from Meta's timestamp, a late message does not open it |
| 2114 | 2026-09-21 16:34 | …0002 | 131047 | - | a duplicate status delivery | status webhook | handled once (no second line): the same status as #2029 delivered again (no send to this number since) |
| 2117 | 2026-09-21 16:58 | …7756 | 131047 | - | reply to a message Meta re-delivered 46h late | bot reply (§ 29) | held: the window is computed from Meta's timestamp, a late message does not open it |
| 2118 | 2026-09-21 18:00 | …6832 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2120 | 2026-09-21 18:00 | …0002 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2122 | 2026-09-21 18:00 | …0002 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2123 | 2026-09-21 18:01 | …6832 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2125 | 2026-09-21 18:01 | …0002 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2127 | 2026-09-21 18:01 | …0002 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2130 | 2026-09-21 22:06 | …0002 | 131047 | - | a duplicate status delivery | status webhook | handled once (no second line): the same status as #2122/#2127 (09-21 18:00 texts) delivered again |
| 2133 | 2026-09-22 06:00 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |
| 2134 | 2026-09-22 06:00 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |
| 2137 | 2026-09-22 08:00 | …6370 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2138 | 2026-09-22 08:00 | …3051 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2141 | 2026-09-22 08:01 | …6370 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2142 | 2026-09-22 08:01 | …3051 | 131049 | - | marketing template utak_v2_inactive dropped by Meta's marketing cap | 08:00 outreach | still sent (marketing purpose); after a 131049 not that template to that number again that day |
| 2157 | 2026-09-22 18:00 | …6832 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2158 | 2026-09-22 18:00 | …6832 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2161 | 2026-09-22 18:00 | …0002 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2162 | 2026-09-22 18:00 | …0002 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2164 | 2026-09-22 18:00 | …6832 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2166 | 2026-09-22 18:01 | …0002 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2167 | 2026-09-22 18:01 | …0002 | 131047 | - | free-form text outside the window | ? | held |
| 2170 | 2026-09-23 06:01 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |
| 2415 | 2026-09-23 18:00 | …6832 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2417 | 2026-09-23 18:00 | …6832 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2418 | 2026-09-23 18:00 | …0002 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2420 | 2026-09-23 18:01 | …0002 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2472 | 2026-09-24 18:01 | …6832 | 132018 | - | template variables refused (multi-line list) | 18:00 collection summary | sanitized since ح1; and after a refusal no text fallback (one attempt) |
| 2474 | 2026-09-24 18:01 | …6832 | 131047 | - | 18:00 collection text outside the window (the template had just failed) | 18:00 collection summary text fallback | no text after a refused template; outside the window it would be held |
| 2482 | 2026-09-24 21:15 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |
| 2487 | 2026-09-24 23:43 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |
| 2558 | 2026-09-25 05:00 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |
| 2559 | 2026-09-25 06:00 | …4962 | 131049 | - | Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap) | sendOwnerAlert | never that template: text inside his window, held for his tap outside it |

## (2) إعادة التشغيل: 100 محاولة إرسال في 7 أيام

- الفعلي: accepted = 66، refused 131047 = 13، blocked (allowlist) = 1، refused 131049 = 13، refused 132018 = 7
- البوابة: held = 40، skipped = 12، refused (allowlist) = 1، text = 26، template = 15، skipped (131049 today) = 4، skipped (refused <24h) = 2
- المرفوض فعلاً عند البوابة: held = 19، template = 8، skipped (131049 today) = 4، skipped (refused <24h) = 2

| الغرض | text | template | held | skipped | skipped (131049 today) | skipped (refused <24h) | refused (allowlist) |
|---|---|---|---|---|---|---|---|
| operational_text | 4 | 0 | 20 | 0 | 0 | 0 | 1 |
| owner_alert | 6 | 0 | 15 | 0 | 0 | 0 | 0 |
| supplier_ask | 0 | 1 | 0 | 8 | 0 | 0 | 0 |
| bot_reply | 16 | 0 | 5 | 0 | 0 | 0 | 0 |
| customer_welcome | 0 | 1 | 0 | 4 | 0 | 0 | 0 |
| customer_inactive | 0 | 6 | 0 | 0 | 4 | 0 | 0 |
| collection_summary | 0 | 5 | 0 | 0 | 0 | 2 | 0 |
| supplier_price_nudge | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| team_shift_start | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

### المرفوض فعلاً في 7 أيام، وقرار البوابة فيه

| المصدر | الوقت | الرقم | النوع | الغرض | النافذة (آخر وارد) | الفعلي | البوابة |
|---|---|---|---|---|---|---|---|
| D1#14 | 2026-09-18 20:07 | …9474 | document | operational_text | closed (-) | refused 131047 | held |
| D1#33 | 2026-09-21 01:09 | …7704 | text | bot_reply | closed (2026-09-18 02:02) | refused 131047 | held |
| D1#41 | 2026-09-21 03:18 | …9474 | text | bot_reply | closed (2026-09-18 20:38) | refused 131047 | held |
| D1#43 | 2026-09-21 05:11 | …7704 | text | bot_reply | closed (2026-09-18 02:02) | refused 131047 | held |
| XW#76 | 2026-09-21 08:00 | …7756 | utak_v2_inactive | customer_inactive | closed (2026-09-19 18:43) | refused 131049 | template |
| XW#78 | 2026-09-21 08:00 | …7756 | utak_v2_inactive | customer_inactive | closed (2026-09-19 18:43) | refused 131049 | skipped (131049 today) |
| D1#49 | 2026-09-21 08:00 | …7756 | utak_v2_inactive | customer_inactive | closed (2026-09-19 18:43) | refused 131049 | skipped (131049 today) |
| D1#55 | 2026-09-21 14:32 | …6370 | text | bot_reply | closed (2026-09-17 10:01) | refused 131047 | held |
| D1#56 | 2026-09-21 16:58 | …7756 | text | bot_reply | closed (2026-09-19 18:43) | refused 131047 | held |
| XW#98 | 2026-09-21 18:00 | …0002 | text | operational_text | closed (-) | refused 131047 | held |
| D1#57 | 2026-09-21 18:01 | …6832 | utak_collection_summary | collection_summary | open (2026-09-21 12:19) | refused 132018 | template |
| D1#59 | 2026-09-21 18:01 | …0002 | utak_collection_summary | collection_summary | closed (-) | refused 132018 | template |
| D1#60 | 2026-09-21 18:01 | …0002 | text | operational_text | closed (-) | refused 131047 | held |
| D1#63 | 2026-09-22 06:00 | …4962 | utak_owner_alert | owner_alert | closed (2026-09-21 01:09) | refused 131049 | held |
| XW#107 | 2026-09-22 08:00 | …6370 | utak_v2_inactive | customer_inactive | closed (2026-09-17 10:01) | refused 131049 | template |
| XW#108 | 2026-09-22 08:00 | …3051 | utak_v2_inactive | customer_inactive | closed (2026-09-20 13:55) | refused 131049 | template |
| D1#64 | 2026-09-22 08:00 | …6370 | utak_v2_inactive | customer_inactive | closed (2026-09-17 10:01) | refused 131049 | skipped (131049 today) |
| D1#65 | 2026-09-22 08:00 | …3051 | utak_v2_inactive | customer_inactive | closed (2026-09-20 13:55) | refused 131049 | skipped (131049 today) |
| D1#66 | 2026-09-22 18:00 | …6832 | utak_collection_summary | collection_summary | closed (2026-09-21 12:19) | refused 132018 | skipped (refused <24h) |
| D1#67 | 2026-09-22 18:00 | …6832 | text | operational_text | closed (2026-09-21 12:19) | refused 131047 | held |
| D1#68 | 2026-09-22 18:00 | …0002 | utak_collection_summary | collection_summary | closed (-) | refused 132018 | skipped (refused <24h) |
| D1#69 | 2026-09-22 18:00 | …0002 | text | operational_text | closed (-) | refused 131047 | held |
| D1#72 | 2026-09-23 06:00 | …4962 | utak_owner_alert | owner_alert | closed (2026-09-21 01:09) | refused 131049 | held |
| D1#78 | 2026-09-23 18:00 | …6832 | utak_collection_summary | collection_summary | closed (2026-09-21 12:19) | refused 132018 | template |
| D1#79 | 2026-09-23 18:00 | …6832 | text | operational_text | closed (2026-09-21 12:19) | refused 131047 | held |
| D1#80 | 2026-09-23 18:00 | …0002 | utak_collection_summary | collection_summary | closed (-) | refused 132018 | template |
| D1#81 | 2026-09-23 18:00 | …0002 | text | operational_text | closed (-) | refused 131047 | held |
| D1#92 | 2026-09-24 18:01 | …6832 | utak_collection_summary | collection_summary | closed (2026-09-21 12:19) | refused 132018 | template |
| D1#93 | 2026-09-24 18:01 | …6832 | text | operational_text | closed (2026-09-21 12:19) | refused 131047 | held |
| D1#94 | 2026-09-24 21:15 | …4962 | utak_owner_alert | owner_alert | closed (2026-09-21 01:09) | refused 131049 | held |
| D1#95 | 2026-09-24 23:43 | …4962 | utak_owner_alert | owner_alert | closed (2026-09-21 01:09) | refused 131049 | held |
| D1#98 | 2026-09-25 05:00 | …4962 | utak_owner_alert | owner_alert | closed (2026-09-21 01:09) | refused 131049 | held |
| D1#100 | 2026-09-25 06:00 | …4962 | utak_owner_alert | owner_alert | closed (2026-09-21 01:09) | refused 131049 | held |
