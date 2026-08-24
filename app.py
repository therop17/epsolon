"""
ESPOLÓN — app.py
Flask backend + Google Sheets integration
"""
import os
import json
import time
import hashlib
import hmac
from datetime import datetime
from urllib.parse import parse_qsl

from flask import Flask, render_template, request, jsonify
import gspread
from google.oauth2.service_account import Credentials

# ══════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', '4cae9e8fe7de6affd7bb67e35392e6ae32755d5d')

# ── Google Sheets ──
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

# Вставь ID своей Google таблицы (часть URL между /d/ и /edit)
# Пример: https://docs.google.com/spreadsheets/d/ЭТОТ_ID/edit
SPREADSHEET_ID = os.environ.get('SPREADSHEET_ID', '1MSuNj35A6h-G98KqEpskFpa2JYijquS3i0xtDRu3tsg')

# Telegram Bot Token (для валидации initData)
BOT_TOKEN = os.environ.get('BOT_TOKEN', '8578244905:AAFn7c9e5ionISowOXgYDW92sqg7sc-q4hw')

# Имена листов
SHEET_TEAMS        = 'Команды'
SHEET_NOM_EXTRA    = 'Дополнительные'       # данные: cristalino / enlighten
SHEET_NOM_MAIN     = 'Основные'    # данные форм: spirit/stereo
SHEET_NOM_TIRESOME = 'Нарушители тишины'   # заявки номинации tiresome (структурированные)
SHEET_ENROLL_TIRESOME  = 'Тишина'        # записи «Участвую» → Нарушители тишины
SHEET_ENROLL_CRISTALINO= 'Драйверы'      # записи «Участвую» → Драйверы Cristalino
SHEET_ENROLL_ENLIGHTEN = 'Просветитель'  # записи «Участвую» → Дерзкий просветитель

# ══════════════════════════════════════════════
# GOOGLE SHEETS CLIENT
# ══════════════════════════════════════════════

def get_sheets_client():
    """
    Создать авторизованный клиент Google Sheets.
    Продакшн: переменная окружения GOOGLE_CREDENTIALS (JSON-строка или base64).
    Локально:  файл credits.json рядом с app.py.
    """
    import base64

    raw = os.environ.get('GOOGLE_CREDENTIALS', '')
    if raw:
        # Попробуем сначала как base64, затем как plain JSON
        try:
            info = json.loads(base64.b64decode(raw).decode('utf-8'))
        except Exception:
            info = json.loads(raw)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        creds_path = os.path.join(os.path.dirname(__file__), 'credits.json')
        creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    return gspread.authorize(creds)


def get_or_create_sheet(spreadsheet, title, headers):
    """Получить лист или создать с заголовками."""
    try:
        ws = spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=title, rows=1000, cols=len(headers))
        ws.append_row(headers)
    return ws


_ENROLL_HEADERS = ['Дата', 'TG ID', 'TG Username', 'Имя']

# Заголовки листа «Нарушители тишины» — структурированные колонки
# (вместо единого JSON-блока, как в «Дополнительные»)
_TIRESOME_HEADERS = [
    'Дата', 'TG ID', 'TG Username', 'Имя', 'Номинация',
    'Ссылка на фото-отчёт', 'Ссылка на видео-отчёт', 'Ссылка на муд-борд',
]

def ensure_sheets(spreadsheet):
    """Создать все нужные листы если их нет."""
    get_or_create_sheet(spreadsheet, SHEET_TEAMS, [
        'Дата', 'TG ID', 'TG Username', 'Имя', 'Город', 'Заведение',
        'Соцсеть заведения', 'Соцсеть капитана', 'Площадь (м²)',
        'Номер лицензии', 'Юр. лицо / ИП', 'Ссылка на лицензию',
    ])
    get_or_create_sheet(spreadsheet, SHEET_NOM_EXTRA, [
        'Дата', 'TG ID', 'TG Username', 'Имя', 'Номинация',
        'Данные (JSON)',
    ])
    get_or_create_sheet(spreadsheet, SHEET_NOM_MAIN, [
        'Дата', 'TG ID', 'TG Username', 'Имя', 'Номинация',
        'Cristalino (л)', 'Anejo (л)', 'Reposado (л)', 'Blanco (л)',
        'Коктейли (шт)', 'Ссылка на пост', 'Ссылка на видео',
        'Ссылка 1', 'Ссылка 2', 'Ссылка 3',
    ])
    # Новый отдельный лист для заявок «Нарушители тишины» (структурированный)
    get_or_create_sheet(spreadsheet, SHEET_NOM_TIRESOME, _TIRESOME_HEADERS)
    # Листы записи заявок на участие в дополнительных номинациях
    get_or_create_sheet(spreadsheet, SHEET_ENROLL_TIRESOME,   _ENROLL_HEADERS)
    get_or_create_sheet(spreadsheet, SHEET_ENROLL_CRISTALINO, _ENROLL_HEADERS)
    get_or_create_sheet(spreadsheet, SHEET_ENROLL_ENLIGHTEN,  _ENROLL_HEADERS)
    # Меню
    get_or_create_sheet(spreadsheet, 'Меню', [
        'Дата', 'TG ID', 'TG Username', 'Имя', 'Ссылка на меню',
    ])


# ══════════════════════════════════════════════
# TELEGRAM VALIDATION
# ══════════════════════════════════════════════

def validate_telegram_data(init_data: str) -> dict | None:
    """
    Валидировать initData из Telegram WebApp.
    Возвращает dict с данными пользователя или None если невалидно.
    В dev-режиме (без BOT_TOKEN) пропускает проверку.
    """
    if BOT_TOKEN == '8578244905:AAFn7c9e5ionISowOXgYDW92sqg7sc-q4hw' or not BOT_TOKEN:
        return {}  # dev mode — skip validation

    if not init_data:
        return None

    params = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = params.pop('hash', None)
    if not received_hash:
        return None

    data_check_string = '\n'.join(
        f'{k}={v}' for k, v in sorted(params.items())
    )
    secret_key = hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        return None

    # Check freshness (1 hour)
    auth_date = int(params.get('auth_date', 0))
    if time.time() - auth_date > 3600:
        return None

    return params


# ══════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/check-registration', methods=['GET'])
def check_registration():
    """
    Check whether a Telegram user is registered in the sheet.
    Returns { registered: true/false, nominations: [submitted nom ids] }
    """
    tg_id = request.args.get('tg_id', '').strip()
    if not tg_id:
        return jsonify({'registered': False, 'nominations': []}), 200

    try:
        gc = get_sheets_client()
        ss = gc.open_by_key(SPREADSHEET_ID)
        ensure_sheets(ss)

        # Check team registration
        ws_teams = ss.worksheet(SHEET_TEAMS)
        tg_ids = ws_teams.col_values(2)  # TG ID column
        registered = tg_id in tg_ids

        # Check submitted nominations
        submitted_noms = []
        NOM_ID_MAP = {
            # Только cristalino и enlighten по-прежнему пишутся в «Дополнительные».
            # tiresome теперь проверяется отдельно, в своём листе.
            'Драйверы Cristalino': 'cristalino',
            'Дерзкий просветитель': 'enlighten',
        }
        NOM_MAIN_MAP = {
            'Дух бунтарей':       'spirit',
            'Вызов стереотипам':  'stereo',
        }

        # Extra nominations sheet (cristalino / enlighten)
        try:
            ws_extra = ss.worksheet(SHEET_NOM_EXTRA)
            rows_extra = ws_extra.get_all_values()
            for row in rows_extra[1:]:  # skip header
                if len(row) >= 5 and row[1] == tg_id:
                    nom_label = row[4]
                    nom_id = NOM_ID_MAP.get(nom_label)
                    if nom_id:
                        submitted_noms.append(nom_id)
        except Exception:
            pass

        # Tiresome nominations sheet (отдельный лист «Нарушители тишины»)
        try:
            ws_tiresome = ss.worksheet(SHEET_NOM_TIRESOME)
            rows_tiresome = ws_tiresome.get_all_values()
            for row in rows_tiresome[1:]:  # skip header
                if len(row) >= 2 and row[1] == tg_id:
                    submitted_noms.append('tiresome')
                    break
        except Exception:
            pass

        # Main nominations sheet
        try:
            ws_main = ss.worksheet(SHEET_NOM_MAIN)
            rows_main = ws_main.get_all_values()
            for row in rows_main[1:]:
                if len(row) >= 5 and row[1] == tg_id:
                    nom_label = row[4]
                    nom_id = NOM_MAIN_MAP.get(nom_label)
                    if nom_id:
                        submitted_noms.append(nom_id)
        except Exception:
            pass

        # Check enrollment in extra nominations (Тишина / Драйверы / Просветитель)
        # Only mark a user as enrolled if a corresponding submitted application
        # still exists in the relevant nomination sheet (Дополнительные для
        # cristalino/enlighten, Нарушители тишины для tiresome). Если запись
        # об участии осталась, но сама заявка была удалена вручную —
        # пользователь не считается "уже отправившим" и должен снова увидеть форму.
        enrolled_noms = []
        submitted_extra = set(submitted_noms)

        ENROLL_MAP = {
            SHEET_ENROLL_TIRESOME: 'tiresome',
            SHEET_ENROLL_CRISTALINO: 'cristalino',
            SHEET_ENROLL_ENLIGHTEN: 'enlighten',
        }

        for sheet_title, nom_key in ENROLL_MAP.items():
            try:
                ws_enroll = ss.worksheet(sheet_title)
                ids = ws_enroll.col_values(2)

                if tg_id in ids and nom_key in submitted_extra:
                    enrolled_noms.append(nom_key)
            except Exception:
                pass

        return jsonify({
            'registered': registered,
            'nominations': list(set(submitted_noms)),
            'enrolled': enrolled_noms,
        }), 200

    except Exception as e:
        app.logger.error(f'Sheets error (check-registration): {e}')
        # On error, fall back to whatever client has — don't wipe state
        return jsonify({'registered': None, 'nominations': [], 'error': str(e)}), 200


@app.route('/api/register-team', methods=['POST'])
def register_team():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    required = ['city', 'venue', 'legal']
    for f in required:
        if not str(data.get(f, '')).strip():
            return jsonify({'error': f'Поле «{f}» обязательно'}), 400

    now = datetime.now().strftime('%d.%m.%Y %H:%M')
    tg_id   = str(data.get('telegram_user_id', ''))
    tg_user = str(data.get('telegram_username', ''))
    tg_name = str(data.get('telegram_name', ''))

    row = [
        now,
        tg_id,
        tg_user,
        tg_name,
        data.get('city', '').strip(),
        data.get('venue', '').strip(),
        data.get('venue_link', '').strip(),
        data.get('captain_link', '').strip(),
        data.get('area', '').strip(),
        data.get('license', '').strip(),
        data.get('legal', '').strip(),
        data.get('license_link', '').strip(),
    ]

    try:
        gc = get_sheets_client()
        ss = gc.open_by_key(SPREADSHEET_ID)
        ensure_sheets(ss)
        ws = ss.worksheet(SHEET_TEAMS)

        # Check if already registered (by TG ID)
        if tg_id:
            existing = ws.col_values(2)  # TG ID column
            if tg_id in existing:
                return jsonify({'error': 'Ваша команда уже зарегистрирована'}), 409

        ws.append_row(row)
    except Exception as e:
        app.logger.error(f'Sheets error (register): {e}')
        return jsonify({'error': 'Ошибка записи в таблицу'}), 500

    return jsonify({'status': 'success', 'message': 'Команда зарегистрирована'}), 201


@app.route('/api/enroll-nomination', methods=['POST'])
def enroll_nomination():
    """
    Записать факт нажатия «Да, участвую» в дополнительной номинации.
    Пишет строку в соответствующий лист: Тишина / Драйверы / Просветитель.
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    nom_id  = data.get('nomination_id', '')
    now     = datetime.now().strftime('%d.%m.%Y %H:%M')
    tg_id   = str(data.get('telegram_user_id', '') or '')
    tg_user = str(data.get('telegram_username', '') or '')
    tg_name = str(data.get('telegram_name', '') or '')

    ENROLL_SHEET_MAP = {
        'tiresome':   SHEET_ENROLL_TIRESOME,
        'cristalino': SHEET_ENROLL_CRISTALINO,
        'enlighten':  SHEET_ENROLL_ENLIGHTEN,
    }
    sheet_name = ENROLL_SHEET_MAP.get(nom_id)
    if not sheet_name:
        return jsonify({'error': f'Unknown nomination: {nom_id}'}), 400

    try:
        gc = get_sheets_client()
        ss = gc.open_by_key(SPREADSHEET_ID)

        # Find or create the enrollment sheet
        try:
            ws = ss.worksheet(sheet_name)
        except gspread.WorksheetNotFound:
            ws = ss.add_worksheet(title=sheet_name, rows=1000, cols=4)
            ws.append_row(_ENROLL_HEADERS)

        # Deduplicate by TG ID (only if we have one)
        if tg_id:
            existing_ids = ws.col_values(2)  # column B = TG ID
            if tg_id in existing_ids:
                return jsonify({'status': 'already_enrolled'}), 200

        ws.append_row([now, tg_id, tg_user, tg_name])
        app.logger.info(f'Enrolled {tg_id or "anon"} in {sheet_name}')

    except Exception as e:
        app.logger.error(f'Sheets error (enroll {nom_id} → {sheet_name}): {e}')
        return jsonify({'error': str(e)}), 500

    return jsonify({'status': 'success'}), 200


@app.route('/api/submit-nomination', methods=['POST'])
def submit_nomination():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    nom_id  = data.get('nomination_id', '')
    now     = datetime.now().strftime('%d.%m.%Y %H:%M')
    tg_id   = str(data.get('telegram_user_id', ''))
    tg_user = str(data.get('telegram_username', ''))
    tg_name = str(data.get('telegram_name', ''))

    NOM_LABELS = {
        'tiresome':   'Нарушители тишины',
        'cristalino': 'Драйверы Cristalino',
        'enlighten':  'Дерзкий просветитель',
        'spirit':     'Дух бунтарей',
        'stereo':     'Вызов стереотипам',
    }
    nom_label = NOM_LABELS.get(nom_id, nom_id)

    def g(k): return str(data.get(k, '') or '')

    try:
        gc = get_sheets_client()
        ss = gc.open_by_key(SPREADSHEET_ID)
        ensure_sheets(ss)

        if nom_id == 'tiresome':
            # Пишем структурированной строкой в отдельный лист
            # «Нарушители тишины», а не JSON-блоком в «Дополнительные».
            ws = ss.worksheet(SHEET_NOM_TIRESOME)
            ws.append_row([
                now, tg_id, tg_user, tg_name, nom_label,
                g('tiresome-photo'), g('tiresome-video'), g('tiresome-moodboard'),
            ])

        elif nom_id in ('cristalino', 'enlighten'):
            ws = ss.worksheet(SHEET_NOM_EXTRA)
            # Build compact JSON of all submitted fields
            extra = {k: v for k, v in data.items()
                     if k not in ('nomination_id','telegram_user_id','telegram_username','telegram_name','submitted_at')}
            ws.append_row([now, tg_id, tg_user, tg_name, nom_label, json.dumps(extra, ensure_ascii=False)])

        elif nom_id in ('spirit', 'stereo'):
            ws = ss.worksheet(SHEET_NOM_MAIN)
            ws.append_row([
                now, tg_id, tg_user, tg_name, nom_label,
                g(f'{nom_id}-cristalino'), g(f'{nom_id}-anejo'),
                g(f'{nom_id}-reposado'),  g(f'{nom_id}-blanco'),
                g(f'{nom_id}-cocktails'), g(f'{nom_id}-post'),
                g(f'{nom_id}-video'),
                g(f'{nom_id}-link1'), g(f'{nom_id}-link2'), g(f'{nom_id}-link3'),
            ])
        else:
            return jsonify({'error': 'Unknown nomination'}), 400

    except Exception as e:
        app.logger.error(f'Sheets error (nomination {nom_id}): {e}')
        return jsonify({'error': 'Ошибка записи в таблицу'}), 500

    return jsonify({'status': 'success'}), 200


@app.route('/api/upload-menu', methods=['POST'])
def upload_menu():
    """Save menu photo submission to Google Sheets (base64 reference)."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    now = datetime.now().strftime('%d.%m.%Y %H:%M')
    tg_id     = str(data.get('telegram_user_id', ''))
    tg_user   = str(data.get('telegram_username', ''))
    tg_name   = str(data.get('telegram_name', ''))
    menu_link = str(data.get('menu_link', ''))

    try:
        gc = get_sheets_client()
        ss = gc.open_by_key(SPREADSHEET_ID)
        # Write to a 'Меню' sheet
        try:
            ws = ss.worksheet('Меню')
        except:
            ws = ss.add_worksheet(title='Меню', rows=1000, cols=6)
            ws.append_row(['Дата', 'TG ID', 'TG Username', 'Имя', 'Ссылка на меню'])
        ws.append_row([now, tg_id, tg_user, tg_name, menu_link])
    except Exception as e:
        app.logger.error(f'Sheets error (menu): {e}')
        return jsonify({'error': 'Ошибка записи в таблицу'}), 500

    return jsonify({'status': 'success'}), 200


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Server error'}), 500


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=os.environ.get('FLASK_ENV') == 'development',
    )