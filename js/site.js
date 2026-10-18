/* FOA — общая логика страниц: карточки, лайтбокс, скрытый вход в админку. */

(function () {
  /* ---------- лайтбокс ---------- */
  function ensureLightbox() {
    if (document.getElementById('foa-lightbox')) return;
    const lb = document.createElement('div');
    lb.id = 'foa-lightbox';
    lb.className = 'lightbox';
    lb.innerHTML = '<button class="lightbox__close" aria-label="Закрыть">×</button><img alt="">';
    lb.addEventListener('click', e => { if (e.target === lb || e.target.closest('.lightbox__close')) lb.classList.remove('is-open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('is-open'); });
    document.body.appendChild(lb);
  }
  window.FOAlightbox = function (src) {
    ensureLightbox();
    const lb = document.getElementById('foa-lightbox');
    lb.querySelector('img').src = src;
    lb.classList.add('is-open');
  };

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
