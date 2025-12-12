// API_BASE объявлен в datafeed.js как window.API_BASE
// Используем напрямую window.API_BASE
// Устанавливаем API_BASE, если он еще не установлен
if (!window.API_BASE) {
    window.API_BASE = window.location.origin + '/api';
    console.log('🔧 API_BASE установлен:', window.API_BASE);
}

// currentPairId управляется через window.chartModule
let socket = null;
let selectedPairs = [];
let activePairId = null; // Текущая активная пара в UI
let activeRounds = [];
let userBalance = 10000.0;
let tradeAmount = 5.0;
let tradeDuration = 60; // секунды
// currentTimeframe объявлен в chart.js

// Хранение времени сервера (UTC) в секундах (Unix timestamp)
let serverTimeUTC = null;

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    // Ждем загрузки LightweightCharts библиотеки
    console.log('🚀 DOM Content Loaded');
    console.log('📦 LightweightCharts:', typeof LightweightCharts !== 'undefined' ? '✅ loaded' : '❌ not loaded');
    
    function waitForLibrary() {
        if (typeof LightweightCharts !== 'undefined') {
            console.log('✅ LightweightCharts loaded, initializing...');
            initSocket();
            loadPairs();
            loadBalance();
            setupEventListeners();
            updateProfitDisplay();
            
            // Запускаем HTTP polling для server time
            startServerTimePolling();
        } else {
            console.log('⏳ Waiting for LightweightCharts library...');
            setTimeout(waitForLibrary, 100);
        }
    }
    waitForLibrary();
});

// initTradingView удалена - теперь используется chartModule

function initSocket() {
    console.log('🔌 Initializing socket connection to http://127.0.0.1:5500');
    console.log('🔌 Socket.io version check:', typeof io !== 'undefined' ? 'loaded' : 'NOT LOADED');
    
    socket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        forceNew: true  // Принудительно новое подключение
    });
    
    // Логируем все события ДО подключения
    socket.onAny((eventName, ...args) => {
        console.log('🔍 [onAny] Event received:', eventName, 'Args:', args);
        if (eventName === 'server_time') {
            console.log('🔍 [onAny] ✅ Caught server_time event!', args);
        }
    });
    
    socket.on('connect', () => {
        console.log('✅ Socket connected successfully');
        console.log('✅ Socket ID:', socket.id);
        console.log('✅ Socket transport:', socket.io.engine.transport.name);
        console.log('✅ Socket readyState:', socket.readyState);
        
        socket.emit('subscribe_rounds', { user_id: 1 });
        console.log('✅ Sent subscribe_rounds event');
        
        // // Тестовая отправка - проверим, работает ли вообще WebSocket
        // setTimeout(() => {
        //     console.log('🧪 Testing: Sending test event...');
        //     socket.emit('test_event', { message: 'test' });
        // }, 1000);
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
    });
    
    socket.on('disconnect', (reason) => {
        console.warn('⚠️ Socket disconnected:', reason);
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
        console.error('❌ Error details:', error.message, error.type);
    });
    
    socket.on('test_response', (data) => {
        console.log('🧪 Test response received:', data);
    });
    
    socket.on('server_time', (data) => {
        // Упрощенная обработка - логируем только первые несколько раз
        if (!window.serverTimeLogCount) window.serverTimeLogCount = 0;
        if (window.serverTimeLogCount < 3) {
            console.log('🕐🕐🕐 [server_time handler] EVENT RECEIVED!', data);
            window.serverTimeLogCount++;
        }
        
        // Обработка, если data - это массив (socket.io иногда оборачивает)
        let actualData = data;
        if (Array.isArray(data) && data.length > 0) {
            actualData = data[0];
        }
        
        // Сохраняем время сервера (UTC) в секундах
        if (actualData && actualData.timestamp) {
            serverTimeUTC = Math.floor(actualData.timestamp);
        } else if (actualData && actualData.time) {
            // Если timestamp нет, вычисляем из ISO строки
            serverTimeUTC = Math.floor(new Date(actualData.time).getTime() / 1000);
        }
        
        if (actualData && actualData.formatted) {
            updateServerTime(actualData.formatted);
        } else if (actualData && actualData.time) {
            const date = new Date(actualData.time);
            const formatted = date.toLocaleTimeString('ru-RU', { hour12: false });
            updateServerTime(formatted);
        } else {
            console.warn('⚠️ [server_time handler] No valid time data found:', actualData);
        }
    });
    
    socket.on('round_finished', (data) => {
        handleRoundFinished(data);
    });
    
    socket.on('round_update', (data) => {
        updateRoundTime(data);
    });
    
    // WebSocket price_update больше не используется - используем HTTP polling
}

// initChart удалена - теперь используется chartModule.initChart

async function loadPairs() {
    try {
        // Убеждаемся, что API_BASE установлен
        if (!window.API_BASE) {
            window.API_BASE = window.location.origin + '/api';
        }
        const response = await fetch(`${window.API_BASE}/pairs`);
        const pairs = await response.json();
        
        if (pairs.length > 0) {
            // Ищем первую доступную пару для инициализации
            let defaultPair = pairs.find(p => p.symbol === 'AAPL') || pairs[0];
            
            selectedPairs = [defaultPair];
            activePairId = defaultPair.id;
            console.log('✅ Active pair ID set to:', activePairId, 'Symbol:', defaultPair.symbol);
            
            // Обновляем отображение (создаст вкладки и окна)
            updateSelectedPair(defaultPair);
            
            // Инициализируем график для активного окна
            setTimeout(() => {
                const windowData = pairWindows.get(activePairId);
                if (windowData && window.chartModule) {
                    const chartId = windowData.windowElement.getAttribute('data-chart-id');
                    const chartContainer = windowData.windowElement.querySelector(`#${chartId}`);
                    if (chartContainer) {
                        window.chartModule.initChart(activePairId, chartContainer);
                    }
                }
            }, 100);
        } else {
            console.warn('⚠️ No pairs found, setting default activePairId to 1');
            activePairId = 1;
        }
    } catch (error) {
        console.error('Error loading pairs:', error);
    }
}

async function loadBalance() {
    try {
        // Убеждаемся, что API_BASE установлен
        if (!window.API_BASE) {
            window.API_BASE = window.location.origin + '/api';
        }
        const response = await fetch(`${window.API_BASE}/balance?user_id=1`);
        const data = await response.json();
        userBalance = data.balance;
        updateBalanceDisplay();
    } catch (error) {
        console.error('Error loading balance:', error);
    }
}

async function loadActiveRounds() {
    try {
        // Убеждаемся, что API_BASE установлен
        if (!window.API_BASE) {
            window.API_BASE = window.location.origin + '/api';
        }
        const url = `${window.API_BASE}/rounds/active?user_id=1`;
        console.log('📋 Fetching active rounds from:', url);
        const response = await fetch(url);
        const rounds = await response.json();
        activeRounds = rounds;
        updateActiveRoundsDisplay();
        
        // Обновление ордеров на графике происходит автоматически через drawOrderLine
        console.log('📋 Active rounds updated');
    } catch (error) {
        console.error('Error loading active rounds:', error);
    }
}

// Периодическое обновление активных раундов
setInterval(async () => {
    try {
        // Убеждаемся, что API_BASE установлен
        if (!window.API_BASE) {
            window.API_BASE = window.location.origin + '/api';
        }
        const url = `${window.API_BASE}/rounds/active?user_id=1`;
        const response = await fetch(url);
        const rounds = await response.json();
        
        if (!Array.isArray(rounds)) {
            return;
        }
        
        // Обновляем список активных раундов
        const existingIds = new Set(activeRounds.map(r => r.id));
        const newRounds = rounds.filter(r => !existingIds.has(r.id));
        
        newRounds.forEach(round => {
            if (round.end_time) {
                addActiveRound({
                    id: round.id,
                    end_time: round.end_time,
                    start_price: round.start_price,
                }, round.direction);
            }
        });
        
        // Обновляем время для всех существующих раундов
        rounds.forEach(round => {
            if (round.end_time) {
                const now = new Date().getTime();
                const endTime = new Date(round.end_time).getTime();
                if (!isNaN(endTime) && endTime > 0) {
                    const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
                    updateRoundTimeRemaining(round.id, remaining);
                }
            }
        });
        
        // Удаляем раунды, которых больше нет на сервере
        const serverIds = new Set(rounds.map(r => r.id));
        activeRounds = activeRounds.filter(r => serverIds.has(r.id));
        updateActiveRoundsDisplay();
    } catch (error) {
        console.error('Error loading active rounds:', error);
    }
}, 2000);

function setupEventListeners() {
    console.log('🔧 Setting up event listeners...');
    
    // Добавление пары
    const addPairBtn = document.getElementById('addPairBtn');
    if (addPairBtn) {
        addPairBtn.addEventListener('click', showAddPairModal);
    }
    
    const closeModal = document.getElementById('closeModal');
    if (closeModal) {
        closeModal.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAddPairModal();
        });
    }
    
    // Закрытие модального окна при клике вне его
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('addPairModal');
        if (e.target === modal) {
            closeAddPairModal();
        }
    });
    
    // Кнопки Buy/Sell теперь обрабатываются в setupRightbarHandlers
    // Нет необходимости искать их здесь, так как они создаются динамически
}

// Хранилище окон для каждого символа
let pairWindows = new Map(); // pairId -> { windowElement, tabElement, chartContainer }

function updateSelectedPair(activePair) {
    const tabsContainer = document.getElementById('tabs');
    const windowsContainer = document.getElementById('windows');
    if (!tabsContainer || !windowsContainer) return;
    
    // Удаляем все существующие вкладки и окна
    const existingTabs = tabsContainer.querySelectorAll('.item');
    const existingWindows = windowsContainer.querySelectorAll('#window');
    existingTabs.forEach(el => el.remove());
    existingWindows.forEach(el => el.remove());
    pairWindows.clear();
    
    // Создаем вкладки и окна для всех выбранных пар
    selectedPairs.forEach((p) => {
        // Создаем вкладку
        const tabElement = createTab(p);
        const addBtn = document.getElementById('addPairBtn');
        tabsContainer.insertBefore(tabElement, addBtn);
        
        // Создаем окно
        const windowElement = createWindow(p);
        windowsContainer.appendChild(windowElement);
        
        // Сохраняем ссылки
        pairWindows.set(p.id, {
            tabElement,
            windowElement,
            pair: p
        });
        
        // Инициализируем график для этого окна
        initChartForWindow(p.id, windowElement);
    });
    
    // Активируем выбранную пару
    if (activePair) {
        switchToPair(activePair.id);
    } else if (selectedPairs.length > 0) {
        switchToPair(selectedPairs[0].id);
    }
}

function createTab(pair) {
    const tab = document.createElement('div');
    tab.className = 'item';
    tab.setAttribute('data-pair-id', pair.id);
    tab.setAttribute('data-v-f02899e6', '');
    
    // URL иконки символа (можно использовать реальные иконки или placeholder)
    const iconUrl = `https://zlincontent.com/cdn/icons/symbols/${pair.symbol.toLowerCase()}.png`;
    // Fallback на placeholder, если иконка не загрузится
    const fallbackIcon = `https://via.placeholder.com/30x30/333333/ffffff?text=${pair.symbol.substring(0, 1).toUpperCase()}`;
    
    tab.innerHTML = `
        <button class="close" data-v-f02899e6="">
            <span class="material-symbols-outlined zli" data-v-f02899e6="">close</span>
        </button>
        <img data-v-f02899e6="" src="${iconUrl}" onerror="this.src='${fallbackIcon}'" alt="${pair.symbol}">
        <div class="title" data-v-f02899e6="">${pair.name || pair.symbol}</div>
        <div class="description" data-v-f02899e6="">Crypto</div>
    `;
    
    // Обработчик клика на вкладку
    tab.addEventListener('click', (e) => {
        if (!e.target.closest('.close')) {
            switchToPair(pair.id);
        }
    });
    
    // Обработчик закрытия вкладки
    const closeBtn = tab.querySelector('.close');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removePair(pair.id);
    });
    
    return tab;
}

function createWindow(pair) {
    const window = document.createElement('section');
    window.id = `window_${pair.id}`;
    window.className = 'window';
    window.setAttribute('data-pair-id', pair.id);
    window.setAttribute('data-symbol', pair.symbol);
    
    // Генерируем уникальный ID для графика
    const chartId = `chart_${pair.id}_${Date.now()}`;
    const token = `token_${pair.id}_${Date.now()}`;
    window.setAttribute('data-token', token);
    
    window.innerHTML = `
        <div id="${chartId}" class="chart"></div>
        <div id="rightbar">
            <div class="symbol-countdown">
                <div class="sc-title">
                    Time remaining: <b class="pull-right text-sell" id="round-start-time-${pair.id}">00:03</b>
                </div>
                <div class="sc-bar">
                    <div class="sc-bar-fill bg-sell" id="round-bar-${pair.id}" style="width: 5%;"></div>
                </div>
            </div>
            <div class="rb-item">
                <div class="rb-value" id="selected_expiration-${pair.id}">
                    <i class="fa fa-clock-o desktop-only"></i>1 min.
                </div>
                <div class="rb-buttons">
                    <button class="btn-expiration" data-pair-id="${pair.id}" data-action="down">-</button>
                    <button class="btn-expiration" data-pair-id="${pair.id}" data-action="up">+</button>
                </div>
            </div>
            <div class="rb-item">
                <div class="rb-value">
                    <i class="fa fa-dollar desktop-only"></i>
                    <input type="text" class="trade-amount" id="trade-amount-${pair.id}" value="5.00">
                </div>
                <div class="rb-buttons">
                    <button class="btn-amount" data-pair-id="${pair.id}" data-action="down">-</button>
                    <button class="btn-amount" data-pair-id="${pair.id}" data-action="up">+</button>
                </div>
            </div>
            <div class="rb-profit">
                <div class="rb-title">
                    Profit <b class="percent-profit-side text-buy">85%</b>
                </div>
                <div class="rb-percent" id="return-view-${pair.id}">+R$ 74,00</div>
            </div>
            <div class="rb-trade-buttons">
                <button class="bg-buy btn-trade-buy" data-pair-id="${pair.id}" data-direction="BUY">
                    <span class="material-symbols-outlined zli" translate="no">trending_up</span>
                    <text>Buy</text>
                    <span class="mobile-profit">85%</span>
                </button>
                <button class="bg-sell btn-trade-sell" data-pair-id="${pair.id}" data-direction="SELL">
                    <span class="material-symbols-outlined zli" translate="no">trending_down</span>
                    <text>Sell</text>
                    <span class="mobile-profit">85%</span>
                </button>
            </div>
            <div class="rb-server-time">
                Server time: <span id="server-clock-${pair.id}">00:00:00</span>
            </div>
        </div>
    `;
    
    // Сохраняем chartId в элементе окна
    window.setAttribute('data-chart-id', chartId);
    
    // Настраиваем обработчики событий для rightbar
    setupRightbarHandlers(window, pair.id);
    
    return window;
}

function setupRightbarHandlers(windowElement, pairId) {
    // Обработчики для expiration
    windowElement.querySelectorAll('.btn-expiration').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            if (action === 'up') {
                tradeDuration = Math.min(tradeDuration + 60, 3600);
        } else {
                tradeDuration = Math.max(tradeDuration - 60, 60);
            }
            updateTimeDisplay(pairId);
            updateProfitDisplay(pairId);
        });
    });
    
    // Обработчики для amount
    windowElement.querySelectorAll('.btn-amount').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            if (action === 'up') {
                tradeAmount = Math.min(tradeAmount + 1, 1000);
        } else {
                tradeAmount = Math.max(tradeAmount - 1, 1);
            }
            updateAmountDisplay(pairId);
            updateProfitDisplay(pairId);
        });
    });
    
    // Обработчик для input amount
    const amountInput = windowElement.querySelector(`#trade-amount-${pairId}`);
    if (amountInput) {
        amountInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value) || 1;
            tradeAmount = Math.max(1, Math.min(1000, value));
            updateProfitDisplay(pairId);
        });
    }
    
    // Обработчики для кнопок Buy/Sell
    windowElement.querySelectorAll('.btn-trade-buy, .btn-trade-sell').forEach(btn => {
        btn.addEventListener('click', () => {
            const direction = btn.getAttribute('data-direction');
            console.log(`🛒 ${direction} button clicked for pair ${pairId}`);
            createRound(direction, pairId);
        });
    });
}

function initChartForWindow(pairId, windowElement) {
    const chartId = windowElement.getAttribute('data-chart-id');
    const chartContainer = windowElement.querySelector(`#${chartId}`);
    
    if (!chartContainer || !window.chartModule) {
        console.warn(`Cannot init chart for pair ${pairId}: container or module not found`);
        return;
    }
    
    // Инициализируем график для этого окна только если оно активно
    if (pairId === activePairId) {
        window.chartModule.initChart(pairId, chartContainer);
    }
}

function switchToPair(pairId) {
    const pair = selectedPairs.find(p => p.id === pairId);
    if (!pair) return;
    
        activePairId = pairId;
    
    // Обновляем вкладки
    pairWindows.forEach((data, id) => {
        if (id === pairId) {
            data.tabElement.classList.add('active');
            data.windowElement.classList.add('active');
        } else {
            data.tabElement.classList.remove('active');
            data.windowElement.classList.remove('active');
        }
    });
    
    // Инициализируем график для активного окна, если еще не инициализирован
    const windowData = pairWindows.get(pairId);
    if (windowData && window.chartModule) {
        const chartId = windowData.windowElement.getAttribute('data-chart-id');
        const chartContainer = windowData.windowElement.querySelector(`#${chartId}`);
        if (chartContainer && !chartContainer.querySelector('.chart-wrapper')) {
            window.chartModule.initChart(pairId, chartContainer);
        } else {
            const timeframe = window.chartModule ? window.chartModule.getCurrentTimeframe() : '1m';
            window.chartModule.updateChart(pairId, timeframe);
        }
    }
    
    // Обновляем отображение
    updateTimeDisplay(pairId);
    updateAmountDisplay(pairId);
    updateProfitDisplay(pairId);
}

function removePair(pairId) {
    if (selectedPairs.length <= 1) {
        alert('Нельзя закрыть последнюю вкладку');
        return;
    }
    
    // Удаляем из selectedPairs
    selectedPairs = selectedPairs.filter(p => p.id !== pairId);
    
    // Удаляем вкладку и окно
    const windowData = pairWindows.get(pairId);
    if (windowData) {
        windowData.tabElement.remove();
        windowData.windowElement.remove();
        pairWindows.delete(pairId);
    }
    
    // Если удалили активную пару, переключаемся на первую доступную
    if (activePairId === pairId && selectedPairs.length > 0) {
        switchToPair(selectedPairs[0].id);
    }
}

let allAvailablePairs = [];

function showAddPairModal() {
    console.log('🔍 showAddPairModal called');
    const modal = document.getElementById('addPairModal');
    const searchInput = document.getElementById('pairSearch');
    
    if (!modal) {
        console.error('❌ Modal element not found!');
        return;
    }
    
    // Очищаем поиск
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Инициализируем меню категорий
    initCategoryMenu();
    
    // Убеждаемся, что API_BASE установлен
    if (!window.API_BASE) {
        window.API_BASE = window.location.origin + '/api';
    }
    
    fetch(`${window.API_BASE}/pairs`)
        .then(res => res.json())
        .then(pairs => {
            allAvailablePairs = pairs;
            renderPairsList(pairs);
            modal.style.display = 'block';
            modal.style.zIndex = '10000';
            console.log('✅ Modal displayed');
            
            // Фокус на поле поиска
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 100);
            }
        })
        .catch(error => {
            console.error('Error loading pairs:', error);
        });
}

function initCategoryMenu() {
    const menuDesktop = document.getElementById('trmMenuDesktop');
    const menuMobile = document.getElementById('trmMenuMobile');
    
    const categories = [
        { id: 'all', icon: 'apps', label: 'All' },
        { id: 'crypto', icon: 'currency_bitcoin', label: 'Crypto' },
        { id: 'forex', icon: 'attach_money', label: 'Forex' },
        { id: 'stocks', icon: 'account_balance', label: 'Stocks' },
        { id: 'commodities', icon: 'grain', label: 'Commodities' }
    ];
    
    const createMenuItems = (container) => {
        container.innerHTML = '';
        categories.forEach((cat, index) => {
            const li = document.createElement('li');
            li.setAttribute('data-v-a849e800', '');
            const a = document.createElement('a');
            a.setAttribute('data-v-a849e800', '');
            a.className = index === 0 ? 'active' : '';
            a.setAttribute('data-category', cat.id);
            a.innerHTML = `
                <span data-v-a849e800="" class="zli material-symbols-outlined" translate="no">${cat.icon}</span> ${cat.label}
            `;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                // Удаляем active со всех элементов
                container.querySelectorAll('a').forEach(item => item.classList.remove('active'));
                // Добавляем active к выбранному
                a.classList.add('active');
                // Фильтруем пары по категории
                filterPairsByCategory(cat.id);
            });
            li.appendChild(a);
            container.appendChild(li);
        });
    };
    
    if (menuDesktop) createMenuItems(menuDesktop);
    if (menuMobile) createMenuItems(menuMobile);
}

function filterPairsByCategory(category) {
    if (category === 'all') {
        renderPairsList(allAvailablePairs);
        return;
    }
    
    const filtered = allAvailablePairs.filter(pair => {
        const pairCategory = (pair.category || 'Crypto').toLowerCase();
        return pairCategory === category;
    });
    
    renderPairsList(filtered);
}

function renderPairsList(pairs) {
    const availablePairsDiv = document.getElementById('availablePairs');
    if (!availablePairsDiv) return;
    
    availablePairsDiv.innerHTML = '';
    
    if (pairs.length === 0) {
        const noResults = document.createElement('tr');
        noResults.innerHTML = '<td colspan="4" style="text-align: center; color: #8b8fa3; padding: 20px;">No pairs found</td>';
        availablePairsDiv.appendChild(noResults);
        return;
    }
    
    pairs.forEach(pair => {
        const isSelected = selectedPairs.some(p => p.id === pair.id);
        const iconUrl = `https://zlincontent.com/cdn/icons/symbols/${pair.symbol.toLowerCase()}.png`;
        const category = pair.category || 'Crypto';
        const payout = pair.payout || '85%';
        const lastPrice = pair.last_price || '0.000000';
        
        const row = document.createElement('tr');
        row.setAttribute('data-v-a849e800', '');
        row.innerHTML = `
            <td data-v-a849e800="">
                <div data-v-a849e800="" class="symbol-detail">
                    <div data-v-a849e800="" class="symbol-img">
                        <img data-v-a849e800="" src="${iconUrl}" onerror="this.src='https://via.placeholder.com/30x30/333333/ffffff?text=${pair.symbol.substring(0, 1).toUpperCase()}'" alt="${pair.symbol}">
                    </div>
                    <div data-v-a849e800="" class="symbol-data">${pair.name || pair.symbol} <div data-v-a849e800="" class="h-description">${category}</div></div>
                </div>
            </td>
            <td data-v-a849e800="" align="center" class="arial mobile-hide">${lastPrice}</td>
            <td data-v-a849e800="" align="center" class="arial symbol-payout text-buy">${payout}</td>
            <td data-v-a849e800="" align="center">
                <span data-v-a849e800="" class="material-symbols-outlined s-icon">local_fire_department</span>
                <span data-v-a849e800="" class="material-symbols-outlined s-icon">local_fire_department</span>
                <span data-v-a849e800="" class="material-symbols-outlined s-icon">local_fire_department</span>
            </td>
        `;
        
        if (!isSelected) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                selectedPairs.push(pair);
                updateSelectedPair(pair);
                switchToPair(pair.id);
                closeAddPairModal();
            });
        }
        
        availablePairsDiv.appendChild(row);
    });
}

// Обработчик поиска
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('pairSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            
            if (searchTerm === '') {
                renderPairsList(allAvailablePairs);
            } else {
                const filtered = allAvailablePairs.filter(pair => {
                    const nameMatch = pair.name.toLowerCase().includes(searchTerm);
                    const symbolMatch = pair.symbol.toLowerCase().includes(searchTerm);
                    return nameMatch || symbolMatch;
                });
                renderPairsList(filtered);
            }
        });
    }
});

function closeAddPairModal() {
    document.getElementById('addPairModal').style.display = 'none';
}

function updateTimeDisplay(pairId = null) {
    const targetPairId = pairId || activePairId;
    if (!targetPairId) return;
    
    const minutes = Math.floor(tradeDuration / 60);
    const expirationEl = document.getElementById(`selected_expiration-${targetPairId}`);
    if (expirationEl) {
        expirationEl.innerHTML = `<i class="fa fa-clock-o desktop-only"></i>${minutes} min.`;
    }
}

function updateAmountDisplay(pairId = null) {
    const targetPairId = pairId || activePairId;
    if (!targetPairId) return;
    
    const amountInput = document.getElementById(`trade-amount-${targetPairId}`);
    if (amountInput) {
        amountInput.value = tradeAmount.toFixed(2);
    }
}

function updateProfitDisplay(pairId = null) {
    const targetPairId = pairId || activePairId;
    if (!targetPairId) return;
    
    const profit = tradeAmount * 0.85;
    const profitEl = document.getElementById(`return-view-${targetPairId}`);
    if (profitEl) {
        profitEl.textContent = `+R$ ${profit.toFixed(2).replace('.', ',')}`;
    }
}

function updateBalanceDisplay() {
    const formatted = userBalance.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    document.getElementById('balance').textContent = `R$ ${formatted}`;
}

function updateServerTime(timeStr) {
    if (!timeStr || timeStr === '0' || timeStr === '00:00:00') {
        // Если время не пришло, используем локальное время как fallback
        const now = new Date();
        timeStr = now.toLocaleTimeString('ru-RU', { hour12: false });
    }
    
    // Обновляем время во всех окнах
    pairWindows.forEach((data, pairId) => {
        const serverTimeEl = document.getElementById(`server-clock-${pairId}`);
        if (serverTimeEl) {
            serverTimeEl.textContent = timeStr;
        }
    });
}

// HTTP Polling для server time (надежный способ вместо WebSocket)
function startServerTimePolling() {
    const pollServerTime = async () => {
        try {
            // Убеждаемся, что API_BASE установлен
            if (!window.API_BASE) {
                window.API_BASE = window.location.origin + '/api';
            }
            const url = `${window.API_BASE}/server-time`;
            console.log('🕐 Fetching server time from:', url);
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                
                // Сохраняем время сервера (UTC) в секундах
                if (data && data.timestamp) {
                    serverTimeUTC = Math.floor(data.timestamp);
                } else if (data && data.time) {
                    // Если timestamp нет, вычисляем из ISO строки
                    serverTimeUTC = Math.floor(new Date(data.time).getTime() / 1000);
                }
                
                if (data && data.formatted) {
                    updateServerTime(data.formatted);
                } else if (data && data.time) {
                    const date = new Date(data.time);
                    const formatted = date.toLocaleTimeString('ru-RU', { hour12: false });
                    updateServerTime(formatted);
                }
            }
        } catch (error) {
            console.error('Error fetching server time:', error);
            // Fallback на локальное время при ошибке
            const now = new Date();
            updateServerTime(now.toLocaleTimeString('ru-RU', { hour12: false }));
        }
    };
    
    // Запускаем сразу и затем каждую секунду
    pollServerTime();
    setInterval(pollServerTime, 1000);
}

// Экспортируем функцию для получения времени сервера (UTC)
window.getServerTimeUTC = function() {
    return serverTimeUTC;
};

// HTTP Polling для обновления цен свечей (надежный способ вместо WebSocket)
// startPricePolling удалена - LightweightCharts обновляет данные автоматически через updateLastCandle


async function createRound(direction, pairId = null) {
    const targetPairId = pairId || activePairId || 1;
    console.log('🛒 [createRound] Called with direction:', direction, 'pairId:', targetPairId);
    console.log('🛒 [createRound] userBalance:', userBalance, 'tradeAmount:', tradeAmount);
    
    if (userBalance < tradeAmount) {
        console.warn('⚠️ Insufficient balance');
        alert('Недостаточно средств');
        return;
    }
    
    const requestData = {
        user_id: 1,
        pair_id: targetPairId,
        direction: direction,
        amount: tradeAmount,
        duration: tradeDuration,
    };
    
    // Убеждаемся, что API_BASE установлен
    if (!window.API_BASE) {
        window.API_BASE = window.location.origin + '/api';
    }
    
    console.log('🛒 [createRound] Request data:', requestData);
    console.log('🛒 [createRound] API URL:', `${window.API_BASE}/rounds`);
    
    try {
        const response = await fetch(`${window.API_BASE}/rounds`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        
        console.log('🛒 [createRound] Response status:', response.status);
        console.log('🛒 [createRound] Response ok:', response.ok);
        
        if (response.ok) {
            const round = await response.json();
            console.log('✅ [createRound] Round created successfully:', round);
            addActiveRound(round, direction);
            loadBalance(); // Обновляем баланс
            
            // Рисуем горизонтальную линию по цене ордера на графике
            const targetPairId = pairId || activePairId || 1;
            
            // Используем цену из round.start_price - это цена, по которой был создан ордер
            let orderPrice = round.start_price;
            
            console.log(`💰 [createRound] Round start_price from server: ${orderPrice}`);
            
            // Если start_price не валиден, используем fallback
            if (!orderPrice || orderPrice === 0 || isNaN(orderPrice)) {
                console.warn('⚠️ [createRound] Invalid start_price from server, using fallback');
                orderPrice = 100.0;
                console.warn(`⚠️ Using fallback price: ${orderPrice}`);
            }
            
            // Убеждаемся, что цена валидна
            if (!orderPrice || orderPrice === 0 || isNaN(orderPrice)) {
                console.error('❌ Invalid price, cannot draw order line');
                return;
            }
            
            console.log(`💰 [createRound] Using order price: ${orderPrice} (from round.start_price)`);
            
            // Рисуем горизонтальную линию по цене ордера на графике
            if (window.chartModule && window.chartModule.drawOrderLine) {
                // Получаем время создания ордера из round.start_time
                const orderTime = round.start_time ? new Date(round.start_time).getTime() / 1000 : Math.floor(Date.now() / 1000);
                console.log(`📏 [createRound] Drawing order line at price ${orderPrice} (start_price: ${round.start_price}) for ${direction} order`);
                console.log(`📏 [createRound] Order time: ${orderTime} (from start_time: ${round.start_time})`);
                // Передаем end_time для обратного отсчета
                const endTime = round.end_time || null;
                window.chartModule.drawOrderLine(
                    targetPairId,
                    orderPrice, // Это round.start_price (цена создания ордера)
                    round.id.toString(),
                    direction,
                    orderTime, // Передаем время создания ордера
                    endTime // Передаем время окончания раунда для обратного отсчета
                );
            }
            
            // Загружаем активные раунды для обновления списка
            loadActiveRounds();
        } else {
            const error = await response.json();
            console.error('❌ [createRound] Error response:', error);
            alert(error.error || 'Ошибка при создании раунда');
        }
    } catch (error) {
        console.error('❌ [createRound] Exception:', error);
        alert('Ошибка при создании раунда: ' + error.message);
    }
}

function addActiveRound(roundData, direction) {
    const round = {
        id: roundData.id,
                pair_id: activePairId || 1,
        direction: direction,
        amount: tradeAmount,
        duration: tradeDuration,
        end_time: roundData.end_time,
        start_price: roundData.start_price,
    };
    
    activeRounds.push(round);
    updateActiveRoundsDisplay();
    startRoundTimer(round);
}

function startRoundTimer(round) {
    const interval = setInterval(() => {
        const now = new Date().getTime();
        let endTime;
        
        // Парсим время окончания
        if (typeof round.end_time === 'string') {
            endTime = new Date(round.end_time).getTime();
        } else {
            endTime = round.end_time;
        }
        
        // Проверяем валидность времени
        if (isNaN(endTime) || endTime === 0) {
            console.error('Invalid end_time for round:', round);
            clearInterval(interval);
            return;
        }
        
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        
        if (remaining <= 0) {
            clearInterval(interval);
            // Раунд завершится через WebSocket событие
        } else {
            updateRoundTimeRemaining(round.id, remaining);
        }
    }, 1000);
}

function updateRoundTimeRemaining(roundId, seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const roundElement = document.querySelector(`[data-round-id="${roundId}"]`);
    if (roundElement) {
        const timeElement = roundElement.querySelector('.round-time');
        if (timeElement) {
            timeElement.textContent = timeStr;
        }
    }
}

function updateActiveRoundsDisplay() {
    const roundsList = document.getElementById('roundsList');
    if (!roundsList) return;
    
    roundsList.innerHTML = '';
    
    activeRounds.forEach(round => {
        const roundItem = document.createElement('div');
        roundItem.className = 'round-item';
        roundItem.setAttribute('data-round-id', round.id);
        
        const now = new Date().getTime();
        let endTime;
        
        // Парсим время окончания
        if (typeof round.end_time === 'string') {
            endTime = new Date(round.end_time).getTime();
        } else {
            endTime = round.end_time;
        }
        
        // Вычисляем оставшееся время
        let remaining = 0;
        let timeStr = '00:00';
        
        if (!isNaN(endTime) && endTime > 0) {
            remaining = Math.max(0, Math.floor((endTime - now) / 1000));
            const minutes = Math.floor(remaining / 60);
            const secs = remaining % 60;
            timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        
        roundItem.innerHTML = `
            <div class="round-item-header">
                <span class="round-direction ${round.direction.toLowerCase()}">${round.direction}</span>
                <span class="round-time">${timeStr}</span>
            </div>
            <div>Amount: $${round.amount.toFixed(2)}</div>
        `;
        
        roundsList.appendChild(roundItem);
    });
}

function handleRoundFinished(data) {
    // Удаляем раунд из активных
    activeRounds = activeRounds.filter(r => r.id !== data.round_id);
    updateActiveRoundsDisplay();
    
    // Обновляем баланс
    userBalance = data.new_balance;
    updateBalanceDisplay();
    
    // Показываем результат
    const message = data.win 
        ? `Выигрыш! Прибыль: R$ ${data.profit.toFixed(2)}`
        : `Проигрыш. Потеряно: R$ ${Math.abs(data.profit).toFixed(2)}`;
    
    console.log(message);
    alert(message);
}

function updateRoundTime(data) {
    // Обновление времени раунда через WebSocket
    if (data.round_id) {
        updateRoundTimeRemaining(data.round_id, data.remaining);
    }
}

// Обновление времени для свечи (time remaining)
function updateCandleTimeRemaining() {
    const timeRemainingEl = document.getElementById('timeRemaining');
    if (!timeRemainingEl) return;
    
    const now = new Date();
    const seconds = now.getSeconds();
    const remaining = 60 - seconds;
    timeRemainingEl.textContent = `00:${String(remaining).padStart(2, '0')}`;
}

// Обновляем время свечи каждую секунду
setInterval(updateCandleTimeRemaining, 1000);
updateCandleTimeRemaining(); // Сразу обновляем

// Функция для обновления цены на графике
// LightweightCharts обновляет данные автоматически через updateLastCandle
function updateChartPrice(data) {
    // График обрабатывает обновления автоматически
    console.log('💰 [updateChartPrice] Price update received:', data);
}

