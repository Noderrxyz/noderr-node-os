# @noderr/ml

Unified ML/AI engine for the Noderr Protocol, providing state-of-the-art machine learning capabilities for trading strategy optimization, market prediction, and adaptive learning.

## Overview

This package consolidates all ML/AI functionality from:
- `ai-core`: Core AI infrastructure and regime detection
- `ml-enhanced`: Advanced ML features and online learning
- `ml-enhancement`: Strategy evolution algorithms
- `model-expansion`: LLM integration and advanced models

## Features

### Core ML Infrastructure
- **Model Management**: Versioning, checkpointing, and deployment
- **Feature Engineering**: Automated feature extraction and selection
- **Training Pipeline**: Distributed training with GPU support
- **Inference Engine**: Low-latency prediction serving

### Advanced Models
- **Transformer Models**: Market prediction with attention mechanisms
- **Reinforcement Learning**: PPO, SAC, A3C for strategy optimization
- **Ensemble Methods**: Meta-learning and model combination
- **Neural Architecture Search**: Automated model design

### Online Learning
- **Adaptive Models**: Real-time model updates
- **Concept Drift Detection**: Automatic retraining triggers
- **Incremental Learning**: Continuous improvement
- **A/B Testing**: Strategy performance comparison

### Strategy Evolution
- **Genetic Algorithms**: Strategy mutation and crossover
- **Hyperparameter Optimization**: Bayesian optimization
- **Multi-objective Optimization**: Balance risk and return
- **Population-based Training**: Parallel strategy evolution

## Installation

```bash
npm install @noderr/ml
```

## Usage

```typescript
import { 
  MLEngine,
  TransformerPredictor,
  RLTrader,
  StrategyEvolution,
  FeatureEngine 
} from '@noderr/ml';

// Initialize ML engine
const mlEngine = new MLEngine({
  models: ['transformer', 'rl', 'ensemble'],
  gpu: true,
  distributed: false
});

// Price prediction with transformer
const predictor = new TransformerPredictor({
  sequenceLength: 100,
  features: ['price', 'volume', 'volatility'],
  horizon: 24 // hours
});

const prediction = await predictor.predict(marketData);

// Reinforcement learning trader
const rlTrader = new RLTrader({
  algorithm: 'PPO',
  stateSpace: ['price', 'position', 'pnl'],
  actionSpace: ['buy', 'sell', 'hold'],
  rewardFunction: 'sharpe'
});

await rlTrader.train(historicalData);
const action = await rlTrader.act(currentState);

// Strategy evolution
const evolution = new StrategyEvolution({
  populationSize: 100,
  generations: 50,
  mutationRate: 0.1,
  crossoverRate: 0.7
});

const bestStrategy = await evolution.evolve(strategies);
```

## Architecture

```
ml/
├── core/              # Core ML infrastructure
│   ├── MLEngine.ts
│   ├── ModelRegistry.ts
│   ├── TrainingPipeline.ts
│   └── InferenceServer.ts
├── models/            # Model implementations
│   ├── TransformerModel.ts
│   ├── LSTMModel.ts
│   ├── RLAgent.ts
│   └── EnsembleModel.ts
├── features/          # Feature engineering
│   ├── FeatureEngine.ts
│   ├── TechnicalIndicators.ts
│   ├── MarketMicrostructure.ts
│   └── SentimentFeatures.ts
├── training/          # Training systems
│   ├── Trainer.ts
│   ├── DistributedTrainer.ts
│   ├── OnlineLearner.ts
│   └── HyperparameterTuner.ts
├── inference/         # Inference systems
│   ├── PredictionServer.ts
│   ├── BatchPredictor.ts
│   ├── StreamingPredictor.ts
│   └── EdgeInference.ts
└── evolution/         # Strategy evolution
    ├── GeneticAlgorithm.ts
    ├── StrategyMutator.ts
    ├── FitnessEvaluator.ts
    └── PopulationManager.ts
```

## Models

### Supervised Learning
- **Price Prediction**: LSTM, GRU, Transformer
- **Classification**: Random Forest, XGBoost, Neural Networks
- **Regression**: Linear, Polynomial, Support Vector

### Reinforcement Learning
- **Value-based**: DQN, Rainbow, Categorical DQN
- **Policy-based**: PPO, SAC, A3C, IMPALA
- **Model-based**: World models, MBPO

### Unsupervised Learning
- **Clustering**: K-means, DBSCAN, Hierarchical
- **Dimensionality Reduction**: PCA, t-SNE, Autoencoders
- **Anomaly Detection**: Isolation Forest, One-class SVM

## Features

### Technical Indicators
- Moving averages (SMA, EMA, WMA)
- Oscillators (RSI, MACD, Stochastic)
- Volatility (Bollinger Bands, ATR)
- Volume indicators (OBV, VWAP)

### Market Microstructure
- Order book imbalance
- Trade flow toxicity
- Price impact models
- Liquidity measures

### Alternative Data
- Sentiment analysis
- News impact scores
- Social media trends
- On-chain metrics

## Configuration

```typescript
{
  // ML configuration
  ml: {
    // Model settings
    models: {
      transformer: {
        layers: 6,
        heads: 8,
        embeddingSize: 512,
        dropout: 0.1
      },
      rl: {
        algorithm: 'PPO',
        learningRate: 3e-4,
        batchSize: 64,
        epochs: 10
      }
    },
    
    // Training settings
    training: {
      gpu: true,
      distributed: false,
      checkpointInterval: 1000,
      validationSplit: 0.2,
      earlyStopping: {
        patience: 10,
        minDelta: 0.001
      }
    },
    
    // Feature settings
    features: {
      technicalIndicators: true,
      marketMicrostructure: true,
      sentimentAnalysis: true,
      lookbackWindow: 100,
      updateFrequency: '1m'
    },
    
    // Evolution settings
    evolution: {
      populationSize: 100,
      eliteSize: 10,
      mutationRate: 0.1,
      crossoverRate: 0.7,
      tournamentSize: 5
    }
  }
}
```

## Performance

- **Training Speed**: 1000+ samples/second (GPU)
- **Inference Latency**: < 10ms per prediction
- **Model Accuracy**: > 65% directional accuracy
- **Strategy Sharpe**: > 2.0 average

## Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Specific benchmark
npm run benchmark -- transformer

# GPU benchmarks
npm run benchmark -- --gpu
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Test specific module
npm test -- models
```

## Research Papers

Our implementations are based on:
- "Attention Is All You Need" (Transformer)
- "Proximal Policy Optimization" (PPO)
- "Deep Reinforcement Learning for Trading" 
- "Genetic Algorithms for Strategy Optimization"

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## License

MIT 