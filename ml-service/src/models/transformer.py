"""
Transformer-based Price Prediction Ensemble (NN1-NN5)

This module implements a Transformer architecture for financial time series
prediction. The ensemble consists of 5 models (NN1-NN5) with varying
hyperparameters to capture different market dynamics.

Architecture:
- Multi-head self-attention for temporal dependencies
- Positional encoding for sequence ordering
- Feed-forward layers for non-linear transformations
- Dual output heads: return prediction and volatility estimation

References:
- Vaswani, A., et al. (2017). Attention is all you need.
- Li, S., et al. (2019). Enhancing the locality and breaking the memory
  bottleneck of Transformer on time series forecasting.
- Zhang, Y., et al. (2022). Transformer-based attention network for
  stock movement prediction.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import math
from typing import Dict, Optional, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class TransformerConfig:
    """Configuration for Transformer price predictor.

    Each NN in the ensemble (NN1-NN5) uses a different configuration
    to capture different aspects of market dynamics:
    - NN1: Shallow, wide attention (broad pattern recognition)
    - NN2: Deep, narrow attention (fine-grained temporal patterns)
    - NN3: Balanced architecture (general-purpose)
    - NN4: Large model with high dropout (regularized deep learning)
    - NN5: Small, fast model (high-frequency signals)
    """

    # Input dimensions
    n_features: int = 94            # Number of input features (94 characteristics)
    seq_len: int = 60               # Sequence length (lookback window)

    # Transformer architecture
    d_model: int = 128              # Model dimension
    n_heads: int = 4                # Number of attention heads
    n_encoder_layers: int = 3       # Number of encoder layers
    d_ff: int = 256                 # Feed-forward dimension
    dropout: float = 0.1            # Dropout rate

    # Output
    n_outputs: int = 3              # (predicted_return, predicted_volatility, confidence)

    # Training
    learning_rate: float = 1e-4
    weight_decay: float = 1e-5
    warmup_steps: int = 1000


class PositionalEncoding(nn.Module):
    """
    Sinusoidal positional encoding for Transformer.

    Adds position information to the input embeddings so the model
    can distinguish between different time steps in the sequence.
    """

    def __init__(self, d_model: int, max_len: int = 5000, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)

        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )

        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # (1, max_len, d_model)

        self.register_buffer('pe', pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: Tensor of shape (batch_size, seq_len, d_model)
        Returns:
            Tensor with positional encoding added
        """
        x = x + self.pe[:, :x.size(1), :]
        return self.dropout(x)


class TransformerPredictor(nn.Module):
    """
    Transformer-based financial time series predictor.

    Takes a sequence of 94-feature vectors and predicts:
    - Expected return (next period)
    - Expected volatility
    - Prediction confidence

    The architecture uses encoder-only Transformer with a regression
    head, similar to BERT-style models adapted for time series.
    """

    def __init__(self, config: Optional[TransformerConfig] = None):
        super().__init__()
        self.config = config or TransformerConfig()

        # Input projection: n_features -> d_model
        self.input_projection = nn.Linear(
            self.config.n_features, self.config.d_model
        )

        # Positional encoding
        self.pos_encoder = PositionalEncoding(
            self.config.d_model,
            max_len=self.config.seq_len + 100,
            dropout=self.config.dropout
        )

        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=self.config.d_model,
            nhead=self.config.n_heads,
            dim_feedforward=self.config.d_ff,
            dropout=self.config.dropout,
            batch_first=True,
            activation='gelu'
        )
        self.transformer_encoder = nn.TransformerEncoder(
            encoder_layer,
            num_layers=self.config.n_encoder_layers
        )

        # Output heads
        self.return_head = nn.Sequential(
            nn.Linear(self.config.d_model, self.config.d_model // 2),
            nn.GELU(),
            nn.Dropout(self.config.dropout),
            nn.Linear(self.config.d_model // 2, 1)
        )

        self.volatility_head = nn.Sequential(
            nn.Linear(self.config.d_model, self.config.d_model // 2),
            nn.GELU(),
            nn.Dropout(self.config.dropout),
            nn.Linear(self.config.d_model // 2, 1),
            nn.Softplus()  # Volatility must be positive
        )

        self.confidence_head = nn.Sequential(
            nn.Linear(self.config.d_model, self.config.d_model // 2),
            nn.GELU(),
            nn.Dropout(self.config.dropout),
            nn.Linear(self.config.d_model // 2, 1),
            nn.Sigmoid()  # Confidence in [0, 1]
        )

        # Layer normalization
        self.layer_norm = nn.LayerNorm(self.config.d_model)

        self._init_weights()

        # Move to GPU if available
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.to(self.device)

        logger.info(
            f"TransformerPredictor initialized: "
            f"d_model={self.config.d_model}, "
            f"n_heads={self.config.n_heads}, "
            f"n_layers={self.config.n_encoder_layers}, "
            f"device={self.device}"
        )

    def _init_weights(self):
        """Initialize weights using Xavier uniform for linear layers."""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.xavier_uniform_(module.weight)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Forward pass.

        Args:
            x: Input tensor of shape (batch_size, seq_len, n_features)

        Returns:
            Tuple of (predicted_return, predicted_volatility, confidence)
            Each of shape (batch_size, 1)
        """
        # Project input features to model dimension
        x = self.input_projection(x)  # (batch, seq_len, d_model)

        # Add positional encoding
        x = self.pos_encoder(x)

        # Transformer encoder
        x = self.transformer_encoder(x)  # (batch, seq_len, d_model)

        # Use the last time step's representation for prediction
        # (similar to using [CLS] token in BERT)
        x = x[:, -1, :]  # (batch, d_model)
        x = self.layer_norm(x)

        # Compute outputs
        predicted_return = self.return_head(x)       # (batch, 1)
        predicted_volatility = self.volatility_head(x)  # (batch, 1)
        confidence = self.confidence_head(x)          # (batch, 1)

        return predicted_return, predicted_volatility, confidence

    def predict(self, features: torch.Tensor) -> Dict[str, float]:
        """
        Make a prediction and return structured results.

        Args:
            features: Input tensor of shape (batch_size, seq_len, n_features)
                      or (seq_len, n_features) for single prediction

        Returns:
            Dictionary with 'return', 'volatility', and 'confidence' keys
        """
        self.eval()

        # Handle single sample input
        if features.dim() == 2:
            features = features.unsqueeze(0)

        features = features.to(self.device)

        with torch.no_grad():
            pred_return, pred_vol, pred_conf = self.forward(features)

        return {
            'return': pred_return.squeeze(-1).cpu().numpy().tolist(),
            'volatility': pred_vol.squeeze(-1).cpu().numpy().tolist(),
            'confidence': pred_conf.squeeze(-1).cpu().numpy().tolist()
        }

    def load_model(self, path: str):
        """Load pre-trained model weights."""
        state_dict = torch.load(path, map_location=self.device)
        self.load_state_dict(state_dict)
        logger.info(f"Loaded model weights from {path}")

    def save_model(self, path: str):
        """Save model weights."""
        torch.save(self.state_dict(), path)
        logger.info(f"Saved model weights to {path}")


def create_ensemble(
    n_features: int = 94,
    seq_len: int = 60
) -> Dict[str, TransformerPredictor]:
    """
    Create the NN1-NN5 Transformer ensemble.

    Each model in the ensemble has different hyperparameters to capture
    different aspects of market dynamics:

    - NN1: Wide attention (8 heads), shallow (2 layers) — broad patterns
    - NN2: Deep (5 layers), narrow (2 heads) — fine temporal structure
    - NN3: Balanced (4 heads, 3 layers) — general purpose
    - NN4: Large model (256 dim, 4 layers) with high dropout — regularized
    - NN5: Small, fast (64 dim, 2 layers) — high-frequency signals

    Args:
        n_features: Number of input features (default: 94)
        seq_len: Sequence length / lookback window (default: 60)

    Returns:
        Dictionary mapping model names to TransformerPredictor instances
    """
    configs = {
        'NN1': TransformerConfig(
            n_features=n_features,
            seq_len=seq_len,
            d_model=128,
            n_heads=8,
            n_encoder_layers=2,
            d_ff=256,
            dropout=0.1,
            learning_rate=1e-4,
        ),
        'NN2': TransformerConfig(
            n_features=n_features,
            seq_len=seq_len,
            d_model=128,
            n_heads=2,
            n_encoder_layers=5,
            d_ff=256,
            dropout=0.15,
            learning_rate=5e-5,
        ),
        'NN3': TransformerConfig(
            n_features=n_features,
            seq_len=seq_len,
            d_model=128,
            n_heads=4,
            n_encoder_layers=3,
            d_ff=256,
            dropout=0.1,
            learning_rate=1e-4,
        ),
        'NN4': TransformerConfig(
            n_features=n_features,
            seq_len=seq_len,
            d_model=256,
            n_heads=4,
            n_encoder_layers=4,
            d_ff=512,
            dropout=0.25,
            learning_rate=5e-5,
        ),
        'NN5': TransformerConfig(
            n_features=n_features,
            seq_len=seq_len,
            d_model=64,
            n_heads=2,
            n_encoder_layers=2,
            d_ff=128,
            dropout=0.1,
            learning_rate=2e-4,
        ),
    }

    ensemble = {}
    for name, config in configs.items():
        logger.info(f"Creating {name}: d_model={config.d_model}, "
                     f"n_heads={config.n_heads}, n_layers={config.n_encoder_layers}")
        ensemble[name] = TransformerPredictor(config)

    logger.info(f"Ensemble created with {len(ensemble)} models")
    return ensemble
