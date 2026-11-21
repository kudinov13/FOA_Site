# -*- coding: utf-8 -*-
"""Отправка заявок в Telegram через бота (прокси из TELEGRAM_PROXY_URL)."""

import os

import requests

_API = 'https://api.telegram.org/bot%s'


def _proxies():
    url = os.environ.get('TELEGRAM_PROXY_URL')
    return {'http': url, 'https': url} if url else None


def _configured():
    return bool(os.environ.get('TELEGRAM_BOT_TOKEN') and os.environ.get('TELEGRAM_CHAT_ID'))


def send_message(text):
    if not _configured():
        print('[telegram] not configured, skipped: %s' % text[:120])
        return
    url = _API % os.environ['TELEGRAM_BOT_TOKEN'] + '/sendMessage'
    res = requests.post(url, json={
        'chat_id': os.environ['TELEGRAM_CHAT_ID'],
        'text': text,
        'parse_mode': 'HTML',
        'disable_web_page_preview': True,
    }, proxies=_proxies(), timeout=30)
    if res.status_code != 200:
        print('[telegram] sendMessage failed: %s %s' % (res.status_code, res.text[:300]))


def send_document(file_path, caption):
    if not _configured():
        print('[telegram] not configured, document skipped: %s' % file_path)
        return
    url = _API % os.environ['TELEGRAM_BOT_TOKEN'] + '/sendDocument'
    with open(file_path, 'rb') as f:
        res = requests.post(url, data={
            'chat_id': os.environ['TELEGRAM_CHAT_ID'],
            'caption': caption[:1000],
        }, files={'document': (os.path.basename(file_path), f)},
            proxies=_proxies(), timeout=60)
    if res.status_code != 200:
        print('[telegram] sendDocument failed: %s %s' % (res.status_code, res.text[:300]))
