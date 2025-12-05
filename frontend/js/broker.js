// Broker API для TradingView Trading Platform
// Интегрирует TradingView с нашим бэкендом для торговли

class LynxBroker {
    constructor(host, datafeed, apiBase) {
        this._host = host;
        this._datafeed = datafeed;
        this.apiBase = apiBase;
        this._currentAccount = '1'; // Используем _currentAccount вместо currentAccount, чтобы избежать конфликта с методом
        this.currentPairId = 1;
    }

    // 1. Connection Status
    // Должен возвращать ConnectionStatus.Connected (1) для активации trading
    connectionStatus() {
        return 1; // ConnectionStatus.Connected = 1
    }

    // 2. Account Metadata
    async accountsMetainfo() {
        return [
            {
                id: '1',
                name: 'Demo Account',
            },
        ];
    }

    // 3. Current Account
    // Согласно документации IBrokerTerminal, должен возвращать AccountId
    currentAccount() {
        return this._currentAccount;
    }

    // 4. Account Manager Info
    accountManagerInfo() {
        return {
            accountTitle: 'LYNX Trading',
            summary: [],
            orderColumns: [
                {
                    label: 'Symbol',
                    formatter: 0, // StandardFormatterName.Symbol
                    id: 'symbol',
                    dataFields: ['symbol', 'symbol', 'message'],
                },
                {
                    label: 'Side',
                    id: 'side',
                    dataFields: ['side'],
                    formatter: 1, // StandardFormatterName.Side
                },
                {
                    label: 'Type',
                    id: 'type',
                    dataFields: ['type', 'parentId', 'stopType'],
                    formatter: 2, // StandardFormatterName.Type
                },
                {
                    label: 'Qty',
                    alignment: 'right',
                    id: 'qty',
                    dataFields: ['qty'],
                    formatter: 3, // StandardFormatterName.FormatQuantity
                },
                {
                    label: 'Status',
                    id: 'status',
                    dataFields: ['status'],
                    formatter: 4, // StandardFormatterName.Status
                },
                {
                    label: 'Order ID',
                    id: 'id',
                    dataFields: ['id'],
                },
            ],
            positionColumns: [
                {
                    label: 'Symbol',
                    formatter: 0,
                    id: 'symbol',
                    dataFields: ['symbol', 'symbol', 'message'],
                },
                {
                    label: 'Side',
                    id: 'side',
                    dataFields: ['side'],
                    formatter: 1,
                },
                {
                    label: 'Qty',
                    alignment: 'right',
                    id: 'qty',
                    dataFields: ['qty'],
                    formatter: 3,
                },
            ],
            pages: [],
        };
    }

    // 5. Chart Context Menu Actions
    async chartContextMenuActions(context, options) {
        return this._host.defaultContextMenuActions(context);
    }

    // 6. Is Tradable
    async isTradable(symbol) {
        return true;
    }

    // 7. Symbol Info
    async symbolInfo(symbol) {
        try {
            // Пытаемся получить minTick из host
            let mintick = 0.01; // Значение по умолчанию
            try {
                if (this._host && typeof this._host.getSymbolMinTick === 'function') {
                    mintick = await this._host.getSymbolMinTick(symbol);
                }
            } catch (e) {
                console.warn('Could not get minTick from host, using default:', e);
                // Для BTC/USDT используем 0.01, для других пар можно настроить
                if (symbol.includes('BTC') || symbol.includes('USDT')) {
                    mintick = 0.01;
                } else {
                    mintick = 0.0001;
                }
            }
            
            const pipSize = mintick;
            const accountCurrencyRate = 1;
            const pointValue = 1;

        return {
            qty: {
                min: 1,
                max: 1e12,
                step: 1,
            },
            pipValue: pipSize * pointValue * accountCurrencyRate || 1,
            pipSize: pipSize,
            minTick: mintick,
            description: '',
        };
        } catch (error) {
            console.error('Error in symbolInfo:', error);
            // Возвращаем значения по умолчанию
            return {
                qty: {
                    min: 1,
                    max: 1e12,
                    step: 1,
                },
                pipValue: 1,
                pipSize: 0.01,
                minTick: 0.01,
                description: '',
            };
        }
    }

    // 8. Place Order
    // Согласно документации, placeOrder принимает PreOrder и опциональный confirmId
    async placeOrder(order, confirmId) {
        try {
            // Получаем текущую цену
            const priceResponse = await fetch(`${this.apiBase}/price/${this.currentPairId}`);
            const priceData = await priceResponse.json();
            const currentPrice = priceData.price;

            // Определяем направление (BUY/SELL)
            const side = order.side === 1 ? 'BUY' : 'SELL'; // 1 = Buy, 2 = Sell

            // Используем qty из order (приходит от TradingView)
            const amount = order.qty || 5.0;
            
            // Получаем время раунда из глобальных переменных или используем дефолт
            // В реальной версии можно получить из настроек UI
            let duration = 60; // по умолчанию 1 минута
            
            // Пытаемся получить из UI, если доступно
            try {
                const timeValue = document.querySelector('[id*="expiration"], [id*="time"]');
                if (timeValue) {
                    const timeText = timeValue.textContent || timeValue.innerText || '';
                    const match = timeText.match(/(\d+)\s*min/);
                    if (match) {
                        duration = parseInt(match[1]) * 60;
                    }
                }
            } catch (e) {
                // Игнорируем ошибки
            }

            // Создаем раунд через наш API
            const response = await fetch(`${this.apiBase}/rounds`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: 1,
                    pair_id: this.currentPairId,
                    direction: side,
                    amount: amount,
                    duration: duration,
                }),
            });

            const result = await response.json();

            if (response.ok && result.id) {
                // Успешно создан раунд
                const orderId = result.id.toString();
                
                // Для демо datafeed используем символ из order (который приходит от TradingView)
                // Это должен быть символ, который отображается на графике (AAPL для демо)
                const symbol = order.symbol || 'AAPL';
                
                // Получаем цену - используем start_price из результата или currentPrice
                let orderPrice = result.start_price || currentPrice;
                
                // Если цена все еще не валидна, используем fallback
                if (!orderPrice || orderPrice === 0 || isNaN(orderPrice)) {
                    const demoSymbolPrices = { 'AAPL': 175.0, 'MSFT': 380.0, 'GOOGL': 140.0, 'TSLA': 250.0, 'AMZN': 150.0 };
                    orderPrice = demoSymbolPrices[symbol] || 100.0;
                    console.warn(`⚠️ [placeOrder] Using fallback price for ${symbol}: ${orderPrice}`);
                }
                
                // ВАЖНО: Согласно документации TradingView, поля id, symbol, side, type, qty, price
                // в orderUpdate ДОЛЖНЫ точно совпадать с полями из PreOrder, переданного в placeOrder
                const placedOrder = {
                    id: orderId,
                    symbol: order.symbol, // КРИТИЧНО: должен совпадать с order.symbol
                    side: order.side, // КРИТИЧНО: должен совпадать с order.side
                    type: order.type || 1, // КРИТИЧНО: должен совпадать с order.type
                    qty: order.qty, // КРИТИЧНО: должен совпадать с order.qty
                    status: 6, // OrderStatus.Working = 6
                    filled: 0,
                    remaining: order.qty,
                    price: orderPrice, // КРИТИЧНО: цена должна быть валидной (не 0)
                };
                
                console.log('📋 [placeOrder] Creating order with:', {
                    orderId: orderId,
                    originalOrder: {
                        symbol: order.symbol,
                        side: order.side,
                        type: order.type,
                        qty: order.qty
                    },
                    placedOrder: placedOrder
                });
                
                // Уведомляем TradingView об успешном создании ордера
                // Согласно документации, нужно передать полный объект PlacedOrder
                this._host.orderUpdate(placedOrder);

                return {
                    orderId: orderId,
                };
            } else {
                throw new Error(result.error || 'Failed to create round');
            }
        } catch (error) {
            console.error('Error placing order:', error);
            throw error;
        }
    }

    // 9. Cancel Order
    async cancelOrder(orderId) {
        try {
            const response = await fetch(`${this.apiBase}/rounds/${orderId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                // Получаем информацию об ордере для полного обновления
                // Для отмены нужно передать полный объект с status = 1 (Canceled)
                this._host.orderUpdate({
                    id: orderId,
                    status: 1, // OrderStatus.Canceled = 1
                    // Остальные поля должны быть такими же, как при создании
                    // Но для отмены достаточно id и status
                });
                return;
            } else {
                throw new Error('Failed to cancel order');
            }
        } catch (error) {
            console.error('Error cancelling order:', error);
            throw error;
        }
    }

    // 10. Orders - возвращает активные ордера для отображения на графике
    async orders() {
        try {
            console.log('📋 [Broker] Fetching orders...');
            const response = await fetch(`${this.apiBase}/rounds/active?user_id=1`);
            const rounds = await response.json();
            console.log('📋 [Broker] Rounds received:', rounds);

            // Получаем текущий символ с графика для правильного отображения ордеров
            let currentSymbol = 'AAPL'; // Fallback
            try {
                if (window.tradingViewModule && window.tradingViewModule.getSymbol) {
                    currentSymbol = window.tradingViewModule.getSymbol(this.currentPairId) || 'AAPL';
                }
            } catch (e) {
                console.warn('Could not get current symbol for orders:', e);
            }
            
            const orders = rounds.map(round => {
                // Получаем цену ордера - должна быть валидной
                let orderPrice = round.start_price;
                
                // Если цена не валидна, используем fallback
                if (!orderPrice || orderPrice === 0 || isNaN(orderPrice)) {
                    const demoSymbolPrices = { 'AAPL': 175.0, 'MSFT': 380.0, 'GOOGL': 140.0, 'TSLA': 250.0, 'AMZN': 150.0 };
                    orderPrice = demoSymbolPrices[currentSymbol] || 100.0;
                    console.warn(`⚠️ [orders] Using fallback price for order ${round.id}: ${orderPrice}`);
                }
                
                return {
                    id: round.id.toString(),
                    // ВАЖНО: symbol должен совпадать с символом на графике для отображения ордера
                    symbol: currentSymbol, // Используем символ с графика, а не из API
                    side: round.direction === 'BUY' ? 1 : 2, // 1 = Buy, 2 = Sell
                    type: 1, // OrderType.Market = 1
                    qty: round.amount,
                    status: (round.status === 'active') ? 6 : 2, // 6 = Working, 2 = Filled
                    filled: 0,
                    remaining: round.amount,
                    price: orderPrice, // КРИТИЧНО: цена должна быть валидной (не 0)
                };
            });
            
            console.log('📋 [Broker] Orders formatted:', orders);
            return orders;
        } catch (error) {
            console.error('❌ [Broker] Error fetching orders:', error);
            return [];
        }
    }

    // 11. Positions
    async positions() {
        // У нас нет позиций в классическом смысле, возвращаем пустой массив
        return [];
    }

    // 12. Executions
    async executions(symbol) {
        // Возвращаем пустой массив, так как у нас нет истории исполнений
        return [];
    }

    // Установить текущий pair_id
    setCurrentPairId(pairId) {
        this.currentPairId = pairId;
    }

    // 13. Modify Order (требуется по IBrokerTerminal)
    async modifyOrder(order, confirmId) {
        try {
            // Для упрощения, просто обновляем ордер через API
            const response = await fetch(`${this.apiBase}/rounds/${order.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: order.qty,
                }),
            });

            if (response.ok) {
                // Уведомляем TradingView об обновлении ордера
                this._host.orderUpdate({
                    id: order.id.toString(),
                    symbol: order.symbol,
                    side: order.side,
                    type: order.type,
                    qty: order.qty,
                    status: order.status || 6, // OrderStatus.Working = 6
                });
                return;
            } else {
                throw new Error('Failed to modify order');
            }
        } catch (error) {
            console.error('Error modifying order:', error);
            throw error;
        }
    }

    // 14. Set Current Account (требуется если accountsMetainfo возвращает > 1 аккаунта)
    setCurrentAccount(id) {
        this._currentAccount = id;
    }
}

