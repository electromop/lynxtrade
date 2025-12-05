from flask import Blueprint, jsonify, request
from models import get_db
from datetime import datetime, timedelta
import random
import sqlite3
import requests
from utils import get_current_price

api = Blueprint('api', __name__)

@api.route('/pairs', methods=['GET'])
def get_pairs():
    """Получить список торговых пар"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, symbol, name FROM trading_pairs WHERE active = 1')
    pairs = [{'id': row[0], 'symbol': row[1], 'name': row[2]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(pairs)

@api.route('/pairs', methods=['POST'])
def add_pair():
    """Добавить новую торговую пару"""
    data = request.json
    symbol = data.get('symbol')
    name = data.get('name')
    
    if not symbol or not name:
        return jsonify({'error': 'Symbol and name are required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO trading_pairs (symbol, name) VALUES (?, ?)', (symbol, name))
        conn.commit()
        pair_id = cursor.lastrowid
        conn.close()
        return jsonify({'id': pair_id, 'symbol': symbol, 'name': name}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Pair already exists'}), 400

@api.route('/pairs/sync', methods=['POST'])
def sync_pairs():
    """Синхронизировать пары с Binance API"""
    try:
        from models import load_pairs_from_binance
        conn = get_db()
        cursor = conn.cursor()
        
        # Очищаем существующие пары (или можно обновлять)
        cursor.execute('DELETE FROM trading_pairs')
        
        # Загружаем новые пары
        load_pairs_from_binance(cursor)
        
        conn.commit()
        
        # Получаем количество загруженных пар
        cursor.execute('SELECT COUNT(*) FROM trading_pairs')
        count = cursor.fetchone()[0]
        conn.close()
        
        return jsonify({'message': 'Pairs synchronized successfully', 'count': count}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@api.route('/balance', methods=['GET'])
def get_balance():
    """Получить баланс пользователя"""
    user_id = request.args.get('user_id', 1, type=int)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT balance FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return jsonify({'balance': row[0]})
    return jsonify({'error': 'User not found'}), 404

@api.route('/rounds', methods=['POST'])
def create_round():
    """Создать новый торговый раунд"""
    data = request.json
    user_id = data.get('user_id', 1)
    pair_id = data.get('pair_id')
    direction = data.get('direction')  # 'BUY' or 'SELL'
    amount = data.get('amount')
    duration = data.get('duration')  # в секундах
    
    if not all([pair_id, direction, amount, duration]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    if direction not in ['BUY', 'SELL']:
        return jsonify({'error': 'Direction must be BUY or SELL'}), 400
    
    # Проверка баланса
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT balance FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'User not found'}), 404
    
    if user[0] < amount:
        conn.close()
        return jsonify({'error': 'Insufficient balance'}), 400
    
    # Создание раунда
    start_time = datetime.utcnow()
    end_time = start_time + timedelta(seconds=duration)
    
    # Получаем текущую цену (симулированную)
    start_price = get_current_price(pair_id)
    
    cursor.execute('''
        INSERT INTO rounds (user_id, pair_id, direction, amount, duration, start_time, end_time, start_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, pair_id, direction, amount, duration, start_time, end_time, start_price))
    
    round_id = cursor.lastrowid
    
    # Списываем сумму со счета
    cursor.execute('UPDATE users SET balance = balance - ? WHERE id = ?', (amount, user_id))
    
    # Получаем информацию о паре для ответа
    cursor.execute('SELECT symbol, name FROM trading_pairs WHERE id = ?', (pair_id,))
    pair_info = cursor.fetchone()
    pair_symbol = pair_info[0] if pair_info else 'AAPL'
    pair_name = pair_info[1] if pair_info else 'Unknown'
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': round_id,
        'pair_id': pair_id,
        'direction': direction,
        'amount': amount,
        'duration': duration,
        'start_time': start_time.isoformat(),
        'end_time': end_time.isoformat(),
        'start_price': start_price,
        'symbol': pair_symbol,
        'name': pair_name,
        'status': 'active'
    }), 201

@api.route('/rounds/active', methods=['GET'])
def get_active_rounds():
    """Получить активные раунды пользователя"""
    user_id = request.args.get('user_id', 1, type=int)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT r.id, r.pair_id, r.direction, r.amount, r.duration, 
               r.start_time, r.end_time, r.start_price, tp.symbol, tp.name
        FROM rounds r
        JOIN trading_pairs tp ON r.pair_id = tp.id
        WHERE r.user_id = ? AND r.status = 'active'
        ORDER BY r.start_time DESC
    ''', (user_id,))
    
    rounds = []
    for row in cursor.fetchall():
        rounds.append({
            'id': row[0],
            'pair_id': row[1],
            'direction': row[2],
            'amount': row[3],
            'duration': row[4],
            'start_time': row[5],
            'end_time': row[6],
            'start_price': row[7],
            'symbol': row[8],
            'name': row[9]
        })
    
    conn.close()
    return jsonify(rounds)

@api.route('/chart-data/<int:pair_id>', methods=['GET'])
def get_chart_data(pair_id):
    """Получить данные для графика"""
    timeframe = request.args.get('timeframe', '1m')
    limit = request.args.get('limit', 100, type=int)
    
    # Пробуем получить реальные данные, если не получится - используем симуляцию
    try:
        candles = get_real_chart_data(pair_id, timeframe, limit)
        if candles:
            return jsonify(candles)
    except Exception as e:
        print(f'Error fetching real data, using simulation: {e}')
    
    # Генерируем симулированные данные свечей как fallback
    candles = generate_candle_data(pair_id, timeframe, limit)
    return jsonify(candles)

@api.route('/server-time', methods=['GET'])
def get_server_time():
    """Получить серверное время"""
    now = datetime.utcnow()
    formatted_time = now.strftime('%H:%M:%S')
    return jsonify({
        'time': now.isoformat(),
        'timestamp': now.timestamp(),
        'formatted': formatted_time
    })

@api.route('/price/<int:pair_id>', methods=['GET'])
def get_current_pair_price(pair_id):
    """Получить текущую цену для пары"""
    try:
        price = get_current_price(pair_id)
        return jsonify({
            'pair_id': pair_id,
            'price': price,
            'timestamp': datetime.utcnow().timestamp()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api.route('/admin/win-rate', methods=['GET'])
def get_win_rate():
    """Получить процент выигрыша"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT value FROM settings WHERE key = ?', ('win_rate',))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return jsonify({'win_rate': int(row[0])})
    return jsonify({'win_rate': 50})

@api.route('/admin/win-rate', methods=['POST'])
def set_win_rate():
    """Установить процент выигрыша"""
    data = request.json
    win_rate = data.get('win_rate')
    
    if win_rate is None:
        return jsonify({'error': 'win_rate is required'}), 400
    
    try:
        win_rate = int(win_rate)
        if win_rate < 0 or win_rate > 100:
            return jsonify({'error': 'win_rate must be between 0 and 100'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'win_rate must be a number'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
    ''', ('win_rate', str(win_rate)))
    conn.commit()
    conn.close()
    
    return jsonify({'win_rate': win_rate})

from utils import get_current_price

def get_real_chart_data(pair_id, timeframe, limit):
    """Получить реальные данные с Binance API"""
    # Получаем символ пары из базы данных
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT symbol FROM trading_pairs WHERE id = ?', (pair_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
    
    symbol = row[0]
    
    # Проверяем, что это USDT пара (Binance формат)
    if not symbol.endswith('USDT'):
        return None
    
    # Маппинг таймфреймов на интервалы Binance
    timeframe_map = {
        '1m': '1m',
        '5m': '5m',
        '15m': '15m',
        '1h': '1h'
    }
    
    interval = timeframe_map.get(timeframe, '1m')
    
    try:
        # Запрос к Binance API
        url = 'https://api.binance.com/api/v3/klines'
        params = {
            'symbol': symbol,
            'interval': interval,
            'limit': min(limit, 1000)  # Binance ограничивает до 1000
        }
        
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        # Конвертируем данные Binance в наш формат
        candles = []
        for candle in data:
            candles.append({
                'time': int(candle[0] / 1000),  # Binance возвращает в миллисекундах
                'open': float(candle[1]),
                'high': float(candle[2]),
                'low': float(candle[3]),
                'close': float(candle[4])
            })
        
        return candles
    except Exception as e:
        print(f'Error fetching data from Binance: {e}')
        return None

def generate_candle_data(pair_id, timeframe, limit):
    """Генерировать данные свечей для графика"""
    import time
    from datetime import timedelta
    from utils import get_current_price
    
    # Определяем интервал в секундах
    timeframe_seconds = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600
    }
    interval = timeframe_seconds.get(timeframe, 60)
    
    base_price = get_current_price(pair_id)
    candles = []
    
    # Генерируем исторические данные
    now = datetime.utcnow()
    for i in range(limit - 1, -1, -1):
        timestamp = now - timedelta(seconds=interval * i)
        
        # Генерируем случайное движение цены
        change = random.uniform(-0.002, 0.002)  # ±0.2%
        open_price = base_price * (1 + change)
        close_price = open_price * (1 + random.uniform(-0.001, 0.001))
        high_price = max(open_price, close_price) * (1 + random.uniform(0, 0.001))
        low_price = min(open_price, close_price) * (1 - random.uniform(0, 0.001))
        
        candles.append({
            'time': int(timestamp.timestamp()),
            'open': round(open_price, 5),
            'high': round(high_price, 5),
            'low': round(low_price, 5),
            'close': round(close_price, 5)
        })
        
        base_price = close_price
    
    return candles

