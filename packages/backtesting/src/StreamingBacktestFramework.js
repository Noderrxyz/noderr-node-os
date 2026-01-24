"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingBacktestingFramework = exports.StreamingPortfolio = exports.StreamingStrategy = void 0;
const events_1 = require("events");
const worker_threads_1 = require("worker_threads");
class StreamingStrategy {
}
exports.StreamingStrategy = StreamingStrategy;
class StreamingPortfolio {
    cash;
    positions = new Map();
    pendingOrders = new Map();
    equity;
    highWaterMark;
    constructor(initialCapital) {
        this.cash = initialCapital;
        this.equity = initialCapital;
        this.highWaterMark = initialCapital;
    }
    async getCash() {
        return this.cash;
    }
    async getEquity() {
        return this.equity;
    }
    async getPosition(symbol) {
        return this.positions.get(symbol);
    }
    async getAllPositions() {
        return Array.from(this.positions.values());
    }
    async updatePosition(symbol, quantity, price, fees, slippage) {
        const existing = this.positions.get(symbol);
        if (existing) {
            const newQuantity = existing.quantity + quantity;
            if (Math.abs(newQuantity) < 0.0001) {
                this.positions.delete(symbol);
            }
            else {
                const totalCost = (existing.quantity * existing.avgPrice) + (quantity * price);
                existing.quantity = newQuantity;
                existing.avgPrice = Math.abs(newQuantity) > 0 ? totalCost / newQuantity : 0;
                existing.totalFees += fees;
                existing.totalSlippage += slippage;
            }
        }
        else if (Math.abs(quantity) > 0.0001) {
            this.positions.set(symbol, {
                symbol,
                quantity,
                avgPrice: price,
                unrealizedPnl: 0,
                totalFees: fees,
                totalSlippage: slippage
            });
        }
        this.cash -= (quantity * price + fees);
    }
    async updateEquity(marketPrices) {
        let totalValue = this.cash;
        for (const [symbol, position] of this.positions) {
            const marketPrice = marketPrices.get(symbol) || position.avgPrice;
            position.unrealizedPnl = (marketPrice - position.avgPrice) * position.quantity;
            totalValue += position.quantity * marketPrice;
        }
        this.equity = totalValue;
        this.highWaterMark = Math.max(this.highWaterMark, this.equity);
    }
    getDrawdown() {
        return this.highWaterMark > 0 ? (this.highWaterMark - this.equity) / this.highWaterMark : 0;
    }
}
exports.StreamingPortfolio = StreamingPortfolio;
class StreamingBacktestingFramework extends events_1.EventEmitter {
    logger;
    config;
    strategy;
    portfolio;
    workers = [];
    metricsWorker;
    constructor(logger) {
        super();
        this.logger = logger;
    }
    async runBacktest(config, strategy) {
        this.config = config;
        this.strategy = strategy;
        this.portfolio = new StreamingPortfolio(config.initialCapital);
        this.logger.info('Starting streaming backtest', {
            strategy: strategy.name,
            startDate: config.startDate,
            endDate: config.endDate,
            symbols: config.symbols,
            workers: config.parallelWorkers
        });
        // Initialize workers
        await this.initializeWorkers();
        // Initialize strategy
        if (strategy.onInit) {
            await strategy.onInit(config);
        }
        // Create result streams
        const tradeStream = this.createTradeStream();
        const equityStream = this.createEquityStream();
        const finalMetrics = this.processFinalMetrics();
        // Start simulation
        this.simulate().catch(err => {
            this.logger.error('Simulation error', err);
            this.emit('error', err);
        });
        return {
            config,
            performance: await this.getInitialPerformance(),
            trades: tradeStream,
            equityCurve: equityStream,
            finalMetrics
        };
    }
    async initializeWorkers() {
        // Create worker pool for parallel processing
        for (let i = 0; i < this.config.parallelWorkers; i++) {
            const worker = new worker_threads_1.Worker('./workers/backtest-worker.js', {
                workerData: {
                    workerId: i,
                    config: this.config
                }
            });
            worker.on('error', err => {
                this.logger.error(`Worker ${i} error`, err);
            });
            worker.on('message', msg => {
                this.handleWorkerMessage(i, msg);
            });
            this.workers.push(worker);
        }
        // Create dedicated metrics worker
        this.metricsWorker = new worker_threads_1.Worker('./workers/metrics-worker.js');
    }
    async simulate() {
        const dataStreams = new Map();
        // Create data streams for each symbol
        for (const symbol of this.config.symbols) {
            const stream = this.config.dataSource.createStream(symbol, this.config.startDate, this.config.endDate);
            dataStreams.set(symbol, stream);
        }
        // Process data in parallel chunks
        const chunkPromises = [];
        for (const [symbol, stream] of dataStreams) {
            const promise = this.processSymbolStream(symbol, stream);
            chunkPromises.push(promise);
        }
        // Wait for all streams to complete
        await Promise.all(chunkPromises);
        // Finalize strategy
        if (this.strategy.onEnd) {
            await this.strategy.onEnd();
        }
        // Cleanup workers
        await this.cleanupWorkers();
        this.emit('complete');
    }
    async processSymbolStream(symbol, stream) {
        const chunks = [];
        for await (const bar of stream) {
            chunks.push(bar);
            if (chunks.length >= this.config.chunkSize) {
                await this.processChunk(chunks);
                chunks.length = 0;
            }
            // Emit progress
            this.emit('progress', {
                symbol,
                timestamp: bar.timestamp,
                processed: true
            });
        }
        // Process remaining data
        if (chunks.length > 0) {
            await this.processChunk(chunks);
        }
    }
    async processChunk(chunk) {
        // Group by timestamp for synchronized processing
        const timeGroups = new Map();
        for (const bar of chunk) {
            const time = bar.timestamp.getTime();
            if (!timeGroups.has(time)) {
                timeGroups.set(time, []);
            }
            timeGroups.get(time).push(bar);
        }
        // Process each time group
        for (const [timestamp, bars] of timeGroups) {
            await this.processTimeSlice(new Date(timestamp), bars);
        }
    }
    async processTimeSlice(timestamp, bars) {
        // Update market prices
        const marketPrices = new Map();
        for (const bar of bars) {
            marketPrices.set(bar.symbol, bar.close);
        }
        // Update portfolio equity
        await this.portfolio.updateEquity(marketPrices);
        // Record equity point
        const equityPoint = {
            timestamp,
            equity: await this.portfolio.getEquity(),
            drawdown: this.portfolio.getDrawdown(),
            openPositions: (await this.portfolio.getAllPositions()).length
        };
        this.emit('equity-update', equityPoint);
        // Process each bar through strategy
        for (const bar of bars) {
            const signal = await this.strategy.onBar(bar, this.portfolio);
            if (signal) {
                await this.executeSignal(signal, bar);
            }
        }
    }
    async executeSignal(signal, marketData) {
        const position = await this.portfolio.getPosition(signal.symbol);
        // Calculate execution details
        const execution = await this.calculateExecution(signal, marketData, position);
        if (!execution) {
            return;
        }
        // Create trade record
        const trade = {
            id: `TRADE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            symbol: signal.symbol,
            side: signal.action,
            entryTime: marketData.timestamp,
            entryPrice: execution.price,
            quantity: execution.quantity,
            fees: execution.fees,
            slippage: execution.slippage,
            isOpen: true
        };
        // Update portfolio
        const actualQuantity = signal.action === 'BUY' ? execution.quantity : -execution.quantity;
        await this.portfolio.updatePosition(signal.symbol, actualQuantity, execution.price, execution.fees, execution.slippage);
        this.emit('trade', trade);
    }
    async calculateExecution(signal, marketData, position) {
        // Delegate to worker for parallel calculation
        return new Promise((resolve) => {
            const workerId = Math.floor(Math.random() * this.workers.length);
            const worker = this.workers[workerId];
            const requestId = Math.random().toString(36);
            const handler = (msg) => {
                if (msg.type === 'execution-result' && msg.requestId === requestId) {
                    worker.off('message', handler);
                    resolve(msg.result);
                }
            };
            worker.on('message', handler);
            worker.postMessage({
                type: 'calculate-execution',
                requestId,
                signal,
                marketData,
                position,
                slippageModel: this.config.slippageModel,
                feeModel: this.config.feeModel
            });
        });
    }
    createTradeStream() {
        const trades = [];
        let resolveNext = null;
        this.on('trade', (trade) => {
            if (resolveNext) {
                resolveNext({ value: trade, done: false });
                resolveNext = null;
            }
            else {
                trades.push(trade);
            }
        });
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        if (trades.length > 0) {
                            return { value: trades.shift(), done: false };
                        }
                        return new Promise(resolve => {
                            resolveNext = resolve;
                        });
                    }
                };
            }
        };
    }
    createEquityStream() {
        const points = [];
        let resolveNext = null;
        this.on('equity-update', (point) => {
            if (resolveNext) {
                resolveNext({ value: point, done: false });
                resolveNext = null;
            }
            else {
                points.push(point);
            }
        });
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        if (points.length > 0) {
                            return { value: points.shift(), done: false };
                        }
                        return new Promise(resolve => {
                            resolveNext = resolve;
                        });
                    }
                };
            }
        };
    }
    async processFinalMetrics() {
        return new Promise((resolve) => {
            this.once('complete', async () => {
                // Delegate metrics calculation to worker
                if (this.metricsWorker) {
                    this.metricsWorker.postMessage({
                        type: 'calculate-final-metrics',
                        data: {
                        // Collect necessary data
                        }
                    });
                    this.metricsWorker.once('message', (msg) => {
                        if (msg.type === 'final-metrics') {
                            resolve(msg.metrics);
                        }
                    });
                }
            });
        });
    }
    async getInitialPerformance() {
        // Return initial/empty performance metrics
        return {
            totalReturn: 0,
            annualizedReturn: 0,
            sharpeRatio: 0,
            sortinoRatio: 0,
            maxDrawdown: 0,
            winRate: 0,
            profitFactor: 0,
            totalTrades: 0,
            avgWin: 0,
            avgLoss: 0,
            expectancy: 0,
            calmarRatio: 0
        };
    }
    handleWorkerMessage(workerId, message) {
        switch (message.type) {
            case 'log':
                const logLevel = message.level;
                if (typeof this.logger[logLevel] === 'function') {
                    this.logger[logLevel](message.message, message.meta);
                }
                break;
            case 'error':
                this.logger.error(`Worker ${workerId} error`, message.error);
                break;
            case 'metrics':
                this.emit('worker-metrics', { workerId, metrics: message.metrics });
                break;
        }
    }
    async cleanupWorkers() {
        const terminationPromises = this.workers.map(worker => worker.terminate());
        if (this.metricsWorker) {
            terminationPromises.push(this.metricsWorker.terminate());
        }
        await Promise.all(terminationPromises);
        this.workers = [];
        this.metricsWorker = undefined;
    }
}
exports.StreamingBacktestingFramework = StreamingBacktestingFramework;
//# sourceMappingURL=StreamingBacktestFramework.js.map