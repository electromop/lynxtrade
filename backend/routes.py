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
        
        # Очищаем существующие пары
        cursor.execute('DELETE FROM trading_pairs')
        
        # Загружаем новые пары с Binance
        load_pairs_from_binance(cursor)
        
        # Удаляем AAPL, если он все еще есть (он не должен быть в списке Binance)
        cursor.execute('DELETE FROM trading_pairs WHERE symbol = ?', ('AAPL',))
        
        conn.commit()
        
        # Получаем количество загруженных пар
        cursor.execute('SELECT COUNT(*) FROM trading_pairs')
        count = cursor.fetchone()[0]
        
        # Получаем список загруженных пар
        cursor.execute('SELECT id, symbol, name FROM trading_pairs ORDER BY symbol')
        pairs = [{'id': row[0], 'symbol': row[1], 'name': row[2]} for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'message': 'Pairs synchronized successfully',
            'count': count,
            'pairs': pairs
        }), 200
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
    pair_symbol = pair_info[0] if pair_info else 'BTCUSDT'
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
        # Конвертируем end_time в Unix timestamp (миллисекунды) для единообразия
        end_time = row[6]
        if end_time:
            if isinstance(end_time, str):
                # Если строка, парсим в datetime
                from datetime import datetime
                try:
                    end_time_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                except:
                    try:
                        end_time_dt = datetime.strptime(end_time, '%Y-%m-%d %H:%M:%S.%f')
                    except:
                        end_time_dt = datetime.strptime(end_time, '%Y-%m-%d %H:%M:%S')
                end_time_ms = int(end_time_dt.timestamp() * 1000)
            elif hasattr(end_time, 'timestamp'):
                # Если datetime объект
                end_time_ms = int(end_time.timestamp() * 1000)
            else:
                end_time_ms = end_time
        else:
            end_time_ms = None
        
        rounds.append({
            'id': row[0],
            'pair_id': row[1],
            'direction': row[2],
            'amount': row[3],
            'duration': row[4],
            'start_time': row[5],
            'end_time': end_time_ms,  # Возвращаем Unix timestamp в миллисекундах
            'start_price': row[7],
            'symbol': row[8],
            'name': row[9]
        })
    
    conn.close()
    return jsonify(rounds)

@api.route('/rounds/<int:round_id>/finish', methods=['POST'])
def finish_round(round_id):
    """Завершить раунд с результатом от клиента"""
    import json
    import os
    data = request.json
    win = data.get('win')
    profit = data.get('profit')
    
    # #region agent log
    log_path = '/Users/g.fink/Documents/GitHub/lynxtrade/.cursor/debug.log'
    try:
        with open(log_path, 'a') as f:
            f.write(json.dumps({'location': 'routes.py:198', 'message': 'finish_round entry', 'data': {'round_id': round_id, 'win': win, 'profit': profit}, 'timestamp': int(__import__('time').time() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'D'}) + '\n')
    except: pass
    # #endregion
    
    if win is None or profit is None:
        # #region agent log
        try:
            with open(log_path, 'a') as f:
                f.write(json.dumps({'location': 'routes.py:205', 'message': 'missing win or profit', 'data': {'round_id': round_id, 'win': win, 'profit': profit}, 'timestamp': int(__import__('time').time() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'D'}) + '\n')
        except: pass
        # #endregion
        return jsonify({'error': 'win and profit are required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Получаем данные раунда
    cursor.execute('''
        SELECT user_id, pair_id, amount, start_price
        FROM rounds
        WHERE id = ? AND status = 'active'
    ''', (round_id,))
    
    round_data = cursor.fetchone()
    if not round_data:
        # #region agent log
        try:
            with open(log_path, 'a') as f:
                f.write(json.dumps({'location': 'routes.py:219', 'message': 'round not found', 'data': {'round_id': round_id}, 'timestamp': int(__import__('time').time() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'D'}) + '\n')
        except: pass
        # #endregion
        conn.close()
        return jsonify({'error': 'Round not found or already finished'}), 404
    
    user_id, pair_id, amount, start_price = round_data
    
    # #region agent log
    try:
        with open(log_path, 'a') as f:
            f.write(json.dumps({'location': 'routes.py:223', 'message': 'round data retrieved', 'data': {'round_id': round_id, 'user_id': user_id, 'amount': amount, 'win': win, 'profit': profit}, 'timestamp': int(__import__('time').time() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'D'}) + '\n')
    except: pass
    # #endregion
    
    # Получаем текущую цену для end_price
    from utils import get_current_price
    end_price = get_current_price(pair_id)
    
    # Обновляем баланс пользователя
    if win:
        # Выигрыш: возвращаем ставку + прибыль
        new_balance_change = amount + profit
        cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', 
                     (new_balance_change, user_id))
    # Если проигрыш, баланс не меняется (ставка уже была списана при создании)
    
    # Сохраняем результат
    cursor.execute('''
        INSERT INTO round_results (round_id, win, profit, end_price)
        VALUES (?, ?, ?, ?)
    ''', (round_id, win, profit, end_price))
    
    # Обновляем статус раунда
    cursor.execute('UPDATE rounds SET status = ? WHERE id = ?', 
                  ('finished', round_id))
    
    # Получаем новый баланс
    cursor.execute('SELECT balance FROM users WHERE id = ?', (user_id,))
    new_balance = cursor.fetchone()[0]
    
    # #region agent log
    try:
        with open(log_path, 'a') as f:
            f.write(json.dumps({'location': 'routes.py:246', 'message': 'balance updated', 'data': {'round_id': round_id, 'user_id': user_id, 'new_balance': new_balance, 'win': win, 'profit': profit}, 'timestamp': int(__import__('time').time() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'D'}) + '\n')
    except: pass
    # #endregion
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'new_balance': new_balance,
        'round_id': round_id
    }), 200

@api.route('/chart-data/<int:pair_id>', methods=['GET'])
def get_chart_data(pair_id):
    """Получить данные для графика"""
    timeframe = request.args.get('timeframe', '1m')
    limit = request.args.get('limit', 100, type=int)
    
    print(f'📊 [get_chart_data] Request for pair_id={pair_id}, timeframe={timeframe}, limit={limit}')
    
    # Пробуем получить реальные данные, если не получится - используем симуляцию
    try:
        candles = get_real_chart_data(pair_id, timeframe, limit)
        if candles:
            print(f'✅ [get_chart_data] Got {len(candles)} real candles from Binance for pair {pair_id}')
            return jsonify(candles)
        else:
            print(f'⚠️ [get_chart_data] No real data returned, using simulation')
    except Exception as e:
        print(f'❌ [get_chart_data] Error fetching real data, using simulation: {e}')
        import traceback
        traceback.print_exc()
    
    # Генерируем симулированные данные свечей как fallback
    candles = generate_candle_data(pair_id, timeframe, limit)
    print(f'📊 [get_chart_data] Generated {len(candles)} simulated candles for pair {pair_id}')
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
        timestamp = datetime.utcnow().timestamp()
        formatted_time = datetime.utcnow().strftime('%H:%M:%S')
        print(f'💰 [get_current_pair_price] Pair {pair_id}: price={price}, timestamp={timestamp}')
        return jsonify({
            'pair_id': pair_id,
            'price': price,
            'timestamp': timestamp,
            'formatted': formatted_time
        })
    except Exception as e:
        print(f'❌ [get_current_pair_price] Error for pair {pair_id}: {e}')
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@api.route('/prices', methods=['GET'])
def get_all_prices():
    """Получить текущие цены для всех активных пар"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, symbol FROM trading_pairs WHERE active = 1')
        pairs = cursor.fetchall()
        conn.close()
        
        prices = {}
        for pair_id, symbol in pairs:
            try:
                price = get_current_price(pair_id)
                prices[pair_id] = {
                    'symbol': symbol,
                    'price': price,
                    'timestamp': datetime.utcnow().timestamp()
                }
            except Exception as e:
                print(f'Error getting price for pair {pair_id} ({symbol}): {e}')
                continue
        
        return jsonify(prices)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api.route('/win-rate', methods=['GET'])
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

import os
from flask import send_from_directory

# Статическая папка для картинок теперь backend/static/img
IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'img')

@api.route('/img/<path:filename>', methods=['GET'])
def get_image(filename):
    """Отдаём картинку из backend/static/img"""
    return send_from_directory(IMG_DIR, filename)

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

