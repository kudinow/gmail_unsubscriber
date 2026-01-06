// Popup UI контроллер
class PopupController {
  constructor() {
    this.currentScreen = 'auth';
    this.senders = [];
    this.filteredSenders = [];
    this.whitelist = new Set();
    this.port = null;
    this.dataLoaded = false; // Флаг загрузки данных
    
    this.initElements();
    this.initEventListeners();
    this.connectToBackground();
    this.checkAuthStatus();
  }

  /**
   * Подключение к background для получения прогресса
   */
  connectToBackground() {
    this.port = chrome.runtime.connect({ name: 'popup' });
    this.port.onMessage.addListener((msg) => {
      if (msg.type === 'progress') {
        this.showProgress(msg.text, msg.percent);
      }
    });
  }

  /**
   * Инициализация элементов DOM
   */
  initElements() {
    // Экраны
    this.authScreen = document.getElementById('auth-screen');
    this.mainScreen = document.getElementById('main-screen');
    this.settingsScreen = document.getElementById('settings-screen');
    this.startScreen = document.getElementById('start-screen');
    
    // Кнопки
    this.authButton = document.getElementById('auth-button');
    this.startButton = document.getElementById('start-button');
    this.refreshButton = document.getElementById('refresh-button');
    this.settingsButton = document.getElementById('settings-button');
    this.backButton = document.getElementById('back-button');
    
    // Секции
    this.statsSection = document.querySelector('.stats');
    this.searchSection = document.querySelector('.search-section');
    this.sendersSection = document.querySelector('.senders-section');
    this.actionsSection = document.querySelector('.actions-section');
    
    // Статистика
    this.totalEmailsEl = document.getElementById('total-emails');
    this.unreadEmailsEl = document.getElementById('unread-emails');
    this.totalSendersEl = document.getElementById('total-senders');
    
    // Поиск и фильтры
    this.searchInput = document.getElementById('search-input');
    this.unreadFilter = document.getElementById('unread-filter');
    
    // Список отправителей
    this.sendersList = document.getElementById('senders-list');
    this.emptyState = document.getElementById('empty-state');
    
    // Прогресс
    this.progressContainer = document.getElementById('progress-container');
    this.progressFill = document.getElementById('progress-fill');
    this.progressText = document.getElementById('progress-text');
    
    // Модальное окно
    this.confirmModal = document.getElementById('confirm-modal');
    this.modalTitle = document.getElementById('modal-title');
    this.modalMessage = document.getElementById('modal-message');
    this.modalCancel = document.getElementById('modal-cancel');
    this.modalConfirm = document.getElementById('modal-confirm');
    
    // Белый список
    this.whitelistContainer = document.getElementById('whitelist-container');
    this.whitelistInput = document.getElementById('whitelist-input');
    this.addWhitelistButton = document.getElementById('add-whitelist-button');
  }

  /**
   * Инициализация обработчиков событий
   */
  initEventListeners() {
    // Авторизация
    this.authButton.addEventListener('click', () => this.handleAuth());
    
    // Стартовая кнопка
    this.startButton.addEventListener('click', () => this.loadEmails());
    
    // Навигация
    this.settingsButton.addEventListener('click', () => this.showScreen('settings'));
    this.backButton.addEventListener('click', () => this.showScreen('main'));
    
    // Обновление данных
    this.refreshButton.addEventListener('click', () => this.loadEmails());
    
    // Поиск с debounce
    let searchTimeout;
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.filterSenders(e.target.value, this.unreadFilter.checked);
      }, 300);
    });
    
    // Фильтр непрочитанных
    this.unreadFilter.addEventListener('change', (e) => {
      this.filterSenders(this.searchInput.value, e.target.checked);
    });
    
    // Модальное окно
    this.modalCancel.addEventListener('click', () => this.hideModal());
    
    // Белый список
    this.addWhitelistButton.addEventListener('click', () => this.addToWhitelist());
    this.whitelistInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addToWhitelist();
    });
  }

  /**
   * Проверка статуса авторизации
   */
  async checkAuthStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'checkAuth' });
      if (response.authenticated) {
        await this.loadWhitelist();
        this.showScreen('main');
        
        // Проверяем наличие кэшированных данных
        const cached = await chrome.storage.local.get(['emailAnalysis', 'lastUpdated']);
        if (cached.emailAnalysis && cached.lastUpdated) {
          const age = Date.now() - cached.lastUpdated;
          const maxAge = 30 * 60 * 1000; // 30 минут
          
          if (age < maxAge) {
            // Используем кэшированные данные
            console.log('Загрузка из кэша');
            this.senders = cached.emailAnalysis.senders || [];
            this.updateStats(cached.emailAnalysis.stats);
            this.filterSenders(this.searchInput.value, this.unreadFilter.checked);
            this.showDataView(); // Показываем данные
            this.dataLoaded = true;
          }
        }
        // Если нет кэша или он устарел, показываем стартовый экран
      } else {
        this.showScreen('auth');
      }
    } catch (error) {
      console.error('Ошибка проверки авторизации:', error);
      this.showScreen('auth');
    }
  }

  /**
   * Обработка авторизации
   */
  async handleAuth() {
    try {
      this.authButton.disabled = true;
      this.authButton.textContent = 'Авторизация...';
      
      const response = await chrome.runtime.sendMessage({ action: 'authenticate' });
      
      if (response.success) {
        await this.loadWhitelist();
        this.showScreen('main');
        // Не загружаем письма автоматически, ждем клика на кнопку
      } else {
        alert('Ошибка авторизации: ' + (response.error || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Ошибка авторизации:', error);
      alert('Ошибка авторизации. Попробуйте еще раз.');
    } finally {
      this.authButton.disabled = false;
      this.authButton.textContent = 'Войти через Google';
    }
  }

  /**
   * Загрузка писем
   */
  async loadEmails() {
    try {
      this.showProgress('Загрузка писем...', 0);
      
      const response = await chrome.runtime.sendMessage({ 
        action: 'loadEmails',
        maxResults: 500 
      });
      
      if (response.success) {
        this.senders = response.senders || [];
        this.updateStats(response.stats);
        this.filterSenders(this.searchInput.value, this.unreadFilter.checked);
        this.showDataView(); // Показываем интерфейс с данными
        this.dataLoaded = true;
      } else {
        // Проверяем, требуется ли повторная авторизация
        if (response.error && response.error.includes('авторизац')) {
          this.showScreen('auth');
          alert('Требуется повторная авторизация. Войдите снова.');
        } else {
          alert('Ошибка загрузки писем: ' + (response.error || 'Неизвестная ошибка'));
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки писем:', error);
      alert('Ошибка загрузки писем. Попробуйте еще раз.');
    } finally {
      this.hideProgress();
    }
  }

  /**
   * Показать интерфейс с данными
   */
  showDataView() {
    this.startScreen.classList.add('hidden');
    this.statsSection.classList.remove('hidden');
    this.searchSection.classList.remove('hidden');
    this.sendersSection.classList.remove('hidden');
    this.actionsSection.classList.remove('hidden');
  }

  /**
   * Скрыть интерфейс с данными
   */
  hideDataView() {
    this.startScreen.classList.remove('hidden');
    this.statsSection.classList.add('hidden');
    this.searchSection.classList.add('hidden');
    this.sendersSection.classList.add('hidden');
    this.actionsSection.classList.add('hidden');
  }

  /**
   * Обновление статистики
   */
  updateStats(stats) {
    this.totalEmailsEl.textContent = stats.totalEmails || 0;
    this.unreadEmailsEl.textContent = stats.unreadEmails || 0;
    this.totalSendersEl.textContent = stats.totalSenders || 0;
  }

  /**
   * Фильтрация отправителей
   */
  filterSenders(searchQuery, onlyUnread) {
    const query = searchQuery.toLowerCase().trim();
    
    this.filteredSenders = this.senders.filter(sender => {
      const matchesSearch = !query || 
        sender.email.toLowerCase().includes(query) ||
        (sender.name && sender.name.toLowerCase().includes(query));
      
      const matchesUnread = !onlyUnread || sender.unreadCount > 0;
      
      return matchesSearch && matchesUnread;
    });
    
    this.renderSenders();
  }

  /**
   * Отрисовка списка отправителей
   */
  renderSenders() {
    if (this.filteredSenders.length === 0) {
      this.sendersList.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }
    
    this.emptyState.classList.add('hidden');
    
    this.sendersList.innerHTML = this.filteredSenders.map(sender => {
      const isWhitelisted = this.whitelist.has(sender.email);
      
      return `
        <div class="sender-card ${isWhitelisted ? 'whitelisted' : ''}" 
             data-email="${sender.email}">
          <div class="sender-header" style="cursor: pointer;" data-action="open-gmail" data-email="${sender.email}">
            <span class="sender-email">${sender.email}</span>
            ${isWhitelisted ? '<span class="sender-badge">Защищен</span>' : ''}
          </div>
          <div class="sender-stats" style="cursor: pointer;" data-action="open-gmail" data-email="${sender.email}">
            <span>📧 ${sender.totalCount} писем</span>
            <span>📬 ${sender.unreadCount} непрочитанных</span>
          </div>
          <div class="sender-actions">
            ${sender.unsubscribeLink ? 
              `<button class="btn btn-small btn-secondary" 
                       data-action="unsubscribe" 
                       data-email="${sender.email}"
                       data-link="${sender.unsubscribeLink}">
                Отписаться
              </button>` : ''}
            <button class="btn btn-small btn-danger" 
                    data-action="delete" 
                    data-email="${sender.email}">
              Удалить все
            </button>
            <button class="btn btn-small ${isWhitelisted ? 'btn-secondary' : 'btn-success'}" 
                    data-action="whitelist" 
                    data-email="${sender.email}">
              ${isWhitelisted ? 'Убрать защиту' : 'Защитить'}
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    // Добавляем обработчики для кнопок и кликабельных областей
    this.sendersList.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleSenderAction(e));
    });
  }

  /**
   * Обработка действий с отправителем
   */
  async handleSenderAction(event) {
    const action = event.target.dataset.action;
    const email = event.target.dataset.email;
    
    switch (action) {
      case 'open-gmail':
        this.openGmailSearch(email);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(email, event.target.dataset.link);
        break;
      case 'delete':
        this.handleDelete(email);
        break;
      case 'whitelist':
        this.toggleWhitelist(email);
        break;
    }
  }

  /**
   * Открытие Gmail с поиском по отправителю
   */
  openGmailSearch(email) {
    const searchQuery = encodeURIComponent(`from:${email}`);
    const gmailUrl = `https://mail.google.com/mail/u/0/#search/${searchQuery}`;
    chrome.tabs.create({ url: gmailUrl });
  }

  /**
   * Отписка от рассылки
   */
  handleUnsubscribe(email, link) {
    chrome.tabs.create({ url: link });
  }

  /**
   * Удаление писем от отправителя
   */
  async handleDelete(email) {
    const sender = this.senders.find(s => s.email === email);
    
    if (this.whitelist.has(email)) {
      alert('Этот отправитель находится в белом списке и защищен от удаления.');
      return;
    }
    
    const confirmed = await this.showModal(
      'Подтверждение удаления',
      `Вы уверены, что хотите удалить все письма (${sender.totalCount} шт.) от ${email}?`
    );
    
    if (!confirmed) return;
    
    try {
      this.showProgress(`Удаление писем от ${email}...`, 0);
      
      const response = await chrome.runtime.sendMessage({
        action: 'deleteEmails',
        email: email
      });
      
      if (response.success) {
        // Удаляем отправителя из списка
        this.senders = this.senders.filter(s => s.email !== email);
        
        // Обновляем статистику вручную
        const stats = {
          totalEmails: this.senders.reduce((sum, s) => sum + s.totalCount, 0),
          unreadEmails: this.senders.reduce((sum, s) => sum + s.unreadCount, 0),
          totalSenders: this.senders.length
        };
        this.updateStats(stats);
        
        this.filterSenders(this.searchInput.value, this.unreadFilter.checked);
      } else {
        // Проверяем, требуется ли повторная авторизация
        if (response.error && response.error.includes('авторизац')) {
          this.showScreen('auth');
          alert('Требуется повторная авторизация. Войдите снова.');
        } else {
          alert('Ошибка удаления: ' + (response.error || 'Неизвестная ошибка'));
        }
      }
    } catch (error) {
      console.error('Ошибка удаления писем:', error);
      alert('Ошибка удаления писем. Попробуйте еще раз.');
    } finally {
      this.hideProgress();
    }
  }

  /**
   * Переключение белого списка
   */
  async toggleWhitelist(email) {
    if (this.whitelist.has(email)) {
      this.whitelist.delete(email);
    } else {
      this.whitelist.add(email);
    }
    
    await this.saveWhitelist();
    this.renderSenders();
    this.renderWhitelist();
  }

  /**
   * Загрузка белого списка
   */
  async loadWhitelist() {
    try {
      const result = await chrome.storage.local.get(['whitelist']);
      this.whitelist = new Set(result.whitelist || []);
      this.renderWhitelist();
    } catch (error) {
      console.error('Ошибка загрузки белого списка:', error);
    }
  }

  /**
   * Сохранение белого списка
   */
  async saveWhitelist() {
    try {
      await chrome.storage.local.set({ 
        whitelist: Array.from(this.whitelist) 
      });
    } catch (error) {
      console.error('Ошибка сохранения белого списка:', error);
    }
  }

  /**
   * Добавление в белый список
   */
  async addToWhitelist() {
    const email = this.whitelistInput.value.trim();
    
    if (!email) return;
    
    // Простая валидация email
    if (!email.includes('@')) {
      alert('Введите корректный email адрес');
      return;
    }
    
    this.whitelist.add(email);
    await this.saveWhitelist();
    
    this.whitelistInput.value = '';
    this.renderWhitelist();
    this.renderSenders();
  }

  /**
   * Отрисовка белого списка
   */
  renderWhitelist() {
    if (this.whitelist.size === 0) {
      this.whitelistContainer.innerHTML = 
        '<p class="help-text">Белый список пуст</p>';
      return;
    }
    
    this.whitelistContainer.innerHTML = Array.from(this.whitelist).map(email => `
      <div class="whitelist-item">
        <span class="whitelist-email">${email}</span>
        <button class="btn-icon" data-remove="${email}">✕</button>
      </div>
    `).join('');
    
    // Обработчики удаления
    this.whitelistContainer.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const email = e.target.dataset.remove;
        this.whitelist.delete(email);
        await this.saveWhitelist();
        this.renderWhitelist();
        this.renderSenders();
      });
    });
  }

  /**
   * Показать экран
   */
  showScreen(screen) {
    this.authScreen.classList.add('hidden');
    this.mainScreen.classList.add('hidden');
    this.settingsScreen.classList.add('hidden');
    
    switch (screen) {
      case 'auth':
        this.authScreen.classList.remove('hidden');
        break;
      case 'main':
        this.mainScreen.classList.remove('hidden');
        break;
      case 'settings':
        this.settingsScreen.classList.remove('hidden');
        break;
    }
    
    this.currentScreen = screen;
  }

  /**
   * Показать прогресс
   */
  showProgress(text, percent) {
    this.progressContainer.classList.remove('hidden');
    this.progressText.textContent = text;
    this.progressFill.style.width = `${percent}%`;
  }

  /**
   * Скрыть прогресс
   */
  hideProgress() {
    this.progressContainer.classList.add('hidden');
  }

  /**
   * Показать модальное окно
   */
  showModal(title, message) {
    return new Promise((resolve) => {
      this.modalTitle.textContent = title;
      this.modalMessage.textContent = message;
      this.confirmModal.classList.remove('hidden');
      
      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };
      
      const handleCancel = () => {
        cleanup();
        resolve(false);
      };
      
      const cleanup = () => {
        this.confirmModal.classList.add('hidden');
        this.modalConfirm.removeEventListener('click', handleConfirm);
        this.modalCancel.removeEventListener('click', handleCancel);
      };
      
      this.modalConfirm.addEventListener('click', handleConfirm);
      this.modalCancel.addEventListener('click', handleCancel);
    });
  }

  /**
   * Скрыть модальное окно
   */
  hideModal() {
    this.confirmModal.classList.add('hidden');
  }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

