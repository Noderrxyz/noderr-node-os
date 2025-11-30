"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadMansSwitch = void 0;
const events_1 = require("events");
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class DeadMansSwitch extends events_1.EventEmitter {
    logger;
    config;
    timer;
    warningTimer;
    lastHeartbeat = null;
    missedBeats = 0;
    triggered = false;
    triggerCount = 0;
    warningIssued = false;
    active = false;
    constructor(config) {
        super();
        this.logger = createLogger(`DeadMansSwitch:${config.name}`);
        this.config = {
            maxMissedBeats: 3,
            autoRecover: true,
            ...config
        };
        this.logger.info('Dead man\'s switch initialized', {
            name: config.name,
            timeoutMs: config.timeoutMs,
            warningThresholdMs: config.warningThresholdMs
        });
    }
    /**
     * Start the dead man's switch
     */
    start() {
        if (this.active) {
            this.logger.warn('Dead man\'s switch already active');
            return;
        }
        this.active = true;
        this.lastHeartbeat = new Date();
        this.missedBeats = 0;
        this.triggered = false;
        this.warningIssued = false;
        this.scheduleTimeout();
        this.logger.info('Dead man\'s switch started');
        this.emit('started', { name: this.config.name });
    }
    /**
     * Stop the dead man's switch
     */
    stop() {
        if (!this.active) {
            return;
        }
        this.active = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.warningTimer) {
            clearTimeout(this.warningTimer);
            this.warningTimer = undefined;
        }
        this.logger.info('Dead man\'s switch stopped');
        this.emit('stopped', { name: this.config.name });
    }
    /**
     * Send a heartbeat to reset the timer
     */
    heartbeat(metadata) {
        if (!this.active) {
            this.logger.warn('Heartbeat received but switch is not active');
            return;
        }
        const previousHeartbeat = this.lastHeartbeat;
        this.lastHeartbeat = new Date();
        // Calculate time since last heartbeat
        const timeSinceLastMs = previousHeartbeat
            ? this.lastHeartbeat.getTime() - previousHeartbeat.getTime()
            : 0;
        // Reset missed beats
        if (this.missedBeats > 0) {
            this.logger.info(`Heartbeat received after ${this.missedBeats} missed beats`);
            this.missedBeats = 0;
        }
        // Clear warning state
        if (this.warningIssued) {
            this.warningIssued = false;
            this.logger.info('Warning state cleared');
        }
        // Reset timers
        this.resetTimers();
        this.scheduleTimeout();
        this.emit('heartbeat', {
            name: this.config.name,
            timestamp: this.lastHeartbeat,
            timeSinceLastMs,
            metadata
        });
        // If we were triggered and auto-recover is enabled, reset
        if (this.triggered && this.config.autoRecover) {
            this.triggered = false;
            this.logger.info('Auto-recovered from triggered state');
            this.emit('recovered', {
                name: this.config.name,
                triggerCount: this.triggerCount
            });
        }
    }
    /**
     * Get current status
     */
    getStatus() {
        const timeUntilTrigger = this.getTimeUntilTrigger();
        return {
            name: this.config.name,
            active: this.active,
            lastHeartbeat: this.lastHeartbeat,
            missedBeats: this.missedBeats,
            triggered: this.triggered,
            triggerCount: this.triggerCount,
            timeUntilTrigger,
            warningIssued: this.warningIssued
        };
    }
    /**
     * Force trigger the switch manually
     */
    async forceTrigger(reason) {
        this.logger.warn(`Force triggering dead man's switch: ${reason}`);
        await this.trigger('MANUAL', reason);
    }
    /**
     * Update configuration
     */
    updateConfig(updates) {
        const oldTimeout = this.config.timeoutMs;
        this.config = { ...this.config, ...updates };
        // If timeout changed and switch is active, restart timers
        if (this.active && this.config.timeoutMs !== oldTimeout) {
            this.resetTimers();
            this.scheduleTimeout();
        }
        this.logger.info('Configuration updated', updates);
        this.emit('config-updated', this.config);
    }
    // Private methods
    scheduleTimeout() {
        // Schedule warning if configured
        if (this.config.warningThresholdMs && this.config.warningThresholdMs < this.config.timeoutMs) {
            this.warningTimer = setTimeout(() => {
                this.issueWarning();
            }, this.config.warningThresholdMs);
        }
        // Schedule main timeout
        this.timer = setTimeout(() => {
            this.handleTimeout();
        }, this.config.timeoutMs);
    }
    resetTimers() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.warningTimer) {
            clearTimeout(this.warningTimer);
            this.warningTimer = undefined;
        }
    }
    async issueWarning() {
        if (!this.active || this.warningIssued) {
            return;
        }
        this.warningIssued = true;
        const timeRemaining = this.config.timeoutMs - (this.config.warningThresholdMs || 0);
        this.logger.warn(`Warning: Dead man's switch will trigger in ${timeRemaining}ms`);
        this.emit('warning', {
            name: this.config.name,
            timeRemainingMs: timeRemaining
        });
        // Execute warning action if configured
        if (this.config.warningAction) {
            try {
                await this.config.warningAction();
            }
            catch (error) {
                this.logger.error('Warning action failed', error);
            }
        }
    }
    async handleTimeout() {
        if (!this.active) {
            return;
        }
        this.missedBeats++;
        this.logger.warn(`Heartbeat missed (${this.missedBeats}/${this.config.maxMissedBeats})`);
        this.emit('missed-beat', {
            name: this.config.name,
            missedBeats: this.missedBeats,
            maxMissedBeats: this.config.maxMissedBeats
        });
        // Check if we should trigger
        if (this.missedBeats >= (this.config.maxMissedBeats || 3)) {
            await this.trigger('TIMEOUT', `No heartbeat for ${this.config.timeoutMs * this.missedBeats}ms`);
        }
        else {
            // Schedule next timeout
            this.scheduleTimeout();
        }
    }
    async trigger(type, reason) {
        if (this.triggered && !this.config.autoRecover) {
            this.logger.warn('Dead man\'s switch already triggered (no auto-recover)');
            return;
        }
        this.triggered = true;
        this.triggerCount++;
        this.logger.error(`🚨 DEAD MAN'S SWITCH TRIGGERED: ${reason}`);
        this.emit('triggered', {
            name: this.config.name,
            type,
            reason,
            timestamp: new Date(),
            triggerCount: this.triggerCount,
            missedBeats: this.missedBeats
        });
        // Execute the configured action
        try {
            this.logger.info('Executing dead man\'s switch action...');
            await this.config.action();
            this.logger.info('Dead man\'s switch action completed');
            this.emit('action-completed', {
                name: this.config.name,
                success: true
            });
        }
        catch (error) {
            this.logger.error('Dead man\'s switch action failed', error);
            this.emit('action-failed', {
                name: this.config.name,
                error: error.message
            });
        }
        // Reset timers if auto-recover is enabled
        if (this.config.autoRecover && this.active) {
            this.resetTimers();
            this.scheduleTimeout();
        }
        else {
            // Stop the switch
            this.stop();
        }
    }
    getTimeUntilTrigger() {
        if (!this.active || !this.lastHeartbeat) {
            return 0;
        }
        const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat.getTime();
        const remainingBeats = (this.config.maxMissedBeats || 3) - this.missedBeats;
        const timeUntilNextBeat = Math.max(0, this.config.timeoutMs - timeSinceLastHeartbeat);
        return timeUntilNextBeat + ((remainingBeats - 1) * this.config.timeoutMs);
    }
    /**
     * Destroy and clean up
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
        this.logger.info('Dead man\'s switch destroyed');
    }
}
exports.DeadMansSwitch = DeadMansSwitch;
//# sourceMappingURL=DeadMansSwitch.js.map