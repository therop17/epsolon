# ESPOLÓN — Telegram Mini App

## Структура проекта

```
espolon/
├── app.py                  ← Flask backend
├── requirements.txt
├── credits.json            ← Google Service Account (уже есть)
├── static/
│   ├── css/base.css
│   └── js/tg.js
└── templates/
    └── index.html
```

## Что нужно сделать перед запуском

### 1. Google Таблица

1. Создай новую Google Таблицу
2. Скопируй её ID из URL:
   `https://docs.google.com/spreadsheets/d/**ВОТ_ЭТОТ_ID**/edit`
3. Добавь сервисный аккаунт как редактора:
   **service@vast-lightning-495115-e7.iam.gserviceaccount.com**
4. В `app.py` замени:
   ```python
   SPREADSHEET_ID = 'ВСТАВЬ_ID_ТАБЛИЦЫ_СЮДА'
   ```
   Или задай переменную окружения `SPREADSHEET_ID=...`

Листы создадутся автоматически при первом запросе:
- `Команды` — регистрации команд
- `Номинации_доп` — нарушители / cristalino / просветитель
- `Номинации_осн` — дух бунтарей / вызов стереотипам

### 2. Telegram Bot Token

В `app.py` замени:
```python
BOT_TOKEN = 'ВСТАВЬ_BOT_TOKEN_СЮДА'
```
Или задай переменную окружения `BOT_TOKEN=...`

Без токена приложение работает в dev-режиме (без валидации Telegram).

### 3. Правила и призы (страница)

В `templates/index.html` найди комментарий:
```html
<!-- ВСТАВЬ СЮДА содержимое документа -->
```
Скопируй текст из документа и добавь в стиле существующих секций.

## Установка и запуск

```bash
pip install -r requirements.txt

# Dev
FLASK_ENV=development python app.py

# Production (Gunicorn)
gunicorn app:app --bind 0.0.0.0:5000
```

## Переменные окружения

| Переменная       | Описание                        | Обязательна |
|------------------|---------------------------------|-------------|
| `SPREADSHEET_ID` | ID Google Таблицы               | ✅ |
| `BOT_TOKEN`      | Telegram Bot Token              | ✅ (для prod) |
| `SECRET_KEY`     | Flask secret key                | ✅ (для prod) |
| `PORT`           | Порт (по умолчанию 5000)        | — |
| `FLASK_ENV`      | development/production          | — |

## Деплой на Railway / Render

1. Загрузи проект на GitHub
2. Подключи репо к Railway/Render
3. Добавь переменные окружения
4. credits.json можно добавить как файл или через переменную `GOOGLE_CREDS_JSON`

## Как работает защита от повторной регистрации

- Регистрация команды: сервер проверяет TG ID в таблице — если уже есть, возвращает 409
- Номинации: состояние сохраняется в localStorage с ключом `espolon_{TG_ID}`
- При повторном входе tg.js восстанавливает все отправленные состояния
