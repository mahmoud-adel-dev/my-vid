# منصة كورس فيديو HTML — دليل التشغيل والنشر (تخزين Cloudinary)

مشروع عملي عربي جاهز، بدون React أو Next.js. الفيديوهات لا تُخزن ضمن ملفات Vercel بل تُخزن وتبث عبر شبكة **Cloudinary** السحابية العالمية فائقة السرعة، ويتحكم بها **Cloudflare Worker** فقط بعد التحقق من كلمة مرور الدخول وتوقيع التوكن.

## المكونات

```text
course_portal_r2/
├── site/                       ← ارفع هذا المجلد فقط على Vercel
│   ├── index.html              ← صفحة الطلاب / قائمة المحاضرات
│   ├── watch.html              ← صفحة عرض فيديو مع مشغل وتحميل
│   ├── admin.html              ← صفحة رفع / حذف الفيديوهات
│   ├── config.js               ← رابط Cloudflare Worker واسم الكورس
│   ├── vercel.json
│   └── assets/                 ← التصميم وجافاسكربت الواجهة
├── worker/                     ← خادم API الذي يدير الصلاحيات ويتصل بـ Cloudinary
│   ├── src/index.js
│   ├── wrangler.toml
│   ├── .dev.vars
│   └── package.json
├── .env                        ← بيانات الاعتماد والتهيئة
├── tests/
│   └── test_worker.mjs
└── README_AR.md
```

**الخصائص:** واجهة RTL عربية متجاوبة، تسجيل دخول الطلاب والإدارة بكلمتي مرور منفصلتين، بحث فوري في المحاضرات، رفع الفيديوهات مباشرة وبسرعة فائقة إلى Cloudinary بتوقيع رقمي آمن (Signed Upload)، دعم الرفع للملفات الكبيرة حتى 2 جيجابايت مع شريط تقدم حي وإمكانية الإلغاء، بث وتشغيل سلس للفيديوهات عبر مشغل HTML5 مع إمكانية التقديم والتأخير، زر تنزيل مباشر (`fl_attachment`)، حذف الفيديوهات من Cloudinary، وإحصائيات المحتوى. **لا تحتاج قاعدة بيانات ولا بطاقة ائتمان لتفعيل التخزين**.

---

## إعدادات Cloudinary المفعلة

تم تجهيز المشروع بحساب Cloudinary التالي:

```env
# Cloudinary uploads
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=eovzipnj
CLOUDINARY_CLOUD_NAME=eovzipnj
CLOUDINARY_API_KEY=899147943361934
CLOUDINARY_API_SECRET=mf2nLY_KKHsP4wxzbpJwlw6fC_8
CLOUDINARY_URL=cloudinary://899147943361934:mf2nLY_KKHsP4wxzbpJwlw6fC_8@eovzipnj
```

---

## الطريقة الأولى: إعداد Cloudflare بالكامل من لوحة التحكم (بدون تثبيت برامج)

1. افتح [Cloudflare Dashboard](https://dash.cloudflare.com/) ثم توجه إلى **Workers & Pages → Create → Worker** وأنشئ Worker جديدًا باسم `course-portal-api`.
2. افتح محرر الكود الخاص بالـ Worker، واستبدل الكود بالكامل بمحتوى `worker/src/index.js`، ثم اضغط **Deploy**.
3. في صفحة الـ Worker، ادخل على **Settings → Variables and Secrets**:
   - أضف المتغيرات النصية العادية (Text Variables):
     - `CLOUDINARY_CLOUD_NAME`: `eovzipnj`
     - `CLOUDINARY_API_KEY`: `899147943361934`
     - `CLOUDINARY_URL`: `cloudinary://899147943361934:mf2nLY_KKHsP4wxzbpJwlw6fC_8@eovzipnj`
     - `ALLOWED_ORIGIN`: رابط دومين موقعك على Vercel، مثل `https://my-course.vercel.app` (بدون `/` في النهاية).
   - أضف القيم السرية المشفرة (Secrets):
     - `CLOUDINARY_API_SECRET`: `mf2nLY_KKHsP4wxzbpJwlw6fC_8`
     - `ADMIN_PASSWORD`: كلمة مرور قوية للإدارة (10 أحرف أو أكثر).
     - `STUDENT_PASSWORD`: كلمة مرور قوية للطلاب (10 أحرف أو أكثر).
     - `TOKEN_SECRET`: سلسلة عشوائية قوية لتوقيع الجلسات (مثلاً 32 إلى 64 حرف عشوائي).
4. اضغط **Deploy** لحفظ الإعدادات، وانسخ رابط الـ Worker الظاهر لديك: `https://course-portal-api.YOUR-ACCOUNT.workers.dev`.

---

## الطريقة الثانية: نشر الـ Worker بأوامر Wrangler

من داخل مجلد `worker`:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

ثم أدخل كلمات المرور والسرية كـ Secrets:

```bash
npx wrangler secret put CLOUDINARY_API_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put STUDENT_PASSWORD
npx wrangler secret put TOKEN_SECRET
```

---

## نشر صفحات الموقع على Vercel

1. افتح **`site/config.js`** وضع رابط الـ Worker في `apiBase`:
   ```javascript
   window.COURSE_CONFIG = {
     title: 'أكاديمية المعرفة',
     subtitle: 'تعلم على راحتك، وشاهد محاضراتك في أي وقت',
     apiBase: 'https://course-portal-api.YOUR-ACCOUNT.workers.dev',
     cloudinaryCloudName: 'eovzipnj'
   };
   ```
2. ارفع مجلدات المشروع إلى مستودع GitHub.
3. افتح Vercel ← **Add New Project** ← اختر المستودع.
4. حدد **Root Directory** = `site`، و**Framework Preset** = `Other`.
5. اضغط **Deploy**. سيظهر رابط مثل `https://my-course.vercel.app`.
6. تأكد من وضع رابط Vercel داخل متغير `ALLOWED_ORIGIN` في Cloudflare Worker حتى يُسمح بالاتصال من المتصفح بدون مشاكل CORS.

---

## تجربة النظام محليًا واختبار الكود

تم تضمين فحص واختبار كامل لجميع الوظائف:

```bash
node tests/test_worker.mjs
```

ويتحقق الاختبار من:
- فحص الحالة `GET /api/health` وتأكيد اتصال Cloudinary.
- تسجيل الدخول للطلاب والمسؤولين وحماية كلمات المرور.
- التوقيع المشفر لرفع الفيديوهات `POST /api/upload/sign`.
- جلب قائمة الفيديوهات من Cloudinary `GET /api/videos`.
- حماية روابط الفيديو وتوجيه المشاهدة والتنزيل بالتوكن المصرح.
