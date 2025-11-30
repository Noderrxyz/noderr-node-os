"use strict";
/**
 * @fileoverview Phoenix ML - PhD-Level Machine Learning for Trading
 * @author Manus AI
 * @version 1.0.0
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoenixEngine = void 0;
class PhoenixEngine {
    async generateSignal(features) {
        // PhD-level ML logic will go here
        console.log('Generating signal from features:', features);
        return {
            action: 'hold',
            symbol: 'BTC/USD',
            confidence: 0.5,
            source: 'PhoenixEngineV1'
        };
    }
}
exports.PhoenixEngine = PhoenixEngine;
__exportStar(require("./kelly"), exports);
__exportStar(require("./client"), exports);
//# sourceMappingURL=index.js.map