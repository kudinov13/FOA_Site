# -*- coding: utf-8 -*-
"""FOA — сервер сайта: статика + SQLite + API + конвертация фото в WebP."""

import hashlib
import json
import os
import sqlite3
import uuid
from functools import wraps
from io import BytesIO

from flask import Flask, g, jsonify, request, send_from_directory, session
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
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


# ---------- статика ----------

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
