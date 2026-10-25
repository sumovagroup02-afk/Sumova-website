// Block schemas. The dashboard renders its editing forms from these definitions,
// and the public site renders each block type from the saved JSON.
// Field types: i18n (single line) · i18n-area (multi line) · media · text · url · select · bool · list
const link = (k, label) => [
  { k: `${k}_label`, t: 'i18n', label: `${label} – النص` },
  { k: `${k}_url`, t: 'url', label: `${label} – الرابط` },
];

export const BLOCKS = {
  hero: {
    label: 'الواجهة الرئيسية',
    desc: 'أول ما يراه الزائر: صورة كبيرة وعنوان وأرقام التشغيل.',
    fields: [
      { k: 'media', t: 'media', label: 'صورة الخلفية' },
      { k: 'headline', t: 'i18n-area', label: 'العنوان (كل سطر في سطر منفصل)' },
      { k: 'sub', t: 'i18n-area', label: 'الوصف' },
      ...link('cta1', 'الزر الرئيسي'),
      ...link('cta2', 'الزر الثانوي'),
      { k: 'figures', t: 'list', label: 'أرقام التشغيل', max: 5, itemLabel: 'رقم', fields: [
        { k: 'value', t: 'text', label: 'الرقم (مثل 100)' },
        { k: 'unit', t: 'i18n', label: 'الوحدة (مثل ألف وجبة)' },
        { k: 'label', t: 'i18n', label: 'الوصف (مثل المصنع، يوميًا)' },
      ] },
    ],
  },
  page_head: {
    label: 'رأس الصفحة',
    desc: 'عنوان الصفحة وتمهيد قصير وصورة اختيارية.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'lede', t: 'i18n-area', label: 'التمهيد' },
      { k: 'media', t: 'media', label: 'صورة (اختياري)' },
    ],
  },
  strips: {
    label: 'عملياتنا (شرائح الصور)',
    desc: 'شرائح عمودية تتسع عند اختيارها. لكل شريحة صورة أو رقم كبير.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'intro', t: 'i18n-area', label: 'تمهيد' },
      { k: 'items', t: 'list', label: 'الشرائح', max: 8, itemLabel: 'شريحة', fields: [
        { k: 'media', t: 'media', label: 'الصورة' },
        { k: 'big', t: 'text', label: 'رقم كبير بدل الصورة (اختياري)' },
        { k: 'title', t: 'i18n', label: 'الاسم' },
        { k: 'text', t: 'i18n-area', label: 'الوصف' },
        { k: 'url', t: 'url', label: 'رابط الصفحة' },
      ] },
    ],
  },
  steps: {
    label: 'خطوات (تسلسل)',
    desc: 'للمسارات المتسلسلة فقط، مثل كيف يتم طلب عرض السعر.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'items', t: 'list', label: 'الخطوات', max: 6, itemLabel: 'خطوة', fields: [
        { k: 'title', t: 'i18n', label: 'الخطوة' },
        { k: 'text', t: 'i18n-area', label: 'الشرح' },
      ] },
      ...link('cta', 'الزر'),
    ],
  },
  text_image: {
    label: 'نص وصورة',
    desc: 'نص تعريفي بجانب صورة، مع حقائق مختصرة.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'body', t: 'i18n-area', label: 'النص (فقرة لكل سطر فارغ)' },
      { k: 'media', t: 'media', label: 'الصورة' },
      { k: 'side', t: 'select', label: 'مكان الصورة', opts: [['end', 'في النهاية'], ['start', 'في البداية']] },
      { k: 'facts', t: 'list', label: 'حقائق', max: 8, itemLabel: 'حقيقة', fields: [
        { k: 'value', t: 'text', label: 'القيمة' },
        { k: 'label', t: 'i18n', label: 'الوصف' },
      ] },
      ...link('cta', 'الزر'),
    ],
  },
  facts: {
    label: 'معلومات وأرقام',
    desc: 'قائمة معلومات مختصرة بقيمة ووصف.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'items', t: 'list', label: 'المعلومات', max: 10, itemLabel: 'معلومة', fields: [
        { k: 'value', t: 'text', label: 'القيمة' },
        { k: 'unit', t: 'i18n', label: 'الوحدة' },
        { k: 'label', t: 'i18n', label: 'الوصف' },
      ] },
    ],
  },
  richtext: {
    label: 'نص',
    desc: 'عنوان وفقرات نصية.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'body', t: 'i18n-area', label: 'النص (فقرة لكل سطر فارغ)' },
    ],
  },
  catalog: {
    label: 'كتالوج المنتجات',
    desc: 'يعرض المنتجات المنشورة من قسم «المنتجات». يظهر نص بديل إذا لم توجد منتجات.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'intro', t: 'i18n-area', label: 'تمهيد' },
      { k: 'empty', t: 'i18n-area', label: 'النص عند عدم وجود منتجات' },
    ],
  },
  logos: {
    label: 'عملاؤنا',
    desc: 'شعارات الجهات. يختفي القسم تلقائيًا إذا كان فارغًا.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'items', t: 'list', label: 'الشعارات', max: 24, itemLabel: 'عميل', fields: [
        { k: 'media', t: 'media', label: 'الشعار' },
        { k: 'name', t: 'i18n', label: 'الاسم' },
      ] },
    ],
  },
  accreditations: {
    label: 'الاعتمادات والشهادات',
    desc: 'أضف ما تحمله الشركة فعلًا فقط. يختفي القسم إذا كان فارغًا.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'items', t: 'list', label: 'الاعتمادات', max: 12, itemLabel: 'اعتماد', fields: [
        { k: 'name', t: 'i18n', label: 'الاسم' },
        { k: 'text', t: 'i18n', label: 'التفصيل (رقم أو جهة)' },
      ] },
    ],
  },
  faq: {
    label: 'أسئلة شائعة',
    desc: 'تظهر في النتائج البحثية أيضًا عبر البيانات المنظّمة.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'items', t: 'list', label: 'الأسئلة', max: 20, itemLabel: 'سؤال', fields: [
        { k: 'q', t: 'i18n', label: 'السؤال' },
        { k: 'a', t: 'i18n-area', label: 'الجواب' },
      ] },
    ],
  },
  quote_form: {
    label: 'نموذج طلب عرض سعر',
    desc: 'نموذج الطلب. يتحول تلقائيًا إلى أسئلة الإعاشة عند اختيار نوع الإعاشة.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'intro', t: 'i18n-area', label: 'تمهيد' },
      { k: 'kind', t: 'select', label: 'النوع الافتراضي', opts: [['quote', 'عرض سعر عام'], ['catering', 'إعاشة']] },
    ],
  },
  contact: {
    label: 'بيانات التواصل ونموذج الرسالة',
    desc: 'تُؤخذ البيانات من «الإعدادات».',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'intro', t: 'i18n-area', label: 'تمهيد' },
    ],
  },
  cta: {
    label: 'دعوة للإجراء',
    desc: 'شريط داكن بعنوان وزر.',
    fields: [
      { k: 'title', t: 'i18n', label: 'العنوان' },
      { k: 'text', t: 'i18n-area', label: 'النص' },
      ...link('cta', 'الزر'),
    ],
  },
};

export const blockLabel = (type) => BLOCKS[type]?.label || type;

// A fresh, empty block of a type
export function emptyBlock(type) {
  const b = { type, id: Math.random().toString(36).slice(2, 9), data: {} };
  return b;
}
