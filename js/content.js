/* FOA — редактируемые блоки контента.
   Переопределения из /api/content применяются к элементам [data-editable].
   FOAContent.collect(page) используется админкой для построения реестра блоков. */
(function () {
  function applyOverrides() {
    fetch('/api/content').then(function (r) { return r.ok ? r.json() : {}; }).then(function (map) {
      document.querySelectorAll('[data-editable]').forEach(function (el) {
        var o = map[el.dataset.editable];
        if (!o) return;
        if (o.text) {
          if (el.tagName === 'UL' || el.tagName === 'OL') {
            el.innerHTML = o.text.split('\n').filter(function (s) { return s.trim(); })
              .map(function (s) { return '<li>' + s.replace(/</g, '&lt;') + '</li>'; }).join('');
          } else {
            el.textContent = o.text;
          }
        }
        var s = o.styles || {};
        if (s.mt) el.style.marginTop = s.mt;
        if (s.mb) el.style.marginBottom = s.mb;
        if (s.fs) el.style.fontSize = s.fs;
        if (s.color) el.style.color = s.color;
        if (s.font) el.style.fontFamily = s.font;
      });
    }).catch(function () {});
  }

  window.FOAContent = {
    /* собирает реестр редактируемых блоков со страницы (для админки) */
    collect: function (page) {
      return fetch(page).then(function (r) { return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        return Array.from(doc.querySelectorAll('[data-editable]')).map(function (el) {
          var isList = el.tagName === 'UL' || el.tagName === 'OL';
          var text = isList
            ? Array.from(el.children).map(function (li) { return li.textContent.trim(); }).join('\n')
            : el.textContent.trim();
          return {
            key: el.dataset.editable,
            label: el.dataset.label || el.dataset.editable,
            page: page,
            tag: el.tagName.toLowerCase(),
            isList: isList,
            text: text
          };
        });
      });
    }
  };

  applyOverrides();
})();
