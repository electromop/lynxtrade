from models import get_db
from datetime import datetime
import random

def get_win_rate():
    """Получить процент выигрыша из настроек"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT value FROM settings WHERE key = ?', ('win_rate',))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return int(row[0])
    return 50  # По умолчанию 50%

def determine_round_result(win_rate):
    """Определить результат раунда на основе процента выигрыша"""
    # win_rate от 0 до 100
    # Если win_rate = 100, всегда выигрыш
    # Если win_rate = 0, всегда проигрыш
    # Если win_rate = 50, 50% шанс выигрыша
    random_value = random.randint(1, 100)
    return random_value <= win_rate

def calculate_profit(amount, win_rate_percent):
    """Рассчитать прибыль при выигрыше"""
    # Процент прибыли 85% как в Lynx
    profit_percent = 0.85
    return amount * profit_percent

def check_and_finish_rounds(socketio):
    """Проверить и завершить истекшие раунды"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Находим активные раунды, которые должны быть завершены
    now = datetime.utcnow()
    cursor.execute('''
        SELECT r.id, r.user_id, r.pair_id, r.direction, r.amount, 
               r.start_price, tp.symbol, tp.name
        FROM rounds r
        JOIN trading_pairs tp ON r.pair_id = tp.id
        WHERE r.status = 'active' AND r.end_time <= ?
    ''', (now,))
    
    finished_rounds = cursor.fetchall()
    
    win_rate = get_win_rate()
    
    for round_data in finished_rounds:
        round_id = round_data[0]
        user_id = round_data[1]
        pair_id = round_data[2]
        direction = round_data[3]
        amount = round_data[4]
        start_price = round_data[5]
        symbol = round_data[6]
        name = round_data[7]
        
        # Определяем результат
        win = determine_round_result(win_rate)
        
        # Генерируем конечную цену (симулированная)
        from utils import get_current_price
        end_price = get_current_price(pair_id)
        
        # Рассчитываем прибыль
        if win:
            profit = calculate_profit(amount, win_rate)
            new_balance_change = amount + profit  # Возвращаем ставку + прибыль
        else:
            profit = -amount  # Теряем всю ставку
            new_balance_change = 0  # Ставка уже была списана
        
        # Обновляем баланс пользователя
        if win:
            cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', 
                         (new_balance_change, user_id))
        
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
        
        conn.commit()
        
        # Отправляем событие через WebSocket
        socketio.emit('round_finished', {
            'round_id': round_id,
            'user_id': user_id,
            'win': win,
            'profit': profit,
            'amount': amount,
            'direction': direction,
            'symbol': symbol,
            'name': name,
            'start_price': start_price,
            'end_price': end_price,
            'new_balance': new_balance
        }, room=None)  # Отправляем всем подключенным клиентам
    
    conn.close()

