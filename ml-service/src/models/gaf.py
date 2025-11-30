"""
Gramian Angular Field (GAF) Computer Vision for Market Regime Classification

This module implements GAF transformation and CNN-based regime classification.
GAF converts time series into images, allowing us to use computer vision techniques
for market regime detection.

References:
- Wang, Z., & Oates, T. (2015). Encoding time series as images for visual inspection
  and classification using tiled convolutional neural networks.
- Jiang, W. (2020). Applications of deep learning in stock market prediction.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Tuple, Optional, List
from dataclasses import dataclass
from enum import Enum
import logging


class MarketRegime(Enum):
    """Market regime types."""
    BULL = "BULL"           # Strong uptrend
    BEAR = "BEAR"           # Strong downtrend
    SIDEWAYS = "SIDEWAYS"   # Range-bound, low volatility
    VOLATILE = "VOLATILE"   # High volatility, no clear trend


@dataclass
class GAFConfig:
    """Configuration for GAF transformation and CNN."""
    
    # GAF parameters
    image_size: int = 64            # Size of GAF image (64x64)
    method: str = "summation"       # "summation" or "difference"
    sample_range: Tuple[float, float] = (-1, 1)  # Normalization range
    
    # CNN architecture
    n_channels: List[int] = None    # Number of channels in each conv layer
    kernel_sizes: List[int] = None  # Kernel sizes for each conv layer
    pool_sizes: List[int] = None    # Pooling sizes
    dropout: float = 0.5            # Dropout rate
    
    # Training
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    
    def __post_init__(self):
        if self.n_channels is None:
            self.n_channels = [32, 64, 128]
        if self.kernel_sizes is None:
            self.kernel_sizes = [5, 3, 3]
        if self.pool_sizes is None:
            self.pool_sizes = [2, 2, 2]


class GAFTransformer:
    """
    Gramian Angular Field transformer.
    
    Converts time series into 2D images using polar coordinate transformation.
    This allows us to use CNNs for time series classification.
    """
    
    def __init__(self, config: Optional[GAFConfig] = None):
        self.config = config or GAFConfig()
        self.logger = logging.getLogger(__name__)
    
    def transform(self, time_series: np.ndarray) -> np.ndarray:
        """
        Transform time series to GAF image.
        
        Args:
            time_series: 1D array of time series values
        
        Returns:
            2D array representing GAF image
        """
        # Normalize to [-1, 1]
        ts_min, ts_max = time_series.min(), time_series.max()
        if ts_max - ts_min == 0:
            normalized = np.zeros_like(time_series)
        else:
            normalized = (2 * (time_series - ts_min) / (ts_max - ts_min)) - 1
        
        # Clip to ensure values are in [-1, 1]
        normalized = np.clip(normalized, -1, 1)
        
        # Compute angular representation
        phi = np.arccos(normalized)
        
        # Resize if needed
        if len(phi) != self.config.image_size:
            phi = self._resize_series(phi, self.config.image_size)
        
        # Compute Gramian matrix
        if self.config.method == "summation":
            # GASF: Gramian Angular Summation Field
            gaf = self._gasf(phi)
        else:
            # GADF: Gramian Angular Difference Field
            gaf = self._gadf(phi)
        
        return gaf
    
    def _gasf(self, phi: np.ndarray) -> np.ndarray:
        """
        Compute Gramian Angular Summation Field.
        
        GASF[i,j] = cos(phi[i] + phi[j])
        """
        n = len(phi)
        gasf = np.zeros((n, n))
        
        for i in range(n):
            for j in range(n):
                gasf[i, j] = np.cos(phi[i] + phi[j])
        
        return gasf
    
    def _gadf(self, phi: np.ndarray) -> np.ndarray:
        """
        Compute Gramian Angular Difference Field.
        
        GADF[i,j] = sin(phi[i] - phi[j])
        """
        n = len(phi)
        gadf = np.zeros((n, n))
        
        for i in range(n):
            for j in range(n):
                gadf[i, j] = np.sin(phi[i] - phi[j])
        
        return gadf
    
    def _resize_series(self, series: np.ndarray, target_size: int) -> np.ndarray:
        """Resize time series using linear interpolation."""
        indices = np.linspace(0, len(series) - 1, target_size)
        return np.interp(indices, np.arange(len(series)), series)
    
    def batch_transform(self, time_series_batch: np.ndarray) -> np.ndarray:
        """
        Transform a batch of time series.
        
        Args:
            time_series_batch: 2D array (batch_size, seq_len)
        
        Returns:
            3D array (batch_size, image_size, image_size)
        """
        batch_size = time_series_batch.shape[0]
        gaf_batch = np.zeros((batch_size, self.config.image_size, self.config.image_size))
        
        for i in range(batch_size):
            gaf_batch[i] = self.transform(time_series_batch[i])
        
        return gaf_batch


class GAFConvNet(nn.Module):
    """
    Convolutional Neural Network for GAF image classification.
    
    Architecture:
    - Multiple convolutional layers with batch normalization
    - Max pooling for dimensionality reduction
    - Fully connected layers for classification
    - Dropout for regularization
    """
    
    def __init__(self, config: Optional[GAFConfig] = None):
        super().__init__()
        self.config = config or GAFConfig()
        
        # Build convolutional layers
        self.conv_layers = nn.ModuleList()
        self.bn_layers = nn.ModuleList()
        self.pool_layers = nn.ModuleList()
        
        in_channels = 1  # GAF images are grayscale
        for out_channels, kernel_size, pool_size in zip(
            self.config.n_channels,
            self.config.kernel_sizes,
            self.config.pool_sizes
        ):
            self.conv_layers.append(
                nn.Conv2d(in_channels, out_channels, kernel_size, padding=kernel_size//2)
            )
            self.bn_layers.append(nn.BatchNorm2d(out_channels))
            self.pool_layers.append(nn.MaxPool2d(pool_size))
            in_channels = out_channels
        
        # Calculate size after convolutions
        size = self.config.image_size
        for pool_size in self.config.pool_sizes:
            size = size // pool_size
        
        # Fully connected layers
        self.fc1 = nn.Linear(self.config.n_channels[-1] * size * size, 256)
        self.fc2 = nn.Linear(256, 64)
        self.fc3 = nn.Linear(64, len(MarketRegime))  # 4 regimes
        
        self.dropout = nn.Dropout(self.config.dropout)
        
        self._init_weights()
    
    def _init_weights(self):
        """Initialize weights using He initialization."""
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, 0, 0.01)
                nn.init.constant_(m.bias, 0)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.
        
        Args:
            x: Input tensor of shape (batch_size, 1, image_size, image_size)
        
        Returns:
            Logits for each regime class
        """
        # Convolutional layers
        for conv, bn, pool in zip(self.conv_layers, self.bn_layers, self.pool_layers):
            x = conv(x)
            x = bn(x)
            x = F.relu(x)
            x = pool(x)
        
        # Flatten
        x = x.view(x.size(0), -1)
        
        # Fully connected layers
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = F.relu(self.fc2(x))
        x = self.dropout(x)
        x = self.fc3(x)
        
        return x
    
    def predict(self, x: torch.Tensor) -> Tuple[MarketRegime, float, dict]:
        """
        Make a prediction and return regime, confidence, and probabilities.
        
        Args:
            x: Input tensor
        
        Returns:
            regime: Predicted market regime
            confidence: Confidence score (0-1)
            probabilities: Dictionary of probabilities for each regime
        """
        self.eval()
        with torch.no_grad():
            logits = self.forward(x)
            probs = F.softmax(logits, dim=1)
            
            confidence, pred_idx = torch.max(probs, dim=1)
            
            regime_list = list(MarketRegime)
            predicted_regime = regime_list[pred_idx.item()]
            
            prob_dict = {
                regime.value: probs[0, i].item()
                for i, regime in enumerate(regime_list)
            }
            
            return predicted_regime, confidence.item(), prob_dict


class GAFRegimeClassifier:
    """
    Complete GAF-based regime classification system.
    
    Combines GAF transformation and CNN classification for end-to-end
    market regime detection from price time series.
    """
    
    def __init__(self, config: Optional[GAFConfig] = None):
        self.config = config or GAFConfig()
        self.transformer = GAFTransformer(config)
        self.model = GAFConvNet(config)
        self.logger = logging.getLogger(__name__)
        
        # Move model to GPU if available
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
        
        self.logger.info(f"GAF Regime Classifier initialized on {self.device}")
    
    def classify(
        self,
        prices: np.ndarray,
        return_image: bool = False
    ) -> dict:
        """
        Classify market regime from price time series.
        
        Args:
            prices: 1D array of historical prices
            return_image: Whether to return the GAF image
        
        Returns:
            Dictionary with regime, confidence, probabilities, and optionally image
        """
        # Transform to GAF image
        gaf_image = self.transformer.transform(prices)
        
        # Convert to tensor
        gaf_tensor = torch.from_numpy(gaf_image).float()
        gaf_tensor = gaf_tensor.unsqueeze(0).unsqueeze(0)  # Add batch and channel dims
        gaf_tensor = gaf_tensor.to(self.device)
        
        # Classify
        regime, confidence, probabilities = self.model.predict(gaf_tensor)
        
        result = {
            'regime': regime.value,
            'confidence': confidence,
            'probabilities': probabilities
        }
        
        if return_image:
            result['gaf_image'] = gaf_image
        
        return result
    
    def batch_classify(
        self,
        prices_batch: np.ndarray
    ) -> List[dict]:
        """
        Classify multiple time series in batch.
        
        Args:
            prices_batch: 2D array (batch_size, seq_len)
        
        Returns:
            List of classification results
        """
        # Transform batch
        gaf_batch = self.transformer.batch_transform(prices_batch)
        
        # Convert to tensor
        gaf_tensor = torch.from_numpy(gaf_batch).float()
        gaf_tensor = gaf_tensor.unsqueeze(1)  # Add channel dim
        gaf_tensor = gaf_tensor.to(self.device)
        
        # Classify
        self.model.eval()
        with torch.no_grad():
            logits = self.model(gaf_tensor)
            probs = F.softmax(logits, dim=1)
        
        # Convert to results
        results = []
        regime_list = list(MarketRegime)
        
        for i in range(len(prices_batch)):
            confidence, pred_idx = torch.max(probs[i], dim=0)
            predicted_regime = regime_list[pred_idx.item()]
            
            prob_dict = {
                regime.value: probs[i, j].item()
                for j, regime in enumerate(regime_list)
            }
            
            results.append({
                'regime': predicted_regime.value,
                'confidence': confidence.item(),
                'probabilities': prob_dict
            })
        
        return results
    
    def train_step(
        self,
        images: torch.Tensor,
        labels: torch.Tensor,
        optimizer: torch.optim.Optimizer
    ) -> float:
        """
        Perform a single training step.
        
        Args:
            images: Batch of GAF images
            labels: Batch of regime labels
            optimizer: Optimizer
        
        Returns:
            Loss value
        """
        self.model.train()
        
        images = images.to(self.device)
        labels = labels.to(self.device)
        
        # Forward pass
        logits = self.model(images)
        loss = F.cross_entropy(logits, labels)
        
        # Backward pass
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
        return loss.item()
    
    def evaluate(
        self,
        images: torch.Tensor,
        labels: torch.Tensor
    ) -> Tuple[float, float]:
        """
        Evaluate model on a batch.
        
        Args:
            images: Batch of GAF images
            labels: Batch of regime labels
        
        Returns:
            loss: Cross-entropy loss
            accuracy: Classification accuracy
        """
        self.model.eval()
        
        images = images.to(self.device)
        labels = labels.to(self.device)
        
        with torch.no_grad():
            logits = self.model(images)
            loss = F.cross_entropy(logits, labels)
            
            _, predicted = torch.max(logits, 1)
            accuracy = (predicted == labels).float().mean()
        
        return loss.item(), accuracy.item()
    
    def save_model(self, path: str):
        """Save model weights."""
        torch.save(self.model.state_dict(), path)
        self.logger.info(f"Model saved to {path}")
    
    def load_model(self, path: str):
        """Load model weights."""
        self.model.load_state_dict(torch.load(path, map_location=self.device))
        self.logger.info(f"Model loaded from {path}")


def create_synthetic_training_data(n_samples: int = 1000) -> Tuple[np.ndarray, np.ndarray]:
    """
    Create synthetic training data for GAF regime classifier.
    
    Args:
        n_samples: Number of samples to generate
    
    Returns:
        prices: Array of price time series (n_samples, seq_len)
        labels: Array of regime labels (n_samples,)
    """
    seq_len = 64
    prices = []
    labels = []
    
    for _ in range(n_samples):
        regime = np.random.choice(list(MarketRegime))
        
        if regime == MarketRegime.BULL:
            # Uptrend with low volatility
            trend = np.linspace(0, 0.2, seq_len)
            noise = np.random.randn(seq_len) * 0.01
            price = 100 * np.exp(trend + noise)
            label = 0
        
        elif regime == MarketRegime.BEAR:
            # Downtrend with low volatility
            trend = np.linspace(0, -0.2, seq_len)
            noise = np.random.randn(seq_len) * 0.01
            price = 100 * np.exp(trend + noise)
            label = 1
        
        elif regime == MarketRegime.SIDEWAYS:
            # No trend, low volatility
            noise = np.random.randn(seq_len) * 0.005
            price = 100 * np.exp(noise)
            label = 2
        
        else:  # VOLATILE
            # High volatility, no clear trend
            noise = np.random.randn(seq_len) * 0.05
            price = 100 * np.exp(noise)
            label = 3
        
        prices.append(price)
        labels.append(label)
    
    return np.array(prices), np.array(labels)


if __name__ == "__main__":
    # Test GAF transformation and classification
    logging.basicConfig(level=logging.INFO)
    
    # Create synthetic data
    print("Generating synthetic training data...")
    prices, labels = create_synthetic_training_data(n_samples=100)
    
    # Create classifier
    print("\nInitializing GAF Regime Classifier...")
    classifier = GAFRegimeClassifier()
    
    # Test single classification
    print("\nTesting single classification...")
    result = classifier.classify(prices[0], return_image=True)
    print(f"Regime: {result['regime']}")
    print(f"Confidence: {result['confidence']:.4f}")
    print(f"Probabilities: {result['probabilities']}")
    print(f"GAF image shape: {result['gaf_image'].shape}")
    
    # Test batch classification
    print("\nTesting batch classification...")
    batch_results = classifier.batch_classify(prices[:5])
    for i, result in enumerate(batch_results):
        print(f"Sample {i}: {result['regime']} (confidence: {result['confidence']:.4f})")
    
    # Test training step
    print("\nTesting training step...")
    optimizer = torch.optim.Adam(classifier.model.parameters(), lr=1e-3)
    
    # Transform batch for training
    gaf_batch = classifier.transformer.batch_transform(prices[:32])
    gaf_tensor = torch.from_numpy(gaf_batch).float().unsqueeze(1)
    label_tensor = torch.from_numpy(labels[:32]).long()
    
    loss = classifier.train_step(gaf_tensor, label_tensor, optimizer)
    print(f"Training loss: {loss:.4f}")
    
    # Test evaluation
    print("\nTesting evaluation...")
    eval_loss, eval_acc = classifier.evaluate(gaf_tensor, label_tensor)
    print(f"Evaluation loss: {eval_loss:.4f}")
    print(f"Evaluation accuracy: {eval_acc:.4f}")
    
    print("\n✅ GAF Regime Classifier test complete!")
