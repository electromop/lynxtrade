// UDF Datafeed для TradingView
// Адаптирован для работы с нашим бэкенд API

// Глобальная константа для API (устанавливается в config.js)
// Если config.js не загружен, используем fallback
if (!window.API_BASE) {
    window.API_BASE = window.location.origin + '/api';
    console.warn('⚠️ [Datafeed] API_BASE не установлен в config.js, используется fallback:', window.API_BASE);
}

class UDFDatafeed {
    constructor(baseUrl, pairId) {
        this.baseUrl = baseUrl;
        this.pairId = pairId;
        this.configuration = {
            supported_resolutions: ['1', '5', '15', '60'], // 1m, 5m, 15m, 1h
            supports_group_request: false,
            supports_marks: false,
            supports_search: false,
            supports_timescale_marks: false,
        };
    }

    onReady(callback) {
        setTimeout(() => {
            callback(this.configuration);
        }, 0);
    }

    searchSymbols(userInput, exchange, symbolType, onResultReadyCallback) {
        // Не поддерживаем поиск символов
        onResultReadyCallback([]);
    }

    resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
        // Получаем информацию о паре с бэкенда
        fetch(`${this.baseUrl}/pairs`)
            .then(response => response.json())
            .then(pairs => {
                const pair = pairs.find(p => p.id === this.pairId) || pairs[0];
                if (!pair) {
                    onResolveErrorCallback('Pair not found');
                    return;
                }

                // Получаем текущую цену для определения pricescale
                return fetch(`${this.baseUrl}/price/${this.pairId}`)
                    .then(priceResponse => priceResponse.json())
                    .then(priceData => {
                        const price = priceData.price || 100000;
                        // Определяем pricescale на основе цены
                        let pricescale = 100;
                        if (price >= 1000) {
                            pricescale = 100; // 2 знака после запятой
                        } else if (price >= 1) {
                            pricescale = 10000; // 4 знака после запятой
                        } else {
                            pricescale = 100000; // 5 знаков после запятой
                        }

                        const symbolInfo = {
                            name: pair.symbol,
                            ticker: pair.symbol,
                            description: pair.name,
                            type: 'crypto',
                            session: '24x7',
                            timezone: 'Etc/UTC',
                            exchange: 'LYNX',
                            minmov: 1,
                            pricescale: pricescale,
                            has_intraday: true,
                            has_weekly_and_monthly: false,
                            supported_resolutions: this.configuration.supported_resolutions,
                            volume_precision: 2,
                            data_status: 'streaming',
                        };

                        onSymbolResolvedCallback(symbolInfo);
                    });
            })
            .catch(error => {
                console.error('Error resolving symbol:', error);
                onResolveErrorCallback('Error resolving symbol');
            });
    }

    getBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback, firstDataRequest) {
        // Конвертируем resolution в timeframe
        const timeframeMap = {
            '1': '1m',
            '5': '5m',
            '15': '15m',
            '60': '1h',
        };
        const timeframe = timeframeMap[resolution] || '1m';

        // Вычисляем лимит на основе временного диапазона
        const timeDiff = to - from;
        const intervalSeconds = parseInt(resolution) * 60;
        const limit = Math.min(Math.ceil(timeDiff / intervalSeconds) + 10, 1000);

        // Используем правильный endpoint для получения данных графика
        const url = `${this.baseUrl}/chart-data/${this.pairId}?timeframe=${timeframe}&limit=${limit}`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (!data || !Array.isArray(data)) {
                    onHistoryCallback([], { noData: true });
                    return;
                }

                // Конвертируем данные в формат TradingView
                const bars = data
                    .filter(candle => candle.time >= from && candle.time <= to)
                    .map(candle => ({
                        time: candle.time * 1000, // TradingView ожидает миллисекунды
                        low: candle.low,
                        high: candle.high,
                        open: candle.open,
                        close: candle.close,
                        volume: 0, // У нас нет данных об объеме
                    }))
                    .sort((a, b) => a.time - b.time);

                if (bars.length === 0) {
                    onHistoryCallback([], { noData: true });
                } else {
                    onHistoryCallback(bars, { noData: false });
                }
            })
            .catch(error => {
                console.error('Error fetching bars:', error);
                onErrorCallback(error);
            });
    }

    subscribeBars(symbolInfo, resolution, onTick, subscriberUID, onResetCacheNeededCallback) {
        // Подписка на обновления в реальном времени
        // Используем polling каждые 2 секунды
        const timeframeMap = {
            '1': '1m',
            '5': '5m',
            '15': '15m',
            '60': '1h',
        };
        const timeframe = timeframeMap[resolution] || '1m';

        // Храним последнюю свечу для обновления
        let lastCandle = null;

        const pollInterval = setInterval(() => {
            fetch(`${this.baseUrl}/price/${this.pairId}`)
                .then(response => response.json())
                .then(data => {
                    if (data && data.price) {
                        const now = Math.floor(Date.now() / 1000);
                        const currentCandleTime = this._getCandleTime(now, resolution);
                        
                        if (lastCandle && lastCandle.time === currentCandleTime) {
                            // Обновляем существующую свечу
                            lastCandle.high = Math.max(lastCandle.high, data.price);
                            lastCandle.low = Math.min(lastCandle.low, data.price);
                            lastCandle.close = data.price;
                            onTick(lastCandle);
                        } else {
                            // Новая свеча
                            lastCandle = {
                                time: currentCandleTime * 1000,
                                close: data.price,
                                open: data.price,
                                high: data.price,
                                low: data.price,
                                volume: 0,
                            };
                            onTick(lastCandle);
                        }
                    }
                })
                .catch(error => {
                    console.error('Error polling price:', error);
                });
        }, 2000);

        // Сохраняем interval для отписки
        if (!this.subscriptions) {
            this.subscriptions = {};
        }
        this.subscriptions[subscriberUID] = pollInterval;
    }

    unsubscribeBars(subscriberUID) {
        if (this.subscriptions && this.subscriptions[subscriberUID]) {
            clearInterval(this.subscriptions[subscriberUID]);
            delete this.subscriptions[subscriberUID];
        }
    }

    _getCandleTime(timestamp, resolution) {
        const intervalSeconds = parseInt(resolution) * 60;
        return Math.floor(timestamp / intervalSeconds) * intervalSeconds;
    }
}

