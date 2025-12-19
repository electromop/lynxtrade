import random
import requests

def get_current_price(pair_id):
    """Получить текущую цену пары с Binance API"""
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
    
    # Проверяем, что это USDT пара (Binance формат)
    # Если не USDT пара, используем симуляцию без запроса к Binance
    if not symbol.endswith('USDT'):
        # Для не-USDT пар используем симуляцию
        base_prices = {
            'BTCUSDT': 65000.0,
            'ETHUSDT': 3500.0,
            'BNBUSDT': 600.0,
            'SOLUSDT': 150.0,
            'ADAUSDT': 0.5
        }
        base = base_prices.get(symbol, 100.0)
        return base + random.uniform(-base * 0.001, base * 0.001)
    
    # Для USDT пар пытаемся получить реальную цену с Binance
    try:
        url = 'https://api.binance.com/api/v3/ticker/price'
        params = {'symbol': symbol}
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        price = float(data['price'])
        return price
    except requests.exceptions.RequestException as e:
        print(f'Error fetching real price for {symbol} from Binance: {e}')
        # Fallback на симуляцию только если Binance недоступен
        base_prices = {
            'BTCUSDT': 65000.0,
            'ETHUSDT': 3500.0,
            'BNBUSDT': 600.0,
            'SOLUSDT': 150.0,
            'ADAUSDT': 0.5
        }
        base = base_prices.get(symbol, 100.0)
        return base + random.uniform(-base * 0.001, base * 0.001)
    except (KeyError, ValueError) as e:
        print(f'Error parsing price for {symbol}: {e}')
        # Fallback на симуляцию
        base_prices = {
            'BTCUSDT': 65000.0,
            'ETHUSDT': 3500.0,
            'BNBUSDT': 600.0,
            'SOLUSDT': 150.0,
            'ADAUSDT': 0.5
        }
        base = base_prices.get(symbol, 100.0)
        return base + random.uniform(-base * 0.001, base * 0.001)

