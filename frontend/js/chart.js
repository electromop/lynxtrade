// API_BASE объявлен в datafeed.js как window.API_BASE

let chart = null;
let candlestickSeries = null;
let currentPairId = 1;
let currentTimeframe = '1m';

function initChart() {
    const chartContainer = document.getElementById('chartContainer');
    
    if (!chartContainer) {
        console.error('Chart container not found');
        return;
    }
    
    if (typeof LightweightCharts === 'undefined') {
        console.error('LightweightCharts library not loaded');
        return;
    }
    
    try {
        // Проверяем доступность метода createChart
        if (!LightweightCharts || typeof LightweightCharts.createChart !== 'function') {
            console.error('LightweightCharts.createChart is not available');
            return;
        }
        
        chart = LightweightCharts.createChart(chartContainer, {
            layout: {
                background: { color: '#0a0e27' },
                textColor: '#8b8fa3',
            },
            grid: {
                vertLines: { color: '#1e2330' },
                horzLines: { color: '#1e2330' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            rightPriceScale: {
                borderColor: '#1e2330',
            },
            timeScale: {
                borderColor: '#1e2330',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        // Проверяем доступность метода addCandlestickSeries
        if (!chart) {
            console.error('Chart object is null');
            return;
        }
        
        // Пробуем разные варианты создания серии
        if (typeof chart.addCandlestickSeries === 'function') {
        candlestickSeries = chart.addCandlestickSeries({
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
        });
        } else if (typeof chart.addSeries === 'function') {
            // Альтернативный способ для некоторых версий
            candlestickSeries = chart.addSeries('Candlestick', {
                upColor: '#22c55e',
                downColor: '#ef4444',
                borderVisible: false,
                wickUpColor: '#22c55e',
                wickDownColor: '#ef4444',
            });
        } else {
            console.error('Neither addCandlestickSeries nor addSeries is available');
            console.log('Chart object:', chart);
            console.log('Available methods:', Object.getOwnPropertyNames(chart).filter(name => typeof chart[name] === 'function'));
            return;
        }
        
        console.log('Chart initialized successfully');
    } catch (error) {
        console.error('Error initializing chart:', error);
        console.error('Error details:', error.stack);
    }

    // Обновление информации о свече при наведении
    chart.subscribeCrosshairMove(param => {
        if (param.time && param.seriesData) {
            const data = param.seriesData.get(candlestickSeries);
            if (data) {
                updateCandleInfo(data);
            }
        }
    });
}

function updateCandleInfo(data) {
    const open = data.open.toFixed(5);
    const high = data.high.toFixed(5);
    const low = data.low.toFixed(5);
    const close = data.close.toFixed(5);
    const change = close - open;
    const changePercent = ((change / open) * 100).toFixed(2);
    const sign = change >= 0 ? '+' : '';
    
    document.getElementById('candleInfo').textContent = 
        `O${open} H${high} L${low} C${close} ${sign}${change.toFixed(4)} (${sign}${changePercent}%)`;
}

async function loadChartData(pairId, timeframe) {
    if (!candlestickSeries) {
        console.error('Candlestick series not initialized');
        return;
    }
    
    try {
        const response = await fetch(`${window.API_BASE}/chart-data/${pairId}?timeframe=${timeframe}&limit=100`);
        const candles = await response.json();
        
        const formattedData = candles.map(candle => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        }));
        
        // Вычисляем текущее время свечи для проверки (используем время сервера UTC)
        // Получаем время сервера из app.js или используем fallback
        let now;
        if (typeof window.getServerTimeUTC === 'function') {
            now = window.getServerTimeUTC();
        }
        // Если время сервера еще не получено, используем текущее время (fallback)
        if (!now || isNaN(now)) {
            now = Math.floor(Date.now() / 1000);
        }
        
        const timeframeSeconds = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1h': 3600
        };
        const interval = timeframeSeconds[currentTimeframe] || 60;
        const currentCandleTime = Math.floor(now / interval) * interval;
        
        // Удаляем последнюю свечу только если она действительно в будущем (больше чем текущая свеча)
        let dataToSet = formattedData;
        if (formattedData.length > 0) {
            const lastCandle = formattedData[formattedData.length - 1];
            if (lastCandle.time > currentCandleTime) {
                console.log('⚠️ Last candle is in future, removing it. Last candle time:', lastCandle.time, 'Current candle time:', currentCandleTime);
                dataToSet = formattedData.slice(0, -1);
            } else {
                console.log('✅ Last candle is historical or current, keeping it. Last candle time:', lastCandle.time, 'Current candle time:', currentCandleTime);
            }
        }
        
        // Если lastCandleTime уже установлен (после первого обновления цены),
        // объединяем исторические данные с текущей свечой
        if (lastCandleTime !== null && currentCandleData !== null) {
            console.log('⚠️ Merging historical data with existing live candle');
            console.log('   Historical candles:', dataToSet.length);
            console.log('   Live candle time:', lastCandleTime);
            
            // ВСЕГДА показываем все исторические данные + живую свечу
            // Не фильтруем по времени, так как из-за разницы часовых поясов все исторические данные
            // могут быть в будущем относительно времени живой свечи
            let allHistorical = [...dataToSet];
            // Удаляем только последнюю свечу, если она имеет то же время, что и живая
            if (allHistorical.length > 0 && allHistorical[allHistorical.length - 1].time === lastCandleTime) {
                allHistorical = allHistorical.slice(0, -1);
            }
            const mergedDataWithAll = [...allHistorical, currentCandleData];
            const validatedDataWithAll = validateCandleData(mergedDataWithAll);
            const sortedAndDeduped = sortAndDeduplicateCandles(validatedDataWithAll);
            console.log('   Using all historical candles:', sortedAndDeduped.length, '(historical:', allHistorical.length, '+ live: 1, filtered:', mergedDataWithAll.length - sortedAndDeduped.length, 'invalid/duplicates)');
            candlestickSeries.setData(sortedAndDeduped);
            chartDataCache = [...sortedAndDeduped];
        } else {
            // Первая загрузка - просто устанавливаем данные
            const validatedData = validateCandleData(dataToSet);
            const sortedAndDeduped = sortAndDeduplicateCandles(validatedData);
            console.log('   Validated data:', sortedAndDeduped.length, '(filtered:', dataToSet.length - sortedAndDeduped.length, 'invalid/duplicates)');
            candlestickSeries.setData(sortedAndDeduped);
            chartDataCache = [...sortedAndDeduped];
            
            console.log('✅ Chart data loaded, lastCandleTime will be set on first price update with server time');
            if (dataToSet.length > 0) {
                console.log('   Last candle from data:', dataToSet[dataToSet.length - 1]);
                
                const livePriceEl = document.getElementById('livePrice');
                if (livePriceEl) {
                    livePriceEl.textContent = dataToSet[dataToSet.length - 1].close.toFixed(5);
                }
            } else {
                console.log('✅ No data, lastCandleTime will be set on first price update');
            }
        }
    } catch (error) {
        console.error('Error loading chart data:', error);
    }
}

function updateChart(pairId, timeframe) {
    currentPairId = pairId;
    currentTimeframe = timeframe;
    // Сбрасываем состояние свечи при смене пары/таймфрейма
    lastCandleTime = null;
    currentCandleData = null;
    loadChartData(pairId, timeframe);
}

let lastCandleTime = null;
let currentCandleData = null;
let chartDataCache = []; // Кэш данных графика для отслеживания последней свечи

// Функция для валидации и фильтрации данных свечей
function validateCandleData(data) {
    return data.filter(candle => {
        if (!candle || typeof candle !== 'object') {
            return false;
        }
        // Проверяем, что все необходимые поля присутствуют и не null/undefined/Infinity
        const hasValidFields = 
            typeof candle.time === 'number' && !isNaN(candle.time) && 
            candle.time !== null && candle.time !== undefined && 
            isFinite(candle.time) &&
            typeof candle.open === 'number' && !isNaN(candle.open) && 
            candle.open !== null && candle.open !== undefined && 
            isFinite(candle.open) &&
            typeof candle.high === 'number' && !isNaN(candle.high) && 
            candle.high !== null && candle.high !== undefined && 
            isFinite(candle.high) &&
            typeof candle.low === 'number' && !isNaN(candle.low) && 
            candle.low !== null && candle.low !== undefined && 
            isFinite(candle.low) &&
            typeof candle.close === 'number' && !isNaN(candle.close) && 
            candle.close !== null && candle.close !== undefined && 
            isFinite(candle.close);
        
        if (!hasValidFields) {
            console.warn('⚠️ Invalid candle data filtered out:', candle);
            return false;
        }
        return true;
    });
}

// Функция для сортировки и удаления дубликатов по времени
function sortAndDeduplicateCandles(data) {
    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }
    
    // Сортируем по времени (по возрастанию)
    const sorted = [...data].sort((a, b) => a.time - b.time);
    
    // Удаляем дубликаты по времени (оставляем последнюю свечу с одинаковым временем)
    const deduplicated = [];
    const seenTimes = new Map();
    
    for (const candle of sorted) {
        const existing = seenTimes.get(candle.time);
        if (existing) {
            // Заменяем существующую свечу с тем же временем (берем последнюю)
            const index = deduplicated.indexOf(existing);
            if (index !== -1) {
                deduplicated[index] = candle;
            }
        } else {
            deduplicated.push(candle);
            seenTimes.set(candle.time, candle);
        }
    }
    
    return deduplicated;
}

function updateLastCandle(price, timestamp) {
    console.log('🕯️ [updateLastCandle] Called with price:', price, 'timestamp:', timestamp);
    
    if (!candlestickSeries) {
        console.warn('⚠️ Candlestick series not initialized');
        return;
    }
    
    if (typeof price !== 'number' || isNaN(price)) {
        console.warn('⚠️ Invalid price:', price);
        return;
    }
    
    // Используем timestamp от сервера или текущее время
    const now = timestamp ? Math.floor(timestamp) : Math.floor(Date.now() / 1000);
    const timeframeSeconds = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600
    };
    const interval = timeframeSeconds[currentTimeframe] || 60;
    
    // Округляем время до начала текущей свечи
    const currentCandleTime = Math.floor(now / interval) * interval;
    
    console.log('🕯️ Current candle time:', currentCandleTime, 'Last candle time:', lastCandleTime, 'Interval:', interval);
    
    // Если это новая свеча (время изменилось), создаем её
    if (lastCandleTime === null || lastCandleTime < currentCandleTime) {
        console.log('🕯️ Creating NEW candle at time:', currentCandleTime);
        
        // Если lastCandleTime === null (первое обновление), просто создаем новую свечу
        // Последняя свеча в будущем уже была удалена при загрузке данных
        
        // Новая свеча - создаем её
        lastCandleTime = currentCandleTime;
        currentCandleData = {
            time: currentCandleTime,
            open: price,
            high: price,
            low: price,
            close: price
        };
        
        // Обновляем кэш - добавляем новую свечу
        // Проверяем, есть ли уже свеча с таким временем
        const existingIndex = chartDataCache.findIndex(c => c.time === currentCandleTime);
        if (existingIndex !== -1) {
            // Заменяем существующую свечу
            chartDataCache[existingIndex] = {...currentCandleData};
        } else {
            // Добавляем новую свечу
            chartDataCache.push({...currentCandleData});
        }
        
        // Используем setData для гарантии, что все данные (включая исторические) отображаются
        try {
            const validatedCache = validateCandleData(chartDataCache);
            const sortedAndDeduped = sortAndDeduplicateCandles(validatedCache);
            candlestickSeries.setData(sortedAndDeduped);
            chartDataCache = [...sortedAndDeduped]; // Обновляем кэш валидированными данными
            console.log('✅ New candle created successfully via setData:', currentCandleData);
            console.log('   Total candles in chart:', sortedAndDeduped.length);
        } catch (e) {
            console.error('❌ Error setting data:', e);
            // Fallback: пробуем update
            try {
                candlestickSeries.update(currentCandleData);
                console.log('✅ New candle created via update (fallback)');
            } catch (e2) {
                console.error('❌ Error creating candle:', e2);
            }
        }
    } else if (lastCandleTime === currentCandleTime) {
        console.log('🕯️ Updating EXISTING candle at time:', currentCandleTime);
        
        // НЕ удаляем исторические данные при обновлении существующей свечи
        // Исторические данные должны оставаться на графике, даже если они в будущем
        // из-за разницы часовых поясов
        
        // Обновляем текущую свечу (обновляем high, low, close)
        // ВАЖНО: Lightweight Charts требует, чтобы обновлялась именно последняя свеча
        // Проверяем, что currentCandleData существует и время совпадает
        if (!currentCandleData || currentCandleData.time !== currentCandleTime) {
            console.log('🕯️ No currentCandleData, creating new one');
            // Если данных нет или время не совпадает, создаем новую свечу
            currentCandleData = {
                time: currentCandleTime,
                open: price,
                high: price,
                low: price,
                close: price
            };
        } else {
            const oldClose = currentCandleData.close;
            // Обновляем существующую свечу
            currentCandleData.high = Math.max(currentCandleData.high, price);
            currentCandleData.low = Math.min(currentCandleData.low, price);
            currentCandleData.close = price;
            console.log('🕯️ Updated candle data - old close:', oldClose, 'new close:', price, 'high:', currentCandleData.high, 'low:', currentCandleData.low);
        }
        
        // Обновляем свечу на графике
        // Проверяем, является ли текущая свеча последней на графике
        const isLastCandle = chartDataCache.length === 0 || 
                            chartDataCache[chartDataCache.length - 1].time === currentCandleTime ||
                            chartDataCache[chartDataCache.length - 1].time < currentCandleTime;
        
        if (isLastCandle) {
            // Текущая свеча последняя - можно использовать update()
            try {
                console.log('🕯️ Calling candlestickSeries.update with:', currentCandleData);
                candlestickSeries.update(currentCandleData);
                // Обновляем кэш
                if (chartDataCache.length > 0 && chartDataCache[chartDataCache.length - 1].time === currentCandleTime) {
                    const lastCandle = chartDataCache[chartDataCache.length - 1];
                    lastCandle.open = currentCandleData.open;
                    lastCandle.high = currentCandleData.high;
                    lastCandle.low = currentCandleData.low;
                    lastCandle.close = currentCandleData.close;
                }
                console.log('✅ Candle updated successfully on chart');
            } catch (e) {
                console.warn('⚠️ Error updating candle with update(), using setData instead:', e);
                // Fallback: используем setData
                updateCandleWithSetData();
            }
        } else {
            // Текущая свеча не последняя (есть более новые свечи) - используем setData
            console.log('⚠️ Current candle is not the last one, using setData instead of update()');
            updateCandleWithSetData();
        }
        
        function updateCandleWithSetData() {
            // Обновляем свечу в кэше
            const candleIndex = chartDataCache.findIndex(c => c.time === currentCandleTime);
            if (candleIndex !== -1) {
                // Заменяем существующую свечу
                chartDataCache[candleIndex] = {...currentCandleData};
            } else {
                // Добавляем новую свечу
                chartDataCache.push({...currentCandleData});
            }
            
            // Используем setData для обновления всех данных
            try {
                const validated = validateCandleData(chartDataCache);
                const sortedAndDeduped = sortAndDeduplicateCandles(validated);
                candlestickSeries.setData(sortedAndDeduped);
                chartDataCache = [...sortedAndDeduped];
                console.log('✅ Candle updated successfully via setData');
            } catch (e) {
                console.error('❌ Error updating candle with setData:', e);
            }
        }
    } else {
        console.warn('⚠️ Ignoring update - lastCandleTime > currentCandleTime (old candle)');
    }
    
    // Обновляем live price
    const livePriceEl = document.getElementById('livePrice');
    if (livePriceEl) {
        livePriceEl.textContent = price.toFixed(5);
    }
}

// Экспорт функций
window.chartModule = {
    initChart,
    updateChart,
    loadChartData,
    updateLastCandle,
    getCurrentPairId: () => currentPairId,
    getCurrentTimeframe: () => currentTimeframe,
};

