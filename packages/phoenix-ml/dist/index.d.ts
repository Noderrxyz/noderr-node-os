/**
 * @fileoverview Phoenix ML - PhD-Level Machine Learning for Trading
 * @author Manus AI
 * @version 1.0.0
 */
import { IFeatureSet, ITradingSignal, IStrategy } from '@noderr/phoenix-types';
export declare class PhoenixEngine implements IStrategy {
    generateSignal(features: IFeatureSet): Promise<ITradingSignal>;
}
export * from './kelly';
//# sourceMappingURL=index.d.ts.map