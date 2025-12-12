// Lightweight Charts модуль
// Полная замена TradingView на open source lightweight-charts

// API_BASE объявлен в datafeed.js как window.API_BASE
if (!window.API_BASE) {
    window.API_BASE = window.location.origin + '/api';
}

let charts = new Map(); // pairId -> { chart, candlestickSeries, container, orderLines }
let currentPairId = 1;
let currentTimeframe = '1m';

// Хранилище для данных свечей
let chartDataCache = new Map(); // pairId -> [candles]
let lastCandleTime = new Map(); // pairId -> timestamp
let currentCandleData = new Map(); // pairId -> candle data
let priceUpdateIntervals = new Map(); // pairId -> intervalId

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
        
        // Функция для создания разделителя
        function createSeparator() {
            const separatorWrap = document.createElement('div');
            separatorWrap.className = 'separatorWrap-MBOVGQRI';
            const separator = document.createElement('div');
            separator.className = 'separator-xVhBjD5m separator-MBOVGQRI';
            separatorWrap.appendChild(separator);
            return separatorWrap;
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
        
        // Разделитель
        innerWrap.appendChild(createSeparator());
        
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
        
        // Разделитель
        innerWrap.appendChild(createSeparator());
        
        // Группа 3: Индикаторы
        const indicatorsGroup = createGroup();
        const indicatorsWrap = document.createElement('div');
        indicatorsWrap.className = 'wrap-n5bmFxyX';
        indicatorsWrap.id = 'header-toolbar-indicators';
        const indicatorsButton = document.createElement('button');
        indicatorsButton.type = 'button';
        indicatorsButton.className = 'button-OhqNVIYA button-ptpAHg8E withText-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S';
        indicatorsButton.setAttribute('data-name', 'open-indicators-dialog');
        indicatorsButton.setAttribute('data-tooltip', 'Indicators & Strategies');
        indicatorsButton.setAttribute('aria-label', 'Indicators & Strategies');
        indicatorsButton.setAttribute('tabindex', '-1');
        const indicatorsBg = document.createElement('div');
        indicatorsBg.className = 'bg-KTgbfaP5';
        indicatorsBg.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 6px;';
        const indicatorsIcon = document.createElement('span');
        indicatorsIcon.className = 'icon-KTgbfaP5';
        indicatorsIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none"><path stroke="currentColor" d="M20 17l-5 5M15 17l5 5M9 11.5h7M17.5 8a2.5 2.5 0 0 0-5 0v11a2.5 2.5 0 0 1-5 0"></path></svg>';
        const indicatorsText = document.createElement('div');
        indicatorsText.className = 'js-button-text text-GwQQdU8S';
        indicatorsText.textContent = 'Indicators';
        indicatorsBg.appendChild(indicatorsIcon);
        indicatorsBg.appendChild(indicatorsText);
        indicatorsButton.appendChild(indicatorsBg);
        indicatorsWrap.appendChild(indicatorsButton);
        indicatorsGroup.appendChild(indicatorsWrap);
        innerWrap.appendChild(indicatorsGroup);
        
        // Разделитель
        innerWrap.appendChild(createSeparator());
        
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
        
        // Разделитель
        innerWrap.appendChild(createSeparator());
        
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
        height: 50px;
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
            console.warn('Chart container has zero dimensions, waiting for layout...');
            setTimeout(() => initChart(pairId, containerElement), 100);
            return;
        }
        
        // Создаем график
        const chart = LightweightCharts.createChart(chartCanvasContainer, {
            layout: {
                background: { color: '#000000' },
                textColor: '#8b8fa3',
            },
            grid: {
                vertLines: { color: '#1e2330' },
                horzLines: { color: '#1e2330' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: {
                    color: '#393b3f',
                    width: 1,
                    style: LightweightCharts.LineStyle.Solid,
                },
                horzLine: {
                    color: '#393b3f',
                    width: 1,
                    style: LightweightCharts.LineStyle.Solid,
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
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
        });
        } else if (typeof chart.addSeries === 'function' && LightweightCharts.CandlestickSeries) {
            // Версия 5.x+
            candlestickSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
                upColor: '#22c55e',
                downColor: '#ef4444',
                borderVisible: false,
                wickUpColor: '#22c55e',
                wickDownColor: '#ef4444',
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
        loadChartData(pairId, currentTimeframe);
        
        // Запускаем обновление цен
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
        candleInfo.textContent = 
        `O${open} H${high} L${low} C${close} ${sign}${change.toFixed(4)} (${sign}${changePercent}%)`;
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
        const response = await fetch(`${window.API_BASE}/chart-data/${pairId}?timeframe=${timeframe}&limit=100`);
        const candles = await response.json();
        
        const formattedData = candles.map(candle => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        }));
        
        // Валидация и фильтрация данных
        const validatedData = validateCandleData(formattedData);
        const sortedAndDeduped = sortAndDeduplicateCandles(validatedData);
        
        // Удаляем последнюю свечу, если она в будущем
        let dataToSet = sortedAndDeduped;
        if (dataToSet.length > 0) {
            const now = window.getServerTimeUTC ? window.getServerTimeUTC() : Math.floor(Date.now() / 1000);
        const timeframeSeconds = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1h': 3600
        };
            const interval = timeframeSeconds[timeframe] || 60;
        const currentCandleTime = Math.floor(now / interval) * interval;
            const lastCandle = dataToSet[dataToSet.length - 1];
            if (lastCandle.time > currentCandleTime) {
                dataToSet = dataToSet.slice(0, -1);
            }
        }
        
        chartData.candlestickSeries.setData(dataToSet);
        chartDataCache.set(pairId, [...dataToSet]);
        
    } catch (error) {
        console.error('Error loading chart data:', error);
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
            const response = await fetch(`${window.API_BASE}/price/${pairId}`);
            const data = await response.json();
            
            if (data && data.price) {
                updateLastCandle(pairId, data.price, data.timestamp);
            }
        } catch (error) {
            console.error('Error fetching price:', error);
        }
    }, 2000);
    
    priceUpdateIntervals.set(pairId, interval);
}

function updateLastCandle(pairId, price, timestamp) {
    const chartData = charts.get(pairId);
    if (!chartData || !chartData.candlestickSeries) {
        return;
    }
    
    if (typeof price !== 'number' || isNaN(price)) {
        return;
    }
    
    const now = timestamp ? Math.floor(timestamp) : (window.getServerTimeUTC ? window.getServerTimeUTC() : Math.floor(Date.now() / 1000));
    const timeframeSeconds = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600
    };
    const interval = timeframeSeconds[currentTimeframe] || 60;
    const currentCandleTime = Math.floor(now / interval) * interval;
    
    const lastTime = lastCandleTime.get(pairId);
    const currentData = currentCandleData.get(pairId);
    
    if (lastTime === null || lastTime === undefined || lastTime < currentCandleTime) {
        // Новая свеча
        lastCandleTime.set(pairId, currentCandleTime);
        const newCandle = {
            time: currentCandleTime,
            open: price,
            high: price,
            low: price,
            close: price
        };
        currentCandleData.set(pairId, newCandle);
        
        // Обновляем кэш
        const cache = chartDataCache.get(pairId) || [];
        const existingIndex = cache.findIndex(c => c.time === currentCandleTime);
        if (existingIndex !== -1) {
            cache[existingIndex] = {...newCandle};
        } else {
            cache.push({...newCandle});
        }
        
        const validated = validateCandleData(cache);
        const sorted = sortAndDeduplicateCandles(validated);
        chartData.candlestickSeries.setData(sorted);
        chartDataCache.set(pairId, sorted);
        
    } else if (lastTime === currentCandleTime) {
        // Обновляем существующую свечу
        if (!currentData) {
            currentCandleData.set(pairId, {
                time: currentCandleTime,
                open: price,
                high: price,
                low: price,
                close: price
            });
        } else {
            currentData.high = Math.max(currentData.high, price);
            currentData.low = Math.min(currentData.low, price);
            currentData.close = price;
        }
        
        chartData.candlestickSeries.update(currentCandleData.get(pairId));
        
                // Обновляем кэш
        const cache = chartDataCache.get(pairId) || [];
        const lastIndex = cache.length - 1;
        if (lastIndex >= 0 && cache[lastIndex].time === currentCandleTime) {
            cache[lastIndex] = {...currentCandleData.get(pairId)};
        }
    }
}

function updateChart(pairId, timeframe) {
    currentPairId = pairId;
    currentTimeframe = timeframe;
    lastCandleTime.set(pairId, null);
    currentCandleData.set(pairId, null);
    
    loadChartData(pairId, timeframe);
}

// Функция для рисования линии ордера
function drawOrderLine(pairId, price, orderId, side = 'BUY', orderTime = null, endTime = null) {
    const chartData = charts.get(pairId);
    if (!chartData || !chartData.chart) {
        return;
    }
    
    if (!price || price === 0 || isNaN(price)) {
        return;
    }
    
    const lineTime = orderTime || Math.floor(Date.now() / 1000);
    const lineColor = side === 'BUY' ? '#22c55e' : '#ef4444';
    
    // Создаем горизонтальную линию
    const line = chartData.chart.addPriceLine({
        price: price,
        color: lineColor,
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: `${side} ${price.toFixed(2)}`,
    });
    
    // Сохраняем линию
    if (!chartData.orderLines) {
        chartData.orderLines = new Map();
    }
    chartData.orderLines.set(orderId, { line, price, side, endTime });
    
    console.log(`✅ Order line drawn for order ${orderId} at price ${price}`);
}

// Функция для удаления линии ордера
function removeOrderLine(pairId, orderId) {
    const chartData = charts.get(pairId);
    if (!chartData || !chartData.orderLines) {
        return;
    }
    
    const orderLine = chartData.orderLines.get(orderId);
    if (orderLine && orderLine.line) {
        chartData.chart.removePriceLine(orderLine.line);
        chartData.orderLines.delete(orderId);
        console.log(`✅ Order line removed for order ${orderId}`);
    }
}

// Экспорт функций
window.chartModule = {
    initChart,
    updateChart,
    loadChartData,
    updateLastCandle,
    drawOrderLine,
    removeOrderLine,
    getCurrentPairId: () => currentPairId,
    getCurrentTimeframe: () => currentTimeframe,
    getChart: (pairId) => {
        const chartData = charts.get(pairId);
        return chartData ? chartData.chart : null;
    },
};
