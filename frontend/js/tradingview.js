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
    
    // Используем демо datafeed от TradingView для тестирования
    const datafeed = new Datafeeds.UDFCompatibleDatafeed("https://demo-feed-data.tradingview.com");
    console.log(`📊 [initTradingView] Using demo datafeed for testing`);

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
        symbol: 'AAPL', // Стандартный символ для демо datafeed
        interval: '1D',
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
    const updateSymbol = () => {
        // Для демо datafeed используем стандартные символы
        const demoSymbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'];
        const symbolIndex = (pairId - 1) % demoSymbols.length;
        const testSymbol = demoSymbols[symbolIndex];
        
        console.log(`📊 [updateSymbol] Using demo symbol ${testSymbol} for pair ${pairId}`);
        
        if (!tvWidget) {
            console.warn('Widget not available for symbol update');
            return;
        }
        
        // Используем onChartReady для гарантии готовности виджета
        try {
            // Пытаемся сразу изменить символ, если виджет готов
            const chart = tvWidget.chart();
            if (chart && typeof chart === 'function') {
                const chartInstance = chart();
                if (chartInstance && chartInstance.tradingViewApi) {
                    tvWidget.setSymbol(testSymbol, '1D', () => {
                        console.log(`✅ Symbol changed to ${testSymbol} (demo datafeed)`);
                    });
                    return;
                }
            }
        } catch (error) {
            // Игнорируем ошибки при проверке
        }
        
        // Если виджет не готов, используем onChartReady
        tvWidget.onChartReady(() => {
            try {
                tvWidget.setSymbol(testSymbol, '1D', () => {
                    console.log(`✅ Symbol changed to ${testSymbol} (onChartReady)`);
                });
            } catch (error) {
                console.warn('Error changing symbol in onChartReady:', error);
            }
        });
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

// Функция для обновления текста на линии с обратным отсчетом
function updateOrderLineCountdown(pairId, orderId, endTime, side, price) {
    const widgetData = tvWidgets.get(pairId);
    if (!widgetData || !widgetData.widget || !widgetData.orderLines) {
        return;
    }
    
    const shapeId = widgetData.orderLines.get(orderId);
    if (!shapeId) {
        return;
    }
    
    const tvWidget = widgetData.widget;
    tvWidget.onChartReady(() => {
        try {
            const activeChart = tvWidget.activeChart();
            if (!activeChart) {
                return;
            }
            
            const shape = activeChart.getShapeById(shapeId);
            if (!shape) {
                return;
            }
            
            // Вычисляем оставшееся время
            const now = Date.now();
            const end = typeof endTime === 'string' ? new Date(endTime).getTime() : endTime;
            const remaining = Math.max(0, Math.floor((end - now) / 1000)); // секунды
            
            if (remaining <= 0) {
                // Время истекло
                const text = `${side} @ ${price.toFixed(2)} (EXPIRED)`;
                if (shape.setText && typeof shape.setText === 'function') {
                    shape.setText(text);
                } else if (shape.setProperties && typeof shape.setProperties === 'function') {
                    shape.setProperties({ text: text });
                }
                return;
            }
            
            // Форматируем время: MM:SS
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            // Обновляем текст на линии
            const text = `${side} @ ${price.toFixed(2)} (${timeStr})`;
            
            if (shape.setText && typeof shape.setText === 'function') {
                shape.setText(text);
            } else if (shape.setProperties && typeof shape.setProperties === 'function') {
                shape.setProperties({ text: text });
            } else {
                // Альтернативный способ через getProperties и setProperties
                try {
                    const properties = shape.getProperties();
                    if (properties) {
                        properties.text = text;
                        shape.setProperties(properties);
                    }
                } catch (e) {
                    console.warn('⚠️ Could not update line text:', e);
                }
            }
        } catch (error) {
            console.error('❌ Error updating line countdown:', error);
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
                
                // Цвет линии: зеленый для BUY, красный для SELL
                const lineColor = side === 'BUY' ? '#22c55e' : '#ef4444';
                
                console.log(`📏 [drawOrderLine] Calling createShape with price=${price}, time=${lineTime}`);
                
                // Создаем горизонтальную линию через createShape
                // Согласно документации: createShape(point, CreateShapeOptions)
                // point: PricedPoint { time, price }
                // CreateShapeOptions: { shape, overrides, extend, ... }
                // ВАЖНО: для горизонтальной линии extend.left и extend.right определяют, как далеко линия растягивается
                activeChart.createShape(
                    { time: lineTime, price: price }, // PricedPoint - используем точную цену и время
                    {
                        shape: 'horizontal_line', // Тип рисунка - горизонтальная линия
                        extend: {
                            left: true,  // Растягиваем линию влево
                            right: true, // Растягиваем линию вправо
                        },
                        overrides: {
                            linecolor: lineColor,
                            linewidth: 2,
                            linestyle: 0, // Solid line
                            showLabel: true,
                            text: `${side} @ ${price.toFixed(2)}`,
                            // ВАЖНО: цена задается в точке { time, price }, а не в overrides
                        },
                        lock: false, // Разрешаем перемещение и удаление в UI
                    }
                ).then((shapeId) => {
                    // Сохраняем ID рисунка для возможного удаления позже
                    if (!widgetData.orderLines) {
                        widgetData.orderLines = new Map();
                    }
                    widgetData.orderLines.set(orderId, shapeId);
                    console.log(`✅ [drawOrderLine] Horizontal line created for order ${orderId} at price ${price}, time ${lineTime}, shapeId: ${shapeId}`);
                    
                    // Если передан endTime, запускаем обратный отсчет
                    if (endTime) {
                        // Обновляем сразу
                        updateOrderLineCountdown(targetPairId, orderId, endTime, side, price);
                        
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
                    
                    // Проверяем, какая цена реально установлена на линии
                    // Получаем свойства созданной линии для проверки
                    setTimeout(() => {
                        try {
                            const shape = activeChart.getShapeById(shapeId);
                            if (shape && typeof shape.getProperties === 'function') {
                                const properties = shape.getProperties();
                                console.log(`🔍 [drawOrderLine] Line properties for order ${orderId}:`, properties);
                                if (properties && properties.price) {
                                    console.log(`🔍 [drawOrderLine] Actual line price: ${properties.price}, expected: ${price}`);
                                }
                            }
                        } catch (e) {
                            console.warn('⚠️ [drawOrderLine] Could not get line properties:', e);
                        }
                    }, 500);
                }).catch((error) => {
                    console.error('❌ [drawOrderLine] Error creating shape:', error);
                    console.error('❌ [drawOrderLine] Error details - price:', price, 'time:', lineTime, 'price type:', typeof price);
                });
                
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
    
    const shapeId = widgetData.orderLines.get(orderId);
    if (!shapeId) {
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
                
                // Удаляем рисунок через removeEntity согласно документации
                activeChart.removeEntity(shapeId).then(() => {
                    widgetData.orderLines.delete(orderId);
                    console.log(`✅ [removeOrderLine] Line removed for order ${orderId}`);
                }).catch((error) => {
                    console.error('❌ Error removing order line:', error);
                });
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

