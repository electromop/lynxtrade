// Конфигурация для LYNX TRADE
// Определяет базовый URL для API и WebSocket подключений

(function() {
    'use strict';
    
    // Продакшн URL
    const PRODUCTION_URL = 'http://127.0.0.1:5500';
    
    // Определяем базовый URL
    // Если мы на продакшн сервере, используем его URL
    // Иначе используем текущий origin (для разработки)
    const isProduction = window.location.hostname === '45.12.255.196' || 
                        window.location.hostname.includes('45.12.255.196') ||
                        window.location.href.includes('45.12.255.196');
    
    // Базовый URL для API и WebSocket
    // По умолчанию используем продакшн URL для всех запросов
    // Это гарантирует, что приложение всегда работает с продакшн сервером
    window.API_BASE = `${PRODUCTION_URL}/api`;
    window.SOCKET_URL = PRODUCTION_URL;
    
    // Если нужно использовать локальный сервер для разработки, раскомментируйте:
    // window.API_BASE = isProduction ? `${PRODUCTION_URL}/api` : `${window.location.origin}/api`;
    // window.SOCKET_URL = isProduction ? PRODUCTION_URL : window.location.origin;
    
    console.log('🔧 [Config] API_BASE установлен:', window.API_BASE);
    console.log('🔧 [Config] SOCKET_URL установлен:', window.SOCKET_URL);
    console.log('🔧 [Config] Production mode:', isProduction);
    console.log('🔧 [Config] Все запросы идут на продакшн сервер:', PRODUCTION_URL);
})();

