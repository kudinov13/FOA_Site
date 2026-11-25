/* FOA — редактируемые блоки контента.
   Переопределения из /api/content применяются к элементам [data-editable].
   Если открыта админ-сессия — у каждого блока появляется кнопка «✎»,
   открывающая инлайн-редактор (текст, шрифт, цвет, отступы, размер). */
(function () {
  var STYLE_CSS = {
    mt: 'marginTop', mb: 'marginBottom', fs: 'fontSize',
    color: 'color', font: 'fontFamily'
  };
  var overrides = {};
  var originals = new Map(); /* el -> { text, isList } */

  function isList(el) { return el.tagName === 'UL' || el.tagName === 'OL'; }

  function getText(el) {
    if (isList(el)) {
      return Array.prototype.map.call(el.children, function (li) {
        return li.textContent.trim();
      }).join('\n');
    }
    return el.textContent;
  }

  function setText(el, text) {
    if (isList(el)) {
      el.innerHTML = text.split('\n').filter(function (s) { return s.trim(); })
        .map(function (s) { return '<li>' + s.replace(/</g, '&lt;') + '</li>'; })
        .join('');
    } else {
      el.textContent = text;
    }
  }

  function applyStyles(el, s) {
    s = s || {};
    Object.keys(STYLE_CSS).forEach(function (k) {
      el.style[STYLE_CSS[k]] = s[k] || '';
    });
  }

  function applyOverrides() {
    document.querySelectorAll('[data-editable]').forEach(function (el) {
      if (!originals.has(el)) originals.set(el, { text: getText(el) });
      var o = overrides[el.dataset.editable];
      if (!o) return;
      if (o.text) setText(el, o.text);
      applyStyles(el, o.styles);
    });
  }

  /* ---------- инлайн-редактор для админа ---------- */

  var CSS =
    '.foa-eb{position:absolute;z-index:99990;padding:4px 9px;font:600 12px/1.2 var(--font),sans-serif;' +
    'background:#17130e;color:#f4efe6;border:1px solid #f4efe6;cursor:pointer;opacity:.35;transition:opacity .15s;border-radius:2px}' +
    '.foa-eb:hover{opacity:1}' +
    '.foa-emo{position:fixed;inset:0;z-index:99999;background:rgba(23,19,14,.55);display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.foa-em{background:#f4efe6;color:#17130e;border:2px solid #17130e;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:20px 22px;box-shadow:8px 8px 0 #e8501a}' +
    '.foa-em h4{margin:0 0 12px;font:700 15px/1.3 var(--font),sans-serif}' +
    '.foa-em textarea{width:100%;box-sizing:border-box;font:14px/1.5 var(--font),sans-serif;padding:10px;border:1px solid #17130e;background:#fff;resize:vertical}' +
    '.foa-em .row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:12px 0;font:12px var(--font),sans-serif}' +
    '.foa-em .row label{display:flex;align-items:center;gap:5px}' +
    '.foa-em .row input[type=number]{width:56px;padding:4px;border:1px solid #17130e}' +
    '.foa-em .row select{padding:4px;border:1px solid #17130e;background:#fff}' +
    '.foa-em .btns{display:flex;gap:10px;align-items:center}' +
    '.foa-em button{padding:8px 18px;font:600 13px var(--font),sans-serif;cursor:pointer;border:1px solid #17130e;background:#fff}' +
    '.foa-em button.primary{background:#e8501a;border-color:#e8501a;color:#fff}' +
    '.foa-em .ok{font-size:12px;color:#2a7d2a;font-weight:600}' +
    '.foa-em .lbl{font:11px var(--font),sans-serif;color:rgba(23,19,14,.55);margin-bottom:10px}';

  var modal, editing = null;

  function openEditor(el) {
    editing = el;
    var key = el.dataset.editable;
    var o = overrides[key] || {};
    var st = o.styles || {};
    var orig = originals.get(el);
    modal.querySelector('h4').textContent = el.dataset.label || key;
    modal.querySelector('.lbl').textContent = key;
    modal.querySelector('textarea').value = o.text != null && o.text !== '' ? o.text : orig.text;
    modal.querySelector('[data-s=font]').value = st.font || '';
    modal.querySelector('[data-s=colorOn]').checked = !!st.color;
    modal.querySelector('[data-s=color]').value = st.color || '#17130e';
    ['mt', 'mb', 'fs'].forEach(function (k) {
      modal.querySelector('[data-s=' + k + ']').value = st[k] ? parseInt(st[k], 10) : '';
    });
    modal.querySelector('.ok').hidden = true;
    modal.hidden = false;
  }

  function collectStyles() {
    var styles = {};
    var font = modal.querySelector('[data-s=font]').value;
    if (font) styles.font = font;
    if (modal.querySelector('[data-s=colorOn]').checked) {
      styles.color = modal.querySelector('[data-s=color]').value;
    }
    ['mt', 'mb', 'fs'].forEach(function (k) {
      var v = modal.querySelector('[data-s=' + k + ']').value;
      if (v !== '') styles[k] = v + 'px';
    });
    return styles;
  }

  function initEditor() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    modal = document.createElement('div');
    modal.className = 'foa-emo';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="foa-em"><h4></h4><div class="lbl"></div><textarea rows="4"></textarea>' +
      '<div class="row">' +
        '<label>Шрифт <select data-s="font">' +
          '<option value="">по умолчанию</option>' +
          '<option value="var(--anton)">заголовочный (Anton/Oswald)</option>' +
          '<option value="var(--font)">основной (Inter)</option>' +
        '</select></label>' +
        '<label><input type="checkbox" data-s="colorOn"> цвет <input type="color" data-s="color" value="#17130e"></label>' +
        '<label>сверху <input type="number" min="0" max="300" data-s="mt" placeholder="—">px</label>' +
        '<label>снизу <input type="number" min="0" max="300" data-s="mb" placeholder="—">px</label>' +
        '<label>размер <input type="number" min="8" max="160" data-s="fs" placeholder="—">px</label>' +
      '</div>' +
      '<div class="btns"><button class="primary" data-a="save">Сохранить</button>' +
      '<button data-a="reset">Сбросить</button><button data-a="close">Закрыть</button>' +
      '<span class="ok" hidden>сохранено ✓</span></div></div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) { modal.hidden = true; return; }
      var b = e.target.closest('button[data-a]');
      if (!b || !editing) return;
      var el = editing, key = el.dataset.editable;
      if (b.dataset.a === 'close') { modal.hidden = true; return; }
      if (b.dataset.a === 'save') {
        var text = modal.querySelector('textarea').value;
        var styles = collectStyles();
        fetch('/api/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: key, text: text, styles: styles })
        }).then(function (r) {
          if (!r.ok) return;
          overrides[key] = { text: text, styles: styles };
          setText(el, text);
          applyStyles(el, styles);
          var ok = modal.querySelector('.ok');
          ok.hidden = false;
          setTimeout(function () { ok.hidden = true; }, 2000);
          placeButtons();
        });
      } else if (b.dataset.a === 'reset') {
        fetch('/api/content/' + encodeURIComponent(key), { method: 'DELETE' })
          .then(function () {
            delete overrides[key];
            var orig = originals.get(el);
            setText(el, orig.text);
            applyStyles(el, {});
            modal.hidden = true;
            placeButtons();
          });
      }
    });

    /* плавающие кнопки-карандаши у каждого блока */
    var btns = [];
    document.querySelectorAll('[data-editable]').forEach(function (el) {
      var b = document.createElement('button');
      b.className = 'foa-eb';
      b.textContent = '✎';
      b.title = 'Редактировать: ' + (el.dataset.label || el.dataset.editable);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openEditor(el);
      });
      document.body.appendChild(b);
      btns.push({ b: b, el: el });
    });

    window._foaPlace = function () {
      btns.forEach(function (x) {
        var r = x.el.getBoundingClientRect();
        if (!r.width && !r.height) { x.b.style.display = 'none'; return; }
        x.b.style.display = '';
        x.b.style.top = (r.top + window.scrollY - 4) + 'px';
        x.b.style.left = Math.max(4, r.right + window.scrollX - 34) + 'px';
      });
    };
    placeButtons();
    window.addEventListener('scroll', placeButtons, { passive: true });
    window.addEventListener('resize', placeButtons);
    setTimeout(placeButtons, 1200); /* после докрутки шрифтов/шейдера */
  }

  function placeButtons() { if (window._foaPlace) window._foaPlace(); }

  fetch('/api/content').then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (map) {
      overrides = map;
      applyOverrides();
      return fetch('/api/me').then(function (r) { return r.ok ? r.json() : {}; });
    })
    .then(function (me) { if (me && me.admin) initEditor(); })
    .catch(function () {});
})();
