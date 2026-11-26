/* FOA — общая логика страниц: карточки, лайтбокс, скрытый вход в админку. */

(function () {
  /* ---------- лайтбокс с листанием: FOAgallery(photos, index) ---------- */
  let _lbList = [], _lbIdx = 0;

  function lbShow(i) {
    const lb = document.getElementById('foa-lightbox');
    _lbIdx = i;
    lb.querySelector('img').src = _lbList[i];
    const multi = _lbList.length > 1;
    lb.querySelector('.lightbox__count').textContent = multi ? (i + 1) + ' / ' + _lbList.length : '';
    lb.querySelector('.lightbox__prev').style.display = multi ? '' : 'none';
    lb.querySelector('.lightbox__next').style.display = multi ? '' : 'none';
  }

  function lbStep(d) {
    if (_lbList.length > 1) lbShow((_lbIdx + d + _lbList.length) % _lbList.length);
  }

  function ensureLightbox() {
    if (document.getElementById('foa-lightbox')) return;
    const lb = document.createElement('div');
    lb.id = 'foa-lightbox';
    lb.className = 'lightbox';
    lb.innerHTML =
      '<button class="lightbox__close" aria-label="Закрыть">×</button>' +
      '<button class="lightbox__nav lightbox__prev" aria-label="Предыдущее фото">‹</button>' +
      '<img alt="">' +
      '<button class="lightbox__nav lightbox__next" aria-label="Следующее фото">›</button>' +
      '<span class="lightbox__count"></span>';
    const close = () => lb.classList.remove('is-open');
    lb.addEventListener('click', e => {
      if (e.target === lb || e.target.closest('.lightbox__close')) close();
      else if (e.target.closest('.lightbox__prev')) lbStep(-1);
      else if (e.target.closest('.lightbox__next')) lbStep(1);
    });
    document.addEventListener('keydown', e => {
      if (!lb.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') lbStep(-1);
      else if (e.key === 'ArrowRight') lbStep(1);
    });
    let tx = null;
    lb.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (tx === null) return;
      const dx = e.changedTouches[0].clientX - tx;
      tx = null;
      if (Math.abs(dx) > 50) lbStep(dx < 0 ? 1 : -1);
    });
    document.body.appendChild(lb);
  }

  window.FOAgallery = function (photos, index) {
    ensureLightbox();
    _lbList = photos;
    lbShow(index || 0);
    document.getElementById('foa-lightbox').classList.add('is-open');
  };
  window.FOAlightbox = function (src) { window.FOAgallery([src], 0); };

  /* ---------- бургер-меню ---------- */
  const burger = document.querySelector('.burger');
  const nav = document.querySelector('.nav');
  if (burger && nav) {
    const closeNav = () => {
      nav.classList.remove('is-open');
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
    };
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
  }

  /* ---------- скрытый вход в админку: 3 быстрых клика ---------- */
  document.querySelectorAll('[data-admin-trigger]').forEach(el => {
    let n = 0, t = null;
    el.addEventListener('click', e => {
      e.preventDefault();
      n++;
      clearTimeout(t);
      t = setTimeout(() => n = 0, 1500);
      if (n >= 3) { n = 0; location.href = 'admin.html'; }
    });
  });

  /* ---------- форма заявки ---------- */
  const leadForm = document.getElementById('leadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = document.getElementById('leadMsg');
      const btn = leadForm.querySelector('button[type="submit"]');
      const data = Object.fromEntries(new FormData(leadForm).entries());
      btn.disabled = true;
      msg.className = 'lead-form__msg';
      msg.textContent = 'Отправляем…';
      try {
        const r = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!r.ok) throw 0;
        leadForm.reset();
        msg.textContent = 'Заявка отправлена — свяжемся с вами.';
        msg.classList.add('is-ok');
      } catch (err) {
        msg.textContent = 'Не вышло отправить — напишите нам в Telegram.';
        msg.classList.add('is-err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- карточка проекта ---------- */
  window.FOAcard = function (p, i, total) {
    const num = String(i + 1).padStart(2, '0');
    return `<a href="project.html?id=${encodeURIComponent(p.id)}" class="project-card">
      <div class="project-card__img"><img src="${p.cover}" alt="${p.title} — ${p.category}" loading="lazy"></div>
      <div class="project-card__meta">
        <span class="project-card__name">${p.title}</span>
        <span class="project-card__index">${num} / ${String(total).padStart(2, '0')}</span>
      </div>
    </a>`;
  };
})();
