// Инициализация TradingView Trading Platform

let tvWidgets = new Map(); // pairId -> { widget, datafeed, broker }
let currentPairId = null;

// API_BASE объявлен в datafeed.js как window.API_BASE

function initTradingView(pairId = 1, containerElement = null) {
    // Проверяем, существует ли виджет для этой пары
    if (tvWidgets.has(pairId)) {
        const existingData = tvWidgets.get(pairId);
        // Если контейнер тот же, не создаем заново
        if (containerElement && existingData.widget) {
            try {
                const currentContainer = existingData.widget.container();
                if (currentContainer && currentContainer.id === containerElement.id) {
                    console.log(`Widget already exists for pair ${pairId} with same container`);
                    return;
                }
            } catch (e) {
                // Виджет может быть еще не готов, продолжаем
            }
        } else if (!containerElement) {
            console.log(`Widget already exists for pair ${pairId}`);
            return;
        }
    }
    
    // Определяем контейнер
    let containerId;
    let container;
    if (containerElement) {
        container = containerElement;
        containerId = containerElement.id || `tv_chart_${pairId}_${Date.now()}`;
        if (!containerElement.id) {
            containerElement.id = containerId;
        }
        // Очищаем контейнер перед созданием виджета
        if (containerElement.innerHTML.trim() !== '') {
            console.log(`Clearing container ${containerId} before creating widget`);
            containerElement.innerHTML = '';
        }
    } else {
        containerId = 'tv_chart_container';
        container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found');
            return;
        }
    }
    
    // Используем внешний UDF‑фид (стандартный протокол TradingView UDF)
    // Базовый URL: http://127.0.0.1:80  → библиотека сама будет дергать /symbols, /history и т.д.
    const datafeed = new Datafeeds.UDFCompatibleDatafeed('http://127.0.0.1:80');
    console.log(`📊 [initTradingView] Using external UDF datafeed for pair ${pairId}`);

    // Переменная для хранения broker (будет установлена в broker_factory)
    let brokerInstance = null;
    
    // Создаем запись в tvWidgets заранее, чтобы можно было обновить broker
    const widgetData = { 
        widget: null, 
        datafeed, 
        broker: null,
        orderLines: new Map(), // Хранилище для линий ордеров (orderId -> shapeId)
        orderLineIntervals: new Map() // Хранилище для интервалов обновления обратного отсчета (orderId -> intervalId)
    };
    tvWidgets.set(pairId, widgetData);

    // Проверяем, доступен ли TradingView.widget
    if (typeof TradingView === 'undefined' || !TradingView.widget) {
        console.error('❌ TradingView.widget is not available!');
        return;
    }
    
    console.log('🔍 [initTradingView] Creating widget with broker_factory...');
    console.log('🔍 [initTradingView] LynxBroker available:', typeof LynxBroker !== 'undefined');
    console.log('🔍 [initTradingView] datafeed available:', !!datafeed);
    
    // Определяем broker_factory функцию заранее для логирования
    // Согласно документации IBrokerTerminal, broker_factory должен принимать IBrokerConnectionAdapterHost
    // и возвращать объект, реализующий IBrokerTerminal интерфейс
    const broker_factory_fn = function(host) {
        console.log(`🏦 [broker_factory] ⚡⚡⚡ CALLED! Creating broker instance for pair ${pairId}...`);
        console.log(`🏦 [broker_factory] Host:`, host);
        console.log(`🏦 [broker_factory] Host type:`, typeof host);
        console.log(`🏦 [broker_factory] Host methods:`, host ? Object.keys(host).slice(0, 10) : 'N/A');
        console.log(`🏦 [broker_factory] WidgetData exists:`, !!widgetData);
        console.log(`🏦 [broker_factory] LynxBroker available:`, typeof LynxBroker !== 'undefined');
        
        if (!host) {
            console.error('❌ [broker_factory] Host is null or undefined!');
            return null;
        }
        
        if (typeof LynxBroker === 'undefined') {
            console.error('❌ [broker_factory] LynxBroker class is not defined!');
            return null;
        }
        
        try {
            brokerInstance = new LynxBroker(host, datafeed, window.API_BASE);
            brokerInstance.setCurrentPairId(pairId);
            console.log('✅ [broker_factory] Broker created:', brokerInstance);
            console.log('✅ [broker_factory] Broker._host:', brokerInstance._host);
            console.log('✅ [broker_factory] Broker methods:', Object.keys(brokerInstance).slice(0, 10));
            
            // Сохраняем broker сразу в widgetData
            if (widgetData) {
                widgetData.broker = brokerInstance;
                console.log(`✅ [broker_factory] Broker saved immediately for pair ${pairId}`);
                console.log(`✅ [broker_factory] widgetData.broker after save:`, widgetData.broker);
            } else {
                console.error('❌ [broker_factory] widgetData is null!');
            }
            
            return brokerInstance;
        } catch (error) {
            console.error('❌ [broker_factory] Error creating broker:', error);
            console.error('❌ [broker_factory] Error stack:', error.stack);
            return null;
        }
    };
    
    console.log('🔍 [initTradingView] broker_factory_fn defined:', typeof broker_factory_fn);
    
    // Инициализируем виджет TradingView
    // ВАЖНО: Для Trading Platform используется trading-terminal.tradingview-widget.com
    // charting-library.tradingview-widget.com - это для Advanced Charts (без broker API)
    // trading-terminal.tradingview-widget.com - это для Trading Platform (с broker API)
    const tvWidget = new TradingView.widget({
        library_path: 'https://trading-terminal.tradingview-widget.com/charting_library/',
        fullscreen: false,
        // Стартовый символ — будет сразу же переустановлен в updateTradingViewPair
        symbol: 'BTCUSDT',
        interval: '60',
        container: containerId,
        datafeed: datafeed,
        locale: 'en',
        disabled_features: [
            'use_localstorage_for_settings',
            'volume_force_overlay',
            'create_volume_indicator_by_default',
            'trading', // Отключаем торговую панель
            'header_account_manager', // Отключаем панель account manager в заголовке
            'trading_account_manager', // Отключаем featureset Account Manager
            'open_account_manager', // Отключаем автоматическое открытие Account Manager при старте
            'show_object_tree', // Отключаем object tree
            'control_bar', // Отключаем нижнюю панель с кнопками Zoom In/Out и Scroll
            'timeframes_toolbar', // Отключаем панель таймфреймов внизу
            'timezone_menu', // Отключаем меню выбора часового пояса внизу
            'header_fullscreen_button', // Убираем кнопку раскрытия на весь экран
            'header_screenshot', // Убираем прямоугольную иконку (screenshot)
            'header_symbol_search', // Убираем текущий символ (AAPL)
            'header_compare', // Убираем кнопку + для добавления символа
            'show_right_widgets_panel_by_default', // Отключаем правую панель виджетов
            'border_around_the_chart', // Отключаем 2px padding вокруг графика
            // 'header_widget' - оставляем верхнюю панель с настройками, индикаторами и периодом видимой
            // 'left_toolbar' - оставляем левую панель инструментов видимой
        ],
        enabled_features: [
            'side_toolbar_in_fullscreen_mode',
        ],
        // Убираем broker_factory и broker_config, так как не используем торговые функции
        // broker_factory: broker_factory_fn,
        // broker_config: {
        //     configFlags: {
        //         supportOrdersHistory: false,
        //         supportPosition: false,
        //     },
        // },
        theme: 'dark',
        custom_css_url: 'css/tradingview-custom.css',
        overrides: {
            'paneProperties.background': '#000000', // Полностью черный фон
            'paneProperties.vertGridProperties.color': '#1a1a1a', // Серая вертикальная сетка
            'paneProperties.horzGridProperties.color': '#1a1a1a', // Серая горизонтальная сетка
            'scalesProperties.backgroundColor': '#000000', // Черный фон для шкал
            'scalesProperties.lineColor': '#1a1a1a', // Серые линии шкал
        },
    });

    // Обновляем виджет в widgetData
    widgetData.widget = tvWidget;
    
    // Проверяем, был ли вызван broker_factory (может быть вызван до onChartReady)
    console.log(`🔍 [initTradingView] After widget creation - brokerInstance:`, brokerInstance);
    console.log(`🔍 [initTradingView] After widget creation - widgetData.broker:`, widgetData.broker);
    
    // Важно: broker_factory может быть вызван асинхронно после создания виджета
    // Проверяем периодически, был ли создан broker
    const checkBrokerInterval = setInterval(() => {
        if (brokerInstance || widgetData.broker) {
            console.log('✅ Broker found! Stopping check interval');
            clearInterval(checkBrokerInterval);
        } else {
            console.log('⏳ Still waiting for broker_factory to be called...');
        }
    }, 500);
    
    // Останавливаем проверку через 10 секунд
    setTimeout(() => {
        clearInterval(checkBrokerInterval);
        if (!brokerInstance && !widgetData.broker) {
            console.warn('⚠️ broker_factory was never called after 10 seconds');
            console.warn('⚠️ This might mean the library version does not support broker_factory');
            console.warn('⚠️ Or broker_factory is being called with an error');
        }
    }, 10000);

    // Ждем готовности виджета
    tvWidget.onChartReady(() => {
        console.log(`✅ TradingView chart ready for pair ${pairId}`);
        console.log(`🔍 [onChartReady] brokerInstance:`, brokerInstance);
        console.log(`🔍 [onChartReady] widgetData.broker:`, widgetData.broker);
        
        // ТЕСТ: Создаем тестовый прямоугольник при загрузке графика
        setTimeout(() => {
            createTestRectangle(tvWidget, pairId);
        }, 2000); // Ждем 2 секунды после загрузки
        
        // Пытаемся получить broker из виджета после onChartReady
        try {
            const chart = tvWidget.chart();
            if (chart) {
                const chartInstance = chart();
                if (chartInstance && typeof chartInstance.broker === 'function') {
                    const brokerFromWidget = chartInstance.broker();
                    if (brokerFromWidget) {
                        console.log('✅ Found broker from widget after onChartReady:', brokerFromWidget);
                        widgetData.broker = brokerFromWidget;
                        brokerInstance = brokerFromWidget;
                    }
                }
            }
        } catch (e) {
            console.log('⚠️ Could not get broker from widget after onChartReady:', e);
        }
        
        // Обновляем информацию о паре
        updatePairInfo(pairId);
        
        // Для демо datafeed используем стандартные символы TradingView
        // Не нужно обновлять символ, так как он уже установлен в конфигурации виджета
        
        // Функция для загрузки ордеров с повторными попытками
        const loadOrdersWithRetry = (attempt = 0, maxAttempts = 10) => {
            // Проверяем broker из widgetData или из замыкания
            const broker = widgetData.broker || brokerInstance;
            
            console.log(`🔍 [loadOrdersWithRetry] Attempt ${attempt + 1}/${maxAttempts}`);
            console.log(`🔍 [loadOrdersWithRetry] widgetData.broker:`, widgetData.broker);
            console.log(`🔍 [loadOrdersWithRetry] brokerInstance:`, brokerInstance);
            console.log(`🔍 [loadOrdersWithRetry] broker:`, broker);
            console.log(`🔍 [loadOrdersWithRetry] broker._host:`, broker ? broker._host : 'N/A');
            
            if (broker && broker._host) {
                console.log('📋 Loading orders for TradingView...');
                broker.orders().then(orders => {
                    console.log('📋 Orders loaded:', orders);
                    
                    // Обновляем отображение ордеров на графике
                    if (orders && orders.length > 0) {
                        console.log(`✅ ${orders.length} orders should be displayed on chart`);
                        // TradingView автоматически отобразит ордера через Broker API
                        // Если нужно дополнительное визуальное отображение, можно использовать Marks
                    }
                }).catch(error => {
                    console.error('❌ Error loading orders:', error);
                });
            } else if (attempt < maxAttempts) {
                // Broker еще не готов, повторяем попытку
                const delay = Math.min(100 * Math.pow(2, attempt), 2000); // Exponential backoff, max 2s
                console.log(`⚠️ Broker not available yet (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms...`);
                setTimeout(() => {
                    // Обновляем broker из замыкания перед повторной попыткой
                    if (brokerInstance && !widgetData.broker) {
                        widgetData.broker = brokerInstance;
                        console.log(`✅ Broker assigned from closure for pair ${pairId}`);
                    }
                    loadOrdersWithRetry(attempt + 1, maxAttempts);
                }, delay);
            } else {
                console.warn('⚠️ Broker not available after all retry attempts');
                console.warn('⚠️ Final state - widgetData.broker:', widgetData.broker);
                console.warn('⚠️ Final state - brokerInstance:', brokerInstance);
                console.warn('⚠️ This might mean broker_factory was never called or broker creation failed');
            }
        };
        
        // Начинаем загрузку ордеров
        loadOrdersWithRetry();
    });
}

function updateTradingViewPair(pairId) {
    const widgetData = tvWidgets.get(pairId);
    
    if (!widgetData) {
        // Виджет не существует, нужно создать его
        console.log(`Widget not found for pair ${pairId}, will be created when window becomes active`);
        currentPairId = pairId;
        return;
    }

    const { widget: tvWidget, broker } = widgetData;
    currentPairId = pairId;

    // Обновляем только broker
    if (broker) {
        broker.setCurrentPairId(pairId);
    }

    // Проверяем готовность виджета перед изменением символа
    if (!tvWidget) {
        console.warn('Widget not available for pair', pairId);
        return;
    }

    // Для демо datafeed используем стандартные символы TradingView
    // Не нужно обновлять символ, так как демо datafeed работает с фиксированными символами
    const updateSymbol = async () => {
        if (!tvWidget) {
            console.warn('Widget not available for symbol update');
            return;
        }

        // Получаем актуальный символ пары с бэкенда (ожидается такой же тикер, как в UDF)
        let targetSymbol = 'BTCUSDT';
        try {
            const resp = await fetch(`${window.API_BASE}/pairs`);
            const pairs = await resp.json();
            const pair = pairs.find(p => p.id === pairId);
            if (pair && pair.symbol) {
                targetSymbol = pair.symbol;
            }
        } catch (e) {
            console.warn('⚠️ Cannot load pairs for symbol update, fallback to BTCUSDT', e);
        }

        console.log(`📊 [updateSymbol] Setting symbol ${targetSymbol} for pair ${pairId}`);

        const setSym = () => {
            tvWidget.setSymbol(targetSymbol, '60', () => {
                console.log(`✅ Symbol changed to ${targetSymbol}`);
            });
        };

        // Меняем символ, когда виджет готов
        try {
            tvWidget.onChartReady(() => {
                try {
                    setSym();
                } catch (err) {
                    console.warn('Error changing symbol in onChartReady:', err);
                }
            });
        } catch (error) {
            console.warn('Error scheduling symbol change:', error);
        }
    };

    // Проверяем, готов ли виджет
    try {
        const chart = tvWidget.chart();
        if (chart && typeof chart === 'function') {
            const chartInstance = chart();
            if (chartInstance && chartInstance.tradingViewApi) {
                updateSymbol();
            } else {
                // Виджет еще не готов, ждем onChartReady
                tvWidget.onChartReady(() => {
                    updateSymbol();
                });
            }
        } else {
            // Виджет еще не готов, ждем onChartReady
            tvWidget.onChartReady(() => {
                updateSymbol();
            });
        }
    } catch (error) {
        // Виджет еще не готов, ждем onChartReady
        tvWidget.onChartReady(() => {
            updateSymbol();
        });
    }
}

function updateTradingViewTimeframe(timeframe) {
    const pairId = currentPairId || 1;
    const widgetData = tvWidgets.get(pairId);
    
    if (!widgetData || !widgetData.widget) {
        console.warn('Widget not found for timeframe update');
        return;
    }

    const tvWidget = widgetData.widget;
    const resolutionMap = {
        '1m': '1',
        '5m': '5',
        '15m': '15',
        '1h': '60',
        '1D': '1D',
    };

    const resolution = resolutionMap[timeframe] || '1D';
    tvWidget.setResolution(resolution, () => {
        console.log(`✅ Resolution changed to ${resolution}`);
    });
}

async function updatePairInfo(pairId) {
    try {
        const response = await fetch(`${window.API_BASE}/pairs`);
        const pairs = await response.json();
        const pair = pairs.find(p => p.id === pairId);

        if (pair) {
            const pairNameElement = document.querySelector('.pair-name');
            if (pairNameElement) {
                pairNameElement.textContent = pair.name;
            }
        }
    } catch (error) {
        console.error('Error updating pair info:', error);
    }
}

// Функция для получения текущего символа с графика
function getCurrentSymbol(pairId = null) {
    const targetPairId = pairId || currentPairId || 1;
    const widgetData = tvWidgets.get(targetPairId);
    
    if (!widgetData || !widgetData.widget) {
        console.warn('Widget not found for getting symbol');
        return 'AAPL'; // Fallback для демо
    }
    
    const tvWidget = widgetData.widget;
    
    try {
        // Способ 1: через activeChart (если доступен)
        if (typeof tvWidget.activeChart === 'function') {
            try {
                const activeChart = tvWidget.activeChart();
                if (activeChart && typeof activeChart.symbol === 'function') {
                    const symbol = activeChart.symbol();
                    if (symbol && symbol !== '') {
                        console.log(`📊 [getCurrentSymbol] Got symbol from activeChart: ${symbol}`);
                        return symbol;
                    }
                }
            } catch (e) {
                // activeChart может быть недоступен, продолжаем
            }
        }
        
        // Способ 2: через chart() и symbolExt()
        const chart = tvWidget.chart();
        if (chart && typeof chart === 'function') {
            try {
                const chartInstance = chart();
                if (chartInstance) {
                    // Пытаемся получить символ через symbolExt
                    if (chartInstance.symbolExt && typeof chartInstance.symbolExt === 'function') {
                        const symbolExt = chartInstance.symbolExt();
                        if (symbolExt && symbolExt.name) {
                            console.log(`📊 [getCurrentSymbol] Got symbol from symbolExt: ${symbolExt.name}`);
                            return symbolExt.name;
                        }
                    }
                    
                    // Альтернатива: через symbol()
                    if (chartInstance.symbol && typeof chartInstance.symbol === 'function') {
                        const symbol = chartInstance.symbol();
                        if (symbol && symbol !== '') {
                            console.log(`📊 [getCurrentSymbol] Got symbol from chart.symbol: ${symbol}`);
                            return symbol;
                        }
                    }
                }
            } catch (e) {
                // chart() может быть недоступен, продолжаем
            }
        }
        
        // Способ 3: используем сохраненный символ из конфигурации виджета
        // Для демо datafeed используем фиксированные символы
        const demoSymbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'];
        const symbolIndex = (targetPairId - 1) % demoSymbols.length;
        const fallbackSymbol = demoSymbols[symbolIndex];
        
        console.warn(`⚠️ Could not get symbol from widget, using fallback: ${fallbackSymbol}`);
        return fallbackSymbol;
    } catch (error) {
        console.warn('Error getting symbol from widget:', error);
        return 'AAPL'; // Fallback для демо
    }
}

// Функция для добавления Marks на график для визуализации ордеров
function addOrderMarks(pairId = null, orders = []) {
    const targetPairId = pairId || currentPairId || 1;
    const widgetData = tvWidgets.get(targetPairId);
    
    if (!widgetData || !widgetData.widget || !orders || orders.length === 0) {
        return;
    }
    
    const tvWidget = widgetData.widget;
    
    try {
        const chart = tvWidget.chart();
        if (!chart || typeof chart !== 'function') {
            console.warn('Chart not available for adding marks');
            return;
        }
        
        const chartInstance = chart();
        if (!chartInstance) {
            console.warn('Chart instance not available');
            return;
        }
        
        // Получаем серию данных для добавления marks
        // Marks добавляются через datafeed, но мы можем использовать альтернативный способ
        // через создание study или через API виджета
        
        // Альтернативный способ: используем createStudy для создания визуальных меток
        orders.forEach(order => {
            try {
                // Преобразуем цену и время ордера
                const orderTime = order.time || Math.floor(Date.now() / 1000);
                const orderPrice = order.price || 0;
                const orderSide = order.side === 1 ? 'BUY' : 'SELL';
                const orderQty = order.qty || 0;
                
                // Создаем метку для ордера
                // В TradingView можно использовать createStudy для создания визуальных элементов
                // или использовать API для добавления drawings
                
                console.log(`📌 Adding mark for order ${order.id}: ${orderSide} @ ${orderPrice} (${orderQty})`);
                
                // Примечание: TradingView не предоставляет прямой API для добавления Marks
                // Marks должны быть возвращены через datafeed в методе getMarks()
                // Для визуализации ордеров лучше использовать Broker API, который автоматически
                // отображает ордера на графике
                
            } catch (error) {
                console.error(`Error adding mark for order ${order.id}:`, error);
            }
        });
        
    } catch (error) {
        console.error('Error adding order marks:', error);
    }
}

// ТЕСТОВАЯ функция для создания прямоугольника при загрузке графика
function createTestRectangle(tvWidget, pairId) {
    console.log('🧪 [createTestRectangle] Creating test rectangle...');
    
    try {
        const activeChart = tvWidget.activeChart();
        if (!activeChart) {
            console.warn('⚠️ [createTestRectangle] Active chart not available');
            return;
        }
        
        // Получаем текущее время и цену
        const now = Math.floor(Date.now() / 1000);
        const testPrice = 175.0; // Тестовая цена для AAPL
        
        // Создаем большой видимый прямоугольник
        const timeRange = 60 * 30; // 30 минут
        const priceRange = 10; // 10 единиц по цене
        
        const leftTime = now - timeRange / 2;
        const rightTime = now + timeRange / 2;
        const topPrice = testPrice + priceRange;
        const bottomPrice = testPrice - priceRange;
        
        console.log('🧪 [createTestRectangle] Test rectangle coordinates:');
        console.log(`  leftTime: ${leftTime} (${new Date(leftTime * 1000).toISOString()})`);
        console.log(`  rightTime: ${rightTime} (${new Date(rightTime * 1000).toISOString()})`);
        console.log(`  topPrice: ${topPrice}, bottomPrice: ${bottomPrice}`);
        console.log(`  center price: ${testPrice}`);
        
        // Создаем прямоугольник
        activeChart.createMultipointShape(
            [
                { time: leftTime, price: topPrice },   // Левый верхний угол
                { time: rightTime, price: bottomPrice } // Правый нижний угол
            ],
            {
                shape: 'rectangle',
                text: 'TEST 175.00', // Тестовый текст
                overrides: {
                    linecolor: '#22c55e', // Зеленый
                    linewidth: 3,
                    fillcolor: '#22c55e',
                    transparency: 30, // Немного прозрачный для видимости
                    showLabel: true,
                    textcolor: '#ffffff',
                    fontsize: 16,
                },
                lock: false,
            }
        ).then((rectShapeId) => {
            console.log(`✅ [createTestRectangle] Test rectangle created successfully! ID: ${rectShapeId}`);
            
            // Проверяем через секунду
            setTimeout(() => {
                try {
                    const rectShape = activeChart.getShapeById(rectShapeId);
                    if (rectShape) {
                        const props = rectShape.getProperties();
                        console.log('🔍 [createTestRectangle] Rectangle properties:', props);
                        
                        // Пробуем получить точки
                        if (typeof rectShape.getPoints === 'function') {
                            const points = rectShape.getPoints();
                            console.log('🔍 [createTestRectangle] Rectangle points:', points);
                        }
                    } else {
                        console.warn('⚠️ [createTestRectangle] Rectangle not found after creation');
                    }
                } catch (e) {
                    console.warn('⚠️ [createTestRectangle] Error checking rectangle:', e);
                }
            }, 1000);
        }).catch((error) => {
            console.error('❌ [createTestRectangle] Error creating test rectangle:', error);
            console.error('❌ [createTestRectangle] Error details:', error.message, error.stack);
        });
    } catch (error) {
        console.error('❌ [createTestRectangle] Exception:', error);
    }
}

// Функция для обновления прямоугольника (изменение прозрачности при истечении времени)
function updateOrderLineCountdown(pairId, orderId, endTime, side, price) {
    const widgetData = tvWidgets.get(pairId);
    if (!widgetData || !widgetData.widget || !widgetData.orderLines) {
        return;
    }
    
    const shapeIds = widgetData.orderLines.get(orderId);
    if (!shapeIds) {
        return;
    }
    
    const tvWidget = widgetData.widget;
    tvWidget.onChartReady(() => {
        try {
            const activeChart = tvWidget.activeChart();
            if (!activeChart) {
                return;
            }
            
            // Получаем ID прямоугольника
            const rectId = typeof shapeIds === 'object' && shapeIds.rectId ? shapeIds.rectId : shapeIds;
            const shape = activeChart.getShapeById(rectId);
            if (!shape) {
                return;
            }
            
            // Вычисляем оставшееся время
            const now = Date.now();
            const end = typeof endTime === 'string' ? new Date(endTime).getTime() : endTime;
            const remaining = Math.max(0, Math.floor((end - now) / 1000)); // секунды
            
            // Для прямоугольника можно изменить прозрачность при истечении времени
            if (remaining <= 0) {
                // Время истекло - делаем прямоугольник полупрозрачным
                try {
                    const properties = shape.getProperties();
                    if (properties) {
                        properties.transparency = 50; // 50% прозрачности
                        shape.setProperties(properties);
                    }
                } catch (e) {
                    console.warn('⚠️ Could not update rectangle properties:', e);
                }
                return;
            }
            
            // Прямоугольник остается полностью непрозрачным пока время не истекло
        } catch (error) {
            console.error('❌ Error updating rectangle countdown:', error);
        }
    });
}

// Функция для создания горизонтальной линии на графике по цене ордера
function drawOrderLine(pairId = null, price, orderId, side = 'BUY', orderTime = null, endTime = null) {
    const targetPairId = pairId || currentPairId || 1;
    const widgetData = tvWidgets.get(targetPairId);
    
    if (!widgetData || !widgetData.widget) {
        console.warn('Widget not found for drawing order line');
        return;
    }
    
    const tvWidget = widgetData.widget;
    
    if (!price || price === 0 || isNaN(price)) {
        console.warn('Invalid price for drawing line:', price);
        return;
    }
    
    // Используем переданное время или текущее время
    // TradingView ожидает время в секундах (Unix timestamp)
    const lineTime = orderTime || Math.floor(Date.now() / 1000);
    
    console.log(`📏 [drawOrderLine] Creating line for order ${orderId}: price=${price}, time=${lineTime}, side=${side}`);
    
    try {
        // Ждем готовности графика
        tvWidget.onChartReady(() => {
            try {
                // Используем activeChart() согласно документации
                const activeChart = tvWidget.activeChart();
                if (!activeChart) {
                    console.warn('Active chart not available for drawing line');
                    return;
                }
                
                // Цвет линии и прямоугольника: зеленый для BUY, красный для SELL
                const lineColor = side === 'BUY' ? '#22c55e' : '#ef4444';
                const rectColor = side === 'BUY' ? '#22c55e' : '#ef4444';
                
                console.log(`📏 [drawOrderLine] Creating rectangle only (without line) for order ${orderId} at price=${price}, time=${lineTime}`);
                
                // ВРЕМЕННО: создаем только прямоугольник без линии для тестирования
                // Сначала создаем горизонтальную линию
                /*
                activeChart.createShape(
                    { time: Math.floor(lineTime), price: price },
                    {
                        shape: 'horizontal_line',
                        extend: {
                            left: true,
                            right: true,
                        },
                        overrides: {
                            linecolor: lineColor,
                            linewidth: 2,
                            linestyle: 0, // Solid line
                            showLabel: false, // Убираем текст с линии
                        },
                        lock: false,
                    }
                ).then((lineShapeId) => {
                    console.log(`✅ [drawOrderLine] Horizontal line created, shapeId: ${lineShapeId}`);
                    */
                    
                    // Теперь создаем прямоугольник
                    // Вычисляем размер прямоугольника
                    let priceOffset;
                    if (price > 100) {
                        priceOffset = price * 0.05; // 5% от цены для больших цен
                    } else if (price > 10) {
                        priceOffset = price * 0.08; // 8% от цены для средних цен
                    } else {
                        priceOffset = price * 0.15; // 15% от цены для малых цен
                    }
                    // Минимальный размер для видимости
                    if (priceOffset < price * 0.02) {
                        priceOffset = price * 0.02;
                    }
                    
                    const topPrice = price + priceOffset;
                    const bottomPrice = price - priceOffset;
                    
                    // Получаем видимый диапазон графика, чтобы убедиться, что прямоугольник будет виден
                    let visibleRange = null;
                    try {
                        const chart = activeChart;
                        if (chart && typeof chart.getVisibleRange === 'function') {
                            visibleRange = chart.getVisibleRange();
                            console.log(`📏 [drawOrderLine] Visible time range:`, visibleRange);
                        }
                    } catch (e) {
                        console.warn('⚠️ [drawOrderLine] Could not get visible range:', e);
                    }
                    
                    // Временной диапазон для прямоугольника - делаем его больше для видимости
                    const timeRange = 60 * 10; // 10 минут в секундах (увеличили для видимости)
                    const leftTime = Math.floor(lineTime - timeRange / 2);
                    const rightTime = Math.floor(lineTime + timeRange / 2);
                    
                    // Увеличиваем размер по цене для лучшей видимости
                    const priceOffsetMultiplier = 2; // Увеличиваем в 2 раза
                    const finalTopPrice = price + (priceOffset * priceOffsetMultiplier);
                    const finalBottomPrice = price - (priceOffset * priceOffsetMultiplier);
                    
                    console.log(`📏 [drawOrderLine] Creating rectangle via createMultipointShape with 2 points`);
                    console.log(`📏 [drawOrderLine] Rectangle coordinates: leftTime=${leftTime}, rightTime=${rightTime}, topPrice=${finalTopPrice}, bottomPrice=${finalBottomPrice}`);
                    console.log(`📏 [drawOrderLine] Rectangle price offset: ${priceOffset * priceOffsetMultiplier} (${(priceOffset * priceOffsetMultiplier / price * 100).toFixed(2)}%)`);
                    console.log(`📏 [drawOrderLine] Line time: ${lineTime}, Current time: ${Math.floor(Date.now() / 1000)}`);
                    
                    // Создаем прямоугольник через createMultipointShape
                    // Прямоугольник ТРЕБУЕТ ровно 2 точки: левый верхний и правый нижний углы
                    const rectanglePoints = [
                        { time: leftTime, price: finalTopPrice },   // Левый верхний угол
                        { time: rightTime, price: finalBottomPrice } // Правый нижний угол
                    ];
                    
                    console.log(`📏 [drawOrderLine] Rectangle points array:`, rectanglePoints);
                    console.log(`📏 [drawOrderLine] Points count: ${rectanglePoints.length} (should be 2)`);
                    console.log(`📏 [drawOrderLine] Rectangle will be ${timeRange} seconds wide (${timeRange / 60} minutes)`);
                    
                    activeChart.createMultipointShape(
                        rectanglePoints,
                        {
                            shape: 'rectangle',
                            text: price.toFixed(2), // Цена в прямоугольнике
                            overrides: {
                                linecolor: rectColor,
                                linewidth: 3, // Увеличили толщину обводки
                                fillcolor: rectColor,
                                transparency: 0, // Полностью непрозрачный
                                showLabel: true,
                                textcolor: '#ffffff',
                                fontsize: 16, // Увеличили размер шрифта
                                // Добавляем более яркие цвета для видимости
                                borderColor: rectColor,
                                backgroundColor: rectColor,
                            },
                            lock: false,
                        }
                    ).then((rectShapeId) => {
                        console.log(`✅ [drawOrderLine] Rectangle created via createMultipointShape, rectShapeId: ${rectShapeId}`);
                        console.log(`✅ [drawOrderLine] Rectangle created successfully, rectShapeId: ${rectShapeId}`);
                        
                        // Проверяем, что прямоугольник действительно создан и виден
                        setTimeout(() => {
                            try {
                                const rectShape = activeChart.getShapeById(rectShapeId);
                                if (rectShape) {
                                    const props = rectShape.getProperties();
                                    console.log(`🔍 [drawOrderLine] Rectangle properties:`, props);
                                    console.log(`🔍 [drawOrderLine] Rectangle exists and is accessible`);
                                    
                                    // Пробуем получить точки прямоугольника для проверки координат
                                    if (typeof rectShape.getPoints === 'function') {
                                        const points = rectShape.getPoints();
                                        console.log(`🔍 [drawOrderLine] Rectangle points:`, points);
                                    }
                                } else {
                                    console.warn(`⚠️ [drawOrderLine] Rectangle with ID ${rectShapeId} not found after creation`);
                                    console.warn(`⚠️ [drawOrderLine] This might mean the rectangle was created but is not visible`);
                                }
                            } catch (e) {
                                console.warn('⚠️ [drawOrderLine] Could not verify rectangle:', e);
                            }
                        }, 1000); // Увеличили задержку для проверки
                        console.log(`✅ [drawOrderLine] Rectangle created for order ${orderId}, rectShapeId: ${rectShapeId}`);
                        console.log(`✅ [drawOrderLine] Rectangle created at price ${price}, time ${lineTime}`);
                        console.log(`✅ [drawOrderLine] Rectangle color: ${rectColor} (${side}), price text: ${price.toFixed(2)}`);
                        
                        // ВРЕМЕННО: сохраняем только прямоугольник (без линии)
                        if (!widgetData.orderLines) {
                            widgetData.orderLines = new Map();
                        }
                        widgetData.orderLines.set(orderId, {
                            // lineId: lineShapeId, // Временно убрали
                            rectId: rectShapeId
                        });
                        
                        // ВРЕМЕННО: убрали группировку, так как создаем только прямоугольник
                        /*
                        // Пробуем объединить линию и прямоугольник в группу
                        try {
                            const groupController = activeChart.shapesGroupController();
                            if (groupController) {
                                const lineShape = activeChart.getShapeById(lineShapeId);
                                const rectShape = activeChart.getShapeById(rectShapeId);
                                
                                if (lineShape && rectShape) {
                                    console.log(`✅ [drawOrderLine] Both shapes exist, attempting to group them`);
                                } else {
                                    console.warn(`⚠️ [drawOrderLine] Could not get shapes for grouping. Line: ${!!lineShape}, Rect: ${!!rectShape}`);
                                }
                            } else {
                                console.warn('⚠️ [drawOrderLine] shapesGroupController not available');
                            }
                        } catch (groupErr) {
                            console.warn('⚠️ [drawOrderLine] Error creating group:', groupErr);
                        }
                        */
                        
                        // Если передан endTime, можно обновлять прозрачность прямоугольника
                        if (endTime) {
                            // Сохраняем интервал для обновления каждую секунду
                            if (!widgetData.orderLineIntervals) {
                                widgetData.orderLineIntervals = new Map();
                            }
                            
                            const intervalId = setInterval(() => {
                                updateOrderLineCountdown(targetPairId, orderId, endTime, side, price);
                            }, 1000); // Обновляем каждую секунду
                            
                            widgetData.orderLineIntervals.set(orderId, intervalId);
                            
                            // Останавливаем интервал когда время истечет
                            const end = typeof endTime === 'string' ? new Date(endTime).getTime() : endTime;
                            const remaining = Math.max(0, end - Date.now());
                            setTimeout(() => {
                                if (widgetData.orderLineIntervals) {
                                    const interval = widgetData.orderLineIntervals.get(orderId);
                                    if (interval) {
                                        clearInterval(interval);
                                        widgetData.orderLineIntervals.delete(orderId);
                                    }
                                }
                            }, remaining);
                        }
                    }).catch((rectError) => {
                        console.error('❌ [drawOrderLine] Error creating rectangle:', rectError);
                        console.error('❌ [drawOrderLine] Error details:', rectError.message, rectError.stack);
                    });
                // ВРЕМЕННО: убрали catch для линии, так как не создаем линию
                // }).catch((lineError) => {
                //     console.error('❌ [drawOrderLine] Error creating horizontal line:', lineError);
                // });
                
            } catch (error) {
                console.error('❌ Error drawing order line:', error);
            }
        });
        
    } catch (error) {
        console.error('❌ Error in drawOrderLine:', error);
    }
}

// Функция для удаления линии ордера
function removeOrderLine(pairId = null, orderId) {
    const targetPairId = pairId || currentPairId || 1;
    const widgetData = tvWidgets.get(targetPairId);
    
    if (!widgetData || !widgetData.widget || !widgetData.orderLines) {
        return;
    }
    
    const shapeIds = widgetData.orderLines.get(orderId);
    if (!shapeIds) {
        return;
    }
    
    // Останавливаем интервал обратного отсчета, если он есть
    if (widgetData.orderLineIntervals) {
        const intervalId = widgetData.orderLineIntervals.get(orderId);
        if (intervalId) {
            clearInterval(intervalId);
            widgetData.orderLineIntervals.delete(orderId);
        }
    }
    
    try {
        const tvWidget = widgetData.widget;
        tvWidget.onChartReady(() => {
            try {
                // Используем activeChart() согласно документации
                const activeChart = tvWidget.activeChart();
                if (!activeChart) {
                    console.warn('Active chart not available for removing line');
                    return;
                }
                
                // Удаляем и линию, и прямоугольник
                if (typeof shapeIds === 'object' && shapeIds.lineId && shapeIds.rectId) {
                    // Новая структура: объект с lineId и rectId
                    activeChart.removeEntity(shapeIds.rectId).then(() => {
                        return activeChart.removeEntity(shapeIds.lineId);
                    }).then(() => {
                        widgetData.orderLines.delete(orderId);
                        console.log(`✅ [removeOrderLine] Line and rectangle removed for order ${orderId}`);
                    }).catch((error) => {
                        console.error('❌ Error removing order line/rectangle:', error);
                    });
                } else if (typeof shapeIds === 'string') {
                    // Старая структура: просто ID
                    activeChart.removeEntity(shapeIds).then(() => {
                        widgetData.orderLines.delete(orderId);
                        console.log(`✅ [removeOrderLine] Line removed for order ${orderId}`);
                    }).catch((error) => {
                        console.error('❌ Error removing order line:', error);
                    });
                }
            } catch (error) {
                console.error('❌ Error removing order line:', error);
            }
        });
    } catch (error) {
        console.error('❌ Error in removeOrderLine:', error);
    }
}

// Функция для обновления отображения ордеров на графике
function updateOrderDisplay(pairId = null) {
    const targetPairId = pairId || currentPairId || 1;
    const broker = window.tradingViewModule?.getBroker(targetPairId);
    
    if (!broker) {
        console.warn('Broker not available for updating order display');
        return;
    }
    
    // Загружаем ордера и обновляем их отображение
    broker.orders().then(orders => {
        console.log('📋 [updateOrderDisplay] Orders loaded:', orders);
        
        // TradingView автоматически отобразит ордера через Broker API
        // Если нужно дополнительное визуальное отображение, можно использовать Marks
        // Но обычно Broker API достаточно для отображения ордеров
        
        // Проверяем, что ордера правильно переданы
        if (orders && orders.length > 0) {
            console.log(`✅ ${orders.length} orders should be displayed on chart`);
            
            // Можно добавить дополнительную визуализацию через Marks, если нужно
            // addOrderMarks(targetPairId, orders);
        }
    }).catch(error => {
        console.error('❌ Error updating order display:', error);
    });
}

// Экспортируем функции для использования в app.js
window.tradingViewModule = {
    init: initTradingView,
    updatePair: updateTradingViewPair,
    updateTimeframe: updateTradingViewTimeframe,
    getWidget: (pairId = null) => {
        const targetPairId = pairId || currentPairId || 1;
        const widgetData = tvWidgets.get(targetPairId);
        return widgetData ? widgetData.widget : null;
    },
    getBroker: (pairId = null) => {
        const targetPairId = pairId || currentPairId || 1;
        const widgetData = tvWidgets.get(targetPairId);
        return widgetData ? widgetData.broker : null;
    },
    getSymbol: getCurrentSymbol, // Экспортируем функцию для получения символа
    updateOrderDisplay: updateOrderDisplay, // Экспортируем функцию для обновления отображения ордеров
    addOrderMarks: addOrderMarks, // Экспортируем функцию для добавления Marks
    drawOrderLine: drawOrderLine, // Экспортируем функцию для рисования линии ордера
    removeOrderLine: removeOrderLine, // Экспортируем функцию для удаления линии ордера
};

