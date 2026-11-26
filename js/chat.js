/* FOA — чат-виджет (GigaChat). Самодостаточный: стили и разметку внедряет сам. */
(function () {
  'use strict';

  var SID_KEY = 'foa_chat_sid';
  var HIST_KEY = 'foa_chat_history';

  function sessionId() {
    var sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = 's' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; }
    catch (e) { return []; }
  }

  function saveHistory(h) {
    localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-30)));
  }

  var css = '' +
    '.foa-chat-btn{position:fixed;right:20px;bottom:20px;z-index:9000;width:60px;height:60px;border-radius:50%;' +
    'background:var(--orange,#F04E23);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'box-shadow:0 8px 24px rgba(23,19,14,.25);transition:transform .2s ease, box-shadow .2s ease}' +
    '.foa-chat-btn:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(23,19,14,.32)}' +
    '.foa-chat-btn svg{width:26px;height:26px;stroke:var(--paper,#F1ECE3);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.foa-chat{position:fixed;right:20px;bottom:92px;z-index:9001;width:min(380px,calc(100vw - 24px));' +
    'height:min(560px,calc(100dvh - 120px));background:var(--paper,#F1ECE3);border:1px solid var(--ink,#17130E);' +
    'display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(23,19,14,.28);' +
    'opacity:0;pointer-events:none;transform:translateY(12px);transition:opacity .2s ease,transform .2s ease}' +
    '.foa-chat.open{opacity:1;pointer-events:auto;transform:none}' +
    '.foa-chat__head{padding:14px 16px;border-bottom:1px solid var(--ink,#17130E);display:flex;align-items:center;justify-content:space-between}' +
    '.foa-chat__title{font-family:var(--anton,"Arial Narrow",sans-serif);font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink,#17130E)}' +
    '.foa-chat__sub{font-size:11px;opacity:.55;margin-top:2px}' +
    '.foa-chat__close{background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:var(--ink,#17130E);padding:4px}' +
    '.foa-chat__body{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px}' +
    '.foa-msg{max-width:85%;padding:10px 13px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;color:var(--ink,#17130E)}' +
    '.foa-msg--bot{align-self:flex-start;background:#fff;border:1px solid var(--hairline,rgba(23,19,14,.14))}' +
    '.foa-msg--user{align-self:flex-end;background:var(--ink,#17130E);color:var(--paper,#F1ECE3)}' +
    '.foa-msg--file{font-size:12px;font-style:italic;opacity:.85}' +
    '.foa-typing{align-self:flex-start;padding:10px 14px;background:#fff;border:1px solid var(--hairline,rgba(23,19,14,.14));display:flex;gap:5px}' +
    '.foa-typing i{width:6px;height:6px;border-radius:50%;background:var(--ink,#17130E);opacity:.35;animation:foaDot 1.2s infinite}' +
    '.foa-typing i:nth-child(2){animation-delay:.2s}.foa-typing i:nth-child(3){animation-delay:.4s}' +
    '@keyframes foaDot{0%,60%,100%{opacity:.25}30%{opacity:.9}}' +
    '.foa-chat__foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--ink,#17130E)}' +
    '.foa-chat__attach{flex:0 0 auto;width:38px;height:38px;background:none;border:1px solid var(--hairline,rgba(23,19,14,.14));' +
    'cursor:pointer;display:flex;align-items:center;justify-content:center}' +
    '.foa-chat__attach svg{width:18px;height:18px;stroke:var(--ink,#17130E);fill:none;stroke-width:2;stroke-linecap:round}' +
    '.foa-chat__input{flex:1;border:1px solid var(--hairline,rgba(23,19,14,.14));background:#fff;padding:9px 12px;' +
    'font:inherit;font-size:14px;color:var(--ink,#17130E);outline:none;resize:none;max-height:96px}' +
    '.foa-chat__input:focus{border-color:var(--ink,#17130E)}' +
    '.foa-chat__send{flex:0 0 auto;width:38px;height:38px;border:none;background:var(--orange,#F04E23);cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center}' +
    '.foa-chat__send svg{width:18px;height:18px;stroke:var(--paper,#F1ECE3);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.foa-chat__send:disabled{opacity:.4;cursor:default}' +
    '@media (max-width:560px){.foa-chat{right:12px;bottom:84px}.foa-chat-btn{right:12px;bottom:16px;width:54px;height:54px}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.className = 'foa-chat-btn';
  btn.setAttribute('aria-label', 'Открыть чат');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var chat = document.createElement('div');
  chat.className = 'foa-chat';
  chat.innerHTML =
    '<div class="foa-chat__head">' +
      '<div><div class="foa-chat__title">Family of Artists</div>' +
      '<div class="foa-chat__sub">ответим на вопросы и соберём заявку</div></div>' +
      '<button class="foa-chat__close" aria-label="Закрыть">×</button>' +
    '</div>' +
    '<div class="foa-chat__body"></div>' +
    '<div class="foa-chat__foot">' +
      '<button class="foa-chat__attach" title="Прикрепить файл" aria-label="Прикрепить файл">' +
        '<svg viewBox="0 0 24 24"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
      '</button>' +
      '<textarea class="foa-chat__input" rows="1" placeholder="Напишите сообщение…"></textarea>' +
      '<button class="foa-chat__send" aria-label="Отправить">' +
        '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
      '</button>' +
    '</div>' +
    '<input type="file" hidden>';

  document.body.appendChild(btn);
  document.body.appendChild(chat);

  var body = chat.querySelector('.foa-chat__body');
  var input = chat.querySelector('.foa-chat__input');
  var sendBtn = chat.querySelector('.foa-chat__send');
  var fileInput = chat.querySelector('input[type=file]');
  var history = loadHistory();
  var busy = false;
  var filesSent = 0;

  function addMsg(role, text, cls) {
    var el = document.createElement('div');
    el.className = 'foa-msg foa-msg--' + role + (cls ? ' ' + cls : '');
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  history.forEach(function (m) { addMsg(m.role === 'user' ? 'user' : 'bot', m.content); });

  function greet() {
    if (history.length) return;
    var text = 'Здравствуйте! Я помогу разобраться с росписью: цены, сроки, процесс — спрашивайте. А если пришлёте фото стены и размеры, смогу собрать заявку художникам.';
    addMsg('bot', text);
    history.push({ role: 'assistant', content: text });
    saveHistory(history);
  }

  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'foa-typing';
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(typingEl);
    body.scrollTop = body.scrollHeight;
  }
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
  }

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    input.style.height = 'auto';
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    saveHistory(history);
    setBusy(true);
    showTyping();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId(), messages: history }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        hideTyping();
        setBusy(false);
        var reply = res.d.reply || res.d.error || 'Не получилось ответить. Оставьте заявку в форме ниже.';
        addMsg('bot', reply);
        history.push({ role: 'assistant', content: reply });
        saveHistory(history);
      })
      .catch(function () {
        hideTyping();
        setBusy(false);
        addMsg('bot', 'Связь прервалась. Попробуйте ещё раз или оставьте заявку в форме ниже.');
      });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  chat.querySelector('.foa-chat__attach').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      addMsg('bot', 'Файл больше 20 МБ — пришлите его позже в Telegram художникам.');
      return;
    }
    var fd = new FormData();
    fd.append('session_id', sessionId());
    fd.append('file', file);
    addMsg('user', 'Файл: ' + file.name, 'foa-msg--file');
    filesSent++;
    fetch('/api/chat/file', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var reply = d.ok
          ? (filesSent === 1
              ? 'Файл получен. Чтобы передать его художникам вместе с расчётом, мне нужно узнать ваше имя, город и удобный способ связи — Telegram, WhatsApp или телефон. Напишите эти данные, пожалуйста.'
              : 'Файл получен — приложу его к заявке.')
          : (d.error || 'Не удалось загрузить файл.');
        addMsg('bot', reply);
        if (d.ok) {
          history.push({ role: 'assistant', content: reply });
          saveHistory(history);
        }
      })
      .catch(function () {
        addMsg('bot', 'Не удалось загрузить файл. Попробуйте ещё раз.');
      });
  });

  btn.addEventListener('click', function () {
    chat.classList.toggle('open');
    if (chat.classList.contains('open')) { greet(); input.focus(); }
  });
  chat.querySelector('.foa-chat__close').addEventListener('click', function () {
    chat.classList.remove('open');
  });
})();
