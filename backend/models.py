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
    
    # Создание таблицы accounts для демо и реального аккаунтов
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            account_type TEXT NOT NULL,
            balance REAL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, account_type)
        )
    ''')
    
    # Добавление поля account_id в таблицу rounds (если его еще нет)
    try:
        cursor.execute('ALTER TABLE rounds ADD COLUMN account_id INTEGER')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_rounds_account_id ON rounds(account_id)')
    except sqlite3.OperationalError:
        # Поле уже существует или индекс уже создан
        pass
    
    conn.commit()
    
    # Миграция данных: создание аккаунтов и перенос существующих данных
    migrate_to_accounts(cursor, conn)
    
    # Инициализация данных
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        cursor.execute('INSERT INTO users (balance) VALUES (10000.0)')
        conn.commit()
    
    cursor.execute('SELECT COUNT(*) FROM trading_pairs')
    if cursor.fetchone()[0] == 0:
        # Загружаем пары с Binance API
        load_pairs_from_binance(cursor)
        conn.commit()
    
    # Удаляем AAPL, если он есть (он не должен быть в списке Binance)
    cursor.execute('DELETE FROM trading_pairs WHERE symbol = ?', ('AAPL',))
    if cursor.rowcount > 0:
        conn.commit()
        print('Removed AAPL pair from database')
    
    # Инициализация settings
    cursor.execute('SELECT COUNT(*) FROM settings WHERE key = ?', ('win_rate',))
    if cursor.fetchone()[0] == 0:
        cursor.execute('INSERT INTO settings (key, value) VALUES (?, ?)', ('win_rate', '50'))
        conn.commit()
    
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
        # BTCUSDT должен быть первым
        popular_pairs = []
        other_pairs = []
        btc_pair = None
        
        for pair in pairs_to_add:
            symbol = pair[0]
            base_asset = symbol.replace('USDT', '')
            if symbol == 'BTCUSDT':
                btc_pair = pair
            elif base_asset in popular_symbols:
                popular_pairs.append(pair)
            else:
                other_pairs.append(pair)
        
        # BTCUSDT всегда первый, потом остальные популярные, потом остальные
        if btc_pair:
            sorted_pairs = [btc_pair] + popular_pairs + other_pairs[:max(0, 30 - len(popular_pairs) - 1)]
        else:
            sorted_pairs = popular_pairs + other_pairs[:max(0, 30 - len(popular_pairs))]
        
        if sorted_pairs:
            cursor.executemany(
                'INSERT INTO trading_pairs (symbol, name) VALUES (?, ?)',
                sorted_pairs
            )
            print(f'Loaded {len(sorted_pairs)} pairs from Binance')
        else:
            # Fallback на дефолтные пары
            default_pairs = [
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
        # Fallback на дефолтные пары
        default_pairs = [
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

def migrate_to_accounts(cursor, conn):
    """Миграция существующих данных в систему аккаунтов"""
    # Проверяем, есть ли уже аккаунты
    cursor.execute('SELECT COUNT(*) FROM accounts')
    accounts_count = cursor.fetchone()[0]
    
    if accounts_count == 0:
        # Создаем аккаунты для всех существующих пользователей
        cursor.execute('SELECT id, balance FROM users')
        users = cursor.fetchall()
        
        for user_id, user_balance in users:
            # Создаем demo аккаунт с текущим балансом пользователя
            cursor.execute('''
                INSERT INTO accounts (user_id, account_type, balance)
                VALUES (?, ?, ?)
            ''', (user_id, 'demo', user_balance if user_balance else 10000.0))
            demo_account_id = cursor.lastrowid
            
            # Создаем real аккаунт с нулевым балансом
            cursor.execute('''
                INSERT INTO accounts (user_id, account_type, balance)
                VALUES (?, ?, ?)
            ''', (user_id, 'real', 0.0))
            real_account_id = cursor.lastrowid
            
            # Переносим существующие раунды в demo аккаунт
            cursor.execute('''
                UPDATE rounds 
                SET account_id = ? 
                WHERE user_id = ? AND account_id IS NULL
            ''', (demo_account_id, user_id))
            
            print(f'Created accounts for user {user_id}: demo (id={demo_account_id}), real (id={real_account_id})')
        
        conn.commit()

def get_or_create_accounts(user_id=1):
    """Получить или создать аккаунты для пользователя"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Проверяем наличие аккаунтов
    cursor.execute('SELECT id, account_type, balance FROM accounts WHERE user_id = ?', (user_id,))
    accounts = cursor.fetchall()
    
    if len(accounts) == 0:
        # Создаем аккаунты, если их нет
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        user_balance = user[0] if user else 10000.0
        
        cursor.execute('''
            INSERT INTO accounts (user_id, account_type, balance)
            VALUES (?, ?, ?)
        ''', (user_id, 'demo', user_balance))
        demo_account_id = cursor.lastrowid
        
        cursor.execute('''
            INSERT INTO accounts (user_id, account_type, balance)
            VALUES (?, ?, ?)
        ''', (user_id, 'real', 0.0))
        real_account_id = cursor.lastrowid
        
        conn.commit()
        conn.close()
        
        return [
            {'id': demo_account_id, 'account_type': 'demo', 'balance': user_balance},
            {'id': real_account_id, 'account_type': 'real', 'balance': 0.0}
        ]
    
    result = [{'id': row[0], 'account_type': row[1], 'balance': row[2]} for row in accounts]
    conn.close()
    return result

