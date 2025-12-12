from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
import os

# Определяем путь к frontend директории
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend')

app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = 'lynx-trade-secret-key'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Эндпоинты для HTML страниц
@app.route('/')
def index():
    """Главная страница с графиком"""
    try:
        return send_from_directory(FRONTEND_DIR, 'index.html')
    except Exception as e:
        return f"Error loading index.html: {str(e)}", 404

@app.route('/admin')
def admin():
    """Админ-панель"""
    try:
        return send_from_directory(FRONTEND_DIR, 'admin.html')
    except Exception as e:
        return f"Error loading admin.html: {str(e)}", 404

@app.route('/test')
def test():
    """Тестовая страница для проверки прямоугольников"""
    try:
        return send_from_directory(FRONTEND_DIR, 'test.html')
    except Exception as e:
        return f"Error loading test.html: {str(e)}", 404

# Статические файлы (CSS, JS, изображения)
@app.route('/css/<path:filename>')
def serve_css(filename):
    """Отдача CSS файлов"""
    try:
        return send_from_directory(os.path.join(FRONTEND_DIR, 'css'), filename)
    except Exception as e:
        return f"Error loading CSS: {str(e)}", 404

@app.route('/js/<path:filename>')
def serve_js(filename):
    """Отдача JavaScript файлов"""
    try:
        return send_from_directory(os.path.join(FRONTEND_DIR, 'js'), filename)
    except Exception as e:
        return f"Error loading JS: {str(e)}", 404

@app.route('/favicon.ico')
def favicon():
    """Обработка favicon (избегаем 404 ошибок)"""
    return '', 204  # No Content

# Инициализация базы данных
import models
models.init_db()

# Импорт маршрутов
import routes

# Регистрация Blueprint
app.register_blueprint(routes.api, url_prefix='/api')

# Импорт WebSocket обработчиков (должен быть после создания socketio и регистрации routes)
# Это должно быть ДО запуска приложения, чтобы обработчики зарегистрировались
print('📦 Importing websocket handlers...')
import websocket
print('✅ WebSocket handlers imported')

# Регистрируем обработчики явно после импорта
from flask import request
from datetime import datetime

# Импортируем connected_clients из websocket модуля
import websocket

@socketio.on('connect')
def handle_connect():
    """Обработка подключения клиента"""
    try:
        client_id = request.sid
        websocket.connected_clients.add(client_id)
        print(f'✅✅✅ Client connected - SID: {client_id} (Total: {len(websocket.connected_clients)})')
        print(f'✅✅✅ Connected clients list: {list(websocket.connected_clients)}')
        
        # Отправляем тестовое событие сразу после подключения
        now = datetime.utcnow()
        formatted_time = now.strftime('%H:%M:%S')
        
        socketio.emit('server_time', {
            'time': now.isoformat(),
            'timestamp': now.timestamp(),
            'formatted': formatted_time
        }, room=client_id, namespace='/')
        print(f'✅ Sent initial server_time to {client_id}: {formatted_time}')
    except Exception as e:
        print(f'❌ Error in connect handler: {e}')
        import traceback
        traceback.print_exc()

@socketio.on('disconnect')
def handle_disconnect():
    """Обработка отключения клиента"""
    try:
        client_id = request.sid
        websocket.connected_clients.discard(client_id)
        print(f'❌ Client disconnected - SID: {client_id} (Total: {len(websocket.connected_clients)})')
    except Exception as e:
        print(f'❌ Error in disconnect handler: {e}')

@socketio.on('subscribe_rounds')
def handle_subscribe_rounds(data):
    """Подписка на обновления раундов"""
    try:
        user_id = data.get('user_id', 1)
        client_id = request.sid
        # Убеждаемся, что клиент в списке
        websocket.connected_clients.add(client_id)
        print(f'✅✅✅ User {user_id} subscribed to rounds (SID: {client_id})')
        print(f'✅✅✅ Connected clients after subscribe: {len(websocket.connected_clients)} - {list(websocket.connected_clients)}')
        
        # Отправляем тестовое событие
        now = datetime.utcnow()
        formatted_time = now.strftime('%H:%M:%S')
        socketio.emit('server_time', {
            'time': now.isoformat(),
            'timestamp': now.timestamp(),
            'formatted': formatted_time
        }, room=client_id, namespace='/')
        print(f'✅ Sent server_time after subscribe: {formatted_time}')
    except Exception as e:
        print(f'❌ Error in subscribe_rounds handler: {e}')
        import traceback
        traceback.print_exc()

@socketio.on('test_event')
def handle_test_event(data):
    """Тестовый обработчик"""
    try:
        client_id = request.sid
        print(f'🧪🧪🧪 Test event received from {client_id}: {data}')
        socketio.emit('test_response', {'message': 'Server received your test!'}, room=client_id)
        print(f'🧪 Sent test_response to {client_id}')
    except Exception as e:
        print(f'❌ Error in test_event handler: {e}')
        import traceback
        traceback.print_exc()

print('✅ WebSocket event handlers registered in app.py')

if __name__ == '__main__':
    # Запускаем фоновые задачи после инициализации
    # Используем use_reloader=False для debug, чтобы избежать двойного запуска задач
    websocket.start_background_tasks()
    socketio.run(app, debug=True, host='0.0.0.0', port=5500, allow_unsafe_werkzeug=True, use_reloader=False)

