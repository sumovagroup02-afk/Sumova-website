import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { one, run, setSetting, J, DATA_DIR, audit } from './db.js';
import { addMedia } from './media.js';
import { createUser } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, '..', 'seed_assets');
const i = (ar, en = '') => ({ ar, en });
const id6 = () => crypto.randomBytes(4).toString('hex');
const B = (type, data) => ({ id: id6(), type, data });

export async function seedIfEmpty() {
  if (one('SELECT COUNT(*) n FROM pages').n > 0) return false;

  // ── media from the photos supplied by the client (replaceable from the dashboard)
  const m = {};
  const add = async (key, file, alt) => { m[key] = fs.existsSync(path.join(ASSETS, file)) ? await addMedia(fs.readFileSync(path.join(ASSETS, file)), file, alt) : null; };
  await add('wide', 'factory-wide.jpg', i('مبنى مصنع سوموفا ومبنى الثلاجات المجاور له', 'The SUMOVA factory and the adjoining cold-storage building'));
  await add('front', 'factory-front.jpg', i('واجهة مصنع سوموفا ورصيف التحميل', 'The SUMOVA factory front and loading dock'));
  await add('cold', 'cold-stores.jpg', i('مبنى ثلاجات سوموفا ومولدات الكهرباء', 'The SUMOVA cold-storage building and generators'));
  await add('kitchen', 'kitchen.jpg', i('واجهة المطبخ', 'The kitchen building'));

  // ── settings
  setSetting('brand', { name: i('سوموفا', 'SUMOVA'), cr: '7017713426' });
  setSetting('contact', { phone: '0557706254', email: 'info@sumova.org', address: i('مكة المكرمة – أم الجود – الزايدي', 'Al-Zaidi, Umm Al-Joud, Makkah'), hours: i('', ''),
    // coordinates only: the Google Maps place at this spot is still listed under the old owner's name
    map_url: 'https://www.google.com/maps?q=21.4219303,39.7154083', geo: { lat: 21.4219303, lng: 39.7154083 }, city: i('مكة المكرمة', 'Makkah') });
  const h = 'sumova02';
  setSetting('social', { LinkedIn: `https://www.linkedin.com/company/${h}`, Instagram: `https://www.instagram.com/${h}`, YouTube: `https://www.youtube.com/@${h}`, TikTok: `https://www.tiktok.com/@${h}`, Snapchat: `https://www.snapchat.com/add/${h}` });
  setSetting('footer', { about: i('شركة سعودية مقرها مكة المكرمة، تُشغّل بنفسها مصنعًا ومطبخًا وثلاجات تبريد ومستودعًا وأسطول نقل لخدمة الجهات والشركات.', 'A Saudi company based in Makkah that runs its own factory, kitchen, cold stores, warehouse and delivery fleet for organisations and businesses.') });
  setSetting('seo', { desc: i('سوموفا: مصنع ومطبخ وثلاجات تبريد وأسطول نقل بإدارة واحدة، لخدمة الجهات والشركات في المملكة.', 'SUMOVA runs a factory, kitchen, cold stores and delivery fleet under one management for organisations in Saudi Arabia.'), og: m.wide });
  setSetting('notifications', { emails: 'sumovagroup02@gmail.com', webhook_url: '', webhook_secret: '' });
  setSetting('smtp', {});
  setSetting('analytics', {});
  setSetting('site', { url: process.env.SITE_URL || 'https://sumova.org' });

  const page = (slug, title, blocks, o = {}) => run('INSERT INTO pages(slug,title,seo,blocks,published,show_in_nav,nav_label,sort,kind) VALUES(?,?,?,?,?,?,?,?,?)',
    slug, JSON.stringify(title), JSON.stringify(o.seo || {}), JSON.stringify(blocks), 1, o.nav ? 1 : 0, JSON.stringify(o.navLabel || {}), o.sort ?? 0, o.kind || 'page');

  const toQuote = { cta_label: i('اطلب عرض سعر', 'Request a quote'), cta_url: '/request-quote' };

  page('home', i('الرئيسية', 'Home'), [
    B('hero', {
      media: m.wide,
      headline: i('مصنع ومطبخ وتبريد ونقل.\nنُشغّلها بأنفسنا.', 'Factory, kitchen, cold storage and delivery.\nWe run them ourselves.'),
      sub: i('من مكة المكرمة نخدم الجهات والشركات في المملكة، بخبرة تشغيلية تتجاوز عشر سنوات.', 'From Makkah we serve organisations and businesses across Saudi Arabia, with more than ten years of operating experience.'),
      cta1_label: i('اطلب عرض سعر', 'Request a quote'), cta1_url: '/request-quote',
      cta2_label: i('تعرّف على عملياتنا', 'See how we operate'), cta2_url: '#operations',
      figures: [
        { value: '100', unit: i('ألف قطعة', 'k pieces'), label: i('طاقة المصنع اليومية', 'Factory daily capacity') },
        { value: '50', unit: i('ألف وجبة', 'k meals'), label: i('طاقة المطبخ الشهرية', 'Kitchen monthly capacity') },
        { value: '3', unit: i('ثلاجات', 'stores'), label: i('ثلاجات تبريد كبرى', 'Large cold stores') },
        { value: '21', unit: i('مركبة', 'vehicles'), label: i('أسطول النقل', 'Delivery fleet') },
      ],
    }),
    B('strips', {
      title: i('كل ما تحتاجه في سلسلة التشغيل، تحت إدارة واحدة', 'The whole operating chain, under one management'),
      intro: i('لا نعتمد على وسطاء في التصنيع أو الطهي أو التبريد أو النقل. نشغّلها بأنفسنا، فنضبط الجودة والمواعيد من أولها إلى آخرها.', 'We do not outsource manufacturing, cooking, cold storage or delivery. We run each ourselves, so quality and timing stay in our hands.'),
      items: [
        { media: m.front, title: i('المصنع', 'Factory'), text: i('مخبوزات وعلب فاخرة بطاقة تعادل 100 ألف قطعة يوميًا، وأرصفة تحميل جاهزة للشحن.', 'Bakery and luxury boxes at a capacity equal to 100,000 pieces a day, with loading docks ready for dispatch.'), url: '/factory' },
        { media: null, big: '50', title: i('المطبخ', 'Kitchen'), text: i('مطبخ بطاقة تعادل 50 ألف وجبة شهريًا.', 'A kitchen with capacity equal to 50,000 meals a month.'), url: '/kitchen' },
        { media: m.cold, title: i('التبريد والتخزين', 'Cold storage'), text: i('ثلاث ثلاجات كبرى ومستودع تحفظ المنتجات في درجات الحرارة المطلوبة.', 'Three large cold stores and a warehouse keep products at the required temperatures.'), url: '/cold-chain' },
        { big: '21', title: i('أسطول النقل', 'Fleet'), text: i('21 مركبة توصل الطلبات إلى مواقع الجهات.', '21 vehicles deliver orders to client sites.'), url: '/cold-chain' },
      ],
    }),
    B('steps', {
      title: i('كيف يتم طلب عرض السعر', 'How a quotation works'),
      items: [
        { title: i('أرسل طلبك', 'Send your request'), text: i('اكتب ما تحتاجه أو أضف منتجات من الكتالوج، وأرفق ملفاتك إن وجدت.', 'Describe what you need or add products from the catalogue, and attach any files.') },
        { title: i('نرسل لك العرض', 'We send a quotation'), text: i('يدرس فريقنا الطلب ويرفع عرض السعر بصيغة PDF في صفحة متابعة طلبك.', 'Our team reviews the request and posts a PDF quotation on your tracking page.') },
        { title: i('أكّد الطلب', 'Confirm the order'), text: i('اقبل العرض أو ارفضه من الصفحة نفسها، ونبدأ التنفيذ بعد التأكيد.', 'Accept or decline from the same page. We start work once you confirm.') },
      ], ...toQuote,
    }),
    B('text_image', {
      title: i('عن سوموفا', 'About SUMOVA'),
      body: i('سوموفا شركة سعودية متعددة القطاعات مقرها مكة المكرمة، بخبرة تشغيلية تتجاوز عشر سنوات. نملك المصنع والمطبخ وثلاجات التبريد والمستودع وأسطول النقل، ونديرها بفرق تشغيل خاصة بنا.', 'SUMOVA is a Saudi multi-sector company based in Makkah, with more than ten years of operating experience. We own the factory, kitchen, cold stores, warehouse and fleet, and run them with our own operating teams.'),
      media: m.cold, side: 'start', cta_label: i('اقرأ المزيد عنا', 'More about us'), cta_url: '/about',
    }),
    B('cta', { title: i('هل لديك طلب لجهتك؟', 'Have a request for your organisation?'), text: i('أرسل التفاصيل ونرد عليك بعرض سعر.', 'Send us the details and we will reply with a quotation.'), ...toQuote }),
  ], { sort: 0, nav: false, seo: { title: i('سوموفا | مصنع ومطبخ وتبريد ونقل للجهات في المملكة', 'SUMOVA | Factory, kitchen, cold storage and delivery in Saudi Arabia'), desc: i('نُشغّل بأنفسنا مصنعًا ومطبخًا وثلاجات تبريد وأسطول نقل. اطلب عرض سعر لجهتك من سوموفا.', 'We run our own factory, kitchen, cold stores and delivery fleet. Request a quotation for your organisation from SUMOVA.') } });

  page('factory', i('المصنع', 'Factory'), [
    B('page_head', { title: i('المصنع', 'The factory'), lede: i('خطّا إنتاج للمخبوزات والعلب الفاخرة، بطاقة تعادل 100 ألف قطعة يوميًا.', 'Two production lines, bakery and luxury boxes, with capacity equal to 100,000 pieces a day.'), media: m.front }),
    B('text_image', { title: i('من خط الإنتاج إلى رصيف الشحن', 'From the production line to the loading dock'),
      body: i('خط المخبوزات ينتج الكرواسون وفطيرة الجبنة والكب كيك، وخط مستقل للعلب الفاخرة. الطاقة الإجمالية تعادل 100 ألف قطعة يوميًا.\n\nيجاور المصنعَ مبنى ثلاجات سوموفا، فتنتقل المنتجات من الإنتاج إلى التبريد ثم إلى أسطول النقل دون وسيط، وتتابعها إدارة مختصة بالجودة وسلامة الغذاء.\n\nنُعِدّ الكميات والمواصفات حسب طلب كل جهة، ونرسل عرض السعر مكتوبًا قبل التنفيذ.', 'The bakery line makes croissants, cheese pies and cupcakes, and a separate line makes luxury boxes. Total capacity is equal to 100,000 pieces a day.\n\nThe SUMOVA cold-storage building stands next to the factory, so products move from production to cold storage to our fleet with no middleman, overseen by a dedicated quality and food-safety team.\n\nWe prepare volumes and specifications for each organisation and send a written quotation before production.'),
      media: m.wide, side: 'end', facts: [{ value: '100', label: i('ألف قطعة يوميًا', 'thousand pieces a day') }, { value: '2', label: i('خطّا إنتاج', 'production lines') }, { value: '21', label: i('مركبة للتوزيع', 'delivery vehicles') }] }),
    // The product catalogue block is added from the dashboard once real products are entered (an empty catalogue looks unfinished).
    B('cta', { title: i('تحتاج كميات أو مواصفات خاصة؟', 'Need special volumes or specifications?'), text: i('أرسل طلبك ونرد بعرض سعر.', 'Send your request and we will reply with a quotation.'), ...toQuote }),
  ], { sort: 10, nav: true, navLabel: i('المصنع', 'Factory'), seo: { title: i('مصنع سوموفا | مخبوزات وعلب فاخرة بطاقة 100 ألف قطعة يوميًا', 'SUMOVA factory | Bakery and luxury boxes, 100,000 pieces a day'), desc: i('مصنع سوموفا في مكة المكرمة: خط مخبوزات وخط علب فاخرة بطاقة تعادل 100 ألف قطعة يوميًا. اطلب عرض سعر لكمياتك.', 'The SUMOVA factory in Makkah: a bakery line and a luxury-box line with capacity equal to 100,000 pieces a day. Request a quotation for your volumes.') } });

  // Kitchen: name, picture and information only (client decision). No catalogue, no cart.
  page('kitchen', i('المطبخ', 'Kitchen'), [
    B('page_head', { title: i('المطبخ', 'The kitchen'), lede: i('مطبخ سوموفا بطاقة تعادل 50 ألف وجبة شهريًا.', 'The SUMOVA kitchen has capacity equal to 50,000 meals a month.'), media: null }), // the supplied kitchen photo shows a signboard with the waqf name – hidden until retouched or re-shot
    B('facts', { title: i('معلومات المطبخ', 'Kitchen information'), items: [{ value: '50', unit: i('ألف وجبة', 'k meals'), label: i('الطاقة الشهرية', 'Monthly capacity') }] }),
    B('cta', { title: i('للاستفسار عن المطبخ', 'To ask about the kitchen'), text: i('تواصل معنا وسنرد عليك.', 'Get in touch and we will reply.'), cta_label: i('تواصل معنا', 'Contact us'), cta_url: '/contact' }),
  ], { sort: 20, nav: true, navLabel: i('المطبخ', 'Kitchen'), seo: { title: i('مطبخ سوموفا | طاقة 50 ألف وجبة شهريًا', 'SUMOVA kitchen | 50,000 meals a month capacity'), desc: i('معلومات عن مطبخ سوموفا وطاقته التشغيلية الشهرية. تواصل معنا للاستفسار.', 'Information about the SUMOVA kitchen and its monthly operating capacity. Contact us to ask.') } });

  page('cold-chain', i('التبريد والنقل', 'Cold storage & fleet'), [
    B('page_head', { title: i('التبريد والنقل', 'Cold storage and fleet'), lede: i('ثلاث ثلاجات كبرى ومستودع وأسطول من 21 مركبة، تحت إدارتنا المباشرة.', 'Three large cold stores, a warehouse and a fleet of 21 vehicles, under our direct management.'), media: m.cold }),
    B('facts', { title: i('أصولنا', 'Our assets'), items: [
      { value: '3', unit: i('ثلاجات', 'stores'), label: i('ثلاجات تبريد كبرى', 'Large cold stores') },
      { value: '21', unit: i('مركبة', 'vehicles'), label: i('مركبات في أسطول النقل', 'Vehicles in the fleet') },
    ] }),
    B('cta', { title: i('تحتاج تخزينًا أو نقلًا؟', 'Need storage or transport?'), text: i('أرسل احتياجك ونرد بعرض سعر.', 'Send your need and we will reply with a quotation.'), ...toQuote }),
  ], { sort: 30, nav: true, navLabel: i('التبريد والنقل', 'Cold storage'), seo: { title: i('التبريد والنقل | ثلاث ثلاجات كبرى وأسطول 21 مركبة', 'Cold storage and fleet | 3 large stores and 21 vehicles'), desc: i('تخزين مبرّد في ثلاث ثلاجات كبرى ومستودع، ونقل بأسطول من 21 مركبة من مكة المكرمة إلى مواقع الجهات.', 'Chilled storage in three large cold stores and a warehouse, and delivery with a fleet of 21 vehicles from Makkah to client sites.') } });

  page('catering', i('الإعاشة', 'Catering'), [
    B('page_head', { title: i('الإعاشة', 'Catering'), lede: i('نجهّز وجبات الإعاشة في مطبخنا بمكة المكرمة للجهات والفعاليات والمواسم. يتحدد السعر بعدد الأشخاص والأيام وموقع التقديم.', 'We prepare catering in our Makkah kitchen for organisations, events and seasons. Pricing depends on the number of people, days and service location.') }),
    B('quote_form', { title: i('اطلب عرض سعر للإعاشة', 'Request a catering quotation'), intro: i('أجب عن الأسئلة التالية ونرسل لك العرض.', 'Answer the questions below and we will send you a quotation.'), kind: 'catering' }),
  ], { sort: 40, nav: true, navLabel: i('الإعاشة', 'Catering'), seo: { title: i('خدمات الإعاشة للجهات والفعاليات | سوموفا', 'Catering for organisations and events | SUMOVA'), desc: i('اطلب عرض سعر للإعاشة بحسب عدد الأشخاص والأيام وموقع التقديم من مطبخ ومصنع سوموفا.', 'Request a catering quotation by number of people, days and location from the SUMOVA kitchen and factory.') } });

  page('about', i('من نحن', 'About us'), [
    B('page_head', { title: i('من نحن', 'About us'), lede: i('شركة سعودية مقرها مكة المكرمة، تُشغّل بنفسها المصنع والمطبخ والتبريد والتخزين والنقل.', 'A Saudi company based in Makkah that runs its own factory, kitchen, cold storage, warehousing and delivery.') }),
    B('text_image', { title: i('نُشغّل بأنفسنا', 'We run it ourselves'), body: i('سوموفا شركة تجارية سعودية متعددة القطاعات، بخبرة تشغيلية تتجاوز عشر سنوات.\n\nنملك أصول التشغيل كلها ونديرها بفرقنا: مصنع للمخبوزات والعلب الفاخرة، ومطبخ للإعاشة، وثلاث ثلاجات كبرى، ومستودع، وأسطول من 21 مركبة. لذلك لا نترك جودة طلبك ولا موعده لطرف آخر.', 'SUMOVA is a Saudi multi-sector commercial company with more than ten years of operating experience.\n\nWe own every operating asset and run it with our own teams: a bakery and luxury-box factory, a catering kitchen, three large cold stores, a warehouse and a fleet of 21 vehicles. So the quality and timing of your order never depend on a third party.'), media: m.wide, side: 'end', facts: [
      { value: '10+', label: i('سنوات خبرة تشغيلية', 'years of operating experience') }, { value: '21', label: i('مركبة في الأسطول', 'vehicles in the fleet') }, { value: '3', label: i('ثلاجات تبريد كبرى', 'large cold stores') } ] }),
    B('richtext', { title: i('مجالان نعمل فيهما', 'Two areas we work in'), body: i('الأغذية والضيافة: المصنع ينتج المخبوزات والعلب الفاخرة بطاقة تعادل 100 ألف قطعة يوميًا، والمطبخ يجهّز الإعاشة بطاقة تعادل 50 ألف وجبة شهريًا.\n\nسلسلة التبريد والتوريد: ثلاث ثلاجات كبرى ومستودع وأسطول نقل يحفظ المنتجات ويوصلها إلى مواقع الجهات في الوقت المتفق عليه.\n\nوتعمل في المجالين إدارة مختصة بالجودة وسلامة الغذاء.', 'Food and hospitality: the factory makes bakery products and luxury boxes at a capacity equal to 100,000 pieces a day, and the kitchen prepares catering at a capacity equal to 50,000 meals a month.\n\nCold chain and supply: three large cold stores, a warehouse and a delivery fleet keep products right and bring them to client sites on the agreed time.\n\nA dedicated quality and food-safety team works across both.') }),
    B('richtext', { title: i('رؤيتنا ورسالتنا', 'Our vision and mission'), body: i('رؤيتنا: الريادة في الأغذية والإعاشة بمنتجات عالية الجودة وأثر مستدام.\n\nرسالتنا: تقديم منتجات غذائية آمنة ومبتكرة عبر تشغيل كفء وشراكات فعّالة.\n\nاسمنا: «سوموفا» يحمل معنى السُّمُوّ، وهو ما نطلبه في كل ما نقدمه.', 'Our vision: to lead in food and catering with high-quality products and lasting impact.\n\nOur mission: to provide safe, innovative food products through efficient operations and effective partnerships.\n\nOur name: “SUMOVA” carries the sense of rising higher, which is what we aim for in everything we deliver.') }),
    B('accreditations', { title: i('الاعتمادات', 'Accreditations'), items: [] }),
    B('cta', { title: i('نرحّب بطلبك', 'We welcome your request'), text: i('أرسل احتياجك ونرد عليك بعرض سعر مكتوب.', 'Send us what you need and we will reply with a written quotation.'), ...toQuote }),
  ], { sort: 50, nav: true, navLabel: i('من نحن', 'About'), seo: { title: i('من نحن | سوموفا', 'About us | SUMOVA'), desc: i('سوموفا شركة سعودية مقرها مكة المكرمة بخبرة تشغيلية تتجاوز عشر سنوات، تشغّل مصنعًا ومطبخًا وثلاجات ومستودعًا وأسطول نقل.', 'SUMOVA is a Saudi company based in Makkah with more than ten years of operating experience, running a factory, kitchen, cold stores, warehouse and fleet.') } });

  page('contact', i('تواصل معنا', 'Contact'), [
    B('page_head', { title: i('تواصل معنا', 'Contact us'), lede: i('اتصل بنا أو أرسل رسالة وسنرد عليك.', 'Call us or send a message and we will reply.') }),
    B('contact', { title: i('بيانات التواصل', 'Contact details'), intro: i('', '') }),
  ], { sort: 60, nav: true, navLabel: i('تواصل معنا', 'Contact'), seo: { title: i('تواصل معنا | سوموفا', 'Contact | SUMOVA'), desc: i('اتصل بسوموفا أو أرسل رسالتك عبر النموذج، وسنرد عليك في أقرب وقت.', 'Call SUMOVA or send a message through the form and we will reply as soon as possible.') } });

  page('request-quote', i('طلب عرض سعر', 'Request a quote'), [
    B('page_head', { title: i('طلب عرض سعر', 'Request a quote'), lede: i('أخبرنا بما تحتاجه ونرسل لك عرض سعر.', 'Tell us what you need and we will send you a quotation.') }),
    B('quote_form', { title: i('تفاصيل الطلب', 'Request details'), intro: i('', ''), kind: 'quote' }),
  ], { sort: 70, nav: false, seo: { title: i('طلب عرض سعر | سوموفا', 'Request a quote | SUMOVA'), desc: i('أرسل طلبك إلى سوموفا واستلم عرض السعر بصيغة PDF، ثم أكّد الطلب من صفحة المتابعة.', 'Send your request to SUMOVA, receive a PDF quotation, then confirm from the tracking page.') } });

  page('privacy', i('سياسة الخصوصية', 'Privacy policy'), [
    B('page_head', { title: i('سياسة الخصوصية', 'Privacy policy'), lede: i('', '') }),
    B('richtext', { title: i('من نحن', 'Who we are'), body: i('هذا الموقع تديره شركة سوموفا، سجل تجاري رقم 7017713426، المملكة العربية السعودية. تشرح هذه السياسة كيف نجمع بياناتك الشخصية ونستخدمها ونحميها وفق نظام حماية البيانات الشخصية في المملكة.', 'This website is run by SUMOVA, commercial registration 7017713426, Kingdom of Saudi Arabia. This policy explains how we collect, use and protect your personal data under the Saudi Personal Data Protection Law.') }),
    B('richtext', { title: i('ما الذي نجمعه ولماذا', 'What we collect and why'), body: i('عند إرسال طلب أو رسالة نجمع: الاسم، واسم الجهة، ورقم الجوال، والبريد الإلكتروني، وتفاصيل الطلب، والملفات التي ترفعها.\n\nنستخدمها فقط لدراسة طلبك والرد عليه وإعداد عرض السعر وتنفيذ الطلب والتواصل معك بشأنه. لا نستخدمها للتسويق دون موافقتك.', 'When you send a request or message we collect your name, organisation, mobile number, email, request details and any files you upload.\n\nWe use them only to review and answer your request, prepare the quotation, fulfil the order and contact you about it. We do not use them for marketing without your consent.') }),
    B('richtext', { title: i('المشاركة والحفظ', 'Sharing and storage'), body: i('لا نبيع بياناتك. لا نشاركها إلا مع من يلزم لتنفيذ طلبك (مثل مزود الاستضافة أو خدمة البريد) أو إذا طلبتها جهة رسمية بموجب الأنظمة.\n\nتُحفظ البيانات على خوادم داخل المملكة العربية السعودية، ونحتفظ بها طوال تعاملنا معك ثم للمدة التي تفرضها الأنظمة، وبعدها تُحذف.', 'We do not sell your data. We share it only where needed to fulfil your request (for example our hosting or email provider) or when a public authority requires it by law.\n\nData is stored on servers inside Saudi Arabia. We keep it while we work with you and then for the period the law requires, after which it is deleted.') }),
    B('richtext', { title: i('حقوقك وملفات تعريف الارتباط', 'Your rights and cookies'), body: i('يحق لك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها أو سحب موافقتك. راسلنا على البريد الإلكتروني المذكور في صفحة التواصل وسنرد خلال المدة النظامية.\n\nيستخدم الموقع ملفات تعريف ارتباط ضرورية لتشغيله فقط. إن فُعّلت أدوات قياس الزيارات فهي تجمع بيانات استخدام مجمّعة لا تحدد هويتك.', 'You may ask to see, correct or delete your data, or withdraw your consent. Email us at the address on the contact page and we will reply within the legal period.\n\nThe site uses only the cookies it needs to work. If visitor analytics are enabled, they collect aggregated usage data that does not identify you.') }),
  ], { sort: 90, nav: false, seo: { title: i('سياسة الخصوصية | سوموفا', 'Privacy policy | SUMOVA'), desc: i('كيف تجمع سوموفا بياناتك وتستخدمها وتحميها عند إرسال طلب أو رسالة.', 'How SUMOVA collects, uses and protects your data when you send a request or message.') } });

  page('terms', i('الشروط والأحكام', 'Terms'), [
    B('page_head', { title: i('الشروط والأحكام', 'Terms'), lede: i('', '') }),
    B('richtext', { title: i('شروط استخدام الموقع', 'Terms of use'), body: i('الموقع للتعريف بخدمات سوموفا وتقديم طلبات عروض الأسعار. إرسال الطلب لا يُعد التزامًا من أي طرف.\n\nالأسعار والكميات ومواعيد التسليم تُحدَّد في عرض السعر المكتوب، ولا تُعتمد إلا بعد تأكيد الطلب.\n\nيخضع استخدام الموقع للأنظمة المعمول بها في المملكة العربية السعودية.', 'This website presents SUMOVA services and accepts quotation requests. Sending a request does not bind either party.\n\nPrices, quantities and delivery dates are set in the written quotation and apply only after the order is confirmed.\n\nUse of this website is subject to the laws of the Kingdom of Saudi Arabia.') }),
  ], { sort: 91, nav: false, seo: { title: i('الشروط والأحكام | سوموفا', 'Terms | SUMOVA'), desc: i('شروط استخدام موقع سوموفا وتقديم طلبات عروض الأسعار.', 'Terms for using the SUMOVA website and submitting quotation requests.') } });

  // ── first owner account
  if (!one('SELECT 1 x FROM users LIMIT 1')) {
    const email = process.env.ADMIN_EMAIL || 'sumovagroup02@gmail.com';
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    createUser({ email, name: 'المالك', password, role: 'owner' }, null);
    if (!process.env.ADMIN_PASSWORD) {
      const f = path.join(DATA_DIR, 'FIRST-LOGIN.txt');
      fs.writeFileSync(f, `Dashboard: /admin\nEmail: ${email}\nPassword: ${password}\n\nChange this password after the first sign-in, then delete this file.\n`, { mode: 0o600 });
      console.log(`\n  First owner account created. Credentials saved to ${f}\n`);
    }
  }
  audit(null, 'seed', 'site', null, 'initial content');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { seedIfEmpty().then((r) => console.log(r ? 'seeded' : 'already has content')); }
