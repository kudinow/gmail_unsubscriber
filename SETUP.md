# Инструкция по настройке Gmail Subscription Cleaner

## Шаг 1: Настройка Google Cloud Console

### 1.1 Создание проекта

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Нажмите "Select a project" → "New Project"
3. Введите название проекта: "Gmail Subscription Cleaner"
4. Нажмите "Create"

### 1.2 Включение Gmail API

1. В левом меню выберите "APIs & Services" → "Library"
2. Найдите "Gmail API"
3. Нажмите на карточку Gmail API
4. Нажмите "Enable"

### 1.3 Настройка OAuth Consent Screen

1. Перейдите в "APIs & Services" → "OAuth consent screen"
2. Выберите "External" (для тестирования) или "Internal" (если у вас Google Workspace)
3. Нажмите "Create"

Заполните обязательные поля:
- **App name**: Gmail Subscription Cleaner
- **User support email**: ваш email
- **Developer contact information**: ваш email

4. Нажмите "Save and Continue"

На странице "Scopes":
5. Нажмите "Add or Remove Scopes"
6. Найдите и добавьте следующие scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.readonly`
7. Нажмите "Update" → "Save and Continue"

На странице "Test users" (если выбрали External):
8. Нажмите "Add Users"
9. Добавьте свой Gmail аккаунт для тестирования
10. Нажмите "Save and Continue"

### 1.4 Создание OAuth 2.0 Client ID

1. Перейдите в "APIs & Services" → "Credentials"
2. Нажмите "Create Credentials" → "OAuth client ID"
3. Выберите "Chrome Extension" как тип приложения
4. Введите название: "Gmail Cleaner Extension"
5. В поле "Application ID" введите ID вашего расширения:
   - Временно можно оставить пустым
   - После первой загрузки расширения в Chrome, скопируйте его ID и вернитесь сюда
6. Нажмите "Create"

7. Скопируйте **Client ID** (формат: `xxxxx.apps.googleusercontent.com`)

## Шаг 2: Настройка расширения

### 2.1 Обновление manifest.json

1. Откройте файл `manifest.json`
2. Найдите строку:
```json
"client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com"
```
3. Замените `YOUR_CLIENT_ID.apps.googleusercontent.com` на ваш Client ID из шага 1.4

### 2.2 Загрузка расширения в Chrome

1. Откройте Chrome
2. Перейдите на `chrome://extensions/`
3. Включите "Developer mode" (переключатель в правом верхнем углу)
4. Нажмите "Load unpacked"
5. Выберите папку с проектом
6. Расширение будет загружено

### 2.3 Получение Extension ID

1. После загрузки расширения, скопируйте его ID (под названием расширения)
2. Вернитесь в Google Cloud Console → Credentials
3. Нажмите на созданный OAuth client
4. Обновите поле "Application ID" вашим Extension ID
5. Нажмите "Save"

## Шаг 3: Тестирование

1. Нажмите на иконку расширения в Chrome
2. Нажмите "Войти через Google"
3. Выберите ваш Gmail аккаунт
4. Разрешите доступ к Gmail
5. Расширение начнет загрузку писем

## Возможные проблемы и решения

### Ошибка: "Access blocked: This app's request is invalid"

**Решение**: Убедитесь, что:
- Extension ID в manifest.json совпадает с ID в Google Cloud Console
- OAuth consent screen настроен правильно
- Gmail API включен

### Ошибка: "The developer hasn't given you access to this app"

**Решение**: 
- Добавьте свой email в Test Users (OAuth consent screen)
- Или опубликуйте приложение (для production)

### Ошибка: "Insufficient Permission"

**Решение**:
- Проверьте, что добавлены правильные scopes в OAuth consent screen
- Удалите расширение и установите заново
- Отзовите доступ в настройках Google аккаунта и авторизуйтесь снова

### Расширение не загружает письма

**Решение**:
- Откройте DevTools (F12) на странице popup
- Проверьте Console на наличие ошибок
- Убедитесь, что Gmail API включен
- Проверьте, что токен авторизации получен успешно

## Лимиты Gmail API

Gmail API имеет следующие лимиты:
- **250 quota units/user/second** - основной лимит
- **1 billion quota units/day** - дневной лимит для проекта

Операции и их стоимость:
- Получение списка писем: 5 units
- Получение деталей письма: 5 units
- Удаление письма: 10 units
- Batch delete: 50 units (до 1000 писем)

Расширение оптимизировано для соблюдения этих лимитов через:
- Батчинг запросов
- Задержки между запросами
- Кэширование результатов

## Публикация расширения (опционально)

Для публикации в Chrome Web Store:

1. Создайте аккаунт разработчика Chrome Web Store ($5 единоразовый платеж)
2. Подготовьте иконки (16x16, 48x48, 128x128)
3. Создайте скриншоты для магазина
4. Заполните описание и метаданные
5. Загрузите ZIP архив с расширением
6. Отправьте на модерацию

Для production:
- Переведите OAuth consent screen в "Published" статус
- Пройдите верификацию Google (если требуется)
- Обновите privacy policy

## Поддержка

Если у вас возникли проблемы:
1. Проверьте Console в DevTools
2. Проверьте логи в Background Service Worker
3. Убедитесь, что все шаги выполнены правильно
4. Создайте issue в репозитории проекта

## Безопасность

- Никогда не публикуйте Client ID в публичных репозиториях
- Используйте .gitignore для исключения конфиденциальных данных
- Регулярно проверяйте доступы в настройках Google аккаунта
- Для production используйте отдельный проект в Google Cloud

