// Lightweight Charts модуль
// Полная замена TradingView на open source lightweight-charts

// API_BASE объявлен в config.js
// Если config.js не загружен, используем fallback
if (!window.API_BASE) {
    window.API_BASE = window.location.origin + '/api';
    console.warn('⚠️ [Chart] API_BASE не установлен в config.js, используется fallback:', window.API_BASE);
}

let charts = new Map(); // pairId -> { chart, candlestickSeries, container, orderLines }
let currentPairId = 1;
let currentTimeframe = '1m';

// Хранилище для данных свечей
let chartDataCache = new Map(); // pairId -> [candles]
let lastCandleTime = new Map(); // pairId -> timestamp
let currentCandleData = new Map(); // pairId -> candle data
let priceUpdateIntervals = new Map(); // pairId -> intervalId
let candleAnimations = new Map(); // pairId -> { frameId, targetPrice, startPrice, startTime }

// Хранилище для линий ордеров
let orderLines = new Map(); // pairId -> Map(orderId -> { line, rect })

function initChart(pairId = 1, containerElement = null) {
    const chartContainer = containerElement || document.getElementById('chartContainer');
    
    if (!chartContainer) {
        console.error('Chart container not found');
        return;
    }
    
    if (typeof LightweightCharts === 'undefined') {
        console.error('LightweightCharts library not loaded');
        return;
    }
    
    // Очищаем контейнер
    chartContainer.innerHTML = '';
    
    // Создаем структуру с боковой панелью инструментов
    const chartWrapper = document.createElement('div');
    chartWrapper.className = 'chart-wrapper';
    chartWrapper.style.cssText = `
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: #000000;
    `;
    
    // Левая панель инструментов (как в TradingView Advanced)
    const leftToolbar = document.createElement('div');
    leftToolbar.className = 'chart-left-toolbar';
    leftToolbar.style.cssText = `
        width: 48px;
        background: #000000;
        border-right: 0;
        display: flex;
        flex-direction: column;
        padding: 0;
        overflow-y: auto;
        overflow-x: hidden;
    `;
    
    const toolbarContent = document.createElement('div');
    toolbarContent.className = 'chart-toolbar-content';
    toolbarContent.style.cssText = `
        display: flex;
        flex-direction: column;
        padding: 4px 0;
        flex: 1;
        min-height: 0;
    `;
    
    // Группа 1: Курсоры и инструменты рисования
    const group1 = createToolbarGroup();
    
    // Курсоры (Cross - активен по умолчанию)
    const cursorsDropdown = createDropdownTool('linetool-group-cursors', 'Cross', true, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor">
                <path d="M18 15h8v-1h-8z"></path>
                <path d="M14 18v8h1v-8zM14 3v8h1v-8zM3 15h8v-1h-8z"></path>
            </g>
        </svg>
    `);
    group1.appendChild(cursorsDropdown);
    
    // Трендовые линии
    const trendLineDropdown = createDropdownTool('linetool-group-trend-line', 'Trend Line', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor" fill-rule="nonzero">
                <path d="M7.354 21.354l14-14-.707-.707-14 14z"></path>
                <path d="M22.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM5.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z"></path>
            </g>
        </svg>
    `);
    group1.appendChild(trendLineDropdown);
    
    // Фибоначчи
    const fibDropdown = createDropdownTool('linetool-group-gann-and-fibonacci', 'Fib Retracement', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor" fill-rule="nonzero">
                <path d="M3 5h22v-1h-22z"></path>
                <path d="M3 17h22v-1h-22z"></path>
                <path d="M3 11h19.5v-1h-19.5z"></path>
                <path d="M5.5 23h19.5v-1h-19.5z"></path>
                <path d="M3.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM24.5 12c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z"></path>
            </g>
        </svg>
    `);
    group1.appendChild(fibDropdown);
    
    // Паттерны
    const patternsDropdown = createDropdownTool('linetool-group-patterns', 'XABCD Pattern', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor" fill-rule="nonzero">
                <path d="M20.449 8.505l2.103 9.112.974-.225-2.103-9.112zM13.943 14.011l7.631 4.856.537-.844-7.631-4.856zM14.379 11.716l4.812-3.609-.6-.8-4.812 3.609zM10.96 13.828l-4.721 6.744.819.573 4.721-6.744zM6.331 20.67l2.31-13.088-.985-.174-2.31 13.088zM9.041 7.454l1.995 3.492.868-.496-1.995-3.492z"></path>
                <path d="M8.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM5.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM12.5 14c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM20.5 8c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM23.5 21c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z"></path>
            </g>
        </svg>
    `);
    group1.appendChild(patternsDropdown);
    
    // Прогнозирование
    const predictionDropdown = createDropdownTool('linetool-group-prediction-and-measurement', 'Long Position', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
            <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2 6.5A2.5 2.5 0 0 1 6.95 6H24v1H6.95A2.5 2.5 0 0 1 2 6.5zM4.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2 16.5a2.5 2.5 0 0 1 4.95-.5h13.1a2.5 2.5 0 1 1 0 1H6.95A2.5 2.5 0 0 1 2 16.5zM22.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-18 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2 22.5a2.5 2.5 0 0 1 4.95-.5H24v1H6.95A2.5 2.5 0 0 1 2 22.5z"></path>
            <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M22.4 8.94l-1.39.63-.41-.91 1.39-.63.41.91zm-4 1.8l-1.39.63-.41-.91 1.39-.63.41.91zm-4 1.8l-1.4.63-.4-.91 1.39-.63.41.91zm-4 1.8l-1.4.63-.4-.91 1.39-.63.41.91z"></path>
        </svg>
    `);
    group1.appendChild(predictionDropdown);
    
    // Геометрические фигуры
    const geometricDropdown = createDropdownTool('linetool-group-geometric-shapes', 'Brush', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor" fill-rule="nonzero">
                <path d="M1.789 23l.859-.854.221-.228c.18-.19.38-.409.597-.655.619-.704 1.238-1.478 1.815-2.298.982-1.396 1.738-2.776 2.177-4.081 1.234-3.667 5.957-4.716 8.923-1.263 3.251 3.785-.037 9.38-5.379 9.38h-9.211zm9.211-1c4.544 0 7.272-4.642 4.621-7.728-2.45-2.853-6.225-2.015-7.216.931-.474 1.408-1.273 2.869-2.307 4.337-.599.852-1.241 1.653-1.882 2.383l-.068.078h6.853z"></path>
                <path d="M18.182 6.002l-1.419 1.286c-1.031.935-1.075 2.501-.096 3.48l1.877 1.877c.976.976 2.553.954 3.513-.045l5.65-5.874-.721-.693-5.65 5.874c-.574.596-1.507.609-2.086.031l-1.877-1.877c-.574-.574-.548-1.48.061-2.032l1.419-1.286-.672-.741z"></path>
            </g>
        </svg>
    `);
    group1.appendChild(geometricDropdown);
    
    // Аннотации
    const annotationDropdown = createDropdownTool('linetool-group-annotation', 'Text', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <path fill="currentColor" d="M8 6.5c0-.28.22-.5.5-.5H14v16h-2v1h5v-1h-2V6h5.5c.28 0 .5.22.5.5V9h1V6.5c0-.83-.67-1.5-1.5-1.5h-12C7.67 5 7 5.67 7 6.5V9h1V6.5Z"></path>
        </svg>
    `);
    group1.appendChild(annotationDropdown);
    
    // Иконки
    const iconsDropdown = createDropdownTool('linetool-group-font-icons', 'Icon', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <path fill="currentColor" d="M4.05 14a9.95 9.95 0 1 1 19.9 0 9.95 9.95 0 0 1-19.9 0ZM14 3a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm-3 13.03a.5.5 0 0 1 .64.3 2.5 2.5 0 0 0 4.72 0 .5.5 0 0 1 .94.34 3.5 3.5 0 0 1-6.6 0 .5.5 0 0 1 .3-.64Zm.5-4.53a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"></path>
        </svg>
    `);
    group1.appendChild(iconsDropdown);
    
    toolbarContent.appendChild(group1);
    
    // Горизонтальный сепаратор перед группой 2
    const separator1 = document.createElement('div');
    separator1.style.cssText = 'width: calc(100% - 8px); height: 1px; background: #393b3f; margin: 4px 4px;';
    toolbarContent.appendChild(separator1);
    
    // Группа 2: Измерение и масштаб
    const group2 = createToolbarGroup();
    
    // Измерение
    const measureBtn = createSimpleTool('measure', 'Measure', `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
            <path fill="currentColor" d="M2 9.75a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h24a1.5 1.5 0 0 0 1.5-1.5v-5.5a1.5 1.5 0 0 0-1.5-1.5zm0 1h3v2.5h1v-2.5h3.25v3.9h1v-3.9h3.25v2.5h1v-2.5h3.25v3.9h1v-3.9H22v2.5h1v-2.5h3a.5.5 0 0 1 .5.5v5.5a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5v-5.5a.5.5 0 0 1 .5-.5z" transform="rotate(-45 14 14)"></path>
        </svg>
    `);
    group2.appendChild(measureBtn);
    
    // Увеличение
    const zoomBtn = createSimpleTool('zoom', 'Zoom In', `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor">
            <path d="M17.646 18.354l4 4 .708-.708-4-4z"></path>
            <path d="M12.5 21a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17zm0-1a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z"></path>
            <path d="M9 13h7v-1H9z"></path>
            <path d="M13 16V9h-1v7z"></path>
        </svg>
    `);
    group2.appendChild(zoomBtn);
    
    toolbarContent.appendChild(group2);
    
    // Горизонтальный сепаратор перед группой 3
    const separator2 = document.createElement('div');
    separator2.style.cssText = 'width: calc(100% - 8px); height: 1px; background: #393b3f; margin: 4px 4px;';
    toolbarContent.appendChild(separator2);
    
    // Группа 3: Управление инструментами
    const group3 = createToolbarGroup();
    
    // Магнитный режим
    const magnetDropdown = createDropdownTool('magnet-button', 'Magnet Mode', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor" fill-rule="evenodd">
                <path fill-rule="nonzero" d="M14 10a2 2 0 0 0-2 2v11H6V12c0-4.416 3.584-8 8-8s8 3.584 8 8v11h-6V12a2 2 0 0 0-2-2zm-3 2a3 3 0 0 1 6 0v10h4V12c0-3.864-3.136-7-7-7s-7 3.136-7 7v10h4V12z"></path>
                <path d="M6.5 18h5v1h-5zm10 0h5v1h-5z"></path>
            </g>
        </svg>
    `);
    group3.appendChild(magnetDropdown);
    
    // Режим рисования
    const drawingModeBtn = createSimpleTool('drawginmode', 'Stay in Drawing Mode', `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor" fill-rule="evenodd">
                <path fill-rule="nonzero" d="M23.002 23C23 23 23 18.003 23 18.003L15.998 18C16 18 16 22.997 16 22.997l7.002.003zM15 18.003A1 1 0 0 1 15.998 17h7.004c.551 0 .998.438.998 1.003v4.994A1 1 0 0 1 23.002 24h-7.004A.993.993 0 0 1 15 22.997v-4.994z"></path>
                <path d="M19 20h1v2h-1z"></path>
                <path fill-rule="nonzero" d="M22 14.5a2.5 2.5 0 0 0-5 0v3h1v-3a1.5 1.5 0 0 1 3 0v.5h1v-.5z"></path>
                <g fill-rule="nonzero">
                    <path d="M3 14.707A1 1 0 0 1 3.293 14L14.439 2.854a1.5 1.5 0 0 1 2.122 0l2.585 2.585a1.5 1.5 0 0 1 0 2.122L8 18.707a1 1 0 0 1-.707.293H4a1 1 0 0 1-1-1v-3.293zm1 0V18h3.293L18.439 6.854a.5.5 0 0 0 0-.708l-2.585-2.585a.5.5 0 0 0-.708 0L4 14.707z"></path>
                    <path d="M13.146 4.854l4 4 .708-.708-4-4zm-9 9l4 4 .708-.708-4-4z"></path>
                    <path d="M15.146 6.146l-9 9 .708.708 9-9z"></path>
                </g>
            </g>
        </svg>
    `);
    group3.appendChild(drawingModeBtn);
    
    // Блокировка
    const lockBtn = createSimpleTool('lockAllDrawings', 'Lock All Drawing Tools', `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <path fill="currentColor" fill-rule="evenodd" d="M14 6a3 3 0 0 0-3 3v3h8.5a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 6 21.5v-7A2.5 2.5 0 0 1 8.5 12H10V9a4 4 0 0 1 8 0h-1a3 3 0 0 0-3-3zm-1 11a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0v-2zm-6-2.5c0-.83.67-1.5 1.5-1.5h11c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 7 21.5v-7z"></path>
        </svg>
    `);
    group3.appendChild(lockBtn);
    
    // Скрыть все
    const hideDropdown = createDropdownTool('hide-all', 'Hide all drawings', false, `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
            <path fill="currentColor" fill-rule="evenodd" d="M5 10.76l-.41-.72-.03-.04.03-.04a15 15 0 012.09-2.9c1.47-1.6 3.6-3.12 6.32-3.12 2.73 0 4.85 1.53 6.33 3.12a15.01 15.01 0 012.08 2.9l.03.04-.03.04a15 15 0 01-2.09 2.9c-1.47 1.6-3.6 3.12-6.32 3.12-2.73 0-4.85-1.53-6.33-3.12a15 15 0 01-1.66-2.18zm17.45-.98L22 10l.45.22-.01.02a5.04 5.04 0 01-.15.28 16.01 16.01 0 01-2.23 3.1c-1.56 1.69-3.94 3.44-7.06 3.44-3.12 0-5.5-1.75-7.06-3.44a16 16 0 01-2.38-3.38v-.02h-.01L4 10l-.45-.22.01-.02a5.4 5.4 0 01.15-.28 16 16 0 012.23-3.1C7.5 4.69 9.88 2.94 13 2.94c3.12 0 5.5 1.75 7.06 3.44a16.01 16.01 0 012.38 3.38v.02h.01zM22 10l.45-.22.1.22-.1.22L22 10zM3.55 9.78L4 10l-.45.22-.1-.22.1-.22zm6.8.22A2.6 2.6 0 0113 7.44 2.6 2.6 0 0115.65 10 2.6 2.6 0 0113 12.56 2.6 2.6 0 0110.35 10zM13 6.44A3.6 3.6 0 009.35 10 3.6 3.6 0 0013 13.56c2 0 3.65-1.58 3.65-3.56A3.6 3.6 0 0013 6.44zm7.85 12l.8-.8.7.71-.79.8a.5.5 0 000 .7l.59.59c.2.2.5.2.7 0l1.8-1.8.7.71-1.79 1.8a1.5 1.5 0 01-2.12 0l-.59-.59a1.5 1.5 0 010-2.12zM16.5 21.5l-.35-.35a.5.5 0 00-.07.07l-1 1.5-1 1.5a.5.5 0 00.42.78h4a2.5 2.5 0 001.73-.77A2.5 2.5 0 0021 22.5a2.5 2.5 0 00-.77-1.73A2.5 2.5 0 0018.5 20a3.1 3.1 0 00-1.65.58 5.28 5.28 0 00-.69.55v.01h-.01l.35.36zm.39.32l-.97 1.46-.49.72h3.07c.34 0 .72-.17 1.02-.48.3-.3.48-.68.48-1.02 0-.34-.17-.72-.48-1.02-.3-.3-.68-.48-1.02-.48-.35 0-.75.18-1.1.42a4.27 4.27 0 00-.51.4z"></path>
        </svg>
    `);
    group3.appendChild(hideDropdown);
    
    // Горизонтальный сепаратор перед корзиной
    const separator3 = document.createElement('div');
    separator3.style.cssText = 'width: calc(100% - 8px); height: 1px; background: #393b3f; margin: 4px 4px;';
    group3.appendChild(separator3);
    
    // Удалить все
    const removeDropdown = createDropdownTool('removeAllDrawingTools', 'Remove 0 drawings', false, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <path fill="currentColor" fill-rule="evenodd" d="M11.5 6a.5.5 0 0 0-.5.5V8h6V6.5a.5.5 0 0 0-.5-.5h-5zM18 8V6.5c0-.83-.67-1.5-1.5-1.5h-5c-.83 0-1.5.67-1.5 1.5V8H5.5a.5.5 0 0 0 0 1H7v12.5A2.5 2.5 0 0 0 9.5 24h9a2.5 2.5 0 0 0 2.5-2.5V9h1.5a.5.5 0 0 0 0-1H18zm2 1H8v12.5c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5V9zm-8.5 3c.28 0 .5.22.5.5v7a.5.5 0 0 1-1 0v-7c0-.28.22-.5.5-.5zm5.5.5a.5.5 0 0 0-1 0v7a.5.5 0 0 0 1 0v-7z"></path>
        </svg>
    `);
    group3.appendChild(removeDropdown);
    
    toolbarContent.appendChild(group3);
    
    // Группа 4: Дерево объектов
    const group4 = createToolbarGroup();
    group4.classList.add('lastGroup-BfVZxb4b');
    
    const objectTreeBtn = createSimpleTool('showObjectsTree', 'Show Object Tree', `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
            <g fill="currentColor">
                <path fill-rule="nonzero" d="M14 18.634l-.307-.239-7.37-5.73-2.137-1.665 9.814-7.633 9.816 7.634-.509.394-1.639 1.269-7.667 5.969zm7.054-6.759l1.131-.876-8.184-6.366-8.186 6.367 1.123.875 7.063 5.491 7.054-5.492z"></path>
                <path d="M7 14.5l-1 .57 8 6.43 8-6.5-1-.5-7 5.5z"></path>
                <path d="M7 17.5l-1 .57 8 6.43 8-6.5-1-.5-7 5.5z"></path>
            </g>
        </svg>
    `);
    group4.appendChild(objectTreeBtn);
    
    toolbarContent.appendChild(group4);
    
    leftToolbar.appendChild(toolbarContent);
    
    // Вспомогательные функции для создания элементов тулбара
    function createToolbarGroup() {
        const group = document.createElement('div');
        group.className = 'group-BfVZxb4b';
        group.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 2px 0;
        `;
        return group;
    }
    
    function createDropdownTool(name, tooltip, isActive, svgContent) {
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-pbhJWNrt';
        dropdown.setAttribute('data-name', name);
        dropdown.style.cssText = `
            position: relative;
            display: flex;
        `;
        
        const control = document.createElement('div');
        control.className = 'control-pbhJWNrt';
        control.style.cssText = `
            display: flex;
            align-items: center;
        `;
        
        const buttonWrap = document.createElement('div');
        buttonWrap.className = 'buttonWrap-pbhJWNrt accessible-pbhJWNrt';
        
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `button-KTgbfaP5 apply-common-tooltip ${isActive ? 'isActive-KTgbfaP5' : 'isTransparent-KTgbfaP5'}`;
        button.setAttribute('aria-label', tooltip);
        button.setAttribute('data-tooltip', tooltip);
        button.style.cssText = `
            width: 36px;
            height: 36px;
            padding: 0;
            background: unset;
            border: 1px solid rgba(0, 0, 0, 1);
            border-radius: 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${isActive ? '#22c55e' : '#8b8fa3'};
            transition: all 0.2s;
        `;
        
        const bg = document.createElement('div');
        bg.className = 'bg-KTgbfaP5';
        bg.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            ${isActive ? 'color: rgba(41, 98, 255, 1);' : ''}
            font-size: 13.3px;
        `;
        
        const icon = document.createElement('span');
        icon.className = 'icon-KTgbfaP5';
        icon.innerHTML = svgContent;
        icon.style.cssText = `
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        bg.appendChild(icon);
        button.appendChild(bg);
        buttonWrap.appendChild(button);
        
        button.addEventListener('mouseenter', () => {
            if (!isActive) {
                button.style.background = '#1e2330';
            }
        });
        button.addEventListener('mouseleave', () => {
            if (!isActive) {
                button.style.background = 'unset';
            }
        });
        
        control.appendChild(buttonWrap);
        dropdown.appendChild(control);
        
        return dropdown;
    }
    
    function createSimpleTool(name, tooltip, svgContent) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button-KTgbfaP5 apply-common-tooltip isTransparent-KTgbfaP5';
        button.setAttribute('aria-label', tooltip);
        button.setAttribute('data-tooltip', tooltip);
        button.setAttribute('data-name', name);
        button.style.cssText = `
            width: 36px;
            height: 36px;
            padding: 0;
            background: unset;
            border: 1px solid rgba(0, 0, 0, 1);
            border-radius: 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #8b8fa3;
            transition: all 0.2s;
        `;
        
        const bg = document.createElement('div');
        bg.className = 'bg-KTgbfaP5';
        bg.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13.3px;
        `;
        
        const icon = document.createElement('span');
        icon.className = 'icon-KTgbfaP5';
        icon.innerHTML = svgContent;
        icon.style.cssText = `
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        bg.appendChild(icon);
        button.appendChild(bg);
        
        button.addEventListener('mouseenter', () => {
            button.style.background = '#1e2330';
        });
        button.addEventListener('mouseleave', () => {
            button.style.background = 'unset';
        });
        
        return button;
    }
    
    // Контейнер для графика
    const chartInnerContainer = document.createElement('div');
    chartInnerContainer.className = 'chart-inner-container';
    chartInnerContainer.style.cssText = `
        flex: 1;
        position: relative;
        display: flex;
        flex-direction: column;
        background: #000000;
    `;
    
    // Функция для создания горизонтального тулбара
    function createChartToolbar() {
        const content = document.createElement('div');
        content.className = 'content-OhqNVIYA';
        content.setAttribute('role', 'none');
        
        const innerWrap = document.createElement('div');
        innerWrap.className = 'innerWrap-OhqNVIYA';
        
        // Функция для создания вертикального разделителя
        function createVerticalSeparator() {
            const separator = document.createElement('div');
            separator.className = 'vertical-separator';
            separator.style.cssText = 'width: 1px; height: 24px; background: rgba(255, 255, 255, 0.3); margin: 0 8px; align-self: center;';
            return separator;
        }
        
        // Функция для создания группы
        function createGroup() {
            const group = document.createElement('div');
            group.className = 'group-MBOVGQRI';
            return group;
        }
        
        // Группа 1: Интервалы
        const intervalsGroup = createGroup();
        const intervalsWrap = document.createElement('div');
        intervalsWrap.className = 'wrap-n5bmFxyX';
        intervalsWrap.id = 'header-toolbar-intervals';
        const intervalButton = document.createElement('button');
        intervalButton.type = 'button';
        intervalButton.className = 'menu-S_1OCXUK button-merBkM5y apply-common-tooltip accessible-merBkM5y';
        intervalButton.setAttribute('tabindex', '-1');
        intervalButton.setAttribute('data-tooltip', '1 minute');
        intervalButton.setAttribute('aria-label', '1 minute');
        const intervalBg = document.createElement('div');
        intervalBg.className = 'bg-KTgbfaP5';
        const intervalValue = document.createElement('div');
        intervalValue.className = 'value-gwXludjS';
        intervalValue.textContent = '1m';
        intervalBg.appendChild(intervalValue);
        intervalButton.appendChild(intervalBg);
        intervalsWrap.appendChild(intervalButton);
        intervalsGroup.appendChild(intervalsWrap);
        innerWrap.appendChild(intervalsGroup);
        
        // Вертикальный разделитель после интервалов
        innerWrap.appendChild(createVerticalSeparator());
        
        // Группа 2: Стили графика
        const chartStylesGroup = createGroup();
        const chartStylesWrap = document.createElement('div');
        chartStylesWrap.className = 'wrap-n5bmFxyX';
        chartStylesWrap.id = 'header-toolbar-chart-styles';
        const chartStyleButton = document.createElement('button');
        chartStyleButton.type = 'button';
        chartStyleButton.className = 'menu-b3Cgff6l button-merBkM5y apply-common-tooltip accessible-merBkM5y';
        chartStyleButton.setAttribute('tabindex', '-1');
        chartStyleButton.setAttribute('data-tooltip', 'Candles');
        chartStyleButton.setAttribute('aria-label', 'Candles');
        const chartStyleBg = document.createElement('div');
        chartStyleBg.className = 'bg-KTgbfaP5';
        const chartStyleIcon = document.createElement('span');
        chartStyleIcon.className = 'icon-KTgbfaP5';
        chartStyleIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor"><path d="M17 11v6h3v-6h-3zm-.5-1h4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5z"></path><path d="M18 7h1v3.5h-1zm0 10.5h1V21h-1z"></path><path d="M9 8v12h3V8H9zm-.5-1h4a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z"></path><path d="M10 4h1v3.5h-1zm0 16.5h1V24h-1z"></path></svg>';
        chartStyleBg.appendChild(chartStyleIcon);
        chartStyleButton.appendChild(chartStyleBg);
        chartStylesWrap.appendChild(chartStyleButton);
        chartStylesGroup.appendChild(chartStylesWrap);
        innerWrap.appendChild(chartStylesGroup);
        
        // Вертикальный разделитель после стилей графика
        innerWrap.appendChild(createVerticalSeparator());
        
        // Группа 3: Индикаторы
        const indicatorsGroup = createGroup();
        const indicatorsWrap = document.createElement('div');
        indicatorsWrap.className = 'wrap-n5bmFxyX';
        indicatorsWrap.id = 'header-toolbar-indicators';
        indicatorsWrap.style.cssText = 'display: flex; align-items: center; height: 100%;';
        const indicatorsContainer = document.createElement('div');
        indicatorsContainer.className = 'apply-common-tooltip isInteractive-GwQQdU8S';
        indicatorsContainer.setAttribute('data-name', 'open-indicators-dialog');
        indicatorsContainer.setAttribute('data-tooltip', 'Indicators & Strategies');
        indicatorsContainer.setAttribute('aria-label', 'Indicators & Strategies');
        indicatorsContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 0 8px; height: 36px;';
        const indicatorsIcon = document.createElement('span');
        indicatorsIcon.className = 'icon-KTgbfaP5';
        indicatorsIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none"><path stroke="currentColor" d="M20 17l-5 5M15 17l5 5M9 11.5h7M17.5 8a2.5 2.5 0 0 0-5 0v11a2.5 2.5 0 0 1-5 0"></path></svg>';
        const indicatorsText = document.createElement('div');
        indicatorsText.className = 'js-button-text text-GwQQdU8S';
        indicatorsText.textContent = 'Indicators';
        indicatorsContainer.appendChild(indicatorsIcon);
        indicatorsContainer.appendChild(indicatorsText);
        indicatorsWrap.appendChild(indicatorsContainer);
        indicatorsGroup.appendChild(indicatorsWrap);
        innerWrap.appendChild(indicatorsGroup);
        
        // Вертикальный разделитель после индикаторов
        innerWrap.appendChild(createVerticalSeparator());
        
        // Группа 4: Undo/Redo
        const undoRedoGroup = createGroup();
        const undoRedoWrap = document.createElement('div');
        undoRedoWrap.className = 'wrap-n5bmFxyX';
        undoRedoWrap.id = 'header-toolbar-undo-redo';
        const undoButton = document.createElement('button');
        undoButton.type = 'button';
        undoButton.className = 'button-GwQQdU8S isDisabled-GwQQdU8S accessible-GwQQdU8S';
        undoButton.setAttribute('tabindex', '-1');
        undoButton.disabled = true;
        const undoBg = document.createElement('div');
        undoBg.className = 'bg-KTgbfaP5';
        const undoIcon = document.createElement('span');
        undoIcon.className = 'icon-KTgbfaP5';
        undoIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M8.707 13l2.647 2.646-.707.708L6.792 12.5l3.853-3.854.708.708L8.707 12H14.5a5.5 5.5 0 0 1 5.5 5.5V19h-1v-1.5a4.5 4.5 0 0 0-4.5-4.5H8.707z"></path></svg>';
        undoBg.appendChild(undoIcon);
        undoButton.appendChild(undoBg);
        const redoButton = document.createElement('button');
        redoButton.type = 'button';
        redoButton.className = 'button-GwQQdU8S isDisabled-GwQQdU8S accessible-GwQQdU8S';
        redoButton.setAttribute('tabindex', '-1');
        redoButton.disabled = true;
        const redoBg = document.createElement('div');
        redoBg.className = 'bg-KTgbfaP5';
        const redoIcon = document.createElement('span');
        redoIcon.className = 'icon-KTgbfaP5';
        redoIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M18.293 13l-2.647 2.646.707.708 3.854-3.854-3.854-3.854-.707.708L18.293 12H12.5A5.5 5.5 0 0 0 7 17.5V19h1v-1.5a4.5 4.5 0 0 1 4.5-4.5h5.793z"></path></svg>';
        redoBg.appendChild(redoIcon);
        redoButton.appendChild(redoBg);
        undoRedoWrap.appendChild(undoButton);
        undoRedoWrap.appendChild(redoButton);
        undoRedoGroup.appendChild(undoRedoWrap);
        innerWrap.appendChild(undoRedoGroup);
        
        // Fill группа
        const fillGroup = document.createElement('div');
        fillGroup.className = 'fill-OhqNVIYA group-MBOVGQRI';
        innerWrap.appendChild(fillGroup);
        
        // Вертикальный разделитель перед поиском
        innerWrap.appendChild(createVerticalSeparator());
        
        // Группа 5: Поиск, настройки, скриншот
        const toolsGroup = createGroup();
        const searchButton = document.createElement('button');
        searchButton.id = 'header-toolbar-quick-search';
        searchButton.type = 'button';
        searchButton.className = 'button-xNqEcuN2 button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S';
        searchButton.setAttribute('data-name', 'header-toolbar-quick-search');
        searchButton.setAttribute('data-tooltip', 'Quick Search');
        searchButton.setAttribute('aria-label', 'Quick Search');
        searchButton.setAttribute('tabindex', '-1');
        const searchBg = document.createElement('div');
        searchBg.className = 'bg-KTgbfaP5';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'icon-KTgbfaP5';
        searchIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M15 11v4l1-1.5 2.33-3.5.67-1h-3V4l-1 1.5L12.67 9 12 10h3v1Zm2-7v4h2a1 1 0 0 1 .83 1.55l-4 6A1 1 0 0 1 14 15v-4h-2a1 1 0 0 1-.83-1.56l4-6A1 1 0 0 1 17 4ZM5 13.5a7.5 7.5 0 0 1 6-7.35v1.02A6.5 6.5 0 1 0 18.98 13h1a7.6 7.6 0 0 1-1.83 5.44l4.7 4.7-.7.71-4.71-4.7A7.5 7.5 0 0 1 5 13.5Z"></path></svg>';
        searchBg.appendChild(searchIcon);
        searchButton.appendChild(searchBg);
        toolsGroup.appendChild(searchButton);
        
        const settingsButton = document.createElement('button');
        settingsButton.id = 'header-toolbar-properties';
        settingsButton.type = 'button';
        settingsButton.className = 'button-xNqEcuN2 button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S';
        settingsButton.setAttribute('data-name', 'header-toolbar-properties');
        settingsButton.setAttribute('data-tooltip', 'Chart settings');
        settingsButton.setAttribute('aria-label', 'Chart settings');
        settingsButton.setAttribute('tabindex', '-1');
        const settingsBg = document.createElement('div');
        settingsBg.className = 'bg-KTgbfaP5';
        const settingsIcon = document.createElement('span');
        settingsIcon.className = 'icon-KTgbfaP5';
        settingsIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><g fill="currentColor" fill-rule="evenodd"><path fill-rule="nonzero" d="M14 17a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-1a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"></path><path d="M5.005 16A1.003 1.003 0 0 1 4 14.992v-1.984A.998.998 0 0 1 5 12h1.252a7.87 7.87 0 0 1 .853-2.06l-.919-.925c-.356-.397-.348-1 .03-1.379l1.42-1.42a1 1 0 0 1 1.416.007l.889.882A7.96 7.96 0 0 1 12 6.253V5c0-.514.46-1 1-1h2c.557 0 1 .44 1 1v1.253a7.96 7.96 0 0 1 2.06.852l.888-.882a1 1 0 0 1 1.416-.006l1.42 1.42a.999.999 0 0 1 .029 1.377s-.4.406-.918.926a7.87 7.87 0 0 1 .853 2.06H23c.557 0 1 .447 1 1.008v1.984A.998.998 0 0 1 23 16h-1.252a7.87 7.87 0 0 1-.853 2.06l.882.888a1 1 0 0 1 .006 1.416l-1.42 1.42a1 1 0 0 1-1.415-.007l-.889-.882a7.96 7.96 0 0 1-2.059.852v1.248c0 .56-.45 1.005-1.008 1.005h-1.984A1.004 1.004 0 0 1 12 22.995v-1.248a7.96 7.96 0 0 1-2.06-.852l-.888.882a1 1 0 0 1-1.416.006l-1.42-1.42a1 1 0 0 1 .007-1.415l.882-.888A7.87 7.87 0 0 1 6.252 16H5.005zm3.378-6.193l-.227.34A6.884 6.884 0 0 0 7.14 12.6l-.082.4H5.005C5.002 13 5 13.664 5 14.992c0 .005.686.008 2.058.008l.082.4c.18.883.52 1.71 1.016 2.453l.227.34-1.45 1.46c-.004.003.466.477 1.41 1.422l1.464-1.458.34.227a6.959 6.959 0 0 0 2.454 1.016l.399.083v2.052c0 .003.664.005 1.992.005.005 0 .008-.686.008-2.057l.399-.083a6.959 6.959 0 0 0 2.454-1.016l.34-.227 1.46 1.45c.003.004.477-.466 1.422-1.41l-1.458-1.464.227-.34A6.884 6.884 0 0 0 20.86 15.4l.082-.4h2.053c.003 0 .005-.664.005-1.992 0-.005-.686-.008-2.058-.008l-.082-.4a6.884 6.884 0 0 0-1.016-2.453l-.227-.34 1.376-1.384.081-.082-1.416-1.416-1.465 1.458-.34-.227a6.959 6.959 0 0 0-2.454-1.016L15 7.057V5c0-.003-.664-.003-1.992 0-.005 0-.008.686-.008 2.057l-.399.083a6.959 6.959 0 0 0-2.454 1.016l-.34.227-1.46-1.45c-.003-.004-.477.466-1.421 1.408l1.457 1.466z"></path></g></svg>';
        settingsBg.appendChild(settingsIcon);
        settingsButton.appendChild(settingsBg);
        toolsGroup.appendChild(settingsButton);
        
        const screenshotButton = document.createElement('button');
        screenshotButton.type = 'button';
        screenshotButton.className = 'button-merBkM5y apply-common-tooltip accessible-merBkM5y';
        screenshotButton.id = 'header-toolbar-screenshot';
        screenshotButton.setAttribute('data-role', 'button');
        screenshotButton.setAttribute('data-tooltip', 'Take a snapshot');
        screenshotButton.setAttribute('aria-label', 'Take a snapshot');
        screenshotButton.setAttribute('tabindex', '-1');
        const screenshotBg = document.createElement('div');
        screenshotBg.className = 'bg-KTgbfaP5';
        const screenshotIcon = document.createElement('span');
        screenshotIcon.className = 'icon-KTgbfaP5';
        screenshotIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.118 6a.5.5 0 0 0-.447.276L9.809 8H5.5A1.5 1.5 0 0 0 4 9.5v10A1.5 1.5 0 0 0 5.5 21h16a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 21.5 8h-4.309l-.862-1.724A.5.5 0 0 0 15.882 6h-4.764zm-1.342-.17A1.5 1.5 0 0 1 11.118 5h4.764a1.5 1.5 0 0 1 1.342.83L17.809 7H21.5A2.5 2.5 0 0 1 24 9.5v10a2.5 2.5 0 0 1-2.5 2.5h-16A2.5 2.5 0 0 1 3 19.5v-10A2.5 2.5 0 0 1 5.5 7h3.691l.585-1.17z"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M13.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm0 1a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"></path></svg>';
        screenshotBg.appendChild(screenshotIcon);
        screenshotButton.appendChild(screenshotBg);
        toolsGroup.appendChild(screenshotButton);
        innerWrap.appendChild(toolsGroup);
        
        content.appendChild(innerWrap);
        return content;
    }
    
    // Создаем горизонтальный тулбар
    const chartToolbar = createChartToolbar();
    
    // Верхняя панель с информацией о свече и таймфреймами
    const chartHeader = document.createElement('div');
    chartHeader.className = 'chart-header';
    chartHeader.id = `chart-header-${pairId}`;
    chartHeader.style.cssText = `
        height: 25px;
        background: transparent;
        border-bottom: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 15px;
        font-size: 12px;
        color: #8b8fa3;
        font-family: Arial, sans-serif;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
        pointer-events: none;
    `;
    
    // Левая часть - информация о свече
    const candleInfoDiv = document.createElement('div');
    candleInfoDiv.id = `candleInfo-${pairId}`;
    candleInfoDiv.textContent = 'O 0.00000 H 0.00000 L 0.00000 C 0.00000 +0.0000 (+0.00%)';
    candleInfoDiv.style.pointerEvents = 'auto';
    candleInfoDiv.style.setProperty('font-family', '-apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif', 'important');
    candleInfoDiv.style.setProperty('font-size', '13px', 'important');
    
    chartHeader.appendChild(candleInfoDiv);
    
    // Контейнер для самого графика
    const chartCanvasContainer = document.createElement('div');
    chartCanvasContainer.className = 'chart-canvas-container';
    chartCanvasContainer.id = `chart-canvas-${pairId}`;
    chartCanvasContainer.style.cssText = `
        flex: 1;
        position: relative;
        min-height: 0;
    `;
    
    // Добавляем chartHeader внутрь chartCanvasContainer, чтобы он был поверх графика
    chartCanvasContainer.appendChild(chartHeader);
    
    // Добавляем иконку TradingView в левый нижний угол графика
    const tradingViewIcon = document.createElement('div');
    tradingViewIcon.className = 'tradingview-icon';
    tradingViewIcon.style.cssText = `
        position: absolute;
        bottom: 10px;
        left: 10px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #1a1d29;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        cursor: pointer;
        overflow: hidden;
    `;
    const iconImg = document.createElement('img');
    iconImg.src = '/api/img/image_trading_view.png';
    iconImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain; padding: 8px;';
    iconImg.alt = 'TradingView';
    tradingViewIcon.appendChild(iconImg);
    chartCanvasContainer.appendChild(tradingViewIcon);
    
    chartInnerContainer.appendChild(chartCanvasContainer);
    
    // Создаем контейнер для левого тулбара и графика
    const chartContentWrapper = document.createElement('div');
    chartContentWrapper.style.cssText = `
        display: flex;
        flex: 1;
        min-height: 0;
        width: 100%;
    `;
    
    chartContentWrapper.appendChild(leftToolbar);
    chartContentWrapper.appendChild(chartInnerContainer);
    
    // Добавляем горизонтальный тулбар первым, затем контент
    chartWrapper.appendChild(chartToolbar);
    chartWrapper.appendChild(chartContentWrapper);
    
    chartContainer.appendChild(chartWrapper);
    
    try {
        // Проверяем доступность библиотеки
        if (typeof LightweightCharts === 'undefined') {
            console.error('LightweightCharts library not loaded');
            return;
        }
        
        // Проверяем размеры контейнера
        if (chartCanvasContainer.clientWidth === 0 || chartCanvasContainer.clientHeight === 0) {
            console.warn('Chart container has zero dimensions, skip init for now (will re-init on next switchToPair/loadPairs)...');
            // Не запускаем рекурсивный setTimeout, чтобы не спамить лог и не плодить таймеры.
            // График для этой пары будет инициализирован повторно из switchToPair/loadPairs,
            // когда контейнер будет иметь валидные размеры.
            return;
        }
        
        // Создаем график
        const chart = LightweightCharts.createChart(chartCanvasContainer, {
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#8b8fa3',
            },
            grid: {
                vertLines: { color: '#393b3f' },
                horzLines: { color: '#393b3f' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: {
                    color: '#393b3f',
                    width: 1,
                    style: LightweightCharts.LineStyle.Solid,
                    labelVisible: false,
                },
                horzLine: {
                    color: '#393b3f',
                    width: 1,
                    style: LightweightCharts.LineStyle.Solid,
                    labelVisible: false,
                },
            },
            rightPriceScale: {
                borderColor: '#1e2330',
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            },
            timeScale: {
                borderColor: '#1e2330',
                timeVisible: true,
                secondsVisible: false,
            },
            width: chartCanvasContainer.clientWidth,
            height: chartCanvasContainer.clientHeight,
        });

        // Проверяем, что график создан
        if (!chart) {
            console.error('Failed to create chart');
            return;
        }
        
        // Создаем серию свечей (поддержка обеих версий API)
        let candlestickSeries;
        if (typeof chart.addCandlestickSeries === 'function') {
            // Версия 4.x
            candlestickSeries = chart.addCandlestickSeries({
                upColor: '#08b774',
                downColor: '#f92757',
                borderVisible: false,
                wickUpColor: '#08b774',
                wickDownColor: '#f92757',
            });
        } else if (typeof chart.addSeries === 'function' && LightweightCharts.CandlestickSeries) {
            // Версия 5.x+
            candlestickSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
                upColor: '#08b774',
                downColor: '#f92757',
                borderVisible: false,
                wickUpColor: '#08b774',
                wickDownColor: '#f92757',
            });
        } else {
            console.error('Cannot create candlestick series - API not supported');
            console.log('Available methods:', Object.getOwnPropertyNames(chart).filter(name => typeof chart[name] === 'function'));
            return;
        }
        
        if (!candlestickSeries) {
            console.error('Failed to create candlestick series');
            return;
        }

        // Сохраняем данные графика
        charts.set(pairId, {
            chart,
            candlestickSeries,
            container: chartContainer,
            chartWrapper,
            leftToolbar,
            chartHeader,
            orderLines: new Map(),
            chartCanvasContainer,
        });

    // Обновление информации о свече при наведении
    chart.subscribeCrosshairMove(param => {
        if (param.time && param.seriesData) {
            const data = param.seriesData.get(candlestickSeries);
            if (data) {
                    updateCandleInfo(pairId, data);
                }
            }
        });

        // Обработка изменения размера
        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                chart.applyOptions({ width, height });
            }
        });
        resizeObserver.observe(chartCanvasContainer);

        console.log(`✅ Chart initialized for pair ${pairId}`);
        
        // Загружаем данные
        console.log(`📊 Loading chart data for pair ${pairId}, timeframe: ${currentTimeframe}`);
        loadChartData(pairId, currentTimeframe);
        
        // Запускаем обновление цен
        console.log(`💰 Starting price updates for pair ${pairId}`);
        startPriceUpdates(pairId);
        
    } catch (error) {
        console.error('Error initializing chart:', error);
    }
}

function updateCandleInfo(pairId, data) {
    const open = data.open.toFixed(5);
    const high = data.high.toFixed(5);
    const low = data.low.toFixed(5);
    const close = data.close.toFixed(5);
    const change = close - open;
    const changePercent = ((change / open) * 100).toFixed(2);
    const sign = change >= 0 ? '+' : '';
    
    const candleInfo = document.getElementById(`candleInfo-${pairId}`);
    if (candleInfo) {
        // Определяем цвет на основе изменения цены
        const color = change >= 0 ? '#22c55e' : '#ef4444'; // Зеленый для роста, красный для падения
        
        // Формируем HTML с окраской только цифр, буквы O H L C остаются обычного цвета
        const changeText = `${sign}${change.toFixed(4)}`;
        const percentText = `(${sign}${changePercent}%)`;
        
        // Окрашиваем только цифры, буквы O H L C остаются обычного цвета
        candleInfo.innerHTML = 
            `O<span style="color: ${color};">${open}</span> H<span style="color: ${color};">${high}</span> L<span style="color: ${color};">${low}</span> C<span style="color: ${color};">${close}</span> <span style="color: ${color};">${changeText}</span> <span style="color: ${color};">${percentText}</span>`;
        
        // Устанавливаем шрифт и размер ПОСЛЕ innerHTML (чтобы не сбрасывался при обновлении)
        // Используем !important через setProperty для гарантии применения
        candleInfo.style.setProperty('font-family', '-apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif', 'important');
        candleInfo.style.setProperty('font-size', '13px', 'important');
    }
    
    // Обновляем вкладку для отображения потенциального выигрыша в реальном времени
    if (typeof updateTabForRound === 'function') {
        updateTabForRound(pairId);
    }
}

async function loadChartData(pairId, timeframe) {
    const chartData = charts.get(pairId);
    if (!chartData || !chartData.candlestickSeries) {
        console.error('Chart not initialized for pair', pairId);
        return;
    }
    
    currentTimeframe = timeframe;
    
    try {
        const url = `${window.API_BASE}/chart-data/${pairId}?timeframe=${timeframe}&limit=100`;
        console.log(`📊 Fetching chart data from: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ Error fetching chart data: ${response.status} ${response.statusText}`);
            return;
        }
        
        const candles = await response.json();
        console.log(`📊 Received ${candles.length} candles for pair ${pairId}`);
        
        if (candles.length > 0) {
            console.log(`📊 First candle from server: time=${candles[0].time}, last candle: time=${candles[candles.length - 1].time}`);
        }
        
        // ВАЖНО: свечи из Binance приходят в UTC, нужно конвертировать в UTC-3
        const UTC_OFFSET_SECONDS = 3 * 3600; // 3 часа в секундах
        
        const formattedData = candles.map((candle) => {
            // Убеждаемся, что время - это число (Unix timestamp в секундах)
            let time = candle.time;
            if (typeof time !== 'number') {
                time = parseInt(time, 10);
            }
            if (isNaN(time)) {
                return null;
            }
            
            // Вычитаем 3 часа из времени свечи, чтобы конвертировать из UTC в UTC-3
            time = time - UTC_OFFSET_SECONDS;
            
            return {
                time: time,
                open: parseFloat(candle.open) || 0,
                high: parseFloat(candle.high) || 0,
                low: parseFloat(candle.low) || 0,
                close: parseFloat(candle.close) || 0,
            };
        }).filter(candle => candle !== null);
        
        if (formattedData.length > 0) {
            console.log(`📊 After conversion to UTC-3: first time=${formattedData[0].time}, last time=${formattedData[formattedData.length - 1].time}`);
        }
        
        // Валидация и фильтрация данных
        const validatedData = validateCandleData(formattedData);
        const sortedAndDeduped = sortAndDeduplicateCandles(validatedData);
        
        // Используем все свечи как есть (уже конвертированы в UTC-3)
        const dataToSet = sortedAndDeduped;
        
        console.log(`📊 Setting ${dataToSet.length} candles to chart for pair ${pairId}`);
        if (dataToSet.length > 0) {
            console.log(`📊 Last candle time in dataToSet: ${dataToSet[dataToSet.length - 1].time}`);
        }
        chartData.candlestickSeries.setData(dataToSet);
        chartDataCache.set(pairId, [...dataToSet]);
        
        // Устанавливаем lastCandleTime на время последней свечи
        if (dataToSet.length > 0) {
            const lastCandle = dataToSet[dataToSet.length - 1];
            if (typeof lastCandle.time === 'number') {
                lastCandleTime.set(pairId, lastCandle.time);
                currentCandleData.set(pairId, {...lastCandle});
                console.log(`📊 Set lastCandleTime to: ${lastCandle.time} for pair ${pairId}`);
            }
            
            // Центрируем график к середине данных после загрузки
            setTimeout(() => {
                try {
                    const timeScale = chartData.chart.timeScale();
                    if (timeScale) {
                        // Прокручиваем к середине данных (позиция 0.5 = 50%)
                        if (typeof timeScale.scrollToPosition === 'function') {
                            timeScale.scrollToPosition(0.5, false);
                            console.log(`📊 Centered chart to middle position for pair ${pairId}`);
                        } else if (typeof timeScale.scrollToTime === 'function') {
                            // Альтернативный способ: прокрутка к времени средней свечи
                            const middleIndex = Math.floor(dataToSet.length / 2);
                            const middleCandle = dataToSet[middleIndex];
                            if (middleCandle && typeof middleCandle.time === 'number') {
                                timeScale.scrollToTime(middleCandle.time);
                                console.log(`📊 Centered chart to middle candle time ${middleCandle.time} for pair ${pairId}`);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Could not center chart for pair ${pairId}:`, error);
                }
            }, 100); // Небольшая задержка для завершения рендеринга
        }
        
    } catch (error) {
        console.error('❌ Error loading chart data:', error);
    }
}

function validateCandleData(data) {
    return data.filter(candle => {
        if (!candle || typeof candle !== 'object') {
            return false;
        }
        const hasValidFields = 
            typeof candle.time === 'number' && !isNaN(candle.time) && 
            isFinite(candle.time) &&
            typeof candle.open === 'number' && !isNaN(candle.open) && 
            isFinite(candle.open) &&
            typeof candle.high === 'number' && !isNaN(candle.high) && 
            isFinite(candle.high) &&
            typeof candle.low === 'number' && !isNaN(candle.low) && 
            isFinite(candle.low) &&
            typeof candle.close === 'number' && !isNaN(candle.close) && 
            isFinite(candle.close);
        
        if (!hasValidFields) {
            console.warn('⚠️ Invalid candle data filtered out:', candle);
            return false;
        }
        return true;
    });
}

function sortAndDeduplicateCandles(data) {
    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }
    
    const sorted = [...data].sort((a, b) => a.time - b.time);
    const deduplicated = [];
    const seenTimes = new Map();
    
    for (const candle of sorted) {
        const existing = seenTimes.get(candle.time);
        if (existing) {
            const index = deduplicated.indexOf(existing);
            if (index !== -1) {
                deduplicated[index] = candle;
            }
        } else {
            deduplicated.push(candle);
            seenTimes.set(candle.time, candle);
        }
    }
    
    return deduplicated;
}

function startPriceUpdates(pairId) {
    // Останавливаем предыдущий интервал, если есть
    if (priceUpdateIntervals.has(pairId)) {
        clearInterval(priceUpdateIntervals.get(pairId));
    }
    
    const interval = setInterval(async () => {
        try {
            const url = `${window.API_BASE}/price/${pairId}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                console.error(`❌ Error fetching price: ${response.status} ${response.statusText}`);
                return;
            }
            
            const data = await response.json();
            console.log(`💰 Price update for pair ${pairId}:`, data);
            
            if (data && typeof data.price === 'number') {
                updateLastCandle(pairId, data.price);
            } else {
                console.warn(`⚠️ No valid price data received for pair ${pairId}:`, data);
            }
        } catch (error) {
            console.error('❌ Error fetching price:', error);
        }
    }, 2000);
    
    console.log(`💰 Price update interval started for pair ${pairId}`);
    
    priceUpdateIntervals.set(pairId, interval);
}

// Простая логика обновления свечи, как в примере Lightweight Charts:
// Обновление последней свечи по паттерну Lightweight Charts
// setData() вызывается один раз при загрузке, потом только update()
function updateLastCandle(pairId, price) {
    const chartData = charts.get(pairId);
    if (!chartData || !chartData.candlestickSeries) {
        console.warn(`⚠️ [updateLastCandle] Chart not found for pair ${pairId}`);
        return;
    }
    
    if (typeof price !== 'number' || isNaN(price)) {
        console.warn(`⚠️ [updateLastCandle] Invalid price for pair ${pairId}: ${price}`);
        return;
    }
    
    const timeframeSeconds = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
    };
    const interval = timeframeSeconds[currentTimeframe] || 60;
    
    // Получаем серверное время в UTC-3
    let nowSec = window.getServerTimeUTC ? window.getServerTimeUTC() : null;
    if (nowSec === null || nowSec === undefined) {
        const localNow = Math.floor(Date.now() / 1000);
        nowSec = localNow - (6 * 3600); // UTC+3 -> UTC-3
    }
    
    if (typeof nowSec !== 'number' || isNaN(nowSec)) {
        console.warn(`⚠️ [updateLastCandle] Invalid nowSec for pair ${pairId}: ${nowSec}`);
        return;
    }
    
    nowSec = Math.floor(nowSec);
    const candleTime = Math.floor(nowSec / interval) * interval;
    
    let cache = chartDataCache.get(pairId) || [];
    const last = cache.length > 0 ? cache[cache.length - 1] : null;
    
    // Функция для сравнения времени по часам и минутам (игнорируя секунды и часовой пояс)
    // Извлекаем часы и минуты из timestamp для сравнения
    const getTimeKey = (timestamp) => {
        const date = new Date(timestamp * 1000);
        // Используем UTC для консистентности (независимо от часового пояса)
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const hour = date.getUTCHours();
        const minute = date.getUTCMinutes();
        // Для 1m таймфрейма сравниваем по минутам
        if (interval === 60) {
            return `${year}-${month}-${day}-${hour}-${minute}`;
        }
        // Для других таймфреймов используем соответствующий интервал
        return Math.floor(timestamp / interval);
    };
    
    if (last) {
        const candleTimeKey = getTimeKey(candleTime);
        const lastTimeKey = getTimeKey(last.time);
        console.log(`🕯️ [updateLastCandle] DEBUG: nowSec=${nowSec}, candleTime=${candleTime} (key=${candleTimeKey}), last.time=${last.time} (key=${lastTimeKey}), cache.length=${cache.length}`);
    }
    
    // Если нет истории - создаем первую свечу
    if (!last) {
        const firstBar = {
            time: candleTime,
            open: price,
            high: price,
            low: price,
            close: price,
        };
        cache = [firstBar];
        chartDataCache.set(pairId, cache);
        chartData.candlestickSeries.setData(cache);
        lastCandleTime.set(pairId, candleTime);
        currentCandleData.set(pairId, {...firstBar});
        console.log(`🕯️ [updateLastCandle] Created first candle: time=${candleTime}, price=${price}`);
        return;
    }
    
    // Сравниваем по часам и минутам, а не по точным секундам
    // Нормализуем оба времени к UTC-3 для сравнения
    const UTC_OFFSET_SECONDS = 3 * 3600;
    let normalizedLastTime = last.time;
    // Если last.time больше candleTime на ~3 часа (10800 секунд), значит оно в UTC
    // Нормализуем к UTC-3 для сравнения
    if (last.time > candleTime && Math.abs(last.time - candleTime - UTC_OFFSET_SECONDS) < 300) {
        normalizedLastTime = last.time - UTC_OFFSET_SECONDS;
    }
    
    const candleTimeKey = getTimeKey(candleTime);
    const lastTimeKey = getTimeKey(normalizedLastTime);
    
    // Если разница меньше интервала - считаем это одной свечой (учет расхождений в секундах)
    const isSameTime = candleTimeKey === lastTimeKey;
    const timeDiff = Math.abs(candleTime - normalizedLastTime);
    
    // Логирование для отладки
    if (last) {
        console.log(`🕯️ [updateLastCandle] Keys comparison: candleTimeKey="${candleTimeKey}", lastTimeKey="${lastTimeKey}", isSameTime=${isSameTime}, candleTimeKey > lastTimeKey=${candleTimeKey > lastTimeKey}, candleTime=${candleTime}, normalizedLastTime=${normalizedLastTime}, timeDiff=${timeDiff}`);
    }
    
    // Если новая свеча (время больше последнего)
    // Используем числовое сравнение нормализованного времени
    if (candleTime > normalizedLastTime) {
        // Используем время последней свечи из графика для новой свечи
        // Если в графике последняя свеча имеет время больше candleTime, используем его + интервал
        const currentCandle = currentCandleData.get(pairId);
        let newCandleTime = candleTime;
        
        if (currentCandle && typeof currentCandle.time === 'number' && !isNaN(currentCandle.time)) {
            // Если время последней свечи в графике больше candleTime, используем его + интервал
            if (currentCandle.time > candleTime) {
                newCandleTime = currentCandle.time + interval;
            }
        } else if (last.time > candleTime) {
            // Если last.time больше candleTime, используем его + интервал
            newCandleTime = last.time + interval;
        }
        
        // createCandle - создаем новую свечу (как в примере)
        const newBar = {
            time: newCandleTime,
            open: price,
            high: price,
            low: price,
            close: price,
        };
        
        cache.push(newBar);
        
        // Ограничиваем размер кэша
        const maxCacheSize = 2000;
        if (cache.length > maxCacheSize) {
            cache = cache.slice(-maxCacheSize);
        }
        chartDataCache.set(pairId, cache);
        
        // Используем update для новой свечи (как в примере)
        chartData.candlestickSeries.update(newBar);
        lastCandleTime.set(pairId, newCandleTime);
        currentCandleData.set(pairId, {...newBar});
        console.log(`🕯️ [updateLastCandle] NEW CANDLE: time=${newCandleTime}, candleTime=${candleTime}, last.time=${last.time}, normalizedLastTime=${normalizedLastTime}, price=${price}`);
        
        // Обновляем вкладку для отображения потенциального выигрыша в реальном времени
        if (typeof updateTabForRound === 'function') {
            updateTabForRound(pairId);
        }
        return;
    }
    
    // Если та же свеча (время меньше или равно последнему) - обновляем её
    if (candleTime <= normalizedLastTime) {
        // updateCandle - обновляем существующую свечу (как в примере)
        if (!last || typeof last.time !== 'number' || isNaN(last.time)) {
            console.error(`❌ [updateLastCandle] Invalid last candle:`, last);
            return;
        }
        
        // Используем время из currentCandleData, которое соответствует последней свече в графике
        const currentCandle = currentCandleData.get(pairId);
        const updateTime = currentCandle && typeof currentCandle.time === 'number' && !isNaN(currentCandle.time) 
            ? currentCandle.time 
            : last.time;
        
        const updatedBar = {
            time: updateTime, // Используем время последней свечи из графика
            open: last.open,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
            close: price,
        };
        
        // Обновляем последнюю свечу в кэше
        cache[cache.length - 1] = updatedBar;
        chartDataCache.set(pairId, cache);
        
        // Плавная анимация изменения свечи
        animateCandleUpdate(pairId, chartData, last, updatedBar, updateTime);
        
        lastCandleTime.set(pairId, updateTime);
        currentCandleData.set(pairId, {...updatedBar});
        console.log(`🕯️ [updateLastCandle] UPDATED: time=${updateTime}, price=${price}, high=${updatedBar.high}, low=${updatedBar.low}`);
        
        // Обновляем вкладку для отображения потенциального выигрыша в реальном времени
        if (typeof updateTabForRound === 'function') {
            updateTabForRound(pairId);
        }
        return;
    }
    
    // Если время откатилось назад - игнорируем
    console.warn(`⚠️ [updateLastCandle] Time went backwards: candleTime=${candleTime} (key=${candleTimeKey}), last.time=${last.time} (key=${lastTimeKey}), diff=${timeDiff}`);
}

function animateCandleUpdate(pairId, chartData, lastCandle, targetBar, updateTime) {
    // Останавливаем предыдущую анимацию для этой пары
    if (candleAnimations.has(pairId)) {
        const anim = candleAnimations.get(pairId);
        if (anim.frameId) {
            cancelAnimationFrame(anim.frameId);
        }
    }
    
    const startPrice = lastCandle.close;
    const targetPrice = targetBar.close;
    const startHigh = lastCandle.high;
    const startLow = lastCandle.low;
    const targetHigh = targetBar.high;
    const targetLow = targetBar.low;
    
    // Если цена не изменилась, просто обновляем без анимации
    if (Math.abs(startPrice - targetPrice) < 0.01) {
        chartData.candlestickSeries.update(targetBar);
        return;
    }
    
    const startTime = performance.now();
    const duration = 300; // 300ms для плавной анимации
    
    const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Используем easing функцию для плавности
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        
        // Интерполируем значения
        const currentPrice = startPrice + (targetPrice - startPrice) * easeOutCubic;
        const currentHigh = startHigh + (targetHigh - startHigh) * easeOutCubic;
        const currentLow = startLow + (targetLow - startLow) * easeOutCubic;
        
        // Создаем промежуточную свечу
        const animatedBar = {
            time: updateTime,
            open: lastCandle.open,
            high: Math.max(currentHigh, currentPrice),
            low: Math.min(currentLow, currentPrice),
            close: currentPrice,
        };
        
        // Обновляем график
        chartData.candlestickSeries.update(animatedBar);
        
        if (progress < 1) {
            const frameId = requestAnimationFrame(animate);
            candleAnimations.set(pairId, { frameId, targetPrice, startPrice, startTime });
        } else {
            // Анимация завершена, устанавливаем финальные значения
            chartData.candlestickSeries.update(targetBar);
            candleAnimations.delete(pairId);
        }
    };
    
    const frameId = requestAnimationFrame(animate);
    candleAnimations.set(pairId, { frameId, targetPrice, startPrice, startTime });
}

function updateChart(pairId, timeframe) {
    currentPairId = pairId;
    currentTimeframe = timeframe;
    lastCandleTime.set(pairId, null);
    currentCandleData.set(pairId, null);
    
    // Останавливаем анимацию при смене графика
    if (candleAnimations.has(pairId)) {
        const anim = candleAnimations.get(pairId);
        if (anim.frameId) {
            cancelAnimationFrame(anim.frameId);
        }
        candleAnimations.delete(pairId);
    }
    
    loadChartData(pairId, timeframe);
}

// Функция для рисования линии ордера
// amount - сумма, на которую покупаем (для отображения в прямоугольнике)
function drawOrderLine(pairId, price, orderId, side = 'BUY', orderTime = null, endTime = null, amount = null) {
    const chartData = charts.get(pairId);
    // Для Lightweight Charts прайсовые линии создаются на серии, а не на всём графике
    if (!chartData || !chartData.candlestickSeries) {
        return;
    }
    
    if (!price || price === 0 || isNaN(price)) {
        return;
    }
    
    const lineTime = orderTime || Math.floor(Date.now() / 1000);
    const isBuy = side === 'BUY';
    const lineColor = isBuy ? '#22c55e' : '#ef4444';
    
    // Создаем горизонтальную линию на серии свечей
    const line = chartData.candlestickSeries.createPriceLine({
        price: price,
        color: lineColor,
        lineWidth: 1, // в 2 раза тоньше, чем было
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: false, // Убираем метку цены на оси
        // Без текста BUY/SELL на оси
        title: '',
    });
    
    // HTML-прямоугольник с таймером и суммой, как на скрине
    const containerEl = chartData.chartCanvasContainer || chartData.container;
    if (containerEl) {
        // Удаляем старый прямоугольник/таймер для этого ордера, если есть
        if (!chartData.orderLines) {
            chartData.orderLines = new Map();
        }
        const existing = chartData.orderLines.get(orderId);
        if (existing) {
            if (existing.labelEl && existing.labelEl.parentNode) {
                existing.labelEl.parentNode.removeChild(existing.labelEl);
            }
            if (existing.intervalId) {
                clearInterval(existing.intervalId);
            }
        }
        
        const labelEl = document.createElement('div');
        labelEl.className = 'lc-order-label';
        labelEl.style.position = 'absolute';
        // Прямоугольник со смещением на 30px в другую сторону от правого края графика
        labelEl.style.right = '100px';
        labelEl.style.transform = 'translateY(-50%)';
        labelEl.style.display = 'flex';
        // Базовый шрифт Arial
        labelEl.style.fontFamily = "Arial, Helvetica, sans-serif";
        labelEl.style.fontSize = '10px';
        // Остроугольный прямоугольник
        labelEl.style.borderRadius = '0px';
        labelEl.style.overflow = 'hidden';
        labelEl.style.zIndex = '3';
        
        // Блок времени
        const timeEl = document.createElement('div');
        timeEl.className = 'lc-order-label-time';
        timeEl.style.padding = '2px 6px';
        timeEl.style.backgroundColor = '#ffffff';
        timeEl.style.color = isBuy ? '#22c55e' : '#ef4444';
        timeEl.style.fontWeight = '600';
        timeEl.style.fontFamily = "Arial, Helvetica, sans-serif";
        timeEl.style.fontSize = '10px';
        timeEl.textContent = '00:00';
        
        // Блок суммы: показываем сумму сделки, а не цену входа
        const amountEl = document.createElement('div');
        amountEl.className = 'lc-order-label-amount';
        amountEl.style.padding = '2px 8px';
        amountEl.style.backgroundColor = isBuy ? '#22c55e' : '#ef4444';
        amountEl.style.color = '#ffffff';
        amountEl.style.fontWeight = '600';
        amountEl.style.fontFamily = "Arial, Helvetica, sans-serif";
        amountEl.style.fontSize = '10px';
        const displayAmount = (amount != null && !isNaN(amount)) ? amount : price;
        amountEl.textContent = `R$ ${displayAmount.toFixed(2)}`;
        
        labelEl.appendChild(timeEl);
        labelEl.appendChild(amountEl);
        containerEl.appendChild(labelEl);
        
        // Позиционируем по цене - используем те же координаты, что и линия
        // Линия создается через createPriceLine и автоматически следует за ценой при масштабировании
        // Прямоугольник должен использовать priceToCoordinate для синхронизации с линией
        const positionLabel = () => {
            if (!chartData.candlestickSeries || !labelEl.parentNode || !line) return;
            // Используем ту же цену, что и линия, для получения координат
            const y = chartData.candlestickSeries.priceToCoordinate(price);
            if (y == null || isNaN(y)) return;
            // Прямоугольник привязан к той же Y-координате, что и линия
            labelEl.style.top = `${y}px`;
        };
        positionLabel();
        
        // Обновляем позицию при возможных изменениях масштаба
        // Используем requestAnimationFrame для плавного обновления, синхронизированного с линией
        if (chartData.chart) {
            // Подписка на изменение видимого диапазона времени
            if (chartData.chart.timeScale) {
                const ts = chartData.chart.timeScale();
                if (ts && typeof ts.subscribeVisibleTimeRangeChange === 'function') {
                    ts.subscribeVisibleTimeRangeChange(() => {
                        requestAnimationFrame(() => {
                            positionLabel();
                        });
                    });
                }
            }

            // Подписка на изменение масштаба цены - это ключевое событие для синхронизации с линией
            if (typeof chartData.chart.priceScale === 'function') {
                const rightScale = chartData.chart.priceScale('right');
                if (rightScale && typeof rightScale.subscribePriceScaleChange === 'function') {
                    rightScale.subscribePriceScaleChange(() => {
                        // Используем requestAnimationFrame для синхронизации с рендерингом линии
                        requestAnimationFrame(() => {
                            positionLabel();
                        });
                    });
                }
            }
            
            // Подписка на движение курсора для постоянного обновления позиции
            if (typeof chartData.chart.subscribeCrosshairMove === 'function') {
                chartData.chart.subscribeCrosshairMove(() => {
                    // Используем requestAnimationFrame для плавного обновления
                    requestAnimationFrame(() => {
                        positionLabel();
                    });
                });
            }
            
            // Подписка на изменение размера графика
            if (containerEl) {
                // Используем ResizeObserver для отслеживания изменения размера контейнера
                if (typeof ResizeObserver !== 'undefined') {
                    const resizeObserver = new ResizeObserver(() => {
                        requestAnimationFrame(() => {
                            positionLabel();
                        });
                    });
                    resizeObserver.observe(containerEl);
                    
                    // Сохраняем observer для последующей очистки
                    if (!chartData.resizeObservers) {
                        chartData.resizeObservers = new Map();
                    }
                    chartData.resizeObservers.set(orderId, resizeObserver);
                } else {
                    // Fallback на window resize для старых браузеров
                    const handleResize = () => {
                        requestAnimationFrame(() => {
                            positionLabel();
                        });
                    };
                    window.addEventListener('resize', handleResize);
                    
                    // Сохраняем обработчик для последующей очистки
                    if (!chartData.resizeHandlers) {
                        chartData.resizeHandlers = new Map();
                    }
                    chartData.resizeHandlers.set(orderId, handleResize);
                }
            }
        }
        
        // Инициализируем таймер с начальным значением
        // Обновление будет происходить через updateOrderCountdown из startRoundTimer
        let currentCountdown = endTime; // endTime теперь содержит countdownSeconds
        
        // Цвет определяется направлением ордера (BUY - зеленый, SELL - красный)
        const orderColor = isBuy ? '#22c55e' : '#ef4444';
        
        if (currentCountdown && currentCountdown > 0) {
            // Устанавливаем начальное значение таймера
            const mm = String(Math.floor(currentCountdown / 60)).padStart(2, '0');
            const ss = String(currentCountdown % 60).padStart(2, '0');
            timeEl.textContent = `${mm}:${ss}`;
            
            // Устанавливаем цвет на основе направления ордера (статичный, не меняется)
            const amountEl = labelEl.querySelector('.lc-order-label-amount');
            if (amountEl) {
                amountEl.style.backgroundColor = orderColor;
            }
            timeEl.style.color = orderColor;
        }
        
        // Сохраняем линию и DOM-элемент (всегда используем строку для orderId для консистентности)
        const orderIdStr = String(orderId);
        chartData.orderLines.set(orderIdStr, { 
            line, 
            price, 
            side, 
            countdown: currentCountdown, 
            labelEl
        });
    } else {
        if (!chartData.orderLines) {
            chartData.orderLines = new Map();
        }
        // Всегда используем строку для orderId
        const orderIdStr = String(orderId);
        chartData.orderLines.set(orderIdStr, { line, price, side, endTime });
    }
    
    console.log(`✅ Order line drawn for order ${orderId} at price ${price}`);
}

// Функция для обновления цвета линии ордера (не используется, цвет статичный)
// Оставлена для обратной совместимости, но не меняет цвет
function updateOrderLineColor(pairId, orderId, remainingSeconds) {
    // Цвет определяется направлением ордера при создании и не меняется
    // BUY - зеленый (#22c55e), SELL - красный (#ef4444)
    // Эта функция больше не меняет цвет, оставлена для совместимости
    return;
}

// Функция для обновления обратного отсчета в прямоугольнике ордера
function updateOrderCountdown(pairId, orderId, remainingSeconds) {
    const chartData = charts.get(pairId);
    if (!chartData || !chartData.orderLines) {
        return;
    }
    
    const orderIdStr = String(orderId);
    const orderLine = chartData.orderLines.get(orderIdStr);
    
    if (!orderLine || !orderLine.labelEl) {
        return;
    }
    
    const timeEl = orderLine.labelEl.querySelector('.lc-order-label-time');
    if (!timeEl) {
        return;
    }
    
    // Обновляем только время, цвет не меняем (остается статичным)
    const mm = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const ss = String(remainingSeconds % 60).padStart(2, '0');
    timeEl.textContent = `${mm}:${ss}`;
    
    // Цвет остается прежним - определяется направлением ордера (BUY - зеленый, SELL - красный)
    // Не меняем цвет прямоугольника и линии
}

// Функция для удаления линии ордера
function removeOrderLine(pairId, orderId) {
    console.log(`🗑️ [removeOrderLine] Called for pair ${pairId}, orderId=${orderId} (type: ${typeof orderId})`);
    
    const chartData = charts.get(pairId);
    if (!chartData) {
        console.warn(`⚠️ [removeOrderLine] Chart data not found for pair ${pairId}`);
        return;
    }
    
    if (!chartData.orderLines) {
        console.warn(`⚠️ [removeOrderLine] Order lines map not found for pair ${pairId}`);
        return;
    }
    
    // Всегда пробуем сначала строковый формат (так как мы сохраняем как строку)
    const orderIdStr = String(orderId);
    let orderLine = chartData.orderLines.get(orderIdStr);
    
    // Если не найдено, пробуем другие форматы (для обратной совместимости)
    if (!orderLine) {
        if (typeof orderId === 'number') {
            orderLine = chartData.orderLines.get(orderId);
        }
        const numericId = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
        if (!orderLine && !isNaN(numericId) && numericId !== orderId) {
            orderLine = chartData.orderLines.get(numericId);
        }
    }
    
    if (orderLine) {
        if (orderLine.line && chartData.candlestickSeries) {
            chartData.candlestickSeries.removePriceLine(orderLine.line);
            console.log(`✅ [removeOrderLine] Price line removed`);
        }
        if (orderLine.labelEl && orderLine.labelEl.parentNode) {
            orderLine.labelEl.parentNode.removeChild(orderLine.labelEl);
            console.log(`✅ [removeOrderLine] Label element removed`);
        }
        if (orderLine.intervalId) {
            clearInterval(orderLine.intervalId);
            console.log(`✅ [removeOrderLine] Interval cleared`);
        }
        
        // Очищаем ResizeObserver, если он был создан
        if (chartData.resizeObservers) {
            const resizeObserver = chartData.resizeObservers.get(orderIdStr);
            if (resizeObserver) {
                resizeObserver.disconnect();
                chartData.resizeObservers.delete(orderIdStr);
                console.log(`✅ [removeOrderLine] ResizeObserver disconnected`);
            }
        }
        
        // Очищаем обработчики resize, если они были созданы
        if (chartData.resizeHandlers) {
            const resizeHandler = chartData.resizeHandlers.get(orderIdStr);
            if (resizeHandler) {
                window.removeEventListener('resize', resizeHandler);
                chartData.resizeHandlers.delete(orderIdStr);
                console.log(`✅ [removeOrderLine] Resize handler removed`);
            }
        }
        
        // Удаляем по всем возможным ключам (строка и число)
        chartData.orderLines.delete(orderIdStr);
        if (typeof orderId === 'number') {
            chartData.orderLines.delete(orderId);
        } else {
            const numericId = parseInt(orderId, 10);
            if (!isNaN(numericId)) {
                chartData.orderLines.delete(numericId);
            }
        }
        console.log(`✅ [removeOrderLine] Order line removed for order ${orderId}`);
    } else {
        console.warn(`⚠️ [removeOrderLine] Order line not found for orderId=${orderId}. Available keys:`, Array.from(chartData.orderLines.keys()));
    }
}

function getCurrentPrice(pairId) {
    const candleData = currentCandleData.get(pairId);
    if (candleData && typeof candleData.close === 'number' && !isNaN(candleData.close)) {
        return candleData.close;
    }
    return null;
}

// Экспорт функций
window.chartModule = {
    initChart,
    updateChart,
    loadChartData,
    updateLastCandle,
    drawOrderLine,
    removeOrderLine,
    updateOrderLineColor,
    updateOrderCountdown,
    getCurrentPrice,
    getCurrentPairId: () => currentPairId,
    getCurrentTimeframe: () => currentTimeframe,
    getChart: (pairId) => {
        const chartData = charts.get(pairId);
        return chartData ? chartData.chart : null;
    },
};
