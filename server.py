# -*- coding: utf-8 -*-
"""FOA — сервер сайта: статика + SQLite + API + конвертация фото в WebP."""

import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from functools import wraps
from io import BytesIO

from flask import Flask, g, jsonify, request, send_from_directory, session
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))


def _load_env():
    env_path = os.path.join(ROOT, '.env')
    if not os.path.isfile(env_path):
        return
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()


_load_env()
DB_PATH = os.path.join(ROOT, 'foa.db')
MEDIA_DIR = os.path.join(ROOT, 'media')
SEED_FILE = os.path.join(ROOT, 'data', 'projects.json')

# sha256('admin:foa2026') — задать свой: FOA_ADMIN_HASH env или перегенерировать
ADMIN_HASH = os.environ.get(
    'FOA_ADMIN_HASH',
    '8706bd269ca1a36ad38a740fa807075faf68bdedc32e0a2271b16efbcdced4d8'
)

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('FOA_SECRET', 'foa-dev-secret-change-me')
app.config['MAX_CONTENT_LENGTH'] = 64 * 1024 * 1024  # 64 MB на пачку фото

os.makedirs(MEDIA_DIR, exist_ok=True)


# ---------- БД ----------

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_e):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute('''CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        cover TEXT NOT NULL,
        photos TEXT NOT NULL
    )''')
    db.execute('''CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        tg TEXT DEFAULT '',
        message TEXT DEFAULT '',
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )''')
    db.execute('''CREATE TABLE IF NOT EXISTS chat_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT DEFAULT '',
        lead_id INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )''')
    db.execute('''CREATE TABLE IF NOT EXISTS content_blocks (
        block_key TEXT PRIMARY KEY,
        text TEXT DEFAULT '',
        styles TEXT DEFAULT '{}'
    )''')
    try:
        db.execute("ALTER TABLE leads ADD COLUMN source TEXT DEFAULT 'form'")
    except sqlite3.OperationalError:
        pass
    db.commit()
    db.close()


def row_to_project(row):
    return {
        'id': row['id'],
        'title': row['title'],
        'category': row['category'],
        'description': row['description'],
        'cover': row['cover'],
        'photos': json.loads(row['photos'])
    }


# ---------- WebP ----------

def to_webp(img: Image.Image, max_side=1600, quality=82) -> bytes:
    if max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    if img.mode in ('RGBA', 'LA', 'P'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img.convert('RGBA'), mask=img.convert('RGBA').split()[-1])
        img = bg
    buf = BytesIO()
    img.convert('RGB').save(buf, 'WEBP', quality=quality, method=4)
    return buf.getvalue()


def save_webp(img: Image.Image) -> str:
    name = uuid.uuid4().hex + '.webp'
    path = os.path.join(MEDIA_DIR, name)
    with open(path, 'wb') as f:
        f.write(to_webp(img))
    return 'media/' + name


def media_path_for(src_path: str) -> str:
    """Конвертирует локальный файл в media/<name>.webp, кэширует результат."""
    src_abs = os.path.join(ROOT, src_path)
    if not os.path.isfile(src_abs):
        return src_path
    base = os.path.splitext(os.path.basename(src_path))[0]
    out_name = base + '.webp'
    out_path = os.path.join(MEDIA_DIR, out_name)
    if not os.path.isfile(out_path):
        try:
            with Image.open(src_abs) as img:
                with open(out_path, 'wb') as f:
                    f.write(to_webp(img))
        except Exception:
            return src_path
    return 'media/' + out_name


# ---------- seed ----------

def seed():
    db = sqlite3.connect(DB_PATH)
    count = db.execute('SELECT COUNT(*) FROM projects').fetchone()[0]
    if count:
        db.close()
        return
    with open(SEED_FILE, encoding='utf-8') as f:
        projects = json.load(f)
    for p in projects:
        photos = [media_path_for(ph) for ph in p['photos']]
        cover = media_path_for(p['cover'])
        db.execute(
            'INSERT INTO projects (id, title, category, description, cover, photos) VALUES (?,?,?,?,?,?)',
            (p['id'], p['title'], p['category'], p['description'], cover, json.dumps(photos))
        )
    db.commit()
    db.close()
    print('seeded %d projects' % len(projects))


# ---------- API ----------

def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if session.get('admin') != True:
            return jsonify({'error': 'unauthorized'}), 401
        return fn(*args, **kwargs)
    return wrapper


@app.post('/api/login')
def api_login():
    data = request.get_json(force=True, silent=True) or {}
    digest = hashlib.sha256(
        ('%s:%s' % (data.get('login', ''), data.get('password', ''))).encode()
    ).hexdigest()
    if digest == ADMIN_HASH:
        session['admin'] = True
        return jsonify({'ok': True})
    return jsonify({'error': 'Неверный логин или пароль'}), 401


@app.post('/api/logout')
def api_logout():
    session.pop('admin', None)
    return jsonify({'ok': True})


@app.get('/api/me')
def api_me():
    return jsonify({'admin': session.get('admin') == True})


@app.get('/api/projects')
def api_projects():
    rows = get_db().execute('SELECT * FROM projects').fetchall()
    return jsonify([row_to_project(r) for r in rows])


@app.get('/api/projects/<pid>')
def api_project(pid):
    row = get_db().execute('SELECT * FROM projects WHERE id = ?', (pid,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    return jsonify(row_to_project(row))


@app.post('/api/projects')
@require_admin
def api_create():
    title = (request.form.get('title') or '').strip()
    category = (request.form.get('category') or '').strip()
    description = (request.form.get('description') or '').strip()
    files = request.files.getlist('photos')
    cover_index = int(request.form.get('cover_index') or 0)

    if not title or not files:
        return jsonify({'error': 'Нужны название и хотя бы одно фото'}), 400

    photos = []
    for f in files:
        try:
            img = Image.open(f.stream)
            photos.append(save_webp(img))
        except Exception:
            continue
    if not photos:
        return jsonify({'error': 'Не удалось прочитать изображения'}), 400

    cover_index = max(0, min(cover_index, len(photos) - 1))
    pid = 'p' + uuid.uuid4().hex[:12]
    get_db().execute(
        'INSERT INTO projects (id, title, category, description, cover, photos) VALUES (?,?,?,?,?,?)',
        (pid, title, category, description, photos[cover_index], json.dumps(photos))
    )
    get_db().commit()
    return jsonify({'ok': True, 'id': pid})


@app.post('/api/projects/<pid>/cover')
@require_admin
def api_set_cover(pid):
    data = request.get_json(force=True, silent=True) or {}
    index = int(data.get('index') or 0)
    row = get_db().execute('SELECT * FROM projects WHERE id = ?', (pid,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    photos = json.loads(row['photos'])
    if not photos:
        return jsonify({'error': 'no photos'}), 400
    index = max(0, min(index, len(photos) - 1))
    get_db().execute('UPDATE projects SET cover = ? WHERE id = ?', (photos[index], pid))
    get_db().commit()
    return jsonify({'ok': True, 'cover': photos[index]})


@app.delete('/api/projects/<pid>')
@require_admin
def api_delete(pid):
    get_db().execute('DELETE FROM projects WHERE id = ?', (pid,))
    get_db().commit()
    return jsonify({'ok': True})


@app.put('/api/projects/<pid>')
@require_admin
def api_update(pid):
    row = get_db().execute('SELECT * FROM projects WHERE id = ?', (pid,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get('title') or '').strip() or row['title']
    category = (data.get('category') or '').strip() or row['category']
    description = (data.get('description') or '').strip() or row['description']
    get_db().execute(
        'UPDATE projects SET title = ?, category = ?, description = ? WHERE id = ?',
        (title, category, description, pid)
    )
    get_db().commit()
    return jsonify({'ok': True})


@app.post('/api/projects/<pid>/photos')
@require_admin
def api_add_photos(pid):
    row = get_db().execute('SELECT * FROM projects WHERE id = ?', (pid,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    photos = json.loads(row['photos'])
    for f in request.files.getlist('photos'):
        try:
            photos.append(save_webp(Image.open(f.stream)))
        except Exception:
            continue
    get_db().execute('UPDATE projects SET photos = ? WHERE id = ?', (json.dumps(photos), pid))
    get_db().commit()
    return jsonify({'ok': True, 'photos': photos})


@app.post('/api/projects/<pid>/photos/delete')
@require_admin
def api_del_photo(pid):
    row = get_db().execute('SELECT * FROM projects WHERE id = ?', (pid,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    data = request.get_json(force=True, silent=True) or {}
    photos = json.loads(row['photos'])
    idx = int(data.get('index', -1))
    if not (0 <= idx < len(photos)):
        return jsonify({'error': 'bad index'}), 400
    if len(photos) == 1:
        return jsonify({'error': 'Нельзя удалить единственное фото'}), 400
    removed = photos.pop(idx)
    cover = photos[0] if row['cover'] == removed else row['cover']
    get_db().execute('UPDATE projects SET photos = ?, cover = ? WHERE id = ?',
                     (json.dumps(photos), cover, pid))
    get_db().commit()
    return jsonify({'ok': True, 'photos': photos, 'cover': cover})


# ---------- заявки ----------

@app.post('/api/leads')
def api_lead_create():
    data = request.get_json(force=True, silent=True) or request.form
    if (data.get('website') or '').strip():     # honeypot — спам принимаем молча
        return jsonify({'ok': True})
    name = (data.get('name') or '').strip()
    phone = (data.get('phone') or '').strip()
    tg = (data.get('tg') or '').strip().lstrip('@')
    message = (data.get('message') or '').strip()
    if not name or not phone:
        return jsonify({'error': 'Укажите имя и телефон'}), 400
    cur = get_db().execute(
        'INSERT INTO leads (name, phone, tg, message, source) VALUES (?,?,?,?,?)',
        (name, phone, tg, message, 'form')
    )
    get_db().commit()
    try:
        from telegram_send import send_message
        esc = lambda s: str(s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        send_message(
            '<b>Новая заявка #%s с сайта семьяхудожников.рф (форма)</b>\n\n'
            '<b>Имя:</b> %s\n<b>Телефон:</b> %s\n'
            '<b>Telegram:</b> %s\n<b>Сообщение:</b> %s'
            % (cur.lastrowid, esc(name), esc(phone), esc('@' + tg if tg else '—'), esc(message or '—'))
        )
    except Exception as e:
        print('[leads] telegram notify failed:', e)
    return jsonify({'ok': True})


@app.get('/api/leads')
@require_admin
def api_leads():
    rows = get_db().execute('SELECT * FROM leads ORDER BY id DESC').fetchall()
    return jsonify([dict(r) for r in rows])


@app.post('/api/leads/<int:lid>/read')
@require_admin
def api_lead_read(lid):
    get_db().execute('UPDATE leads SET is_read = 1 WHERE id = ?', (lid,))
    get_db().commit()
    return jsonify({'ok': True})


@app.delete('/api/leads/<int:lid>')
@require_admin
def api_lead_delete(lid):
    get_db().execute('DELETE FROM leads WHERE id = ?', (lid,))
    get_db().commit()
    return jsonify({'ok': True})


# ---------- редактируемые блоки контента ----------

_STYLE_KEYS = ('font', 'color', 'mt', 'mb', 'fs')


@app.get('/api/content')
def api_content():
    rows = get_db().execute('SELECT block_key, text, styles FROM content_blocks').fetchall()
    return jsonify({
        r['block_key']: {'text': r['text'], 'styles': json.loads(r['styles'] or '{}')}
        for r in rows
    })


@app.post('/api/content')
@require_admin
def api_content_save():
    d = request.get_json(force=True, silent=True) or {}
    key = str(d.get('key') or '')[:100]
    if not key:
        return jsonify({'error': 'key required'}), 400
    text = str(d.get('text') or '')[:5000]
    raw_styles = d.get('styles')
    styles = {}
    if isinstance(raw_styles, dict):
        styles = {k: str(v)[:50] for k, v in raw_styles.items()
                  if k in _STYLE_KEYS and str(v).strip()}
    get_db().execute(
        'INSERT INTO content_blocks (block_key, text, styles) VALUES (?,?,?) '
        'ON CONFLICT(block_key) DO UPDATE SET text=excluded.text, styles=excluded.styles',
        (key, text, json.dumps(styles, ensure_ascii=False))
    )
    get_db().commit()
    return jsonify({'ok': True})


@app.delete('/api/content/<path:key>')
@require_admin
def api_content_delete(key):
    get_db().execute('DELETE FROM content_blocks WHERE block_key = ?', (key,))
    get_db().commit()
    return jsonify({'ok': True})


# ---------- чат-бот (GigaChat) ----------

CHAT_LIMIT = 30
CHAT_WINDOW = 10 * 60
_chat_hits = {}

MAX_HISTORY = 20
MAX_MESSAGE_LEN = 2000
SESSION_RE = re.compile(r'^[a-zA-Z0-9_-]{16,80}$')
PLACEHOLDER = re.compile(r'неуказан|не указан|unknown|нет данных|^\s*$', re.I)

CHAT_UPLOAD_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ai', '.pdf', '.eps', '.zip'}


def _rate_ok(key):
    now = time.time()
    hits = [t for t in _chat_hits.get(key, []) if now - t < CHAT_WINDOW]
    if len(hits) >= CHAT_LIMIT:
        _chat_hits[key] = hits
        return False
    hits.append(now)
    _chat_hits[key] = hits
    return True


def _esc(s):
    return str(s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _valid_application(a, history):
    required = [
        ('name', 'имя'),
        ('work_type', 'вид работы'),
        ('city', 'город'),
        ('contact_method', 'способ связи'),
        ('contact', 'контакт'),
    ]
    missing = [label for key, label in required if PLACEHOLDER.search(str(a.get(key) or ''))]
    if missing:
        return 'missing: %s' % ', '.join(missing)

    method = str(a.get('contact_method', '')).lower()
    contact = str(a.get('contact', '')).strip()
    if method not in ('telegram', 'phone', 'whatsapp'):
        return 'invalid: способ связи — telegram, phone или whatsapp'

    user_text = '\n'.join(m['content'] for m in history if m['role'] == 'user')
    user_digits = re.sub(r'\D', '', user_text)

    # имя должно быть реально названо клиентом — отдельным словом в его сообщениях
    name = str(a.get('name') or '').strip()
    if re.match(r'^(вы|клиент|заказчик|имя|неизвестн\w*|незнаком\w*|аноним\w*|user|пользователь|тест\w*|гость)$', name, re.I):
        return 'missing: имя — спросите «Как к вам обращаться?»'
    if not re.search(r'(?<![а-яёa-z0-9])' + re.escape(name.lower()) + r'(?![а-яёa-z0-9])', user_text.lower()):
        return 'invalid: имя не было указано клиентом — спросите «Как к вам обращаться?»'

    # клиент отказался от Telegram — нельзя записывать tg-контакт
    if method == 'telegram' and re.search(r'(не|нет|без)\b.{0,20}?(телеграм\w*|telegram|\bтг\b)', user_text, re.I):
        return 'invalid: клиент отказался от Telegram — спросите номер телефона'

    if method == 'telegram':
        if not re.match(r'^(@[a-zA-Z0-9_]{5,32}|https://t\.me/[a-zA-Z0-9_]{5,32}/?$)', contact):
            return 'invalid: нужен Telegram @username или ссылка https://t.me/username'
        if contact.lower() not in user_text.lower():
            return 'invalid: Telegram-контакт не был указан клиентом'
    else:
        if len(re.sub(r'\D', '', contact)) < 10:
            return 'invalid: номер телефона должен содержать не менее 10 цифр'
        contact_digits = re.sub(r'\D', '', contact)
        if contact_digits not in user_digits and contact_digits[1:] not in user_digits:
            return 'invalid: номер телефона не был указан клиентом'

    phone = str(a.get('phone') or '')
    if phone and len(re.sub(r'\D', '', phone)) < 10:
        return 'invalid: неверный номер телефона'
    return None


def _create_chat_lead(a, session_id):
    method = str(a.get('contact_method', '')).lower()
    contact = str(a.get('contact', '')).strip()
    phone = str(a.get('phone') or '').strip()
    tg = ''
    if method == 'telegram':
        tg = re.sub(r'^(https://t\.me/|@)', '', contact).strip('/')
    elif not phone:
        phone = contact
    lines = [
        '[чат-бот] Вид работы: %s' % (a.get('work_type') or ''),
        'Город: %s' % (a.get('city') or ''),
    ]
    for label, key in (('Задача', 'description'), ('Размеры', 'wall_size'), ('Сроки', 'deadline'), ('Комментарий', 'comment')):
        if a.get(key):
            lines.append('%s: %s' % (label, a[key]))
    cur = get_db().execute(
        'INSERT INTO leads (name, phone, tg, message, source) VALUES (?,?,?,?,?)',
        (str(a.get('name') or ''), phone, tg, '\n'.join(lines), 'chat')
    )
    lead_id = cur.lastrowid
    get_db().execute(
        'UPDATE chat_files SET lead_id = ? WHERE session_id = ? AND lead_id IS NULL',
        (lead_id, session_id)
    )
    get_db().commit()
    return lead_id


def _chat_files_for(session_id, lead_id=None):
    if lead_id is not None:
        return get_db().execute(
            'SELECT filename, original_name FROM chat_files WHERE lead_id = ?', (lead_id,)
        ).fetchall()
    return get_db().execute(
        'SELECT id, original_name FROM chat_files WHERE session_id = ? AND lead_id IS NULL',
        (session_id,)
    ).fetchall()


def _notify_chat_lead(lead_id, a):
    from telegram_send import send_message, send_document
    method = str(a.get('contact_method', '')).lower()
    contact_label = {'telegram': 'Telegram', 'phone': 'Звонок', 'whatsapp': 'WhatsApp'}.get(method, method)
    parts = [
        '<b>Заявка #%s с сайта семьяхудожников.рф (чат-бот)</b>' % lead_id,
        '',
        '<b>Имя:</b> %s' % _esc(a.get('name')),
        '<b>Работа:</b> %s' % _esc(a.get('work_type')),
        '<b>Город:</b> %s' % _esc(a.get('city')),
    ]
    if a.get('description'):
        parts.append('<b>Задача:</b> %s' % _esc(a['description']))
    if a.get('wall_size'):
        parts.append('<b>Размеры:</b> %s' % _esc(a['wall_size']))
    if a.get('deadline'):
        parts.append('<b>Сроки:</b> %s' % _esc(a['deadline']))
    parts += [
        '',
        '<b>Связь:</b> %s — %s' % (_esc(contact_label), _esc(a.get('contact'))),
    ]
    if a.get('phone'):
        parts.append('<b>Телефон:</b> %s' % _esc(a['phone']))
    if a.get('comment'):
        parts.append('<b>Комментарий:</b> %s' % _esc(a['comment']))
    send_message('\n'.join(parts))
    for f in _chat_files_for(None, lead_id):
        send_document(
            os.path.join(MEDIA_DIR, f['filename']),
            'Файл к заявке #%s: %s' % (lead_id, f['original_name'])
        )


@app.post('/api/chat')
def api_chat():
    if not _rate_ok('chat:%s' % (request.remote_addr or 'x')):
        return jsonify({'error': 'Слишком много сообщений. Попробуйте позже.'}), 429

    data = request.get_json(force=True, silent=True) or {}
    raw = data.get('messages')
    if not isinstance(raw, list):
        return jsonify({'error': 'bad request'}), 400
    history = [
        {'role': m['role'], 'content': str(m['content'])[:MAX_MESSAGE_LEN]}
        for m in raw[-MAX_HISTORY:]
        if isinstance(m, dict) and m.get('role') in ('user', 'assistant')
        and isinstance(m.get('content'), str)
    ]
    if not history:
        return jsonify({'error': 'empty history'}), 400

    session_id = data.get('session_id') if SESSION_RE.match(str(data.get('session_id', ''))) else ''

    if not os.environ.get('GIGACHAT_CREDENTIALS'):
        return jsonify({'reply': 'Чат временно недоступен — оставьте заявку в форме ниже, и художники свяжутся с вами.'})

    pending = _chat_files_for(session_id) if session_id else []
    file_ctx = ''
    if pending:
        file_ctx = '\n\nКЛИЕНТ ПРИКРЕПИЛ ФАЙЛЫ:\n%s\nФайлы автоматически уйдут в заявку; не проси прислать их повторно.' % '\n'.join(
            '%s. %s' % (i + 1, f['original_name']) for i, f in enumerate(pending)
        )

    from foa_prompt import SYSTEM_PROMPT, FUNCTIONS
    from gigachat import chat_completion
    messages = [{'role': 'system', 'content': SYSTEM_PROMPT + file_ctx}] + history
    try:
        result = chat_completion(messages, FUNCTIONS)
    except Exception as e:
        print('[chat] gigachat failed:', e)
        return jsonify({'reply': 'Не получилось ответить. Оставьте заявку в форме ниже — художники свяжутся с вами в течение дня.'})

    for _ in range(2):
        fc = result['message'].get('function_call')
        if not fc:
            break
        messages.append({
            'role': 'assistant',
            'content': result['message'].get('content') or '',
            'function_call': fc,
        })
        fn_name = fc.get('name')
        args = fc.get('arguments') or {}
        submitted = False

        if fn_name == 'submit_application':
            invalid = _valid_application(args, history)
            if invalid:
                fn_result = {'ok': False, 'error': 'Не хватает данных (%s). Доспроси клиента и вызови функцию снова.' % invalid}
            else:
                lead_id = _create_chat_lead(args, session_id)
                try:
                    _notify_chat_lead(lead_id, args)
                except Exception as e:
                    print('[chat] telegram notify failed:', e)
                files_n = len(_chat_files_for(None, lead_id))
                fn_result = {'ok': True, 'application_id': lead_id, 'files_attached': files_n}
                submitted = True
        elif fn_name == 'contact_admin':
            try:
                from telegram_send import send_message
                send_message(
                    '<b>Вопрос из чат-бота FOA</b>\n\n%s%s\n\nКлиент на сайте; если контакта нет — ответ невозможен, бот предложит оставить заявку.'
                    % (_esc(args.get('question')),
                       '\n\n<b>Контакт:</b> %s' % _esc(args.get('contact')) if args.get('contact') else '')
                )
            except Exception as e:
                print('[chat] handoff failed:', e)
            fn_result = {'ok': True}
        else:
            fn_result = {'ok': False, 'error': 'unknown function'}

        messages.append({'role': 'function', 'name': fn_name, 'content': json.dumps(fn_result)})
        result = chat_completion(messages, FUNCTIONS)

        if submitted and not result['message'].get('function_call'):
            return jsonify({
                'reply': 'Передал Алине фото и вводные. Она напишет по стоимости и срокам в течение дня. Спасибо!',
                'submitted': True,
                'model': result['model'],
            })

    return jsonify({'reply': result['message'].get('content') or '', 'model': result['model']})


@app.post('/api/chat/file')
def api_chat_file():
    f = request.files.get('file')
    session_id = request.form.get('session_id', '')
    if not SESSION_RE.match(session_id):
        return jsonify({'error': 'Некорректная сессия чата'}), 400
    if not f or not f.filename:
        return jsonify({'error': 'Нет файла'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in CHAT_UPLOAD_EXT:
        return jsonify({'error': 'Недопустимый формат файла'}), 400
    name = uuid.uuid4().hex + ext
    f.save(os.path.join(MEDIA_DIR, name))
    get_db().execute(
        'INSERT INTO chat_files (session_id, filename, original_name) VALUES (?,?,?)',
        (session_id, name, f.filename[:255])
    )
    get_db().commit()
    return jsonify({'ok': True, 'filename': f.filename})


# ---------- статика ----------

_STATIC_CACHE = ('.webp', '.png', '.jpg', '.jpeg', '.svg', '.woff', '.woff2', '.ttf')


@app.after_request
def cache_headers(resp):
    p = request.path.lower()
    if p.endswith(_STATIC_CACHE) or '.css' in p or '.js' in p:
        resp.headers['Cache-Control'] = 'public, max-age=2592000, immutable'
    elif p.endswith('.html') or p == '/':
        resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/', defaults={'path': 'index.html'})
@app.route('/<path:path>')
def static_files(path):
    if os.path.isfile(os.path.join(ROOT, path)):
        return send_from_directory(ROOT, path)
    return send_from_directory(ROOT, 'index.html')


if __name__ == '__main__':
    init_db()
    seed()
    app.run(host='0.0.0.0', port=8765, debug=False)
