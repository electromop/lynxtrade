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
let roundTimers = new Map(); // roundId -> intervalId для хранения таймеров
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
            
            // Загружаем активные раунды после небольшой задержки, чтобы график успел инициализироваться
            setTimeout(() => {
                loadActiveRounds();
            }, 500);
            
            // Запускаем HTTP polling для server time
            startServerTimePolling();
            
            // Запускаем глобальный таймер для обновления времени до полной минуты
            startGlobalTimeRemainingTimer();
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
            if (!window.serverTimeSetDebugCount) window.serverTimeSetDebugCount = 0;
            if (window.serverTimeSetDebugCount < 3) {
                const testDate = new Date(serverTimeUTC * 1000);
                console.log(`🕐 [server_time] Setting serverTimeUTC=${serverTimeUTC}, UTC time=${testDate.toISOString()}, UTC hours=${testDate.getUTCHours()}`);
                window.serverTimeSetDebugCount++;
            }
        } else if (actualData && actualData.time) {
            // Если timestamp нет, вычисляем из ISO строки
            serverTimeUTC = Math.floor(new Date(actualData.time).getTime() / 1000);
            if (!window.serverTimeSetDebugCount) window.serverTimeSetDebugCount = 0;
            if (window.serverTimeSetDebugCount < 3) {
                const testDate = new Date(serverTimeUTC * 1000);
                console.log(`🕐 [server_time] Setting serverTimeUTC=${serverTimeUTC} from time string, UTC time=${testDate.toISOString()}, UTC hours=${testDate.getUTCHours()}`);
                window.serverTimeSetDebugCount++;
            }
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
            // Ищем BTCUSDT по умолчанию, если нет - берем первую доступную пару
            let defaultPair = pairs.find(p => p.symbol === 'BTCUSDT') || pairs[0];
            
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
        
        console.log(`📋 Loaded ${rounds.length} active rounds:`, rounds.map(r => ({ id: r.id, pair_id: r.pair_id, end_time: r.end_time, duration: r.duration })));
        
        // Останавливаем все старые таймеры
        roundTimers.forEach((intervalId) => {
            clearInterval(intervalId);
        });
        roundTimers.clear();
        
        // Запускаем таймеры для всех активных раундов
        rounds.forEach(round => {
            if (round.end_time) {
                // Создаем объект раунда с правильной структурой
                const roundObj = {
                    id: round.id,
                    pair_id: round.pair_id,
                    end_time: round.end_time,
                    duration: round.duration || tradeDuration,
                };
                startRoundTimer(roundObj);
            }
        });
        
        // Сразу обновляем время для активной пары, если есть активный раунд
        if (activePairId) {
            const activeRound = rounds.find(r => r.pair_id === activePairId && r.end_time);
            if (activeRound) {
                // ВСЕГДА используем серверное время
                const serverTimeSec = window.getServerTimeUTC();
                const now = serverTimeSec * 1000;
                
                let endTime;
                if (typeof activeRound.end_time === 'string') {
                    endTime = new Date(activeRound.end_time).getTime();
                } else if (typeof activeRound.end_time === 'number') {
                    if (activeRound.end_time < 1e10) {
                        endTime = activeRound.end_time * 1000;
                    } else {
                        endTime = activeRound.end_time;
                    }
                } else {
                    endTime = activeRound.end_time;
                }
                
                if (!isNaN(serverTimeSec)) {
                    // Вычисляем время до полной минуты (секунды до следующей минуты)
                    const secondsInCurrentMinute = serverTimeSec % 60;
                    const remaining = 60 - secondsInCurrentMinute;
                    updateRoundTimeRemaining(activeRound.id, remaining, activePairId, activeRound.duration || tradeDuration);
                }
            }
        }
        
        // Рисуем ордера на графике для всех активных раундов
        // Используем небольшую задержку, чтобы график успел инициализироваться
        setTimeout(() => {
            rounds.forEach(round => {
                if (round.start_price && round.pair_id && window.chartModule && window.chartModule.drawOrderLine) {
                    const orderTime = round.start_time ? new Date(round.start_time).getTime() / 1000 : Math.floor(Date.now() / 1000);
                    const endTime = round.end_time || null;
                    const amount = round.amount || 0;
                    const direction = round.direction || 'BUY';
                    window.chartModule.drawOrderLine(
                        round.pair_id,
                        round.start_price,
                        round.id.toString(),
                        direction,
                        orderTime,
                        endTime,
                        amount
                    );
                }
            });
        }, 1000);
        
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
                    pair_id: round.pair_id,
                    end_time: round.end_time,
                    start_price: round.start_price,
                }, round.direction);
            }
        });
        
        // Удаляем раунды, которых больше нет на сервере, и останавливаем их таймеры
        const serverIds = new Set(rounds.map(r => r.id));
        const removedRounds = activeRounds.filter(r => !serverIds.has(r.id));
        removedRounds.forEach(round => {
            // Удаляем линию и прямоугольник с графика
            if (window.chartModule && window.chartModule.removeOrderLine) {
                const pairId = round.pair_id;
                if (pairId) {
                    console.log(`🗑️ [periodic update] Removing order line for round ${round.id}, pair ${pairId}`);
                    window.chartModule.removeOrderLine(pairId, round.id.toString());
                }
            }
            
            // Останавливаем таймер
            if (roundTimers.has(round.id)) {
                clearInterval(roundTimers.get(round.id));
                roundTimers.delete(round.id);
            }
        });
        activeRounds = activeRounds.filter(r => serverIds.has(r.id));
        updateActiveRoundsDisplay();
        
        // Обновляем данные существующих раундов (end_time может измениться)
        rounds.forEach(serverRound => {
            const existingRound = activeRounds.find(r => r.id === serverRound.id);
            if (existingRound && serverRound.end_time) {
                existingRound.end_time = serverRound.end_time;
                // Таймер уже работает, он сам обновит время
            }
        });
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
    // Все окна трейдинга имеют id вида window_<pairId>
    const existingWindows = windowsContainer.querySelectorAll('section[id^="window_"]');
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

// Маппинг символов на URL иконок из файла test
const SYMBOL_ICON_MAP = {
    'BTCUSDT': 'https://zlincontent.com/cdn/icons/symbols/bitcoin.png',
    'BTCUSD': 'https://zlincontent.com/cdn/icons/symbols/btcusd.png',
    'LTCUSDT': 'https://zlincontent.com/cdn/icons/symbols/litecoin.png',
    'BNBUSDT': 'https://zlincontent.com/cdn/icons/symbols/bnb.png',
    'ADAUSDT': 'https://zlincontent.com/cdn/icons/symbols/adausdt.png',
    'AUDJPY': 'https://zlincontent.com/cdn/icons/symbols/audjpy.png',
    'EURUSD': 'https://zlincontent.com/cdn/icons/symbols/otc/eurusd.png',
    'EURGBP': 'https://zlincontent.com/cdn/icons/symbols/otc/eurgbp.png',
    'XAUUSD': 'https://zlincontent.com/cdn/icons/symbols/otc/xauusd.png',
    'GBPUSD': 'https://zlincontent.com/cdn/icons/symbols/gbpusd.png',
    'AUDCAD': 'https://zlincontent.com/cdn/icons/symbols/audcad.png',
    'USDCAD': 'https://zlincontent.com/cdn/icons/symbols/usdcad.png',
    'NZDUSD': 'https://zlincontent.com/cdn/icons/symbols/nzdusd.png',
    'USDJPY': 'https://zlincontent.com/cdn/icons/symbols/usdjpy.png',
    'CADJPY': 'https://zlincontent.com/cdn/icons/symbols/cadjpy.png',
    'CHFJPY': 'https://zlincontent.com/cdn/icons/symbols/chfjpy.png',
    'XRPUSDT': 'https://zlincontent.com/cdn/icons/symbols/xrp.png',
    'ETHUSDT': 'https://zlincontent.com/cdn/icons/symbols/ethereum.png',
    'SOLUSDT': 'https://zlincontent.com/cdn/icons/symbols/solana.png',
    'AVAXUSDT': 'https://zlincontent.com/cdn/icons/symbols/avax.png',
    'DOGEUSDT': 'https://zlincontent.com/cdn/icons/symbols/doge.png',
    'EURNZD': 'https://zlincontent.com/cdn/icons/symbols/eurnzd.png',
    'AUDCHF': 'https://zlincontent.com/cdn/icons/symbols/audchf.png',
    'EURAUD': 'https://zlincontent.com/cdn/icons/symbols/euraud.png',
    'SUIUSDT': 'https://zlincontent.com/cdn/icons/symbols/sui.png',
    'GBPJPY': 'https://zlincontent.com/cdn/icons/symbols/gbpjpy.png',
    'CADCHF': 'https://zlincontent.com/cdn/icons/symbols/cadchf.png',
    'GBPCHF': 'https://zlincontent.com/cdn/icons/symbols/gbpchf.png',
    'GBPAUD': 'https://zlincontent.com/cdn/icons/symbols/gbpaud.png',
    'NZDJPY': 'https://zlincontent.com/cdn/icons/symbols/nzdjpy.png',
    'USDCHF': 'https://zlincontent.com/cdn/icons/symbols/usdchf.png',
    'LINKUSDT': 'https://zlincontent.com/cdn/icons/symbols/link.png',
    'EURCHF': 'https://zlincontent.com/cdn/icons/symbols/eurchf.png',
    'XPLUSDT': 'https://zlincontent.com/cdn/icons/symbols/xpl.png',
    'EURCAD': 'https://zlincontent.com/cdn/icons/symbols/eurcad.png',
    'XLMUSDT': 'https://zlincontent.com/cdn/icons/symbols/xlm.png',
    'AUDNZD': 'https://zlincontent.com/cdn/icons/symbols/audnzd.png',
    'AUDUSD': 'https://zlincontent.com/cdn/icons/symbols/audusd.png',
    'NZDCHF': 'https://zlincontent.com/cdn/icons/symbols/nzdchf.png',
    'GBPCAD': 'https://zlincontent.com/cdn/icons/symbols/gbpcad.png',
    'GBPNZD': 'https://zlincontent.com/cdn/icons/symbols/gbpnzd.png',
    'NZDCAD': 'https://zlincontent.com/cdn/icons/symbols/nzdcad.png',
};

function getIconUrl(symbol) {
    const upperSymbol = symbol.toUpperCase();
    if (SYMBOL_ICON_MAP[upperSymbol]) {
        return SYMBOL_ICON_MAP[upperSymbol];
    }
    // Fallback для символов с /otc/ или других путей
    if (upperSymbol.includes('BTC') && !upperSymbol.includes('USDT')) {
        return 'https://zlincontent.com/cdn/icons/symbols/otc/bitcoin.png';
    }
    if (upperSymbol.includes('LTC')) {
        return 'https://zlincontent.com/cdn/icons/symbols/otc/litecoin.png';
    }
    if (upperSymbol.includes('ETH')) {
        return 'https://zlincontent.com/cdn/icons/symbols/otc/ethereum.png';
    }
    if (upperSymbol.includes('SOL')) {
        return 'https://zlincontent.com/cdn/icons/symbols/otc/solana.png';
    }
    if (upperSymbol.includes('AVAX')) {
        return 'https://zlincontent.com/cdn/icons/symbols/otc/avax.png';
    }
    // Общий fallback
    return `https://zlincontent.com/cdn/icons/symbols/${symbol.toLowerCase()}.png`;
}

function createTab(pair) {
    const tab = document.createElement('div');
    tab.className = 'item';
    tab.setAttribute('data-pair-id', pair.id);
    tab.setAttribute('data-v-f02899e6', '');
    
    // URL иконки символа из маппинга
    const iconUrl = getIconUrl(pair.symbol);
    // Локальный fallback, чтобы не было сетевых ошибок DNS
    const fallbackIcon = '/api/img/mini-logo.png';
    
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
                    <span class="mobile-profit">85%</span>
                    <text>Sell</text>
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
    console.log(`🔀 switchToPair called, activePairId = ${activePairId}`);
    
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
        if (chartContainer) {
            // Всегда переинициализируем график под выбранную пару,
            // чтобы гарантированно подхватить правильный pairId и данные
            console.log(`📈 Re-init chart for pair ${pairId} in container ${chartId}`);
            window.chartModule.initChart(pairId, chartContainer);
        }
    }
    
    // Обновляем время для активной пары, если есть активный раунд
    const activeRound = activeRounds.find(r => r.pair_id === pairId && r.end_time);
    if (activeRound) {
        // ВСЕГДА используем серверное время
        const serverTimeSec = window.getServerTimeUTC();
        const now = serverTimeSec * 1000;
        
        let endTime;
        if (typeof activeRound.end_time === 'string') {
            endTime = new Date(activeRound.end_time).getTime();
        } else if (typeof activeRound.end_time === 'number') {
            if (activeRound.end_time < 1e10) {
                endTime = activeRound.end_time * 1000;
            } else {
                endTime = activeRound.end_time;
            }
        } else {
            endTime = activeRound.end_time;
        }
        
        if (!isNaN(serverTimeSec)) {
            // Вычисляем время до полной минуты (секунды до следующей минуты)
            const secondsInCurrentMinute = serverTimeSec % 60;
            const remaining = 60 - secondsInCurrentMinute;
            updateRoundTimeRemaining(activeRound.id, remaining, pairId, activeRound.duration);
        }
    }
    
    // Обновляем TradingView (UDF) график под выбранную пару, если он используется
    if (window.tradingViewModule && typeof window.tradingViewModule.updatePair === 'function') {
        try {
            window.tradingViewModule.updatePair(pairId);
        } catch (e) {
            console.warn('⚠️ Error updating TradingView pair:', e);
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
        const iconUrl = getIconUrl(pair.symbol);
        const category = pair.category || 'Crypto';
        const payout = pair.payout || '85%';
        const lastPrice = pair.last_price || '0.000000';
        
        const row = document.createElement('tr');
        row.setAttribute('data-v-a849e800', '');
        row.innerHTML = `
            <td data-v-a849e800="">
                <div data-v-a849e800="" class="symbol-detail">
                    <div data-v-a849e800="" class="symbol-img">
                        <img data-v-a849e800="" src="${iconUrl}" onerror="this.src='/api/img/mini-logo.png'" alt="${pair.symbol}">
                    </div>
                    <div data-v-a849e800="" class="symbol-data">${pair.name || pair.symbol} <div data-v-a849e800="" class="h-description">${category}</div></div>
                </div>
            </td>
            <td data-v-a849e800="" align="center" class="arial mobile-hide">${lastPrice}</td>
            <td data-v-a849e800="" align="center" class="arial symbol-payout text-buy">${payout}</td>
            <td data-v-a849e800="" align="center">
                <span data-v-a849e800="" class="material-symbols-outlined s-icon volatility-icon" style="opacity: 0.3;">local_fire_department</span>
                <span data-v-a849e800="" class="material-symbols-outlined s-icon volatility-icon" style="opacity: 0.3;">local_fire_department</span>
                <span data-v-a849e800="" class="material-symbols-outlined s-icon volatility-icon" style="opacity: 0.3;">local_fire_department</span>
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
    // Сервер всегда возвращает время, поэтому используем только serverTimeUTC
    // Игнорируем timeStr, чтобы избежать двойного вычитания
    if (serverTimeUTC === null || serverTimeUTC === undefined) {
        return; // Не обновляем, если серверное время еще не получено
    }
    
    // serverTimeUTC - это Unix timestamp в UTC, форматируем его и вычитаем 3 часа для UTC-3
    const date = new Date(serverTimeUTC * 1000);
    let hours = date.getHours(); // это правильно
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();
    
    // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ДЛЯ ОТЛАДКИ
    if (!window.serverTimeDebugCount) window.serverTimeDebugCount = 0;
    if (window.serverTimeDebugCount < 5) {
        console.log(`🕐 [updateServerTime] DEBUG: serverTimeUTC=${serverTimeUTC}, date=${date.toISOString()}, UTC hours=${hours}, minutes=${minutes}, seconds=${seconds}`);
        window.serverTimeDebugCount++;
    }
    
    // Вычитаем 3 часа для UTC-3
    const originalHours = hours;
    hours = hours - 3;
    if (hours < 0) {
        hours = hours + 24; // Если отрицательное, переходим на предыдущий день
    }
    
    if (window.serverTimeDebugCount <= 5) {
        console.log(`🕐 [updateServerTime] DEBUG: originalHours=${originalHours}, after -3: ${hours}, final time will be: ${hours}:${minutes}:${seconds}`);
    }
    
    const displayTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    // Логируем displayTime для отладки
    if (window.serverTimeDebugCount <= 5) {
        console.log(`🕐 [updateServerTime] displayTime=${displayTime}, will be set to element`);
    }
    
    // Обновляем время во всех окнах
    pairWindows.forEach((data, pairId) => {
        const serverTimeEl = document.getElementById(`server-clock-${pairId}`);
        if (serverTimeEl) {
            serverTimeEl.textContent = displayTime;
            // Логируем, что именно записано в элемент
            if (window.serverTimeDebugCount <= 5) {
                console.log(`🕐 [updateServerTime] Set server-clock-${pairId} to: ${serverTimeEl.textContent}`);
            }
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
            // Сервер всегда возвращает время, поэтому просто логируем ошибку
        }
    };
    
    // Запускаем сразу и затем каждую секунду
    pollServerTime();
    setInterval(pollServerTime, 1000);
}

// Экспортируем функцию для получения времени сервера (UTC-3)
window.getServerTimeUTC = function() {
    // Сервер всегда возвращает время, поэтому просто возвращаем serverTimeUTC минус 3 часа
    if (serverTimeUTC === null || serverTimeUTC === undefined) {
        return null; // Возвращаем null, если серверное время еще не получено
    }
    
    const UTC_OFFSET_HOURS = 3;
    const UTC_OFFSET_SECONDS = UTC_OFFSET_HOURS * 3600;
    
    // Возвращаем серверное время (UTC) минус 3 часа для UTC-3
    return serverTimeUTC - UTC_OFFSET_SECONDS;
};

// Глобальный таймер для обновления времени до полной минуты
let globalTimeRemainingInterval = null;

function startGlobalTimeRemainingTimer() {
    // Останавливаем предыдущий таймер, если есть
    if (globalTimeRemainingInterval) {
        clearInterval(globalTimeRemainingInterval);
    }
    
    console.log('⏱️ [startGlobalTimeRemainingTimer] Starting global time remaining timer');
    
    globalTimeRemainingInterval = setInterval(() => {
        // ВСЕГДА используем серверное время
        const serverTimeSec = window.getServerTimeUTC();
        
        if (isNaN(serverTimeSec)) {
            return;
        }
        
        // Вычисляем время до полной минуты (секунды до следующей минуты)
        const secondsInCurrentMinute = serverTimeSec % 60;
        const remaining = 60 - secondsInCurrentMinute;
        
        // Обновляем время для всех активных пар
        selectedPairs.forEach(pair => {
            const timeElement = document.getElementById(`round-start-time-${pair.id}`);
            if (timeElement) {
                const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
                const ss = String(remaining % 60).padStart(2, '0');
                timeElement.textContent = `${mm}:${ss}`;
                
                // Меняем цвет в зависимости от оставшегося времени
                // ≤10 секунд - красный, >10 секунд - зеленый
                if (remaining <= 10) {
                    timeElement.className = 'pull-right text-sell';
                } else {
                    timeElement.className = 'pull-right text-buy';
                }
            }
            
            // Обновляем прогресс-бар для всех пар (показываем оставшееся время до полной минуты)
            const barElement = document.getElementById(`round-bar-${pair.id}`);
            if (barElement) {
                // Прогресс рассчитываем как оставшееся время до полной минуты
                // remaining - секунды до полной минуты (60-1)
                // Прогресс = (remaining / 60) * 100
                // При remaining = 60 (начало минуты) → 100%
                // При remaining = 0 (конец минуты) → 0%
                const progress = Math.max(0, Math.min(100, (remaining / 60) * 100));
                barElement.style.width = `${progress}%`;
                
                // Меняем цвет прогресс-бара в зависимости от оставшегося времени
                // ≤10 секунд - красный, >10 секунд - зеленый
                if (remaining <= 10) {
                    barElement.className = 'sc-bar-fill bg-sell';
                } else {
                    barElement.className = 'sc-bar-fill bg-buy';
                }
            }
            
            // Обновляем цвет линии ордера для активных раундов этой пары
            if (window.chartModule && window.chartModule.updateOrderLineColor) {
                const activeRoundsForPair = activeRounds.filter(r => r.pair_id === pair.id);
                activeRoundsForPair.forEach(round => {
                    window.chartModule.updateOrderLineColor(pair.id, round.id.toString(), remaining);
                });
            }
        });
    }, 1000);
}

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
                const amount = round.amount || tradeAmount || 0;
                window.chartModule.drawOrderLine(
                    targetPairId,
                    orderPrice, // Это round.start_price (цена создания ордера)
                    round.id.toString(),
                    direction,
                    orderTime, // Передаем время создания ордера
                    endTime, // Передаем время окончания раунда для обратного отсчета
                    amount // Сумма, на которую покупаем
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
        pair_id: roundData.pair_id || activePairId || 1,
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
    // Останавливаем старый таймер для этого раунда, если есть
    if (roundTimers.has(round.id)) {
        clearInterval(roundTimers.get(round.id));
    }
    
    console.log(`⏱️ [startRoundTimer] Starting timer for round ${round.id}, pair ${round.pair_id}, end_time: ${round.end_time}`);
    
    const interval = setInterval(() => {
        // ВСЕГДА используем серверное время для расчета
        const serverTimeSec = window.getServerTimeUTC();
        const now = serverTimeSec * 1000; // Конвертируем в миллисекунды
        
        let endTime;
        
        // Парсим время окончания
        if (typeof round.end_time === 'string') {
            endTime = new Date(round.end_time).getTime();
        } else if (typeof round.end_time === 'number') {
            // Если это Unix timestamp в секундах, конвертируем в миллисекунды
            if (round.end_time < 1e10) {
                endTime = round.end_time * 1000;
            } else {
                endTime = round.end_time;
            }
        } else {
            endTime = round.end_time;
        }
        
        // Проверяем валидность времени
        if (isNaN(endTime) || endTime === 0 || isNaN(now) || isNaN(serverTimeSec)) {
            console.error('Invalid end_time or now for round:', round, 'now:', now, 'serverTimeSec:', serverTimeSec);
            clearInterval(interval);
            roundTimers.delete(round.id);
            return;
        }
        
        // Вычисляем время до полной минуты (секунды до следующей минуты)
        const secondsInCurrentMinute = serverTimeSec % 60;
        const remaining = 60 - secondsInCurrentMinute;
        
        // Логируем только раз в 10 секунд, чтобы не засорять консоль
        if (remaining % 10 === 0 || remaining < 10) {
            console.log(`⏱️ [startRoundTimer] Round ${round.id}, time to full minute: ${remaining}s, serverTime: ${serverTimeSec}, seconds in minute: ${secondsInCurrentMinute}`);
        }
        updateRoundTimeRemaining(round.id, remaining, round.pair_id, round.duration);
    }, 1000);
    
    // Сохраняем ID интервала
    roundTimers.set(round.id, interval);
}

function updateRoundTimeRemaining(roundId, seconds, pairId = null, duration = null) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    // Обновляем элемент в списке активных раундов
    const roundElement = document.querySelector(`[data-round-id="${roundId}"]`);
    if (roundElement) {
        const timeElement = roundElement.querySelector('.round-time');
        if (timeElement) {
            timeElement.textContent = timeStr;
        }
    }
    
    // Обновляем элемент в rightbar для конкретной пары
    if (pairId) {
        const timeElement = document.getElementById(`round-start-time-${pairId}`);
        if (timeElement) {
            timeElement.textContent = timeStr;
            
            // Меняем цвет в зависимости от оставшегося времени
            // ≤10 секунд - красный, >10 секунд - зеленый
            if (seconds <= 10) {
                timeElement.className = 'pull-right text-sell';
            } else {
                timeElement.className = 'pull-right text-buy';
            }
        }
        
        // Обновляем прогресс-бар
        const barElement = document.getElementById(`round-bar-${pairId}`);
        if (barElement && duration) {
            const progress = Math.max(0, Math.min(100, (seconds / duration) * 100));
            barElement.style.width = `${progress}%`;
            
            // Меняем цвет прогресс-бара в зависимости от оставшегося времени
            // ≤10 секунд - красный, >10 секунд - зеленый
            if (seconds <= 10) {
                barElement.className = 'sc-bar-fill bg-sell';
            } else {
                barElement.className = 'sc-bar-fill bg-buy';
            }
        }
        
        // Обновляем цвет линии ордера для этой пары
        if (window.chartModule && window.chartModule.updateOrderLineColor) {
            const activeRoundsForPair = activeRounds.filter(r => r.pair_id === pairId);
            activeRoundsForPair.forEach(round => {
                window.chartModule.updateOrderLineColor(pairId, round.id.toString(), seconds);
            });
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
    console.log(`🏁 [handleRoundFinished] Round finished:`, data);
    
    // Получаем pair_id из данных или из активных раундов
    const finishedRound = activeRounds.find(r => r.id === data.round_id);
    const pairId = finishedRound ? finishedRound.pair_id : (data.pair_id || null);
    
    // Удаляем линию и прямоугольник с графика СРАЗУ
    if (window.chartModule && window.chartModule.removeOrderLine && pairId) {
        console.log(`🗑️ [handleRoundFinished] Removing order line for round ${data.round_id}, pair ${pairId}`);
        window.chartModule.removeOrderLine(pairId, data.round_id.toString());
    } else {
        console.warn(`⚠️ [handleRoundFinished] Cannot remove order line: chartModule=${!!window.chartModule}, pairId=${pairId}`);
    }
    
    // Останавливаем таймер для этого раунда
    if (roundTimers.has(data.round_id)) {
        clearInterval(roundTimers.get(data.round_id));
        roundTimers.delete(data.round_id);
    }
    
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
    
    // Показываем всплывашку при выигрыше
    if (data.win && data.profit > 0) {
        showProfitNotification(data.profit);
    }
}

function showProfitNotification(profit) {
    // Создаем элемент всплывашки
    const notification = document.createElement('div');
    notification.id = 'profit-notification';
    notification.style.cssText = `
        position: fixed;
        left: 20px;
        bottom: 20px;
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
        z-index: 10000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 16px;
        font-weight: 600;
        min-width: 200px;
        animation: slideInLeft 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    
    notification.innerHTML = `
        <span style="font-size: 24px;">🎉</span>
        <div>
            <div style="font-size: 14px; opacity: 0.9;">Выигрыш!</div>
            <div style="font-size: 20px; margin-top: 4px;">+R$ ${profit.toFixed(2).replace('.', ',')}</div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Удаляем через 5 секунд с анимацией
    setTimeout(() => {
        notification.style.animation = 'slideOutLeft 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

function updateRoundTime(data) {
    // Обновление времени раунда через WebSocket
    if (data.round_id) {
        // Находим раунд в активных, чтобы получить pair_id и duration
        const round = activeRounds.find(r => r.id === data.round_id);
        const pairId = round ? round.pair_id : (data.pair_id || null);
        const duration = round ? round.duration : (data.duration || null);
        updateRoundTimeRemaining(data.round_id, data.remaining, pairId, duration);
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

