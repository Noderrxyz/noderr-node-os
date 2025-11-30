"use strict";
/**
 * @fileoverview Comprehensive type system for the Phoenix ML trading system.
 * @author Manus AI
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MLError = exports.MLErrorCode = exports.ModelStatus = void 0;
/**
 * Represents the status of a model.
 */
var ModelStatus;
(function (ModelStatus) {
    ModelStatus["READY"] = "READY";
    ModelStatus["TRAINING"] = "TRAINING";
    ModelStatus["PREDICTING"] = "PREDICTING";
    ModelStatus["EVALUATING"] = "EVALUATING";
    ModelStatus["FAILED"] = "FAILED";
})(ModelStatus || (exports.ModelStatus = ModelStatus = {}));
// =============================================================================
// Error Types
// =============================================================================
var MLErrorCode;
(function (MLErrorCode) {
    MLErrorCode["INVALID_FEATURES"] = "INVALID_FEATURES";
    MLErrorCode["MODEL_NOT_FOUND"] = "MODEL_NOT_FOUND";
    MLErrorCode["TRAINING_FAILED"] = "TRAINING_FAILED";
    MLErrorCode["PREDICTION_FAILED"] = "PREDICTION_FAILED";
})(MLErrorCode || (exports.MLErrorCode = MLErrorCode = {}));
class MLError extends Error {
    code;
    cause;
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'MLError';
    }
}
exports.MLError = MLError;
//# sourceMappingURL=ml.js.map