(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // mobile menu
  const mb = $('[data-menu]'), nav = $('#nav');
  if (mb && nav) {
    mb.addEventListener('click', () => { const o = nav.classList.toggle('open'); mb.setAttribute('aria-expanded', o); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); mb.focus(); } });
  }

  // operations strips: one open at a time (hover/focus/click on desktop)
  $$('[data-strips]').forEach((box) => {
    box.classList.add('is-live');
    const strips = $$('.strip', box);
    const open = (s) => strips.forEach((x) => { const on = x === s; x.classList.toggle('is-active', on); $('.strip__toggle', x)?.setAttribute('aria-expanded', on); });
    strips.forEach((s) => {
      const t = $('.strip__toggle', s);
      t?.addEventListener('click', () => open(s));
      t?.addEventListener('mouseenter', () => { if (matchMedia('(hover:hover)').matches) open(s); });
      t?.addEventListener('focus', () => open(s));
    });
  });

  // request cart (products added from the catalog)
  const KEY = 'sumova_cart';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const lang = document.documentElement.lang;
  const T = lang === 'ar' ? { added: 'أُضيف إلى الطلب', remove: 'حذف', qty: 'الكمية' } : { added: 'Added to request', remove: 'Remove', qty: 'Quantity' };

  $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const cart = read(); const id = Number(b.dataset.id);
    const sel = b.dataset.optFrom ? $(b.dataset.optFrom) : null;
    const opt = sel ? sel.value : (b.dataset.opt || '');
    const hit = cart.find((i) => i.id === id && i.opt === opt);
    if (hit) hit.qty += 1; else cart.push({ id, name: b.dataset.name, qty: 1, opt });
    write(cart);
    const old = b.textContent; b.textContent = T.added; b.setAttribute('aria-live', 'polite');
    setTimeout(() => { b.textContent = old; }, 1600);
  }));

  const form = $('[data-request-form]');
  if (form) {
    const box = $('[data-cart]', form), list = $('[data-cart-list]', form), input = $('[data-cart-input]', form);
    const draw = () => {
      const cart = read();
      input.value = JSON.stringify(cart.map(({ id, name, qty, opt }) => ({ id, name, qty, opt })));
      box.hidden = cart.length === 0;
      list.innerHTML = '';
      cart.forEach((it, i) => {
        const li = document.createElement('li');
        const nm = document.createElement('span'); nm.textContent = it.name + (it.opt ? ' – ' + it.opt : '');
        const q = document.createElement('input'); q.type = 'number'; q.min = 1; q.max = 100000; q.value = it.qty; q.setAttribute('aria-label', T.qty + ' ' + it.name);
        q.addEventListener('change', () => { const c = read(); c[i].qty = Math.max(1, parseInt(q.value, 10) || 1); write(c); draw(); });
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'linkbtn'; rm.textContent = T.remove;
        rm.addEventListener('click', () => { const c = read(); c.splice(i, 1); write(c); draw(); });
        li.append(nm, q, rm); list.append(li);
      });
    };
    draw();
    const cat = $('[data-catering]', form);
    $$('input[name=kind]', form).forEach((r) => r.addEventListener('change', () => { cat.hidden = r.value !== 'catering' || !r.checked; }));
    form.addEventListener('submit', (e) => {
      let bad = false;
      $$('[required]', form).forEach((f) => { const empty = !f.value.trim(); f.setAttribute('aria-invalid', empty); if (empty && !bad) { bad = true; f.focus(); } });
      if (bad) e.preventDefault();
    });
  }
  // file picker label (native control text follows the browser language, not the page)
  $$('[data-files]').forEach((inp) => {
    const out = inp.parentElement.querySelector('[data-files-out]'); if (!out) return;
    const empty = out.textContent;
    inp.addEventListener('change', () => { out.textContent = inp.files.length ? [...inp.files].map((f) => f.name).join('، ') : empty; });
  });
  if (document.body.dataset.clearCart === '1') write([]);
})();
