import * as tf from '@tensorflow/tfjs-node-gpu';
import { TabNetConfig } from './types';

export class TabNet {
  private config: TabNetConfig;
  private model: tf.LayersModel | null = null;
  
  constructor(config: TabNetConfig) {
    this.config = config;
  }
  
  async train(X: number[][], y: number[], valX: number[][], valY: number[]): Promise<void> {
    // Simplified TabNet implementation
    const inputShape = [X[0].length];
    
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape,
          units: 128,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.1 }),
        tf.layers.dense({
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.1 }),
        tf.layers.dense({
          units: 1,
          activation: 'linear'
        })
      ]
    });
    
    this.model.compile({
      optimizer: this.config.optimizer_fn(this.config.optimizer_params),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });
    
    const trainTensor = tf.tensor2d(X);
    const trainLabels = tf.tensor2d(y, [y.length, 1]);
    const valTensor = tf.tensor2d(valX);
    const valLabels = tf.tensor2d(valY, [valY.length, 1]);
    
    await this.model.fit(trainTensor, trainLabels, {
      epochs: 50,
      batchSize: 32,
      validationData: [valTensor, valLabels],
      verbose: this.config.verbose,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 10 === 0 && this.config.verbose > 0) {
            console.log(`TabNet epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}`);
          }
        }
      }
    });
    
    trainTensor.dispose();
    trainLabels.dispose();
    valTensor.dispose();
    valLabels.dispose();
  }
  
  async predict(X: number[][]): Promise<number> {
    if (!this.model) {
      throw new Error('Model not trained');
    }
    
    const inputTensor = tf.tensor2d(X);
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    const result = await prediction.data();
    
    inputTensor.dispose();
    prediction.dispose();
    
    return result[0];
  }
} 