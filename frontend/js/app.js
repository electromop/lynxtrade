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
// Для тестирования можно установить меньшую длительность (например, 30 секунд)
// Раскомментируйте следующую строку для тестирования:
// tradeDuration = 30; // секунды для тестирования
// Для тестирования можно установить меньшую длительность (например, 30 секунд)
// Раскомментируйте следующую строку для тестирования:
// tradeDuration = 30; // секунды для тестирования
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
    
    // Обработчик round_finished удален - теперь используем клиентскую логику finishRoundOnClient
    // socket.on('round_finished', (data) => {
    //     handleRoundFinished(data);
    // });
    
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
        // Очищаем activeRounds - они будут заполнены в цикле ниже
        activeRounds = [];
        
        console.log(`📋 Loaded ${rounds.length} active rounds:`, rounds.map(r => ({ id: r.id, pair_id: r.pair_id, end_time: r.end_time, duration: r.duration })));
        
        // Останавливаем все старые таймеры
        roundTimers.forEach((intervalId) => {
            clearInterval(intervalId);
        });
        roundTimers.clear();
        
        // Проверяем истекшие раунды перед запуском таймеров
        const serverTimeSec = window.getServerTimeUTC();
        const now = serverTimeSec * 1000;
        const UTC_OFFSET_MS = 3 * 3600 * 1000;
        
        rounds.forEach(round => {
            // Вычисляем countdownSeconds для старых раундов, если его нет
            let countdownSeconds = round.countdownSeconds;
            if (!countdownSeconds) {
                // Для старых раундов вычисляем на основе текущего time_remaining
                const serverTimeSec = window.getServerTimeUTC();
                if (!isNaN(serverTimeSec) && serverTimeSec !== null) {
                    const secondsInCurrentMinute = serverTimeSec % 60;
                    const timeRemaining = 60 - secondsInCurrentMinute;
                    countdownSeconds = timeRemaining < 30 ? 60 + timeRemaining : timeRemaining;
                } else {
                    countdownSeconds = 60; // Дефолтное значение
                }
            }
            
            // Создаем объект раунда с правильной структурой
            const roundObj = {
                id: round.id,
                pair_id: round.pair_id,
                duration: round.duration || tradeDuration,
                amount: round.amount || tradeAmount,
                direction: round.direction || 'BUY',
                start_price: round.start_price,
                countdownSeconds: countdownSeconds,
                startCountdownTime: Date.now() // Используем текущее время как старт
            };
            
            // Добавляем раунд в activeRounds
            activeRounds.push(roundObj);
            
            // Запускаем таймер
            startRoundTimer(roundObj);
        });
        
        // Обновляем отображение активных раундов
        updateActiveRoundsDisplay();
        
        // Рисуем ордера на графике для всех активных раундов
        // Используем небольшую задержку, чтобы график успел инициализироваться
        setTimeout(() => {
            activeRounds.forEach(round => {
                if (round.start_price && round.pair_id && window.chartModule && window.chartModule.drawOrderLine) {
                    const orderTime = Date.now() / 1000; // Используем текущее время
                    const countdownSeconds = round.countdownSeconds || 60;
                    const amount = round.amount || 0;
                    const direction = round.direction || 'BUY';
                    window.chartModule.drawOrderLine(
                        round.pair_id,
                        round.start_price,
                        round.id.toString(),
                        direction,
                        orderTime,
                        countdownSeconds, // Передаем countdownSeconds вместо endTime
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
                    amount: round.amount || tradeAmount, // Сохраняем amount из сервера
                }, round.direction);
            }
        });
        
        // Проверяем истекшие раунды на клиенте
        const serverTimeSec = window.getServerTimeUTC();
        const now = serverTimeSec * 1000;
        
        activeRounds.forEach(round => {
            let endTimeUTC = null;
            if (typeof round.end_time === 'string') {
                endTimeUTC = new Date(round.end_time).getTime();
                if (isNaN(endTimeUTC)) {
                    const isoString = round.end_time.replace(' ', 'T');
                    endTimeUTC = new Date(isoString).getTime();
                }
                if (isNaN(endTimeUTC)) {
                    endTimeUTC = new Date(round.end_time + 'Z').getTime();
                }
            } else if (typeof round.end_time === 'number') {
                if (round.end_time < 1e10) {
                    endTimeUTC = round.end_time * 1000;
                } else {
                    endTimeUTC = round.end_time;
                }
            } else {
                endTimeUTC = round.end_time;
            }
            
            // Конвертируем endTime из UTC в UTC-3 (вычитаем 3 часа)
            const UTC_OFFSET_MS = 3 * 3600 * 1000;
            const endTime = endTimeUTC ? endTimeUTC - UTC_OFFSET_MS : null;
            
            // Если время истекло, завершаем раунд на клиенте
            // НО: проверяем, не завершен ли уже раунд в startRoundTimer
            // Если таймер для этого раунда еще активен, не завершаем здесь (пусть startRoundTimer завершит)
            if (!isNaN(endTime) && endTime > 0 && now >= endTime) {
                // Проверяем, есть ли активный таймер для этого раунда
                // #region agent log
                const timerExists = roundTimers.has(round.id);
                const roundTimersKeys = Array.from(roundTimers.keys());
                fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:429',message:'periodic update checking timer',data:{roundId:round.id,roundIdType:typeof round.id,now:now,endTime:endTime,timeDiff:now-endTime,timerExists:timerExists,roundTimersKeys:roundTimersKeys,roundTimersSize:roundTimers.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                if (timerExists) {
                    // Таймер активен, пусть startRoundTimer завершит раунд
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:437',message:'periodic update round expired but timer active',data:{roundId:round.id,now:now,endTime:endTime,timeDiff:now-endTime,timerExists:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    return; // Не завершаем здесь, пусть startRoundTimer завершит
                }
                console.log(`⏰ [periodic update] Round ${round.id} expired, finishing on client (no active timer)`);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:442',message:'periodic update round expired',data:{roundId:round.id,now:now,endTime:endTime,timeDiff:now-endTime,timerExists:false},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                finishRoundOnClient(round);
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
        
        // Обновляем вкладку для отображения результата раунда, если есть
        updateTabForRound(p.id);
    });
    
    // Активируем выбранную пару
    if (activePair) {
        switchToPair(activePair.id);
    } else if (selectedPairs.length > 0) {
        switchToPair(selectedPairs[0].id);
    }
}

// Маппинг символов на URL иконок из файла test
// OTC символы (используют /otc/ в пути)
const OTC_SYMBOL_ICON_MAP = {
    'EURUSD': 'https://zlincontent.com/cdn/icons/symbols/otc/eurusd.png',
    'EURGBP': 'https://zlincontent.com/cdn/icons/symbols/otc/eurgbp.png',
    'XAUUSD': 'https://zlincontent.com/cdn/icons/symbols/otc/xauusd.png',
    'AAPL': 'https://zlincontent.com/cdn/icons/symbols/otc/aapl2.png',
    'NFLX': 'https://zlincontent.com/cdn/icons/symbols/otc/nflx.png',
    'META': 'https://zlincontent.com/cdn/icons/symbols/otc/meta.png',
    'TSLA': 'https://zlincontent.com/cdn/icons/symbols/otc/tsla.png',
    'MSFT': 'https://zlincontent.com/cdn/icons/symbols/otc/msft.png',
    'EURJPY': 'https://zlincontent.com/cdn/icons/symbols/otc/eurjpy.png',
    'AMZN': 'https://zlincontent.com/cdn/icons/symbols/otc/amzn.png',
    'STARBUCKS': 'https://zlincontent.com/cdn/icons/symbols/otc/starbucks.png',
    'MASTERCARD': 'https://zlincontent.com/cdn/icons/symbols/otc/mastercard.png',
    'VISA': 'https://zlincontent.com/cdn/icons/symbols/otc/visa.png',
    'IBM': 'https://zlincontent.com/cdn/icons/symbols/otc/ibm.png',
    'COKE': 'https://zlincontent.com/cdn/icons/symbols/otc/coke.png',
    'SPOTIFY': 'https://zlincontent.com/cdn/icons/symbols/otc/spotify.png',
    'NIKE': 'https://zlincontent.com/cdn/icons/symbols/otc/nike.png',
    'INTEL': 'https://zlincontent.com/cdn/icons/symbols/otc/intel.png',
    // OTC версии криптовалют
    'BTC': 'https://zlincontent.com/cdn/icons/symbols/otc/bitcoin.png',
    'LTC': 'https://zlincontent.com/cdn/icons/symbols/otc/litecoin.png',
    'BNB': 'https://zlincontent.com/cdn/icons/symbols/otc/bnb.png',
    'ETH': 'https://zlincontent.com/cdn/icons/symbols/otc/ethereum.png',
    'SOL': 'https://zlincontent.com/cdn/icons/symbols/otc/solana.png',
    'AVAX': 'https://zlincontent.com/cdn/icons/symbols/otc/avax.png',
    'SUI': 'https://zlincontent.com/cdn/icons/symbols/otc/sui.png',
    'LINK': 'https://zlincontent.com/cdn/icons/symbols/otc/link.png',
    'XPL': 'https://zlincontent.com/cdn/icons/symbols/otc/xpl.png',
    'ADAUSDT': 'https://zlincontent.com/cdn/icons/symbols/otc/adausdt.png',
    'AUDJPY': 'https://zlincontent.com/cdn/icons/symbols/otc/audjpy.png',
    'EURAUD': 'https://zlincontent.com/cdn/icons/symbols/otc/euraud.png',
    'AUDCHF': 'https://zlincontent.com/cdn/icons/symbols/otc/audchf.png',
    'GBPJPY': 'https://zlincontent.com/cdn/icons/symbols/otc/gbpjpy.png',
    'CADCHF': 'https://zlincontent.com/cdn/icons/symbols/otc/cadchf.png',
    'GBPAUD': 'https://zlincontent.com/cdn/icons/symbols/otc/gbpaud.png',
    'NZDJPY': 'https://zlincontent.com/cdn/icons/symbols/otc/nzdjpy.png',
    'GBPCHF': 'https://zlincontent.com/cdn/icons/symbols/otc/gbpchf.png',
    'USDCHF': 'https://zlincontent.com/cdn/icons/symbols/otc/usdchf.png',
    'EURCAD': 'https://zlincontent.com/cdn/icons/symbols/otc/eurcad.png',
    'EURCHF': 'https://zlincontent.com/cdn/icons/symbols/otc/eurchf.png',
};

// Обычные символы (без /otc/)
const SYMBOL_ICON_MAP = {
    'BTCUSDT': 'https://zlincontent.com/cdn/icons/symbols/bitcoin.png',
    'BTCUSD': 'https://zlincontent.com/cdn/icons/symbols/btcusd.png',
    'LTCUSDT': 'https://zlincontent.com/cdn/icons/symbols/litecoin.png',
    'BNBUSDT': 'https://zlincontent.com/cdn/icons/symbols/bnb.png',
    'ADAUSDT': 'https://zlincontent.com/cdn/icons/symbols/adausdt.png',
    'AUDJPY': 'https://zlincontent.com/cdn/icons/symbols/audjpy.png',
    'GBPUSD': 'https://zlincontent.com/cdn/icons/symbols/gbpusd.png',
    'AUDCAD': 'https://zlincontent.com/cdn/icons/symbols/audcad.png',
    'USDCAD': 'https://zlincontent.com/cdn/icons/symbols/usdcad.png',
    'NZDUSD': 'https://zlincontent.com/cdn/icons/symbols/nzdusd.png',
    'USDJPY': 'https://zlincontent.com/cdn/icons/symbols/usdjpy.png',
    'CADJPY': 'https://zlincontent.com/cdn/icons/symbols/cadjpy.png',
    'CHFJPY': 'https://zlincontent.com/cdn/icons/symbols/chfjpy.png',
    'XRPUSDT': 'https://zlincontent.com/cdn/icons/symbols/xrp.png',
    'XRP': 'https://zlincontent.com/cdn/icons/symbols/xrp.png',
    'ETHUSDT': 'https://zlincontent.com/cdn/icons/symbols/ethereum.png',
    'SOLUSDT': 'https://zlincontent.com/cdn/icons/symbols/solana.png',
    'AVAXUSDT': 'https://zlincontent.com/cdn/icons/symbols/avax.png',
    'DOGEUSDT': 'https://zlincontent.com/cdn/icons/symbols/doge.png',
    'DOGE': 'https://zlincontent.com/cdn/icons/symbols/doge.png',
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
    'XLM': 'https://zlincontent.com/cdn/icons/symbols/xlm.png',
    'AUDNZD': 'https://zlincontent.com/cdn/icons/symbols/audnzd.png',
    'AUDUSD': 'https://zlincontent.com/cdn/icons/symbols/audusd.png',
    'NZDCHF': 'https://zlincontent.com/cdn/icons/symbols/nzdchf.png',
    'GBPCAD': 'https://zlincontent.com/cdn/icons/symbols/gbpcad.png',
    'GBPNZD': 'https://zlincontent.com/cdn/icons/symbols/gbpnzd.png',
    'NZDCAD': 'https://zlincontent.com/cdn/icons/symbols/nzdcad.png',
    'COPPER': 'https://zlincontent.com/cdn/icons/symbols/copper.png',
    'BRENTOIL': 'https://zlincontent.com/cdn/icons/symbols/brent-oil.png',
    'BRENT-OIL': 'https://zlincontent.com/cdn/icons/symbols/brent-oil.png',
    'SILVER': 'https://zlincontent.com/cdn/icons/symbols/silver.png',
};

function getIconUrl(symbol, category = null) {
    const upperSymbol = symbol.toUpperCase();
    
    // Если категория указана и это OTC, используем OTC маппинг
    if (category && (category.toLowerCase() === 'otc' || category.toLowerCase() === 'forex')) {
        // Проверяем OTC маппинг
        if (OTC_SYMBOL_ICON_MAP[upperSymbol]) {
            return OTC_SYMBOL_ICON_MAP[upperSymbol];
        }
        // Для OTC криптовалют извлекаем базовый актив
        if (upperSymbol.endsWith('USDT')) {
            const baseAsset = upperSymbol.replace('USDT', '');
            if (OTC_SYMBOL_ICON_MAP[baseAsset]) {
                return OTC_SYMBOL_ICON_MAP[baseAsset];
            }
        }
    }
    
    // Проверяем обычный маппинг
    if (SYMBOL_ICON_MAP[upperSymbol]) {
        return SYMBOL_ICON_MAP[upperSymbol];
    }
    
    // Для криптовалют извлекаем базовый актив
    if (upperSymbol.endsWith('USDT')) {
        const baseAsset = upperSymbol.replace('USDT', '');
        // Проверяем OTC маппинг для базового актива
        if (OTC_SYMBOL_ICON_MAP[baseAsset]) {
            return OTC_SYMBOL_ICON_MAP[baseAsset];
        }
        // Проверяем обычный маппинг для базового актива
        if (SYMBOL_ICON_MAP[baseAsset]) {
            return SYMBOL_ICON_MAP[baseAsset];
        }
    }
    
    // Fallback: пробуем найти в OTC маппинге
    if (OTC_SYMBOL_ICON_MAP[upperSymbol]) {
        return OTC_SYMBOL_ICON_MAP[upperSymbol];
    }
    
    // Общий fallback
    return `https://zlincontent.com/cdn/icons/symbols/${symbol.toLowerCase()}.png`;
}

// Хранилище завершенных раундов для отображения на вкладках
let finishedRounds = new Map(); // pairId -> { win, profit }

function updateTabForRound(pairId, roundData = null) {
    // Находим вкладку для этой пары
    const tab = document.querySelector(`.item[data-pair-id="${pairId}"]`);
    if (!tab) return;
    
    const descriptionEl = tab.querySelector('.description[data-v-f02899e6]');
    if (!descriptionEl) return;
    
    // Если передан roundData, сохраняем его
    if (roundData) {
        finishedRounds.set(pairId, roundData);
    } else {
        // Ищем в сохраненных завершенных раундах
        roundData = finishedRounds.get(pairId);
    }
    
    // Проверяем активный раунд
    const activeRound = activeRounds.find(r => r.pair_id === pairId);
    
    if (roundData) {
        // Есть завершенный раунд - показываем результат
        const isWin = roundData.win && roundData.profit > 0;
        const profitValue = Math.abs(roundData.profit);
        const formattedProfit = profitValue.toFixed(2).replace('.', ',');
        
        // Добавляем/удаляем классы
        tab.classList.remove('loosing', 'winning');
        tab.classList.add(isWin ? 'winning' : 'loosing');
        
        // Обновляем description
        descriptionEl.textContent = isWin ? `R$ ${formattedProfit}` : `R$ -${formattedProfit}`;
    } else if (activeRound) {
        // Есть активный раунд - показываем потенциальный выигрыш в реальном времени
        const currentPrice = window.chartModule && window.chartModule.getCurrentPrice 
            ? window.chartModule.getCurrentPrice(pairId) 
            : null;
        
        if (currentPrice !== null && activeRound.start_price) {
            // Определяем потенциальный выигрыш на основе текущей цены
            let isPotentialWin = false;
            if (activeRound.direction === 'BUY') {
                isPotentialWin = currentPrice > activeRound.start_price;
            } else if (activeRound.direction === 'SELL') {
                isPotentialWin = currentPrice < activeRound.start_price;
            }
            
            // Рассчитываем потенциальную прибыль
            const potentialProfit = calculateProfit(activeRound.amount, isPotentialWin);
            const profitValue = Math.abs(potentialProfit);
            const formattedProfit = profitValue.toFixed(2).replace('.', ',');
            
            // Обновляем description с жирным шрифтом
            descriptionEl.textContent = potentialProfit >= 0 ? `R$ ${formattedProfit}` : `R$ -${formattedProfit}`;
            
            // Добавляем/удаляем классы в зависимости от потенциального результата
            tab.classList.remove('loosing', 'winning');
            tab.classList.add(isPotentialWin ? 'winning' : 'loosing');
        } else {
            // Цена недоступна - показываем "Crypto"
            tab.classList.remove('loosing', 'winning');
            descriptionEl.textContent = 'Crypto';
        }
    } else {
        // Нет раундов - обычное отображение
        tab.classList.remove('loosing', 'winning');
        descriptionEl.textContent = 'Crypto';
    }
}

function createTab(pair) {
    const tab = document.createElement('div');
    tab.className = 'item';
    tab.setAttribute('data-pair-id', pair.id);
    tab.setAttribute('data-v-f02899e6', '');
    
    // URL иконки символа из маппинга (с учетом категории)
    const iconUrl = getIconUrl(pair.symbol, pair.category);
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
    
    // Обновляем вкладку для отображения результата раунда, если есть
    updateTabForRound(pair.id);
    
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
            
            // Восстанавливаем ордера для этой пары после инициализации графика
            setTimeout(() => {
                const roundsForPair = activeRounds.filter(r => r.pair_id === pairId);
                roundsForPair.forEach(round => {
                    if (round.start_price && window.chartModule && window.chartModule.drawOrderLine) {
                        const orderTime = Date.now() / 1000;
                        const countdownSeconds = round.countdownSeconds || 60;
                        const amount = round.amount || 0;
                        const direction = round.direction || 'BUY';
                        console.log(`🔄 [switchToPair] Restoring order ${round.id} for pair ${pairId}`);
                        window.chartModule.drawOrderLine(
                            pairId,
                            round.start_price,
                            round.id.toString(),
                            direction,
                            orderTime,
                            countdownSeconds,
                            amount
                        );
                    }
                });
            }, 500); // Небольшая задержка для инициализации графика
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
            // Вычисляем время до окончания раунда (в секундах)
            const now = serverTimeSec * 1000;
            let endTimeConverted = activeRound.end_time_converted;
            if (!endTimeConverted) {
                // Fallback: конвертируем на лету
                let endTimeUTC = null;
                if (typeof activeRound.end_time === 'string') {
                    endTimeUTC = new Date(activeRound.end_time).getTime();
                    if (isNaN(endTimeUTC)) {
                        const isoString = activeRound.end_time.replace(' ', 'T');
                        endTimeUTC = new Date(isoString).getTime();
                    }
                    if (isNaN(endTimeUTC)) {
                        endTimeUTC = new Date(activeRound.end_time + 'Z').getTime();
                    }
                } else if (typeof activeRound.end_time === 'number') {
                    if (activeRound.end_time < 1e10) {
                        endTimeUTC = activeRound.end_time * 1000;
                    } else {
                        endTimeUTC = activeRound.end_time;
                    }
                } else {
                    endTimeUTC = activeRound.end_time;
                }
                const UTC_OFFSET_MS = 3 * 3600 * 1000;
                endTimeConverted = endTimeUTC ? endTimeUTC - UTC_OFFSET_MS : null;
            }
            const remaining = Math.max(0, Math.floor((endTimeConverted - now) / 1000));
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
    
    // Обновляем мобильный аккаунт
    if (typeof updateMobileAccount === 'function') {
        updateMobileAccount();
    }
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
        const iconUrl = getIconUrl(pair.symbol, pair.category);
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1163',message:'updateBalanceDisplay entry',data:{userBalance:userBalance},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const balanceEl = document.getElementById('balance');
    if (!balanceEl) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1166',message:'balance element not found',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        return;
    }
    const formatted = userBalance.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    balanceEl.textContent = `R$ ${formatted}`;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1171',message:'updateBalanceDisplay exit',data:{userBalance:userBalance,formatted:formatted,textContent:balanceEl.textContent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
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
        
        // Вычисляем время до окончания раунда для каждой пары
        const now = serverTimeSec * 1000;
        
        // Обновляем время для всех активных пар
        // ВСЕГДА показываем время до следующей полной минуты на основе server time
        selectedPairs.forEach(pair => {
            // Вычисляем секунды до следующей полной минуты на основе server time
            const secondsInCurrentMinute = serverTimeSec % 60;
            const remaining = 60 - secondsInCurrentMinute;
            
            // Находим активный раунд для этой пары (для обновления цвета линии ордера)
            const activeRoundForPair = activeRounds.find(r => r.pair_id === pair.id);
            
            const timeElement = document.getElementById(`round-start-time-${pair.id}`);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1394',message:'global timer updating time',data:{pairId:pair.id,remaining:remaining,serverTimeSec:serverTimeSec,secondsInCurrentMinute:serverTimeSec%60,timeElementExists:!!timeElement},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
            // #endregion
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
            
            // Обновляем прогресс-бар для всех пар (показываем оставшееся время до окончания раунда)
            const barElement = document.getElementById(`round-bar-${pair.id}`);
            if (barElement) {
                // Прогресс рассчитываем как оставшееся время до окончания раунда
                // remaining - секунды до окончания раунда
                // Прогресс = (remaining / duration) * 100
                const duration = activeRoundForPair ? (activeRoundForPair.duration || 60) : 60;
                const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));
                barElement.style.width = `${progress}%`;
                
                // Меняем цвет прогресс-бара в зависимости от оставшегося времени
                // ≤10 секунд - красный, >10 секунд - зеленый
                if (remaining <= 10) {
                    barElement.className = 'sc-bar-fill bg-sell';
                } else {
                    barElement.className = 'sc-bar-fill bg-buy';
                }
            }
            
            // Цвет линии статичный и определяется направлением ордера при создании
            // BUY - зеленый (#22c55e), SELL - красный (#ef4444)
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
    
    // Вычисляем time_remaining (секунды до следующей полной минуты)
    const serverTimeSec = window.getServerTimeUTC();
    if (isNaN(serverTimeSec) || serverTimeSec === null) {
        console.error('❌ [createRound] Server time not available');
        alert('Ошибка: время сервера недоступно');
        return;
    }
    
    const secondsInCurrentMinute = serverTimeSec % 60;
    const timeRemaining = 60 - secondsInCurrentMinute;
    
    // Вычисляем время обратного отсчета согласно новой логике
    let countdownSeconds;
    if (timeRemaining < 30) {
        countdownSeconds = 60 + timeRemaining;
    } else {
        countdownSeconds = timeRemaining;
    }
    
    console.log(`⏱️ [createRound] time_remaining: ${timeRemaining}s, countdown: ${countdownSeconds}s`);
    
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
            
            // Добавляем countdownSeconds в объект раунда
            round.countdownSeconds = countdownSeconds;
            round.startCountdownTime = Date.now(); // Время начала обратного отсчета
            
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
                // Передаем countdownSeconds вместо endTime для индивидуального обратного отсчета
                const amount = round.amount || tradeAmount || 0;
                window.chartModule.drawOrderLine(
                    targetPairId,
                    orderPrice, // Это round.start_price (цена создания ордера)
                    round.id.toString(),
                    direction,
                    orderTime, // Передаем время создания ордера
                    countdownSeconds, // Передаем время обратного отсчета в секундах
                    amount // Сумма, на которую покупаем
                );
            }
            
            // НЕ вызываем loadActiveRounds() здесь, так как ордер уже добавлен через addActiveRound()
            // и имеет правильный countdownSeconds
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
    // Используем новую логику с countdownSeconds
    const countdownSeconds = roundData.countdownSeconds || 60; // По умолчанию 60 секунд, если не указано
    const startCountdownTime = roundData.startCountdownTime || Date.now();
    
    const round = {
        id: roundData.id,
        pair_id: roundData.pair_id || activePairId || 1,
        direction: direction,
        amount: roundData.amount || tradeAmount,
        duration: tradeDuration,
        start_price: roundData.start_price,
        countdownSeconds: countdownSeconds,
        startCountdownTime: startCountdownTime,
    };
    
    console.log(`✅ [addActiveRound] Added round ${round.id} with countdown: ${countdownSeconds}s`);
    
    activeRounds.push(round);
    updateActiveRoundsDisplay();
    
    // Обновляем время сразу при создании раунда
    updateRoundTimeRemaining(round.id, countdownSeconds, round.pair_id, round.duration);
    
    startRoundTimer(round);
}

function startRoundTimer(round) {
    // Останавливаем старый таймер для этого раунда, если есть
    if (roundTimers.has(round.id)) {
        clearInterval(roundTimers.get(round.id));
    }
    
    // Используем countdownSeconds для индивидуального обратного отсчета
    const countdownSeconds = round.countdownSeconds || 60;
    const startCountdownTime = round.startCountdownTime || Date.now();
    
    console.log(`⏱️ [startRoundTimer] Starting timer for round ${round.id}, pair ${round.pair_id}, countdown: ${countdownSeconds}s`);
    
    // Вычисляем оставшееся время на основе прошедшего времени с момента старта
    const calculateRemaining = () => {
        const elapsed = Math.floor((Date.now() - startCountdownTime) / 1000);
        return Math.max(0, countdownSeconds - elapsed);
    };
    
    // Проверяем сразу при запуске таймера
    let remainingSeconds = calculateRemaining();
    if (remainingSeconds <= 0) {
        console.log(`⏰ [startRoundTimer] Round ${round.id} already expired at start, finishing on client`);
        finishRoundOnClient(round);
        return;
    }
    
    // Обновляем время сразу
    updateRoundTimeRemaining(round.id, remainingSeconds, round.pair_id, round.duration);
    
    // Обновляем таймер в прямоугольнике на графике
    if (window.chartModule && window.chartModule.updateOrderCountdown) {
        window.chartModule.updateOrderCountdown(round.pair_id, round.id.toString(), remainingSeconds);
    }
    
    // Используем интервал для обновления каждую секунду
    const interval = setInterval(() => {
        remainingSeconds = calculateRemaining();
        
        // Обновляем отображение времени
        updateRoundTimeRemaining(round.id, remainingSeconds, round.pair_id, round.duration);
        
        // Обновляем таймер в прямоугольнике на графике
        if (window.chartModule && window.chartModule.updateOrderCountdown) {
            window.chartModule.updateOrderCountdown(round.pair_id, round.id.toString(), remainingSeconds);
        }
        
        // Если время истекло, завершаем раунд
        if (remainingSeconds <= 0) {
            console.log(`⏰ [startRoundTimer] Round ${round.id} time expired, finishing on client`);
            clearInterval(interval);
            roundTimers.delete(round.id);
            finishRoundOnClient(round);
            return;
        }
    }, 1000); // Обновляем каждую секунду
    
    // Сохраняем ID интервала
    roundTimers.set(round.id, interval);
}

function updateRoundTimeRemaining(roundId, seconds, pairId = null, duration = null) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1900',message:'updateRoundTimeRemaining entry',data:{roundId:roundId,seconds:seconds,pairId:pairId,duration:duration,timeStr:timeStr},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
    // Обновляем элемент в списке активных раундов
    const roundElement = document.querySelector(`[data-round-id="${roundId}"]`);
    if (roundElement) {
        const timeElement = roundElement.querySelector('.round-time');
        if (timeElement) {
            timeElement.textContent = timeStr;
        }
    }
    
    // НЕ обновляем "Time remaining" в rightbar здесь - это делает startGlobalTimeRemainingTimer
    // Цвет линии статичный и определяется направлением ордера (BUY - зеленый, SELL - красный)
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

// Функции для расчета результата на клиенте
function determineRoundResult(winRate) {
    const randomValue = Math.floor(Math.random() * 100) + 1;
    return randomValue <= winRate;
}

function calculateProfit(amount, isWin) {
    if (isWin) {
        return amount * 0.85; // 85% прибыль
    }
    return -amount; // Проигрыш - теряем всю ставку
}

async function finishRoundOnClient(round) {
    console.log(`🏁 [finishRoundOnClient] Finishing round ${round.id} on client`);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1638',message:'finishRoundOnClient entry',data:{roundId:round.id,pairId:round.pair_id,amount:round.amount,apiBase:window.API_BASE},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    try {
        // 1. Запрашиваем win_rate с сервера
        const winRateUrl = `${window.API_BASE}/win-rate`;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1643',message:'fetching win_rate',data:{url:winRateUrl,roundId:round.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        const winRateResponse = await fetch(winRateUrl);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1644',message:'win_rate response',data:{roundId:round.id,ok:winRateResponse.ok,status:winRateResponse.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        const winRateData = await winRateResponse.json();
        const winRate = winRateData.win_rate || 50;
        console.log(`📊 [finishRoundOnClient] Win rate from server: ${winRate}%`);
        
        // 2. Рассчитываем результат на клиенте
        const isWin = determineRoundResult(winRate);
        const amount = round.amount || 0;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1649',message:'calculating result',data:{roundId:round.id,amount:amount,winRate:winRate,isWin:isWin},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        const profit = calculateProfit(amount, isWin);
        
        console.log(`🎲 [finishRoundOnClient] Round result: win=${isWin}, profit=${profit}, amount=${amount}`);
        
        // 3. Отправляем результат на сервер
        const finishUrl = `${window.API_BASE}/rounds/${round.id}/finish`;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1656',message:'sending finish request',data:{url:finishUrl,roundId:round.id,win:isWin,profit:profit},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        const finishResponse = await fetch(finishUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                win: isWin,
                profit: profit
            })
        });
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1667',message:'finish response',data:{roundId:round.id,ok:finishResponse.ok,status:finishResponse.status,statusText:finishResponse.statusText},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        
        if (!finishResponse.ok) {
            throw new Error(`Failed to finish round: ${finishResponse.statusText}`);
        }
        
        const finishData = await finishResponse.json();
        const newBalance = finishData.new_balance;
        
        console.log(`✅ [finishRoundOnClient] Round finished on server, new balance: ${newBalance}`);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1672',message:'before UI update',data:{roundId:round.id,oldBalance:userBalance,newBalance:newBalance},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        // 4. Обновляем UI
        userBalance = newBalance;
        updateBalanceDisplay();
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1678',message:'after balance update',data:{roundId:round.id,userBalance:userBalance},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        // Удаляем раунд из активных
        activeRounds = activeRounds.filter(r => r.id !== round.id);
        updateActiveRoundsDisplay();
        
        // Удаляем линию с графика
        if (window.chartModule && window.chartModule.removeOrderLine && round.pair_id) {
            console.log(`🗑️ [finishRoundOnClient] Removing order line for round ${round.id}, pair ${round.pair_id}`);
            window.chartModule.removeOrderLine(round.pair_id, round.id.toString());
        }
        
        // Останавливаем таймер (уже остановлен, но на всякий случай)
        if (roundTimers.has(round.id)) {
            clearInterval(roundTimers.get(round.id));
            roundTimers.delete(round.id);
        }
        
        // Обновляем вкладку
        if (round.pair_id) {
            updateTabForRound(round.pair_id, {
                win: isWin,
                profit: profit
            });
            
            // Очищаем форматирование через 3 секунды, если больше нет активных ордеров
            setTimeout(() => {
                const hasActiveRounds = activeRounds.some(r => r.pair_id === round.pair_id);
                if (!hasActiveRounds) {
                    // Удаляем данные завершенного раунда из хранилища
                    finishedRounds.delete(round.pair_id);
                    // Обновляем вкладку без данных (вернет "Crypto" и уберет классы)
                    updateTabForRound(round.pair_id);
                }
            }, 3000);
        }
        
        // Показываем всплывашку
        showRoundResultNotification({
            round_id: round.id,
            pair_id: round.pair_id,
            win: isWin,
            profit: profit,
            new_balance: newBalance
        });
        
    } catch (error) {
        console.error(`❌ [finishRoundOnClient] Error finishing round ${round.id}:`, error);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e25f0d9-b883-4cae-b9d4-faaf8661b268',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:1710',message:'finishRoundOnClient error',data:{roundId:round.id,error:error.message,errorStack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // В случае ошибки все равно удаляем раунд из активных и останавливаем таймер
        activeRounds = activeRounds.filter(r => r.id !== round.id);
        updateActiveRoundsDisplay();
        if (roundTimers.has(round.id)) {
            clearInterval(roundTimers.get(round.id));
            roundTimers.delete(round.id);
        }
    }
}

function handleRoundFinished(data) {
    console.log(`🏁 [handleRoundFinished] Round finished:`, data);
    console.log(`🏁 [handleRoundFinished] Full data object:`, JSON.stringify(data, null, 2));
    
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
    console.log(`💰 [handleRoundFinished] Balance update:`, {
        oldBalance: userBalance,
        newBalance: data.new_balance,
        profit: data.profit,
        win: data.win
    });
    if (data.new_balance !== undefined && data.new_balance !== null) {
        userBalance = data.new_balance;
        updateBalanceDisplay();
    } else {
        console.warn(`⚠️ [handleRoundFinished] new_balance is missing, reloading balance from server`);
        loadBalance();
    }
    
    // Показываем результат
    const message = data.win 
        ? `Выигрыш! Прибыль: R$ ${data.profit.toFixed(2)}`
        : `Проигрыш. Потеряно: R$ ${Math.abs(data.profit).toFixed(2)}`;
    
    console.log(message);
    
    // Обновляем вкладку для отображения результата
    if (pairId) {
        updateTabForRound(pairId, {
            win: data.win,
            profit: data.profit
        });
        
        // Очищаем форматирование через 3 секунды, если больше нет активных ордеров
        setTimeout(() => {
            const hasActiveRounds = activeRounds.some(r => r.pair_id === pairId);
            if (!hasActiveRounds) {
                // Удаляем данные завершенного раунда из хранилища
                finishedRounds.delete(pairId);
                // Обновляем вкладку без данных (вернет "Crypto" и уберет классы)
                updateTabForRound(pairId);
            }
        }, 3000);
        
        // Убеждаемся, что pair_id передается в data для всплывашки
        if (!data.pair_id) {
            data.pair_id = pairId;
        }
    }
    
    // Показываем всплывашку результата сделки (всегда - и при выигрыше, и при проигрыше)
    showRoundResultNotification(data);
}

function showRoundResultNotification(data) {
    console.log(`🔔 [showRoundResultNotification] Showing notification:`, data);
    
    // Проверяем, нет ли уже всплывашки с таким же round_id
    const roundId = data.round_id;
    if (roundId) {
        const existingAlert = document.querySelector(`[data-round-id="${roundId}"]`);
        if (existingAlert) {
            console.log(`⚠️ [showRoundResultNotification] Notification for round ${roundId} already exists, skipping`);
            return;
        }
    }
    
    // Получаем или создаем контейнер для алертов
    let alertsContainer = document.getElementById('traderoom-alerts');
    if (!alertsContainer) {
        alertsContainer = document.createElement('div');
        alertsContainer.id = 'traderoom-alerts';
        alertsContainer.setAttribute('data-v-f02899e6', '');
        alertsContainer.style.cssText = `
            position: fixed;
            left: 20px;
            bottom: 20px;
            z-index: 99999;
            pointer-events: none;
        `;
        document.body.appendChild(alertsContainer);
        console.log(`✅ [showRoundResultNotification] Created alerts container`);
    }
    
    // НЕ удаляем старые алерты - показываем все всплывашки одновременно (глобальный фокус)
    // alertsContainer.innerHTML = '';
    
    // Создаем новый алерт
    const alertEl = document.createElement('div');
    alertEl.className = 'tr-alert';
    alertEl.setAttribute('data-v-f02899e6', '');
    if (roundId) {
        alertEl.setAttribute('data-round-id', roundId);
    }
    alertEl.style.cssText = 'pointer-events: auto; cursor: pointer;';
    
    const containerEl = document.createElement('div');
    containerEl.className = 'tr-container';
    containerEl.setAttribute('data-v-f02899e6', '');
    // Стили применяются через CSS класс tr-alert
    
    // Получаем иконку пары
    const pair = selectedPairs.find(p => p.id === data.pair_id) || 
                 allAvailablePairs.find(p => p.id === data.pair_id);
    const iconUrl = pair ? getIconUrl(pair.symbol, pair.category) : 
                      'https://zlincontent.com/cdn/icons/symbols/bitcoin.png';
    
    const imgEl = document.createElement('img');
    imgEl.setAttribute('data-v-f02899e6', '');
    imgEl.src = iconUrl;
    imgEl.style.cssText = 'width: 32px; height: 32px; object-fit: contain;';
    imgEl.onerror = function() {
        this.src = '/api/img/mini-logo.png';
    };
    
    const contentEl = document.createElement('div');
    contentEl.className = 'tr-content';
    contentEl.setAttribute('data-v-f02899e6', '');
    
    const titleEl = document.createElement('div');
    titleEl.className = 'tr-title';
    titleEl.setAttribute('data-v-f02899e6', '');
    titleEl.textContent = 'Result';
    titleEl.style.cssText = `
        color: #8b8fa3;
        font-size: 12px;
        text-transform: uppercase;
        margin-bottom: 4px;
    `;
    
    const textEl = document.createElement('div');
    textEl.className = 'tr-text';
    textEl.setAttribute('data-v-f02899e6', '');
    const isWin = data.win && data.profit > 0;
    textEl.classList.add(isWin ? 'text-buy' : 'text-sell');
    
    // Форматируем сумму: R$ 10,25 (с запятой)
    const profitValue = Math.abs(data.profit);
    const formattedProfit = profitValue.toFixed(2).replace('.', ',');
    textEl.textContent = isWin ? `R$ ${formattedProfit}` : `R$ -${formattedProfit}`;
    textEl.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        font-family: Arial, Helvetica, sans-serif;
    `;
    
    contentEl.appendChild(titleEl);
    contentEl.appendChild(textEl);
    
    containerEl.appendChild(imgEl);
    containerEl.appendChild(contentEl);
    alertEl.appendChild(containerEl);
    alertsContainer.appendChild(alertEl);
    
    console.log(`✅ [showRoundResultNotification] Notification added to DOM:`, {
        containerExists: !!alertsContainer,
        alertExists: !!alertEl,
        isVisible: alertEl.offsetParent !== null,
        zIndex: alertsContainer.style.zIndex
    });
    
    // Удаляем через 5 секунд с анимацией
    setTimeout(() => {
        containerEl.style.animation = 'slideOutLeft 0.3s ease-in';
        setTimeout(() => {
            if (alertEl.parentNode) {
                alertEl.parentNode.removeChild(alertEl);
            }
            // Удаляем контейнер, если он пустой
            if (alertsContainer.children.length === 0) {
                alertsContainer.remove();
            }
        }, 300);
    }, 5000);
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

// Mobile Account and Tabs functionality
function updateMobileAccount() {
    // Обновляем только мобильный элемент account_name
    const mobileAccounts = document.getElementById('mobile_accounts');
    if (!mobileAccounts) return;
    
    const accountNameEl = mobileAccounts.querySelector('#account_name');
    if (!accountNameEl) return;
    
    const activePair = selectedPairs.find(p => p.id === activePairId) || selectedPairs[0];
    if (activePair) {
        const iconUrl = getIconUrl(activePair.symbol, activePair.category);
        accountNameEl.innerHTML = `<img data-v-f02899e6="" src="${iconUrl}" width="25"> ${activePair.name || activePair.symbol}`;
    }
}

function openMobileTabs() {
    const mobileTabs = document.getElementById('mobile-tabs');
    if (!mobileTabs) return;
    
    const content = document.getElementById('mobile-tabs-content');
    if (!content) return;
    
    // Очищаем содержимое
    content.innerHTML = '';
    
    // Добавляем выбранные пары
    selectedPairs.forEach(pair => {
        const iconUrl = getIconUrl(pair.symbol, pair.category);
        const item = document.createElement('div');
        item.className = `item ${pair.id === activePairId ? 'active' : ''}`;
        item.setAttribute('data-v-f02899e6', '');
        item.innerHTML = `
            <div style="display: flex; align-items: center;">
                <img data-v-f02899e6="" src="${iconUrl}" style="width: 30px; height: 30px; margin-right: 10px;">
                ${pair.name || pair.symbol}
            </div>
            <button data-v-f02899e6="" class="remove-pair-btn" data-pair-id="${pair.id}">
                <i data-v-f02899e6="" class="fa fa-times"></i>
            </button>
        `;
        
        // Обработчик клика на элемент
        item.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                switchToPair(pair.id);
                updateMobileAccount();
                closeMobileTabs();
            }
        });
        
        // Обработчик удаления пары
        const removeBtn = item.querySelector('.remove-pair-btn');
        if (removeBtn && selectedPairs.length > 1) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removePair(pair.id);
                updateMobileAccount();
                openMobileTabs(); // Обновляем список
            });
        }
        
        content.appendChild(item);
    });
    
    // Добавляем кнопку "Add symbol"
    const addItem = document.createElement('div');
    addItem.className = 'item add';
    addItem.setAttribute('data-v-f02899e6', '');
    addItem.innerHTML = `<i data-v-f02899e6="" class="fa fa-plus"></i> Add symbol`;
    addItem.addEventListener('click', () => {
        closeMobileTabs();
        showAddPairModal();
    });
    content.appendChild(addItem);
    
    mobileTabs.style.display = 'block';
}

function closeMobileTabs() {
    const mobileTabs = document.getElementById('mobile-tabs');
    if (mobileTabs) {
        mobileTabs.style.display = 'none';
    }
}

// Инициализация мобильных элементов
document.addEventListener('DOMContentLoaded', () => {
    // Обновляем мобильный аккаунт после загрузки пар
    setTimeout(() => {
        updateMobileAccount();
    }, 1000);
    
    // Обработчик клика на мобильный аккаунт
    const accountDetails = document.getElementById('account_details');
    if (accountDetails) {
        accountDetails.addEventListener('click', () => {
            openMobileTabs();
        });
    }
    
    // Обработчик закрытия модального окна
    const closeBtn = document.getElementById('closeMobileTabs');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMobileTabs();
        });
    }
    
    // Обновляем мобильный аккаунт при переключении пар
    const originalSwitchToPair = window.switchToPair;
    if (originalSwitchToPair) {
        window.switchToPair = function(pairId) {
            originalSwitchToPair(pairId);
            updateMobileAccount();
        };
    }
});

