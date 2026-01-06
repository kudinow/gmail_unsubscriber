/**
 * Gmail API Wrapper
 * Обертка для работы с Gmail API с обработкой ошибок и rate limiting
 */

class GmailAPI {
  constructor() {
    this.baseUrl = 'https://www.googleapis.com/gmail/v1/users/me';
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.rateLimitDelay = 100; // мс между запросами
  }

  /**
   * Получение токена авторизации
   * @param {boolean} interactive - показывать ли диалог авторизации
   * @returns {Promise<string>}
   */
  async getAuthToken(interactive = false) {
    // Проверяем кэшированный токен
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!token) {
          reject(new Error('Не удалось получить токен'));
        } else {
          // Кэшируем токен на 55 минут
          this.accessToken = token;
          this.tokenExpiresAt = Date.now() + 55 * 60 * 1000;
          resolve(token);
        }
      });
    });
  }

  /**
   * Сброс токена (при ошибке 401)
   */
  resetToken() {
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  /**
   * Выполнение HTTP запроса к Gmail API
   * @param {string} endpoint - путь API (например, '/messages')
   * @param {object} options - опции fetch
   * @returns {Promise<object>}
   */
  async request(endpoint, options = {}) {
    const token = await this.getAuthToken(false);
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    // Обработка ошибок
    if (!response.ok) {
      await this.handleError(response);
    }

    return response.json();
  }

  /**
   * Обработка ошибок API
   */
  async handleError(response) {
    const error = await response.json().catch(() => ({}));
    const errorMessage = error.error?.message || `HTTP ${response.status}`;

    switch (response.status) {
      case 401:
        this.resetToken();
        throw new Error('Требуется повторная авторизация');
      
      case 403:
        throw new Error('Недостаточно прав доступа');
      
      case 429:
        throw new Error('Превышен лимит запросов. Попробуйте позже.');
      
      case 500:
      case 502:
      case 503:
        throw new Error('Сервер Gmail временно недоступен. Попробуйте позже.');
      
      default:
        throw new Error(errorMessage);
    }
  }

  /**
   * Получение списка писем с пагинацией
   * @param {object} params - параметры запроса
   * @returns {Promise<object>}
   */
  async getMessages(params = {}) {
    const queryParams = new URLSearchParams({
      maxResults: params.maxResults || 100,
      ...(params.pageToken && { pageToken: params.pageToken }),
      ...(params.q && { q: params.q }),
      ...(params.labelIds && { labelIds: params.labelIds })
    });

    return this.request(`/messages?${queryParams}`);
  }

  /**
   * Получение деталей письма
   * @param {string} messageId - ID письма
   * @param {string} format - формат ответа (full, metadata, minimal)
   * @param {array} metadataHeaders - заголовки для получения
   * @returns {Promise<object>}
   */
  async getMessage(messageId, format = 'metadata', metadataHeaders = []) {
    const params = new URLSearchParams({ format });
    
    metadataHeaders.forEach(header => {
      params.append('metadataHeaders', header);
    });

    return this.request(`/messages/${messageId}?${params}`);
  }

  /**
   * Массовое удаление писем
   * @param {array} messageIds - массив ID писем
   * @returns {Promise<void>}
   */
  async batchDelete(messageIds) {
    if (!messageIds || messageIds.length === 0) {
      throw new Error('Не указаны письма для удаления');
    }

    // Gmail API позволяет удалять до 1000 писем за раз
    const chunks = this.chunkArray(messageIds, 1000);

    for (const chunk of chunks) {
      await this.request('/messages/batchDelete', {
        method: 'POST',
        body: JSON.stringify({ ids: chunk })
      });

      // Задержка между батчами
      if (chunks.length > 1) {
        await this.sleep(this.rateLimitDelay);
      }
    }
  }

  /**
   * Удаление одного письма
   * @param {string} messageId - ID письма
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {
    return this.request(`/messages/${messageId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Модификация меток письма
   * @param {string} messageId - ID письма
   * @param {array} addLabelIds - метки для добавления
   * @param {array} removeLabelIds - метки для удаления
   * @returns {Promise<object>}
   */
  async modifyMessage(messageId, addLabelIds = [], removeLabelIds = []) {
    return this.request(`/messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({
        addLabelIds,
        removeLabelIds
      })
    });
  }

  /**
   * Пометить письмо как прочитанное
   * @param {string} messageId - ID письма
   * @returns {Promise<object>}
   */
  async markAsRead(messageId) {
    return this.modifyMessage(messageId, [], ['UNREAD']);
  }

  /**
   * Пометить письмо как непрочитанное
   * @param {string} messageId - ID письма
   * @returns {Promise<object>}
   */
  async markAsUnread(messageId) {
    return this.modifyMessage(messageId, ['UNREAD'], []);
  }

  /**
   * Получение профиля пользователя
   * @returns {Promise<object>}
   */
  async getProfile() {
    return this.request('/profile');
  }

  /**
   * Поиск писем по запросу
   * @param {string} query - поисковый запрос Gmail
   * @param {number} maxResults - максимальное количество результатов
   * @returns {Promise<array>}
   */
  async searchMessages(query, maxResults = 100) {
    const messages = [];
    let pageToken = null;

    while (messages.length < maxResults) {
      const response = await this.getMessages({
        q: query,
        maxResults: Math.min(100, maxResults - messages.length),
        pageToken
      });

      if (response.messages) {
        messages.push(...response.messages);
      }

      if (!response.nextPageToken || messages.length >= maxResults) {
        break;
      }

      pageToken = response.nextPageToken;
      await this.sleep(this.rateLimitDelay);
    }

    return messages;
  }

  /**
   * Получение всех писем от определенного отправителя
   * @param {string} email - email отправителя
   * @param {number} maxResults - максимальное количество результатов
   * @returns {Promise<array>}
   */
  async getMessagesFromSender(email, maxResults = 500) {
    const query = `from:${email}`;
    return this.searchMessages(query, maxResults);
  }

  /**
   * Batch запрос для получения деталей нескольких писем
   * @param {array} messageIds - массив ID писем
   * @param {string} format - формат ответа
   * @param {array} metadataHeaders - заголовки для получения
   * @returns {Promise<array>}
   */
  async batchGetMessages(messageIds, format = 'metadata', metadataHeaders = []) {
    const messages = [];
    const batchSize = 50; // Рекомендуемый размер батча

    const chunks = this.chunkArray(messageIds, batchSize);

    for (const chunk of chunks) {
      const promises = chunk.map(id =>
        this.getMessage(id, format, metadataHeaders)
          .catch(error => {
            console.error(`Ошибка загрузки письма ${id}:`, error);
            return null;
          })
      );

      const results = await Promise.all(promises);
      messages.push(...results.filter(m => m !== null));

      // Задержка между батчами
      if (chunks.length > 1) {
        await this.sleep(this.rateLimitDelay);
      }
    }

    return messages;
  }

  /**
   * Получение статистики почтового ящика
   * @returns {Promise<object>}
   */
  async getMailboxStats() {
    const profile = await this.getProfile();
    
    return {
      emailAddress: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
      threadsTotal: profile.threadsTotal,
      historyId: profile.historyId
    };
  }

  /**
   * Утилита: разбивка массива на части
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Утилита: задержка
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry логика с exponential backoff
   * @param {function} fn - функция для выполнения
   * @param {number} maxRetries - максимальное количество попыток
   * @returns {Promise<any>}
   */
  async retryWithBackoff(fn, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Не повторяем для некоторых ошибок
        if (error.message.includes('авторизации') || 
            error.message.includes('прав доступа')) {
          throw error;
        }
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000;
        console.log(`Попытка ${i + 1} не удалась. Повтор через ${delay}мс...`);
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GmailAPI;
}

