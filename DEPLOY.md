# نشر موقع سوموفا على Cloudflare

الموقع يعمل على **Cloudflare Containers** (نفس `Dockerfile`)، ويقف أمامه **Worker** يوجّه الطلبات ويحوّل `www` إلى النطاق الأساسي. القرص داخل الحاوية يُمسح عند كل إعادة تشغيل أو نشر، لذلك:

| ماذا | أين يُحفظ | كيف |
|---|---|---|
| قاعدة البيانات `sumova.db` | R2 ← `litestream/` | Litestream يبثّها باستمرار (كل ثانية)، ويحتفظ بالتاريخ 30 يومًا، ويستعيدها تلقائيًا عند تشغيل الحاوية |
| الصور وملفات العملاء وعروض الأسعار | R2 ← `files/` | مزامنة فورية عند كل تغيير + مراجعة كل دقيقة، وتُستعاد تلقائيًا عند التشغيل |
| نسخة احتياطية يومية كاملة | R2 ← `backups/sumova-YYYY-MM-DD.tar.gz` | مرة يوميًا بتوقيت الرياض، تُحذف بعد 30 يومًا |

الحاوية دائمة التشغيل: الـ Worker يفحص `/healthz` كل 5 دقائق فيبقيها مستيقظة.
التكلفة التقريبية: اشتراك **Workers Paid 5 دولارات** + الحاوية (basic: 1 جيجابايت ذاكرة) ≈ **6–7 دولارات** = **≈ 11–12 دولارًا شهريًا**. R2 مجاني حتى 10 جيجابايت.

---

## 1) Cloudflare (مرة واحدة)

1. أضف النطاق `sumova.org` إلى حسابك في Cloudflare، وغيّر خوادم الأسماء (Nameservers) عند مسجّل النطاق إلى خوادم Cloudflare.
2. **Workers & Pages ← Plans**: اشترك في **Workers Paid** (مطلوب للحاويات).
3. **R2 ← Create bucket**: الاسم `sumova-data`، الموقع **Eastern Europe (EEUR)** (أقرب منطقة متاحة).
4. في الحاوية `sumova-data` ← **Settings ← Object lifecycle rules ← Add rule**: البادئة `backups/`، حذف بعد **30 يومًا**.
   (أو بالأمر: `npx wrangler r2 bucket lifecycle add sumova-data backups-30d backups/ --expire-days 30`)
5. **R2 ← Manage API tokens ← Create API token**: صلاحية **Object Read & Write** على `sumova-data` فقط. احفظ:
   `Access Key ID` و`Secret Access Key` ورابط الـ endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
6. **أوقف** في إعدادات النطاق: **Rocket Loader** و**Email Address Obfuscation** (Scrape Shield)، لأن رأس الأمان CSP يحجب السكربتات التي يحقنانها.
7. **SSL/TLS ← Edge Certificates**: فعّل **Always Use HTTPS**.

## 2) GitHub + Workers Builds (النشر)

1. أنشئ مستودعًا **خاصًا (Private)** وارفع محتوى الملف المضغوط إلى الفرع `main` (مع المجلد `.github`).
2. في Cloudflare: **Workers & Pages ← Create ← Import a repository** ← اختر المستودع، أو في Worker موجود: **Settings ← Build ← Connect**. الإعدادات:

   | الإعداد | القيمة |
   |---|---|
   | اسم الـ Worker | **`sumova`** (يجب أن يطابق `name` في `wrangler.jsonc`) |
   | Production branch | `main` |
   | Root directory | `/` |
   | Build command | (فارغ) |
   | Deploy command | `npx wrangler deploy` |

3. كل دفع إلى `main` ينشر تلقائيًا: يُثبّت الحزم، ويبني صورة Docker، ويحدّث الحاوية.
4. **الاختبارات** تعمل في GitHub ← **Actions** ← «Tests» مع كل دفع. Workers Builds لا ينتظرها، فتأكد أنها خضراء قبل الاعتماد على النسخة المنشورة.

## 3) أول نشر

1. بعد نجاح أول بناء في **Workers & Pages ← sumova ← Deployments**، افتح: **Workers & Pages ← sumova ← Settings ← Variables and Secrets** وأضف كـ **Secret**:

   | الاسم | القيمة |
   |---|---|
   | `ADMIN_EMAIL` | بريد المالك للدخول إلى اللوحة |
   | `ADMIN_PASSWORD` | كلمة مرور قوية (12 حرفًا فأكثر) |
   | `R2_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
   | `R2_ACCESS_KEY_ID` | من الخطوة 1-5 |
   | `R2_SECRET_ACCESS_KEY` | من الخطوة 1-5 |

   قبل إضافتها يردّ الموقع «الموقع قيد الإعداد» ولا يشغّل الحاوية (حماية من فقد البيانات).
2. أعد النشر: **Deployments ← آخر بناء ← Retry build** (أو ادفع أي تعديل).
3. افتح `https://sumova.org/admin`، سجّل الدخول، وفعّل **التحقق بخطوتين** (إلزامي للمالك)، واحفظ رموز الاسترداد خارج الجوال.
4. بعد الدخول احذف السر `ADMIN_PASSWORD` من Cloudflare (لا يُستخدم إلا لإنشاء المالك الأول).

النطاقان `sumova.org` و`www.sumova.org` يُربطان تلقائيًا بالـ Worker (Custom Domains)، و`www` يحوَّل إلى `https://sumova.org` بنفس المسار. المتغيرات `COOKIE_SECURE=1` و`TRUST_PROXY=1` و`SITE_URL=https://sumova.org` مضبوطة داخل الـ Worker.

---

## 4) سجلات DNS المطلوبة (Cloudflare ← DNS ← Records)

**الموقع:** لا تضف شيئًا يدويًا. Cloudflare ينشئ سجلات `sumova.org` و`www` عند النشر. احذف قبل النشر أي سجل A/AAAA/CNAME قديم بالاسمين `@` و`www`.

**البريد (Zoho Mail)** — بريد `info@sumova.org` على Zoho، وسجلاته موجودة ويعمل. كلها **DNS only (السحابة الرمادية)**، و**لا تحذف أيًّا منها** عند حذف سجلات الموقع القديمة:

| النوع | الاسم | القيمة | الحالة الآن (فحص 2026-10-25) |
|---|---|---|---|
| MX | `@` | `mx.zoho.com` (10) · `mx2.zoho.com` (20) · `mx3.zoho.com` (50) | ✅ موجودة، اتركها |
| TXT | `@` | `zoho-verification=zb62086868.zmverify.zoho.com` | ✅ موجود، اتركه |
| TXT | `zmail._domainkey` | `v=DKIM1; k=rsa; p=…` (من Zoho) | ✅ موجود، اتركه. تأكد في Zoho Mail Admin ← Domains ← sumova.org ← **DKIM** أنه **Verified/Enabled** |
| TXT | `@` (SPF) | **عدّله إلى:** `v=spf1 include:zohomail.com ~all` | ⚠️ الحالي يحتوي `include:dc-8e814c8572._spfm.sumova.org` مكرّرًا، وهذا الاسم **غير موجود**، فقد تعدّ بعض الخوادم سجل SPF كله خاطئًا. يجب أن يبقى سجل SPF **واحد** فقط للنطاق |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | ✅ موجود ويعمل. اختياري: غيّر `rua` إلى بريد تقرؤه أنت (مثل `mailto:info@sumova.org`) لتصلك تقارير DMARC |

لا تفعّل **Email Routing** في Cloudflare لأنه يستبدل سجلات MX فيتوقف البريد الواصل إلى Zoho.

## 5) البريد الصادر (SMTP من info@sumova.org عبر Zoho)

1. في **Zoho Mail ← Settings ← Mail Accounts ← IMAP/POP/SMTP**: تأكد أن الوصول عبر SMTP مسموح للحساب (وإن كان مديرًا يقيّده فمن Admin Console).
2. إن كان **التحقق بخطوتين** مفعّلًا في حساب Zoho (موصى به): **Zoho Accounts ← Security ← App Passwords ← Generate** باسم «موقع سوموفا»، واستخدم كلمة المرور الناتجة بدل كلمة مرور الحساب.
3. في لوحة الموقع ← **الإعدادات ← خادم البريد** (القيم معبّأة مسبقًا، تكتب كلمة المرور فقط):
   الخادم `smtppro.zoho.com` (حسابات النطاق الخاص، لا `smtp.zoho.com`) · المنفذ `465` مع ✓ «اتصال مشفّر مباشر» (أو `587` بدونها) · المستخدم `info@sumova.org` · كلمة المرور (تكتبها أنت) · عنوان المرسل `سوموفا <info@sumova.org>` (يجب أن يطابق الحساب أو أحد أسمائه البديلة في Zoho).
4. «بريد الموظفين» = `sumovagroup02@gmail.com` ← احفظ ← **أرسل إشعارًا تجريبيًا**. إن لم يصل خلال دقيقة فسبب الفشل مكتوب في **سجل التغييرات** (`email_failed`).
5. لا يحاول الموقع إرسال أي بريد قبل حفظ كلمة المرور، فلا تمتلئ السجلات بأخطاء.

## 6) مراقبة التوقف

- **تنبيه بالبريد (مجاني):** أنشئ حسابًا في [UptimeRobot](https://uptimerobot.com) ← **New monitor**: النوع HTTP(s)، الرابط `https://sumova.org/healthz`، كل **5 دقائق**، وجهة التنبيه `sumovagroup02@gmail.com`. مراقب خارجي ينبّه حتى لو تعطّل Cloudflare نفسه.
- **سجلات Cloudflare:** فحص الـ Worker كل 5 دقائق يكتب `healthz failed` في **Workers ← sumova ← Logs** عند الفشل.

## 7) النسخ الاحتياطي والاستعادة

- **تلقائي:** قاعدة البيانات مستمرة (Litestream)، والملفات فورية، ونسخة كاملة يومية تبقى 30 يومًا.
- **عرض النسخ على جهازك:**
  ```bash
  R2_ENDPOINT=… R2_BUCKET=sumova-data R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node ops/data.mjs list
  ```
- **تنزيل نسخة وفحصها محليًا** (لا يمسّ الموقع):
  ```bash
  … node ops/data.mjs restore latest ./restored     # أو تاريخ: restore 2026-10-25 ./restored
  DATA_DIR=./restored npm start                      # يفتح النسخة على http://localhost:3000
  ```
- **استعادة نسخة على الموقع الحي:** أضف السر `RESTORE_BACKUP` بقيمة التاريخ (مثل `2026-10-25`)، ثم أعد النشر. تُستعاد مرة واحدة فقط ولو بقي السر، ثم احذفه.
- **اختبار الاستعادة:** `npm test` يأخذ نسخة من بيانات الاختبار، ويستعيدها في مجلد فارغ، ويقارن الجداول والملفات، ثم يشغّل الموقع من النسخة المستعادة.

## 8) محركات البحث (بعد أن يفتح `https://sumova.org` الموقع الحقيقي)

**تحقق أولًا:** `https://sumova.org/sitemap.xml` يعرض صفحات الموقع (`/factory` و`/kitchen`…)، و`https://sumova.org/robots.txt` يذكر رابط الخريطة.

**Google Search Console**
1. ادخل [search.google.com/search-console](https://search.google.com/search-console) بحساب الشركة ← **Add property** ← **Domain** ← `sumova.org`.
2. يعرض Google سجل TXT. بما أن النطاق على Cloudflare يظهر زر **Verify with Cloudflare** (يضيفه تلقائيًا)، أو أضفه يدويًا: TXT على `@` بالقيمة `google-site-verification=…` ثم **Verify**.
3. **Sitemaps** ← اكتب `sitemap.xml` ← **Submit**.
4. **URL inspection** ← `https://sumova.org/` ← **Request indexing** (وكرّرها لـ `/factory` و`/kitchen` و`/catering`).

**Bing Webmaster Tools**
1. ادخل [bing.com/webmasters](https://www.bing.com/webmasters) ← **Import from Google Search Console** (أسرع طريقة: ينقل الموقع وخريطته معًا).
2. أو يدويًا: **Add site** `https://sumova.org` ← التحقق عبر **DNS (CNAME)** أو انسخ رمز `msvalidate.01` وضعه في لوحة الموقع ← **تحسين محركات البحث** ← حقل Bing ← احفظ ← **Verify**.
3. **Sitemaps** ← `https://sumova.org/sitemap.xml` ← **Submit**.

(حقل Google في «تحسين محركات البحث» يقبل أيضًا رمز `google-site-verification` إن اخترت التحقق بوسم HTML بدل DNS.)

## 9) قبل كل نشر
- `npm test` ينجح كاملًا (يعمل تلقائيًا في GitHub Actions ← Tests).
- الأفضل النشر في وقت هادئ: أثناء النشر تتوقف الحاوية القديمة وتبدأ الجديدة خلال ثوانٍ.
