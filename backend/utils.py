import random
import requests

def get_current_price(pair_id):
    """Получить текущую цену пары (реальная для крипто, симулированная для форекса)"""
    from models import get_db
    
    # Получаем символ пары из базы данных
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT symbol FROM trading_pairs WHERE id = ?', (pair_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        # Fallback на симуляцию
        return 100.0 + random.uniform(-1, 1)
    
    symbol = row[0]
    
    # Пробуем получить реальную цену с Binance для USDT пар
    if symbol.endswith('USDT'):
        try:
            url = 'https://api.binance.com/api/v3/ticker/price'
            params = {'symbol': symbol}
            response = requests.get(url, params=params, timeout=3)
            response.raise_for_status()
            data = response.json()
            return float(data['price'])
        except Exception as e:
            print(f'Error fetching real price for {symbol}: {e}')
            # Fallback на симуляцию
    
    # Симулированные цены для не-USDT пар и акций
    base_prices = {
        'AAPL': 175.0,  # Apple Inc. для тестирования TradingView
        'BTCUSDT': 65000.0,
        'ETHUSDT': 3500.0,
        'BNBUSDT': 600.0,
        'SOLUSDT': 150.0,
        'ADAUSDT': 0.5
    }
    
    base = base_prices.get(symbol, 100.0)
    # Добавляем небольшое случайное отклонение
    return base + random.uniform(-base * 0.001, base * 0.001)

