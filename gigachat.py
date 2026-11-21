# -*- coding: utf-8 -*-
"""GigaChat API: OAuth + chat/completions. Порт server/gigachat.ts из проекта зеркал."""

import os
import time
import uuid

import requests

ROOT = os.path.dirname(os.path.abspath(__file__))
CA_PATH = os.path.join(ROOT, 'certs', 'russian_trusted_ca.pem')
VERIFY = (
    os.environ.get('GIGACHAT_TLS_VERIFY', '1') != '0'
    and os.path.isfile(CA_PATH)
    and CA_PATH
) or (os.environ.get('GIGACHAT_TLS_VERIFY', '1') != '0')

OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions'

MODEL_PRIMARY = os.environ.get('GIGACHAT_MODEL', 'GigaChat-Pro')
MODEL_FALLBACK = os.environ.get('GIGACHAT_MODEL_FALLBACK', 'GigaChat-Max')

# прокси не используем — GigaChat ходит напрямую (как в Node-версии)
_session = requests.Session()
_session.trust_env = False

_token = {'value': None, 'expires_at': 0.0}


def _get_token(force=False):
    if not force and _token['value'] and _token['expires_at'] > time.time() + 60:
        return _token['value']
    creds = os.environ.get('GIGACHAT_CREDENTIALS')
    if not creds:
        raise RuntimeError('GIGACHAT_CREDENTIALS is not set')
    scope = os.environ.get('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS')
    res = _session.post(
        OAUTH_URL,
        headers={
            'Authorization': 'Basic %s' % creds,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'RqUID': str(uuid.uuid4()),
        },
        data='scope=%s' % scope,
        verify=VERIFY,
        timeout=30,
    )
    if res.status_code != 200:
        raise RuntimeError('GigaChat auth failed: %s %s' % (res.status_code, res.text[:300]))
    data = res.json()
    _token['value'] = data['access_token']
    _token['expires_at'] = (data.get('expires_at') or (time.time() + 25 * 60) * 1000) / 1000
    return _token['value']


def _call_model(model, messages, functions):
    token = _get_token()
    payload = {
        'model': model,
        'messages': messages,
        'temperature': 0.6,
        'max_tokens': 900,
    }
    if functions:
        payload['functions'] = functions
        payload['function_call'] = 'auto'

    res = _session.post(
        CHAT_URL,
        headers={
            'Authorization': 'Bearer %s' % token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        json=payload,
        verify=VERIFY,
        timeout=45,
    )
    if res.status_code == 401:
        token = _get_token(force=True)
        res = _session.post(
            CHAT_URL,
            headers={
                'Authorization': 'Bearer %s' % token,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            json=payload,
            verify=VERIFY,
            timeout=45,
        )
    if res.status_code != 200:
        raise RuntimeError('GigaChat %s: HTTP %s %s' % (model, res.status_code, res.text[:300]))

    choice = (res.json().get('choices') or [None])[0]
    if not choice:
        raise RuntimeError('GigaChat %s: empty choices' % model)
    return {
        'message': choice['message'],
        'model': model,
        'finish_reason': choice.get('finish_reason', ''),
    }


def _call_with_retry(model, messages, functions):
    last = None
    for attempt in range(3):
        try:
            return _call_model(model, messages, functions)
        except Exception as e:
            last = e
            if 'HTTP 429' not in str(e) or attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise last


def chat_completion(messages, functions):
    try:
        return _call_with_retry(MODEL_PRIMARY, messages, functions)
    except Exception as e:
        print('[gigachat] %s failed, fallback %s: %s' % (MODEL_PRIMARY, MODEL_FALLBACK, e))
        return _call_with_retry(MODEL_FALLBACK, messages, functions)
