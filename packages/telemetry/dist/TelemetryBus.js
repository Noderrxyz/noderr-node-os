"use strict";
/**
 * TelemetryBus - Simple event bus for telemetry in AI Core
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryBus = void 0;
const events_1 = require("events");
class TelemetryBus extends events_1.EventEmitter {
    static instance = null;
    constructor() {
        super();
    }
    static getInstance() {
        if (!TelemetryBus.instance) {
            TelemetryBus.instance = new TelemetryBus();
        }
        return TelemetryBus.instance;
    }
    emit(event, data) {
        // Simple telemetry emission
        return super.emit(event, data);
    }
}
exports.TelemetryBus = TelemetryBus;
//# sourceMappingURL=TelemetryBus.js.map