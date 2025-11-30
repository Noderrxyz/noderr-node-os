# Noderr ML Service

PhD-level machine learning service for the Noderr Protocol, implemented in Python with PyTorch.

## Architecture

- **Transformer Neural Networks**: Multi-head attention for price prediction (NN1-NN5 ensemble)
- **94-Feature Engineering**: Gu-Kelly-Xiu (2020) characteristic features
- **GAF Computer Vision**: CNN-based market regime classification
- **gRPC API**: High-performance communication with Node.js execution engine

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Components

### 1. Transformer Models (`src/models/transformer.py`)

- Multi-head attention mechanism
- Positional encoding for time series
- Three output heads: return, volatility, confidence
- Ensemble of 5 models (NN1-NN5)

### 2. Feature Engineering (`src/features/`)

- 94 characteristics from Gu-Kelly-Xiu (2020)
- Technical indicators
- Market microstructure features
- Risk metrics

### 3. GAF Computer Vision (`src/models/gaf.py`)

- Gramian Angular Field transformation
- CNN-based regime classification
- Four regimes: BULL, BEAR, SIDEWAYS, VOLATILE

### 4. Model Serving (`src/server.py`)

- gRPC server for predictions
- Model versioning and management
- Performance monitoring

## API

See `proto/ml_service.proto` for the complete gRPC API specification.

## Quality Standards

- PhD-level research implementation
- Comprehensive testing
- Production-ready code
- Full documentation
