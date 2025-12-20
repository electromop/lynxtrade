from app import socketio, app
from models import get_db
from trading_logic import check_and_finish_rounds
from datetime import datetime

# Глобальный список подключенных клиентов (в этом модуле)
connected_clients = set()


def emit_server_time():
    """Отправка серверного времени каждую секунду"""
    # Небольшая задержка перед началом, чтобы клиенты успели подключиться
    socketio.sleep(2)
    
    while True:
        try:
            now = datetime.utcnow()
            formatted_time = now.strftime('%H:%M:%S')
            
            # КРИТИЧНО: Используем app.app_context() для правильного контекста Flask
            with app.app_context():
                # Простой emit БЕЗ namespace - должен работать для всех подключенных
                socketio.emit('server_time', {
                    'time': now.isoformat(),
                    'timestamp': now.timestamp(),
                    'formatted': formatted_time
                })
            
            socketio.sleep(1)
        except Exception as e:
            import traceback
            traceback.print_exc()
            socketio.sleep(1)

def emit_price_updates():
    """Отправка обновлений цен каждые несколько секунд"""
    from utils import get_current_price
    from models import get_db
    import requests
    
    socketio.sleep(2)  # Небольшая задержка перед началом
    
    while True:
        try:
            socketio.sleep(2)  # Обновляем каждые 2 секунды для более плавного обновления
            
            # КРИТИЧНО: Используем app.app_context() для правильного контекста Flask
            with app.app_context():
                # Получаем все активные пары
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute('SELECT id, symbol FROM trading_pairs WHERE active = 1')
                pairs = cursor.fetchall()
                conn.close()
                
                if not pairs:
                    continue
                
                # Получаем цены для всех пар одним запросом к Binance
                usdt_pairs = [p[1] for p in pairs if p[1].endswith('USDT')]
                
                if usdt_pairs:
                    try:
                        # Получаем цены для всех пар одним запросом
                        url = 'https://api.binance.com/api/v3/ticker/price'
                        response = requests.get(url, timeout=5)
                        response.raise_for_status()
                        all_prices = {item['symbol']: float(item['price']) for item in response.json()}
                        
                        # Отправляем обновления для каждой пары
                        for pair_id, symbol in pairs:
                            try:
                                if symbol in all_prices:
                                    price = all_prices[symbol]
                                else:
                                    price = get_current_price(pair_id)
                                
                                socketio.emit('price_update', {
                                    'pair_id': pair_id,
                                    'price': price,
                                    'timestamp': datetime.utcnow().timestamp()
                                })
                                
                            except Exception as e:
                                print(f'Error emitting price for pair {pair_id}: {e}')
                    except Exception as e:
                        print(f'Error fetching prices from Binance: {e}')
                        # Fallback на индивидуальные запросы
                        for pair_id, symbol in pairs:
                            try:
                                price = get_current_price(pair_id)
                                socketio.emit('price_update', {
                                    'pair_id': pair_id,
                                    'price': price,
                                    'timestamp': datetime.utcnow().timestamp()
                                })
                                
                            except Exception as e:
                                print(f'Error emitting price for pair {pair_id}: {e}')
                    
        except Exception as e:
            print(f'Error in price update loop: {e}')
            import traceback
            traceback.print_exc()
            socketio.sleep(5)

# Функция check_rounds_periodically отключена - теперь раунды завершаются на клиенте
# def check_rounds_periodically():
#     """Периодическая проверка и завершение раундов"""
#     while True:
#         try:
#             with app.app_context():
#                 check_and_finish_rounds(socketio, app)
#             socketio.sleep(1)  # Проверяем каждую секунду
#         except Exception as e:
#             print(f'❌ Error checking rounds: {e}')
#             import traceback
#             traceback.print_exc()
#             socketio.sleep(1)

def start_background_tasks():
    """Запуск фоновых задач используя socketio.start_background_task"""
    try:
        # Используем socketio.start_background_task для правильной работы с Flask-SocketIO
        print('🔄 Starting emit_server_time task...')
        socketio.start_background_task(emit_server_time)
        # check_rounds_periodically отключен - раунды завершаются на клиенте
        # print('🔄 Starting check_rounds_periodically task...')
        # socketio.start_background_task(check_rounds_periodically)
        print('🔄 Starting emit_price_updates task...')
        socketio.start_background_task(emit_price_updates)
        print('✅ All background tasks started using socketio.start_background_task')
    except Exception as e:
        print(f'❌ Error starting background tasks: {e}')
        import traceback
        traceback.print_exc()
        raise