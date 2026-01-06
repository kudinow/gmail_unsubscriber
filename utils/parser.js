/**
 * Email Parser
 * Парсинг и анализ писем Gmail
 */

class EmailParser {
  constructor() {
    this.unsubscribePatterns = [
      /unsubscribe/i,
      /opt-out/i,
      /remove.*list/i,
      /отписаться/i,
      /отказаться от рассылки/i
    ];
  }

  /**
   * Анализ массива писем и группировка по отправителям
   * @param {array} messages - массив писем из Gmail API
   * @returns {object} - объект с отправителями и статистикой
   */
  analyzeMessages(messages) {
    const sendersMap = new Map();
    let totalEmails = 0;
    let unreadEmails = 0;

    for (const message of messages) {
      if (!message || !message.payload) continue;

      totalEmails++;

      // Проверяем, прочитано ли письмо
      const isUnread = message.labelIds?.includes('UNREAD');
      if (isUnread) {
        unreadEmails++;
      }

      // Извлекаем данные отправителя
      const senderInfo = this.extractSenderInfo(message);
      if (!senderInfo.email) continue;

      // Извлекаем ссылку для отписки
      const unsubscribeLink = this.extractUnsubscribeLink(message);

      // Обновляем или создаем запись отправителя
      if (!sendersMap.has(senderInfo.email)) {
        sendersMap.set(senderInfo.email, {
          email: senderInfo.email,
          name: senderInfo.name,
          totalCount: 0,
          unreadCount: 0,
          messageIds: [],
          unsubscribeLink: null,
          lastMessageDate: null,
          isNewsletter: false
        });
      }

      const sender = sendersMap.get(senderInfo.email);
      sender.totalCount++;
      if (isUnread) sender.unreadCount++;
      sender.messageIds.push(message.id);

      // Обновляем ссылку для отписки (если еще не установлена)
      if (unsubscribeLink && !sender.unsubscribeLink) {
        sender.unsubscribeLink = unsubscribeLink;
      }

      // Обновляем дату последнего письма
      const messageDate = parseInt(message.internalDate);
      if (!sender.lastMessageDate || messageDate > sender.lastMessageDate) {
        sender.lastMessageDate = messageDate;
      }

      // Определяем, является ли это рассылкой
      if (this.isNewsletterMessage(message)) {
        sender.isNewsletter = true;
      }
    }

    // Конвертируем Map в массив и сортируем
    const senders = Array.from(sendersMap.values())
      .sort((a, b) => b.totalCount - a.totalCount);

    return {
      senders,
      stats: {
        totalEmails,
        unreadEmails,
        totalSenders: senders.length,
        newsletterSenders: senders.filter(s => s.isNewsletter).length
      }
    };
  }

  /**
   * Извлечение информации об отправителе
   * @param {object} message - письмо из Gmail API
   * @returns {object} - {email, name}
   */
  extractSenderInfo(message) {
    const fromHeader = this.getHeader(message, 'From');
    if (!fromHeader) {
      return { email: null, name: null };
    }

    return {
      email: this.extractEmail(fromHeader),
      name: this.extractName(fromHeader)
    };
  }

  /**
   * Извлечение email из строки "Name <email@example.com>"
   * @param {string} fromString - значение заголовка From
   * @returns {string|null}
   */
  extractEmail(fromString) {
    // Формат: "Name" <email@example.com> или Name <email@example.com>
    const match = fromString.match(/<(.+?)>/);
    if (match) {
      return match[1].toLowerCase().trim();
    }

    // Если нет угловых скобок, проверяем, является ли строка email
    if (fromString.includes('@')) {
      return fromString.trim().toLowerCase();
    }

    return null;
  }

  /**
   * Извлечение имени из строки "Name <email@example.com>"
   * @param {string} fromString - значение заголовка From
   * @returns {string|null}
   */
  extractName(fromString) {
    // Формат: "Name" <email@example.com> или Name <email@example.com>
    const match = fromString.match(/^(.+?)\s*</);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, '');
    }
    return null;
  }

  /**
   * Извлечение ссылки для отписки
   * @param {object} message - письмо из Gmail API
   * @returns {string|null}
   */
  extractUnsubscribeLink(message) {
    // Проверяем заголовок List-Unsubscribe
    const unsubscribeHeader = this.getHeader(message, 'List-Unsubscribe');
    if (unsubscribeHeader) {
      const link = this.parseUnsubscribeHeader(unsubscribeHeader);
      if (link) return link;
    }

    // Проверяем заголовок List-Unsubscribe-Post
    const unsubscribePostHeader = this.getHeader(message, 'List-Unsubscribe-Post');
    if (unsubscribePostHeader) {
      // Этот заголовок обычно содержит "List-Unsubscribe=One-Click"
      // Ссылка должна быть в List-Unsubscribe
      return null;
    }

    // TODO: В будущем можно добавить парсинг тела письма для поиска ссылок
    return null;
  }

  /**
   * Парсинг заголовка List-Unsubscribe
   * @param {string} headerValue - значение заголовка
   * @returns {string|null}
   */
  parseUnsubscribeHeader(headerValue) {
    // Формат: <http://example.com/unsubscribe>, <mailto:unsub@example.com>
    // Предпочитаем HTTP ссылки перед mailto
    
    const httpMatch = headerValue.match(/<(https?:\/\/[^>]+)>/);
    if (httpMatch) {
      return httpMatch[1];
    }

    const mailtoMatch = headerValue.match(/<mailto:([^>]+)>/);
    if (mailtoMatch) {
      return `mailto:${mailtoMatch[1]}`;
    }

    return null;
  }

  /**
   * Определение, является ли письмо рассылкой
   * @param {object} message - письмо из Gmail API
   * @returns {boolean}
   */
  isNewsletterMessage(message) {
    // Проверяем наличие специфичных заголовков рассылок
    const newsletterHeaders = [
      'List-Unsubscribe',
      'List-Id',
      'List-Post',
      'Precedence'
    ];

    for (const headerName of newsletterHeaders) {
      if (this.getHeader(message, headerName)) {
        return true;
      }
    }

    // Проверяем заголовок Precedence
    const precedence = this.getHeader(message, 'Precedence');
    if (precedence && precedence.toLowerCase() === 'bulk') {
      return true;
    }

    return false;
  }

  /**
   * Получение значения заголовка письма
   * @param {object} message - письмо из Gmail API
   * @param {string} headerName - имя заголовка
   * @returns {string|null}
   */
  getHeader(message, headerName) {
    if (!message.payload || !message.payload.headers) {
      return null;
    }

    const header = message.payload.headers.find(
      h => h.name.toLowerCase() === headerName.toLowerCase()
    );

    return header ? header.value : null;
  }

  /**
   * Получение темы письма
   * @param {object} message - письмо из Gmail API
   * @returns {string}
   */
  getSubject(message) {
    return this.getHeader(message, 'Subject') || '(без темы)';
  }

  /**
   * Получение даты письма
   * @param {object} message - письмо из Gmail API
   * @returns {Date}
   */
  getDate(message) {
    if (message.internalDate) {
      return new Date(parseInt(message.internalDate));
    }
    
    const dateHeader = this.getHeader(message, 'Date');
    if (dateHeader) {
      return new Date(dateHeader);
    }
    
    return new Date();
  }

  /**
   * Форматирование даты для отображения
   * @param {number} timestamp - timestamp в миллисекундах
   * @returns {string}
   */
  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Сегодня';
    } else if (diffDays === 1) {
      return 'Вчера';
    } else if (diffDays < 7) {
      return `${diffDays} дн. назад`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} нед. назад`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} мес. назад`;
    } else {
      const years = Math.floor(diffDays / 365);
      return `${years} г. назад`;
    }
  }

  /**
   * Фильтрация отправителей по критериям
   * @param {array} senders - массив отправителей
   * @param {object} filters - объект с фильтрами
   * @returns {array}
   */
  filterSenders(senders, filters = {}) {
    let filtered = [...senders];

    // Фильтр по поисковому запросу
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(sender =>
        sender.email.toLowerCase().includes(query) ||
        (sender.name && sender.name.toLowerCase().includes(query))
      );
    }

    // Фильтр только с непрочитанными
    if (filters.onlyUnread) {
      filtered = filtered.filter(sender => sender.unreadCount > 0);
    }

    // Фильтр только рассылки
    if (filters.onlyNewsletters) {
      filtered = filtered.filter(sender => sender.isNewsletter);
    }

    // Фильтр по минимальному количеству писем
    if (filters.minEmailCount) {
      filtered = filtered.filter(sender => sender.totalCount >= filters.minEmailCount);
    }

    // Сортировка
    if (filters.sortBy) {
      filtered = this.sortSenders(filtered, filters.sortBy, filters.sortOrder);
    }

    return filtered;
  }

  /**
   * Сортировка отправителей
   * @param {array} senders - массив отправителей
   * @param {string} sortBy - поле для сортировки
   * @param {string} sortOrder - порядок (asc/desc)
   * @returns {array}
   */
  sortSenders(senders, sortBy = 'totalCount', sortOrder = 'desc') {
    const sorted = [...senders];
    const multiplier = sortOrder === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      // Для строк используем локальное сравнение
      if (typeof aValue === 'string') {
        return multiplier * aValue.localeCompare(bValue);
      }

      // Для чисел обычное сравнение
      return multiplier * (bValue - aValue);
    });

    return sorted;
  }

  /**
   * Группировка отправителей по доменам
   * @param {array} senders - массив отправителей
   * @returns {object}
   */
  groupByDomain(senders) {
    const domains = new Map();

    for (const sender of senders) {
      const domain = sender.email.split('@')[1];
      
      if (!domains.has(domain)) {
        domains.set(domain, {
          domain,
          senders: [],
          totalEmails: 0,
          totalUnread: 0
        });
      }

      const domainGroup = domains.get(domain);
      domainGroup.senders.push(sender);
      domainGroup.totalEmails += sender.totalCount;
      domainGroup.totalUnread += sender.unreadCount;
    }

    return Array.from(domains.values())
      .sort((a, b) => b.totalEmails - a.totalEmails);
  }

  /**
   * Получение статистики по отправителям
   * @param {array} senders - массив отправителей
   * @returns {object}
   */
  getSendersStats(senders) {
    const totalEmails = senders.reduce((sum, s) => sum + s.totalCount, 0);
    const totalUnread = senders.reduce((sum, s) => sum + s.unreadCount, 0);
    const newsletterCount = senders.filter(s => s.isNewsletter).length;
    const withUnsubscribe = senders.filter(s => s.unsubscribeLink).length;

    return {
      totalSenders: senders.length,
      totalEmails,
      totalUnread,
      newsletterCount,
      withUnsubscribe,
      averageEmailsPerSender: totalEmails / senders.length || 0
    };
  }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmailParser;
}

