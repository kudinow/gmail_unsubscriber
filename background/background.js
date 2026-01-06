/**
 * Background Service Worker для Gmail Subscription Cleaner
 * Управляет OAuth авторизацией и взаимодействием с Gmail API
 */

// Константы
const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY = 500; // мс между запросами (увеличено для соблюдения лимитов)

// Состояние
let accessToken = null;
let tokenExpiresAt = null;

// Переменная для хранения порта связи с popup
let popupPort = null;

/**
 * Обработчик подключения popup
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPort = port;
    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  }
});

/**
 * Отправка прогресса в popup
 */
function sendProgress(text, percent) {
  if (popupPort) {
    popupPort.postMessage({ type: 'progress', text, percent });
  }
}

/**
 * Обработчик сообщений от popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Получено сообщение:', request.action);
  
  switch (request.action) {
    case 'checkAuth':
      checkAuthentication()
        .then(authenticated => sendResponse({ authenticated }))
        .catch(error => sendResponse({ authenticated: false, error: error.message }));
      return true; // Асинхронный ответ
      
    case 'authenticate':
      authenticate()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'loadEmails':
      loadAndAnalyzeEmails(request.maxResults || 500)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'deleteEmails':
      deleteEmailsFromSender(request.email)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    default:
      sendResponse({ success: false, error: 'Неизвестное действие' });
  }
});

/**
 * Проверка статуса авторизации
 */
async function checkAuthentication() {
  try {
    // Сбрасываем кэш токена
    accessToken = null;
    tokenExpiresAt = null;
    
    // Пытаемся получить токен без интерактивной авторизации
    const token = await getAuthToken(false);
    return !!token;
  } catch (error) {
    console.error('Ошибка проверки авторизации:', error);
    return false;
  }
}

/**
 * Авторизация пользователя
 */
async function authenticate() {
  try {
    const token = await getAuthToken(true);
    if (!token) {
      throw new Error('Не удалось получить токен авторизации');
    }
    return true;
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    throw error;
  }
}

/**
 * Получение токена авторизации
 * @param {boolean} interactive - показывать ли диалог авторизации
 */
async function getAuthToken(interactive = false) {
  try {
    // Проверяем кэшированный токен
    if (!interactive && accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
      return accessToken;
    }
    
    // Если интерактивная авторизация, сначала очищаем старый токен
    if (interactive) {
      await new Promise((resolve) => {
        chrome.identity.clearAllCachedAuthTokens(() => resolve());
      });
      accessToken = null;
      tokenExpiresAt = null;
    }
    
    // Получаем новый токен
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
    
    // Кэшируем токен (токены Google обычно живут 1 час)
    accessToken = token;
    tokenExpiresAt = Date.now() + 55 * 60 * 1000; // 55 минут для безопасности
    
    return token;
  } catch (error) {
    console.error('Ошибка получения токена:', error);
    throw error;
  }
}

/**
 * Выполнение запроса к Gmail API
 */
async function gmailApiRequest(endpoint, options = {}) {
  const token = await getAuthToken(false);
  
  const response = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    
    try {
      const error = await response.json();
      errorMessage = error.error?.message || errorMessage;
    } catch (e) {
      // Не JSON ответ, пытаемся получить текст
      const text = await response.text().catch(() => '');
      if (text) {
        console.error('Ответ не JSON:', text);
      }
    }
    
    // Обработка специфичных ошибок
    if (response.status === 401) {
      // Токен истек, сбрасываем кэш
      accessToken = null;
      tokenExpiresAt = null;
      throw new Error('Требуется повторная авторизация');
    } else if (response.status === 429) {
      throw new Error('Превышен лимит запросов. Попробуйте позже.');
    } else if (response.status === 403) {
      throw new Error('Недостаточно прав доступа. Проверьте scopes в Google Cloud Console.');
    }
    
    throw new Error(errorMessage);
  }
  
  // Проверяем статус 204 (No Content) - успешный ответ без тела
  if (response.status === 204) {
    return {};
  }
  
  // Проверяем, что ответ действительно JSON
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    // Если пустой ответ - это нормально для некоторых операций
    if (!text) {
      return {};
    }
    console.error('Ответ не JSON:', text);
    throw new Error('Сервер вернул не JSON ответ');
  }
  
  return response.json();
}

/**
 * Загрузка и анализ писем
 */
async function loadAndAnalyzeEmails(maxResults = 500) {
  try {
    console.log(`Начинаем загрузку писем (макс. ${maxResults})...`);
    sendProgress('Получение списка писем...', 10);
    
    // Получаем список ID писем
    const messageIds = await getAllMessageIds(maxResults);
    console.log(`Найдено ${messageIds.length} писем`);
    sendProgress(`Найдено ${messageIds.length} писем`, 30);
    
    // Загружаем детали писем батчами
    const messages = await loadMessagesBatch(messageIds);
    console.log(`Загружено ${messages.length} писем с деталями`);
    sendProgress('Анализ писем...', 80);
    
    // Анализируем и группируем по отправителям
    const analysis = analyzeMessages(messages);
    console.log(`Найдено ${analysis.senders.length} уникальных отправителей`);
    sendProgress('Сохранение результатов...', 95);
    
    // Кэшируем результаты
    await cacheAnalysis(analysis);
    sendProgress('Готово!', 100);
    
    return analysis;
  } catch (error) {
    console.error('Ошибка загрузки писем:', error);
    throw error;
  }
}

/**
 * Получение списка ID всех писем
 */
async function getAllMessageIds(maxResults) {
  const messageIds = [];
  let pageToken = null;
  
  while (messageIds.length < maxResults) {
    const params = new URLSearchParams({
      maxResults: Math.min(BATCH_SIZE, maxResults - messageIds.length),
      ...(pageToken && { pageToken })
    });
    
    const data = await gmailApiRequest(`/messages?${params}`);
    
    if (data.messages) {
      messageIds.push(...data.messages.map(m => m.id));
    }
    
    if (!data.nextPageToken || messageIds.length >= maxResults) {
      break;
    }
    
    pageToken = data.nextPageToken;
    
    // Небольшая задержка для соблюдения rate limits
    await sleep(RATE_LIMIT_DELAY);
  }
  
  return messageIds;
}

/**
 * Загрузка деталей писем батчами
 */
async function loadMessagesBatch(messageIds) {
  const messages = [];
  const batchSize = 10; // Уменьшено для соблюдения rate limits
  const totalBatches = Math.ceil(messageIds.length / batchSize);
  
  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;
    
    // Обновляем прогресс
    const progress = 30 + Math.floor((currentBatch / totalBatches) * 50);
    sendProgress(`Загрузка писем: ${messages.length}/${messageIds.length}`, progress);
    
    // Загружаем письма последовательно с задержкой
    for (const id of batch) {
      try {
        const message = await gmailApiRequest(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`);
        messages.push(message);
        await sleep(200); // Задержка между каждым запросом
      } catch (error) {
        console.error(`Ошибка загрузки письма ${id}:`, error);
        if (error.message.includes('лимит')) {
          // Если превышен лимит, ждем дольше
          await sleep(2000);
        }
      }
    }
    
    // Дополнительная задержка между батчами
    if (i + batchSize < messageIds.length) {
      await sleep(RATE_LIMIT_DELAY);
    }
  }
  
  return messages;
}

/**
 * Анализ писем и группировка по отправителям
 */
function analyzeMessages(messages) {
  const sendersMap = new Map();
  let totalEmails = 0;
  let unreadEmails = 0;
  
  for (const message of messages) {
    totalEmails++;
    
    // Проверяем, прочитано ли письмо
    const isUnread = message.labelIds?.includes('UNREAD');
    if (isUnread) {
      unreadEmails++;
    }
    
    // Извлекаем email отправителя
    const fromHeader = message.payload?.headers?.find(h => h.name === 'From');
    if (!fromHeader) continue;
    
    const email = extractEmail(fromHeader.value);
    if (!email) continue;
    
    // Извлекаем ссылку для отписки
    const unsubscribeHeader = message.payload?.headers?.find(
      h => h.name === 'List-Unsubscribe'
    );
    const unsubscribeLink = unsubscribeHeader 
      ? extractUnsubscribeLink(unsubscribeHeader.value)
      : null;
    
    // Обновляем статистику отправителя
    if (!sendersMap.has(email)) {
      sendersMap.set(email, {
        email,
        name: extractName(fromHeader.value),
        totalCount: 0,
        unreadCount: 0,
        messageIds: [],
        unsubscribeLink: unsubscribeLink
      });
    }
    
    const sender = sendersMap.get(email);
    sender.totalCount++;
    if (isUnread) sender.unreadCount++;
    sender.messageIds.push(message.id);
    
    // Обновляем ссылку для отписки (берем последнюю найденную)
    if (unsubscribeLink && !sender.unsubscribeLink) {
      sender.unsubscribeLink = unsubscribeLink;
    }
  }
  
  // Конвертируем Map в массив и сортируем по количеству писем
  const senders = Array.from(sendersMap.values())
    .sort((a, b) => b.totalCount - a.totalCount);
  
  return {
    senders,
    stats: {
      totalEmails,
      unreadEmails,
      totalSenders: senders.length
    }
  };
}

/**
 * Извлечение email из строки "Name <email@example.com>"
 */
function extractEmail(fromString) {
  const match = fromString.match(/<(.+?)>/);
  if (match) {
    return match[1].toLowerCase();
  }
  
  // Если нет угловых скобок, возможно это просто email
  if (fromString.includes('@')) {
    return fromString.trim().toLowerCase();
  }
  
  return null;
}

/**
 * Извлечение имени из строки "Name <email@example.com>"
 */
function extractName(fromString) {
  const match = fromString.match(/^(.+?)\s*</);
  if (match) {
    return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Извлечение ссылки для отписки из заголовка
 */
function extractUnsubscribeLink(headerValue) {
  // Формат: <http://example.com/unsubscribe>, <mailto:unsub@example.com>
  const urlMatch = headerValue.match(/<(https?:\/\/[^>]+)>/);
  if (urlMatch) {
    return urlMatch[1];
  }
  return null;
}

/**
 * Удаление всех писем от отправителя (включая те, что не в кэше)
 */
async function deleteEmailsFromSender(email) {
  try {
    console.log(`Удаление ВСЕХ писем от ${email}...`);
    sendProgress(`Поиск всех писем от ${email}...`, 10);
    
    // Получаем ВСЕ письма от этого отправителя (не только из кэша)
    const allMessageIds = [];
    let pageToken = null;
    
    do {
      const params = new URLSearchParams({
        q: `from:${email}`,
        maxResults: 500,
        ...(pageToken && { pageToken })
      });
      
      const data = await gmailApiRequest(`/messages?${params}`);
      
      if (data.messages) {
        allMessageIds.push(...data.messages.map(m => m.id));
        sendProgress(`Найдено ${allMessageIds.length} писем...`, 30);
      }
      
      pageToken = data.nextPageToken;
      
      if (pageToken) {
        await sleep(RATE_LIMIT_DELAY);
      }
    } while (pageToken);
    
    console.log(`Найдено ${allMessageIds.length} писем от ${email}`);
    
    if (allMessageIds.length === 0) {
      throw new Error('Письма не найдены');
    }
    
    sendProgress(`Удаление ${allMessageIds.length} писем...`, 50);
    
    // Удаляем письма батчами
    const batchSize = 1000; // Gmail API позволяет до 1000 за раз
    
    for (let i = 0; i < allMessageIds.length; i += batchSize) {
      const batch = allMessageIds.slice(i, i + batchSize);
      
      await gmailApiRequest('/messages/batchDelete', {
        method: 'POST',
        body: JSON.stringify({
          ids: batch
        })
      });
      
      const progress = 50 + Math.floor((i / allMessageIds.length) * 45);
      sendProgress(`Удалено ${Math.min(i + batchSize, allMessageIds.length)} из ${allMessageIds.length}`, progress);
      
      console.log(`Удалено ${Math.min(i + batchSize, allMessageIds.length)} из ${allMessageIds.length} писем`);
      
      // Задержка между батчами
      if (i + batchSize < allMessageIds.length) {
        await sleep(RATE_LIMIT_DELAY);
      }
    }
    
    console.log(`Успешно удалено ${allMessageIds.length} писем от ${email}`);
    sendProgress('Готово!', 100);
    
    // Обновляем кэш (удаляем отправителя)
    const cached = await chrome.storage.local.get(['emailAnalysis']);
    if (cached.emailAnalysis) {
      const sender = cached.emailAnalysis.senders.find(s => s.email === email);
      
      cached.emailAnalysis.senders = cached.emailAnalysis.senders.filter(
        s => s.email !== email
      );
      
      if (sender) {
        cached.emailAnalysis.stats.totalEmails -= sender.totalCount;
        cached.emailAnalysis.stats.unreadEmails -= sender.unreadCount;
        cached.emailAnalysis.stats.totalSenders--;
      }
      
      await chrome.storage.local.set({ emailAnalysis: cached.emailAnalysis });
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка удаления писем:', error);
    throw error;
  }
}

/**
 * Кэширование результатов анализа
 */
async function cacheAnalysis(analysis) {
  try {
    await chrome.storage.local.set({
      emailAnalysis: analysis,
      lastUpdated: Date.now()
    });
  } catch (error) {
    console.error('Ошибка кэширования:', error);
  }
}

/**
 * Утилита: задержка
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Обработка установки расширения
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Gmail Subscription Cleaner установлен:', details.reason);
  
  if (details.reason === 'install') {
    // Инициализация при первой установке
    chrome.storage.local.set({
      whitelist: [],
      settings: {
        autoRefresh: false,
        confirmDelete: true
      }
    });
  }
});

console.log('Background service worker запущен');

