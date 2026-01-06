/**
 * Storage Manager
 * Управление локальным хранилищем Chrome
 */

class StorageManager {
  constructor() {
    this.storage = chrome.storage.local;
    this.keys = {
      WHITELIST: 'whitelist',
      EMAIL_ANALYSIS: 'emailAnalysis',
      LAST_UPDATED: 'lastUpdated',
      SETTINGS: 'settings',
      HISTORY: 'actionHistory',
      CACHE: 'cache'
    };
  }

  /**
   * Получение данных из хранилища
   * @param {string|array} keys - ключ или массив ключей
   * @returns {Promise<object>}
   */
  async get(keys) {
    return new Promise((resolve, reject) => {
      this.storage.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Сохранение данных в хранилище
   * @param {object} data - объект с данными для сохранения
   * @returns {Promise<void>}
   */
  async set(data) {
    return new Promise((resolve, reject) => {
      this.storage.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Удаление данных из хранилища
   * @param {string|array} keys - ключ или массив ключей
   * @returns {Promise<void>}
   */
  async remove(keys) {
    return new Promise((resolve, reject) => {
      this.storage.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Очистка всего хранилища
   * @returns {Promise<void>}
   */
  async clear() {
    return new Promise((resolve, reject) => {
      this.storage.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  // === Белый список ===

  /**
   * Получение белого списка
   * @returns {Promise<Set>}
   */
  async getWhitelist() {
    const result = await this.get(this.keys.WHITELIST);
    return new Set(result[this.keys.WHITELIST] || []);
  }

  /**
   * Сохранение белого списка
   * @param {Set|array} whitelist - белый список
   * @returns {Promise<void>}
   */
  async saveWhitelist(whitelist) {
    const array = Array.isArray(whitelist) ? whitelist : Array.from(whitelist);
    await this.set({ [this.keys.WHITELIST]: array });
  }

  /**
   * Добавление email в белый список
   * @param {string} email - email для добавления
   * @returns {Promise<void>}
   */
  async addToWhitelist(email) {
    const whitelist = await this.getWhitelist();
    whitelist.add(email.toLowerCase());
    await this.saveWhitelist(whitelist);
  }

  /**
   * Удаление email из белого списка
   * @param {string} email - email для удаления
   * @returns {Promise<void>}
   */
  async removeFromWhitelist(email) {
    const whitelist = await this.getWhitelist();
    whitelist.delete(email.toLowerCase());
    await this.saveWhitelist(whitelist);
  }

  /**
   * Проверка, находится ли email в белом списке
   * @param {string} email - email для проверки
   * @returns {Promise<boolean>}
   */
  async isWhitelisted(email) {
    const whitelist = await this.getWhitelist();
    return whitelist.has(email.toLowerCase());
  }

  // === Анализ писем ===

  /**
   * Сохранение результатов анализа писем
   * @param {object} analysis - результаты анализа
   * @returns {Promise<void>}
   */
  async saveEmailAnalysis(analysis) {
    await this.set({
      [this.keys.EMAIL_ANALYSIS]: analysis,
      [this.keys.LAST_UPDATED]: Date.now()
    });
  }

  /**
   * Получение результатов анализа писем
   * @returns {Promise<object|null>}
   */
  async getEmailAnalysis() {
    const result = await this.get(this.keys.EMAIL_ANALYSIS);
    return result[this.keys.EMAIL_ANALYSIS] || null;
  }

  /**
   * Получение времени последнего обновления
   * @returns {Promise<number|null>}
   */
  async getLastUpdated() {
    const result = await this.get(this.keys.LAST_UPDATED);
    return result[this.keys.LAST_UPDATED] || null;
  }

  /**
   * Проверка актуальности кэша
   * @param {number} maxAge - максимальный возраст в миллисекундах
   * @returns {Promise<boolean>}
   */
  async isCacheValid(maxAge = 30 * 60 * 1000) { // 30 минут по умолчанию
    const lastUpdated = await this.getLastUpdated();
    if (!lastUpdated) return false;
    return (Date.now() - lastUpdated) < maxAge;
  }

  // === Настройки ===

  /**
   * Получение настроек
   * @returns {Promise<object>}
   */
  async getSettings() {
    const result = await this.get(this.keys.SETTINGS);
    return result[this.keys.SETTINGS] || this.getDefaultSettings();
  }

  /**
   * Сохранение настроек
   * @param {object} settings - настройки
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    await this.set({ [this.keys.SETTINGS]: settings });
  }

  /**
   * Обновление отдельной настройки
   * @param {string} key - ключ настройки
   * @param {any} value - значение
   * @returns {Promise<void>}
   */
  async updateSetting(key, value) {
    const settings = await this.getSettings();
    settings[key] = value;
    await this.saveSettings(settings);
  }

  /**
   * Получение настроек по умолчанию
   * @returns {object}
   */
  getDefaultSettings() {
    return {
      autoRefresh: false,
      confirmDelete: true,
      maxEmailsToLoad: 500,
      cacheExpiration: 30 * 60 * 1000, // 30 минут
      showOnlyNewsletters: false,
      sortBy: 'totalCount',
      sortOrder: 'desc'
    };
  }

  // === История действий ===

  /**
   * Добавление записи в историю
   * @param {object} action - действие
   * @returns {Promise<void>}
   */
  async addToHistory(action) {
    const history = await this.getHistory();
    
    const record = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      ...action
    };
    
    history.unshift(record);
    
    // Ограничиваем размер истории (последние 100 действий)
    if (history.length > 100) {
      history.splice(100);
    }
    
    await this.set({ [this.keys.HISTORY]: history });
  }

  /**
   * Получение истории действий
   * @param {number} limit - максимальное количество записей
   * @returns {Promise<array>}
   */
  async getHistory(limit = 50) {
    const result = await this.get(this.keys.HISTORY);
    const history = result[this.keys.HISTORY] || [];
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Очистка истории
   * @returns {Promise<void>}
   */
  async clearHistory() {
    await this.set({ [this.keys.HISTORY]: [] });
  }

  /**
   * Удаление старых записей из истории
   * @param {number} maxAge - максимальный возраст в миллисекундах
   * @returns {Promise<void>}
   */
  async cleanupHistory(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 дней
    const history = await this.getHistory(0); // Получаем всю историю
    const cutoff = Date.now() - maxAge;
    
    const filtered = history.filter(record => record.timestamp > cutoff);
    await this.set({ [this.keys.HISTORY]: filtered });
  }

  // === Кэш ===

  /**
   * Сохранение данных в кэш
   * @param {string} key - ключ кэша
   * @param {any} data - данные
   * @param {number} ttl - время жизни в миллисекундах
   * @returns {Promise<void>}
   */
  async setCache(key, data, ttl = 30 * 60 * 1000) {
    const cache = await this.getCache();
    
    cache[key] = {
      data,
      expires: Date.now() + ttl
    };
    
    await this.set({ [this.keys.CACHE]: cache });
  }

  /**
   * Получение данных из кэша
   * @param {string} key - ключ кэша
   * @returns {Promise<any|null>}
   */
  async getCache(key = null) {
    const result = await this.get(this.keys.CACHE);
    const cache = result[this.keys.CACHE] || {};
    
    if (key === null) {
      return cache;
    }
    
    const cached = cache[key];
    if (!cached) return null;
    
    // Проверяем срок действия
    if (cached.expires < Date.now()) {
      await this.removeCache(key);
      return null;
    }
    
    return cached.data;
  }

  /**
   * Удаление данных из кэша
   * @param {string} key - ключ кэша
   * @returns {Promise<void>}
   */
  async removeCache(key) {
    const cache = await this.getCache();
    delete cache[key];
    await this.set({ [this.keys.CACHE]: cache });
  }

  /**
   * Очистка устаревшего кэша
   * @returns {Promise<void>}
   */
  async cleanupCache() {
    const cache = await this.getCache();
    const now = Date.now();
    
    const cleaned = {};
    for (const [key, value] of Object.entries(cache)) {
      if (value.expires > now) {
        cleaned[key] = value;
      }
    }
    
    await this.set({ [this.keys.CACHE]: cleaned });
  }

  // === Утилиты ===

  /**
   * Получение размера хранилища
   * @returns {Promise<number>} размер в байтах
   */
  async getStorageSize() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(bytes);
        }
      });
    });
  }

  /**
   * Экспорт всех данных
   * @returns {Promise<object>}
   */
  async exportData() {
    return await this.get(null); // Получаем все данные
  }

  /**
   * Импорт данных
   * @param {object} data - данные для импорта
   * @returns {Promise<void>}
   */
  async importData(data) {
    await this.set(data);
  }

  /**
   * Инициализация хранилища (при первой установке)
   * @returns {Promise<void>}
   */
  async initialize() {
    const settings = await this.getSettings();
    
    // Если настройки пустые, устанавливаем значения по умолчанию
    if (Object.keys(settings).length === 0) {
      await this.saveSettings(this.getDefaultSettings());
    }
    
    // Инициализируем пустые структуры
    const whitelist = await this.getWhitelist();
    if (whitelist.size === 0) {
      await this.saveWhitelist([]);
    }
    
    const history = await this.getHistory(1);
    if (history.length === 0) {
      await this.set({ [this.keys.HISTORY]: [] });
    }
  }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}

