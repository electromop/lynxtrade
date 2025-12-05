import sqlite3
import os
import requests
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'database', 'db.sqlite')

def get_db():
    """Получить соединение с БД"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Инициализация базы данных"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Создание таблиц
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            balance REAL DEFAULT 10000.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trading_pairs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            active BOOLEAN DEFAULT 1
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pair_id INTEGER NOT NULL,
            direction TEXT NOT NULL,
            amount REAL NOT NULL,
            duration INTEGER NOT NULL,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            status TEXT DEFAULT 'active',
            start_price REAL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (pair_id) REFERENCES trading_pairs(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS round_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            round_id INTEGER NOT NULL,
            win BOOLEAN NOT NULL,
            profit REAL NOT NULL,
            end_price REAL NOT NULL,
            FOREIGN KEY (round_id) REFERENCES rounds(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    
    # Инициализация данных
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        cursor.execute('INSERT INTO users (balance) VALUES (10000.0)')
    
    cursor.execute('SELECT COUNT(*) FROM trading_pairs')
    if cursor.fetchone()[0] == 0:
        # Сначала добавляем AAPL для тестирования TradingView
        try:
            cursor.execute('INSERT INTO trading_pairs (symbol, name) VALUES (?, ?)', ('AAPL', 'Apple Inc.'))
            print('Added AAPL pair for TradingView testing')
        except sqlite3.IntegrityError:
            pass  # Если уже существует
        
        # Загружаем пары с Binance API
        load_pairs_from_binance(cursor)
        conn.commit()
    else:
        # Проверяем, есть ли AAPL, если нет - добавляем
        cursor.execute('SELECT COUNT(*) FROM trading_pairs WHERE symbol = ?', ('AAPL',))
        if cursor.fetchone()[0] == 0:
            try:
                cursor.execute('INSERT INTO trading_pairs (symbol, name) VALUES (?, ?)', ('AAPL', 'Apple Inc.'))
                conn.commit()
                print('Added AAPL pair for TradingView testing')
            except sqlite3.IntegrityError:
                pass
    
    conn.close()

def load_pairs_from_binance(cursor):
    """Загрузить торговые пары с Binance API"""
    try:
        # Получаем все торговые пары с Binance
        url = 'https://api.binance.com/api/v3/exchangeInfo'
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Фильтруем только USDT пары и популярные криптовалюты
        popular_symbols = ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'XRP', 'DOT', 'DOGE', 'MATIC', 'AVAX', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC']
        
        pairs_to_add = []
        seen_symbols = set()
        
        for symbol_info in data.get('symbols', []):
            symbol = symbol_info.get('symbol', '')
            status = symbol_info.get('status', '')
            
            # Берем только активные пары, заканчивающиеся на USDT
            if status == 'TRADING' and symbol.endswith('USDT'):
                base_asset = symbol.replace('USDT', '')
                
                # Приоритет популярным криптовалютам
                if base_asset in popular_symbols or len(pairs_to_add) < 50:
                    if symbol not in seen_symbols:
                        # Форматируем название: BTC/USDT -> Bitcoin
                        name = format_pair_name(base_asset)
                        pairs_to_add.append((symbol, name))
                        seen_symbols.add(symbol)
        
        # Сортируем: сначала популярные, потом остальные
        popular_pairs = []
        other_pairs = []
        
        for pair in pairs_to_add:
            symbol = pair[0]
            base_asset = symbol.replace('USDT', '')
            if base_asset in popular_symbols:
                popular_pairs.append(pair)
            else:
                other_pairs.append(pair)
        
        # Ограничиваем до 30 пар (все популярные + остальные до лимита)
        sorted_pairs = popular_pairs + other_pairs[:max(0, 30 - len(popular_pairs))]
        
        if sorted_pairs:
            cursor.executemany(
                'INSERT INTO trading_pairs (symbol, name) VALUES (?, ?)',
                sorted_pairs
            )
            print(f'Loaded {len(sorted_pairs)} pairs from Binance')
        else:
            # Fallback на дефолтные пары (включая AAPL для тестирования)
            default_pairs = [
                ('AAPL', 'Apple Inc.'),  # Для тестирования TradingView
                ('BTCUSDT', 'Bitcoin'),
                ('ETHUSDT', 'Ethereum'),
                ('BNBUSDT', 'Binance Coin'),
                ('SOLUSDT', 'Solana'),
                ('ADAUSDT', 'Cardano')
            ]
            cursor.executemany(
                'INSERT OR IGNORE INTO trading_pairs (symbol, name) VALUES (?, ?)',
                default_pairs
            )
            print('Loaded default pairs (Binance API unavailable)')
    except Exception as e:
        print(f'Error loading pairs from Binance: {e}')
        # Fallback на дефолтные пары (включая AAPL для тестирования)
        default_pairs = [
            ('AAPL', 'Apple Inc.'),  # Для тестирования TradingView
            ('BTCUSDT', 'Bitcoin'),
            ('ETHUSDT', 'Ethereum'),
            ('BNBUSDT', 'Binance Coin'),
            ('SOLUSDT', 'Solana'),
            ('ADAUSDT', 'Cardano')
        ]
        cursor.executemany(
            'INSERT OR IGNORE INTO trading_pairs (symbol, name) VALUES (?, ?)',
            default_pairs
        )

def format_pair_name(base_asset):
    """Форматировать название пары"""
    names = {
        'BTC': 'Bitcoin',
        'ETH': 'Ethereum',
        'BNB': 'Binance Coin',
        'SOL': 'Solana',
        'ADA': 'Cardano',
        'XRP': 'Ripple',
        'DOT': 'Polkadot',
        'DOGE': 'Dogecoin',
        'MATIC': 'Polygon',
        'AVAX': 'Avalanche',
        'LINK': 'Chainlink',
        'UNI': 'Uniswap',
        'LTC': 'Litecoin',
        'ATOM': 'Cosmos',
        'ETC': 'Ethereum Classic'
    }
    return names.get(base_asset, base_asset)
    
    cursor.execute('SELECT COUNT(*) FROM settings WHERE key = ?', ('win_rate',))
    if cursor.fetchone()[0] == 0:
        cursor.execute('INSERT INTO settings (key, value) VALUES (?, ?)', ('win_rate', '50'))
    
    conn.commit()
    conn.close()

