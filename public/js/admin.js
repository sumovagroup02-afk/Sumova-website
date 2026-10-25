(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const csrf = document.body.dataset.csrf;
  let uid = 0;

  // confirm destructive buttons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm]');
    if (b && !window.confirm(b.dataset.confirm)) e.preventDefault();
  });

  // character counters (SEO title/description)
  const count = (el) => {
    const max = Number(el.dataset.count);
    let out = el.parentElement.querySelector('.count');
    if (!out) { out = document.createElement('small'); out.className = 'count'; el.after(out); }
    const n = el.value.length;
    out.textContent = n + ' / ' + max;
    out.classList.toggle('over', n > max);
  };
  $$('[data-count]').forEach((el) => { count(el); el.addEventListener('input', () => count(el)); });

  const form = $('[data-pageform]');
  let dirty = false;
  if (form) {
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ── blocks
  const holder = $('[data-blocks]');
  const move = (el, dir) => {
    const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    dir < 0 ? sib.before(el) : sib.after(el);
    dirty = true;
  };
  const tplHTML = (tpl, map) => { let s = tpl.innerHTML; for (const [k, v] of Object.entries(map)) s = s.split(k).join(v); return s; };

  document.addEventListener('click', (e) => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-bup]'))) { e.preventDefault(); move(b.closest('[data-block]'), -1); }
    else if ((b = t.closest('[data-bdown]'))) { e.preventDefault(); move(b.closest('[data-block]'), 1); }
    else if ((b = t.closest('[data-bdel]'))) { e.preventDefault(); if (window.confirm('حذف هذا القسم من الصفحة؟')) { b.closest('[data-block]').remove(); dirty = true; } }
    else if ((b = t.closest('[data-addblock]'))) {
      const type = $('[data-newtype]').value, tpl = $(`template[data-btpl="${type}"]`);
      const li = document.createElement('div');
      li.innerHTML = tplHTML(tpl, { __B__: 'n' + ++uid, __ID__: Math.random().toString(36).slice(2, 9) });
      const node = li.firstElementChild;
      holder.append(node); dirty = true;
      node.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      node.querySelector('input:not([type=hidden]),textarea')?.focus({ preventScroll: true });
    }
    // lists
    else if ((b = t.closest('[data-add]'))) {
      const box = b.closest('[data-list]'), rows = $('.lrows', box);
      if (rows.children.length >= Number(box.dataset.max)) { b.textContent = 'وصلت للحد الأقصى'; return; }
      const wrap = document.createElement('div');
      wrap.innerHTML = tplHTML($('template[data-tpl]', box), { __I__: 'n' + ++uid });
      const row = wrap.firstElementChild; rows.append(row); dirty = true;
      row.querySelector('input:not([type=hidden]),textarea')?.focus();
    }
    else if ((b = t.closest('[data-up]'))) { e.preventDefault(); move(b.closest('[data-row]'), -1); }
    else if ((b = t.closest('[data-down]'))) { e.preventDefault(); move(b.closest('[data-row]'), 1); }
    else if ((b = t.closest('[data-del]'))) { e.preventDefault(); b.closest('[data-row]').remove(); dirty = true; }
    // media fields
    else if ((b = t.closest('[data-clear]'))) { setMedia(b.closest('[data-media]'), null); }
    else if ((b = t.closest('[data-pick]'))) { openPicker(b.closest('[data-media]')); }
  });

  // renumber names so server receives the on-screen order
  if (form) form.addEventListener('submit', () => {
    dirty = false;
    $$('[data-block]', form).forEach((blk, i) => {
      $$('[name]', blk).forEach((el) => { el.name = el.name.replace(/^blocks\[[^\]]+\]/, `blocks[${i}]`); });
      $$('[data-list]', blk).forEach((list) => {
        $$(':scope > .lrows > [data-row]', list).forEach((row, j) => {
          $$('[name]', row).forEach((el) => { el.name = el.name.replace(/^(blocks\[\d+\]\[data\]\[[^\]]+\])\[[^\]]+\]/, `$1[${j}]`); });
        });
      });
    });
    // templates must not be submitted
    $$('template', form).forEach((t) => t.remove());
  });

  // ── media picker
  let dlg, target;
  const thumbFor = (box, url) => {
    const th = $('.thumb', box);
    th.innerHTML = '';
    if (url) { const im = document.createElement('img'); im.src = url; im.alt = ''; im.width = 120; im.height = 80; th.append(im); }
    else { const s = document.createElement('span'); s.className = 'empty'; s.textContent = 'بدون صورة'; th.append(s); }
  };
  function setMedia(box, item) {
    $('input[type=hidden]', box).value = item ? item.id : '';
    $('[data-clear]', box).hidden = !item;
    thumbFor(box, item ? item.thumb : null);
    dirty = true;
  }
  async function loadPicker(q = '') {
    const grid = $('.pgrid', dlg);
    grid.textContent = '…';
    const r = await fetch('/admin/media/picker.json?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
    const items = await r.json();
    grid.textContent = '';
    if (!items.length) { grid.textContent = 'لا توجد صور. ارفع صورة من الأعلى.'; return; }
    items.forEach((it) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pitem';
      const im = document.createElement('img'); im.src = it.thumb; im.alt = ''; im.width = 160; im.height = 107; im.loading = 'lazy';
      const sp = document.createElement('span'); sp.textContent = it.name;
      b.append(im, sp);
      b.addEventListener('click', () => { setMedia(target, it); dlg.close(); });
      grid.append(b);
    });
  }
  function openPicker(box) {
    target = box;
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.className = 'picker'; dlg.setAttribute('aria-label', 'اختيار صورة');
      dlg.innerHTML = '<div class="picker__h"><h2>اختيار صورة</h2><button type="button" class="ico" data-x aria-label="إغلاق">✕</button></div>' +
        '<div class="picker__tools"><input type="search" placeholder="بحث" aria-label="بحث"><label class="btn-s up">رفع صورة جديدة<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label><small class="msg" role="status"></small></div><div class="pgrid"></div>';
      document.body.append(dlg);
      $('[data-x]', dlg).addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      let t; $('input[type=search]', dlg).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => loadPicker(e.target.value), 250); });
      $('input[type=file]', dlg).addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const msg = $('.msg', dlg); msg.textContent = 'جارٍ الرفع…';
        const fd = new FormData(); fd.append('files', f);
        try {
          const r = await fetch('/admin/media/upload?json=1', { method: 'POST', body: fd, headers: { 'x-csrf-token': csrf, accept: 'application/json' }, credentials: 'same-origin' });
          const j = await r.json();
          if (!r.ok || !j.ids?.length) throw new Error(j.failed?.[0] || 'تعذّر الرفع');
          msg.textContent = 'تم الرفع. وصفها لاحقًا من قسم «الصور».'; await loadPicker();
        } catch (err) { msg.textContent = err.message; }
        e.target.value = '';
      });
    }
    $('.msg', dlg).textContent = '';
    $('input[type=search]', dlg).value = '';
    dlg.showModal(); loadPicker();
  }
})();
