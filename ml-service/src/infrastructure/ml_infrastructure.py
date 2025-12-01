"""
ML Infrastructure for Production Deployment

This module provides infrastructure components for:
1. MLflow - Model registry and experiment tracking
2. Redis - Feature store and caching
3. Monitoring - Performance tracking and alerting

References:
- MLflow Documentation: https://mlflow.org/docs/latest/index.html
- Redis Documentation: https://redis.io/documentation
"""

import mlflow
import mlflow.pytorch
import redis
import json
import numpy as np
import torch
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
import logging
import hashlib

logger = logging.getLogger(__name__)


@dataclass
class MLflowConfig:
    """Configuration for MLflow."""
    tracking_uri: str = "http://localhost:5000"
    experiment_name: str = "noderr-trading"
    artifact_location: Optional[str] = None
    registry_uri: Optional[str] = None


@dataclass
class RedisConfig:
    """Configuration for Redis."""
    host: str = "localhost"
    port: int = 6379
    db: int = 0
    password: Optional[str] = None
    feature_ttl: int = 3600  # 1 hour TTL for features


@dataclass
class MonitoringConfig:
    """Configuration for monitoring."""
    enable_metrics: bool = True
    enable_alerts: bool = True
    alert_threshold_latency_ms: float = 100.0
    alert_threshold_error_rate: float = 0.05


class MLflowManager:
    """
    MLflow manager for experiment tracking and model registry.
    
    Handles:
    - Experiment tracking
    - Model versioning
    - Artifact storage
    - Model deployment
    """
    
    def __init__(self, config: Optional[MLflowConfig] = None):
        self.config = config or MLflowConfig()
        self.logger = logging.getLogger(__name__)
        
        # Set tracking URI
        mlflow.set_tracking_uri(self.config.tracking_uri)
        
        # Set or create experiment
        try:
            experiment = mlflow.get_experiment_by_name(self.config.experiment_name)
            if experiment is None:
                experiment_id = mlflow.create_experiment(
                    self.config.experiment_name,
                    artifact_location=self.config.artifact_location
                )
                self.logger.info(f"Created experiment: {self.config.experiment_name}")
            else:
                experiment_id = experiment.experiment_id
                self.logger.info(f"Using existing experiment: {self.config.experiment_name}")
            
            mlflow.set_experiment(self.config.experiment_name)
            
        except Exception as e:
            self.logger.warning(f"MLflow not available: {str(e)}")
    
    def log_experiment(
        self,
        model: torch.nn.Module,
        params: Dict,
        metrics: Dict,
        artifacts: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Log an experiment run.
        
        Args:
            model: PyTorch model
            params: Hyperparameters
            metrics: Performance metrics
            artifacts: Additional artifacts to log
        
        Returns:
            Run ID
        """
        try:
            with mlflow.start_run() as run:
                # Log parameters
                mlflow.log_params(params)
                
                # Log metrics
                mlflow.log_metrics(metrics)
                
                # Log model
                mlflow.pytorch.log_model(model, "model")
                
                # Log artifacts
                if artifacts:
                    for name, path in artifacts.items():
                        mlflow.log_artifact(path, name)
                
                self.logger.info(f"Logged experiment run: {run.info.run_id}")
                
                return run.info.run_id
        
        except Exception as e:
            self.logger.error(f"Failed to log experiment: {str(e)}")
            return ""
    
    def register_model(
        self,
        model_name: str,
        run_id: str,
        description: Optional[str] = None
    ) -> str:
        """
        Register a model in the model registry.
        
        Args:
            model_name: Name for the model
            run_id: Run ID from experiment
            description: Model description
        
        Returns:
            Model version
        """
        try:
            model_uri = f"runs:/{run_id}/model"
            
            result = mlflow.register_model(
                model_uri,
                model_name,
                tags={"description": description} if description else None
            )
            
            version = result.version
            
            self.logger.info(f"Registered model {model_name} version {version}")
            
            return version
        
        except Exception as e:
            self.logger.error(f"Failed to register model: {str(e)}")
            return ""
    
    def load_model(self, model_name: str, version: Optional[str] = None) -> torch.nn.Module:
        """
        Load a model from the registry.
        
        Args:
            model_name: Name of the model
            version: Model version (latest if None)
        
        Returns:
            Loaded PyTorch model
        """
        try:
            if version:
                model_uri = f"models:/{model_name}/{version}"
            else:
                model_uri = f"models:/{model_name}/latest"
            
            model = mlflow.pytorch.load_model(model_uri)
            
            self.logger.info(f"Loaded model {model_name} version {version or 'latest'}")
            
            return model
        
        except Exception as e:
            self.logger.error(f"Failed to load model: {str(e)}")
            raise
    
    def transition_model_stage(
        self,
        model_name: str,
        version: str,
        stage: str
    ):
        """
        Transition model to a different stage.
        
        Args:
            model_name: Name of the model
            version: Model version
            stage: Target stage (Staging, Production, Archived)
        """
        try:
            client = mlflow.tracking.MlflowClient()
            client.transition_model_version_stage(
                name=model_name,
                version=version,
                stage=stage
            )
            
            self.logger.info(f"Transitioned {model_name} v{version} to {stage}")
        
        except Exception as e:
            self.logger.error(f"Failed to transition model: {str(e)}")


class RedisFeatureStore:
    """
    Redis-based feature store for caching and serving features.
    
    Provides:
    - Feature caching with TTL
    - Feature versioning
    - Batch feature retrieval
    """
    
    def __init__(self, config: Optional[RedisConfig] = None):
        self.config = config or RedisConfig()
        self.logger = logging.getLogger(__name__)
        
        try:
            self.client = redis.Redis(
                host=self.config.host,
                port=self.config.port,
                db=self.config.db,
                password=self.config.password,
                decode_responses=True
            )
            
            # Test connection
            self.client.ping()
            self.logger.info("Connected to Redis feature store")
        
        except Exception as e:
            self.logger.warning(f"Redis not available: {str(e)}")
            self.client = None
    
    def _make_key(self, symbol: str, feature_type: str, version: str = "v1") -> str:
        """Generate Redis key for features."""
        return f"features:{version}:{symbol}:{feature_type}"
    
    def store_features(
        self,
        symbol: str,
        features: np.ndarray,
        feature_type: str = "default",
        version: str = "v1",
        metadata: Optional[Dict] = None
    ):
        """
        Store features in Redis.
        
        Args:
            symbol: Trading symbol
            features: Feature array
            feature_type: Type of features
            version: Feature version
            metadata: Additional metadata
        """
        if self.client is None:
            return
        
        try:
            key = self._make_key(symbol, feature_type, version)
            
            # Serialize features and metadata
            data = {
                'features': features.tolist(),
                'timestamp': datetime.now().isoformat(),
                'metadata': metadata or {}
            }
            
            # Store with TTL
            self.client.setex(
                key,
                self.config.feature_ttl,
                json.dumps(data)
            )
            
            self.logger.debug(f"Stored features for {symbol}")
        
        except Exception as e:
            self.logger.error(f"Failed to store features: {str(e)}")
    
    def get_features(
        self,
        symbol: str,
        feature_type: str = "default",
        version: str = "v1"
    ) -> Optional[np.ndarray]:
        """
        Retrieve features from Redis.
        
        Args:
            symbol: Trading symbol
            feature_type: Type of features
            version: Feature version
        
        Returns:
            Feature array or None if not found
        """
        if self.client is None:
            return None
        
        try:
            key = self._make_key(symbol, feature_type, version)
            
            data_str = self.client.get(key)
            if data_str is None:
                return None
            
            data = json.loads(data_str)
            features = np.array(data['features'])
            
            self.logger.debug(f"Retrieved features for {symbol}")
            
            return features
        
        except Exception as e:
            self.logger.error(f"Failed to get features: {str(e)}")
            return None
    
    def get_batch_features(
        self,
        symbols: List[str],
        feature_type: str = "default",
        version: str = "v1"
    ) -> Dict[str, np.ndarray]:
        """
        Retrieve features for multiple symbols.
        
        Args:
            symbols: List of trading symbols
            feature_type: Type of features
            version: Feature version
        
        Returns:
            Dictionary mapping symbols to features
        """
        if self.client is None:
            return {}
        
        try:
            # Build keys
            keys = [self._make_key(symbol, feature_type, version) for symbol in symbols]
            
            # Batch get
            pipe = self.client.pipeline()
            for key in keys:
                pipe.get(key)
            results = pipe.execute()
            
            # Parse results
            features_dict = {}
            for symbol, data_str in zip(symbols, results):
                if data_str is not None:
                    data = json.loads(data_str)
                    features_dict[symbol] = np.array(data['features'])
            
            self.logger.debug(f"Retrieved features for {len(features_dict)} symbols")
            
            return features_dict
        
        except Exception as e:
            self.logger.error(f"Failed to get batch features: {str(e)}")
            return {}
    
    def invalidate_features(
        self,
        symbol: str,
        feature_type: str = "default",
        version: str = "v1"
    ):
        """Invalidate cached features."""
        if self.client is None:
            return
        
        try:
            key = self._make_key(symbol, feature_type, version)
            self.client.delete(key)
            
            self.logger.debug(f"Invalidated features for {symbol}")
        
        except Exception as e:
            self.logger.error(f"Failed to invalidate features: {str(e)}")


class PerformanceMonitor:
    """
    Performance monitoring and alerting.
    
    Tracks:
    - Request latency
    - Error rates
    - Model performance
    - System health
    """
    
    def __init__(self, config: Optional[MonitoringConfig] = None):
        self.config = config or MonitoringConfig()
        self.logger = logging.getLogger(__name__)
        
        # Metrics storage
        self.latencies: List[float] = []
        self.errors: List[Dict] = []
        self.predictions: List[Dict] = []
        
        self.logger.info("Performance monitor initialized")
    
    def record_latency(self, operation: str, latency_ms: float):
        """Record operation latency."""
        if not self.config.enable_metrics:
            return
        
        self.latencies.append(latency_ms)
        
        # Check alert threshold
        if self.config.enable_alerts and latency_ms > self.config.alert_threshold_latency_ms:
            self.logger.warning(f"High latency alert: {operation} took {latency_ms:.2f}ms")
    
    def record_error(self, operation: str, error: str):
        """Record an error."""
        if not self.config.enable_metrics:
            return
        
        self.errors.append({
            'operation': operation,
            'error': error,
            'timestamp': datetime.now().isoformat()
        })
        
        # Check error rate
        if self.config.enable_alerts:
            recent_errors = [e for e in self.errors 
                           if datetime.fromisoformat(e['timestamp']) > datetime.now() - timedelta(minutes=5)]
            error_rate = len(recent_errors) / max(len(self.latencies), 1)
            
            if error_rate > self.config.alert_threshold_error_rate:
                self.logger.error(f"High error rate alert: {error_rate:.2%}")
    
    def record_prediction(
        self,
        symbol: str,
        predicted_return: float,
        actual_return: Optional[float] = None,
        confidence: float = 0.0
    ):
        """Record a prediction for tracking."""
        if not self.config.enable_metrics:
            return
        
        self.predictions.append({
            'symbol': symbol,
            'predicted_return': predicted_return,
            'actual_return': actual_return,
            'confidence': confidence,
            'timestamp': datetime.now().isoformat()
        })
    
    def get_metrics(self) -> Dict:
        """Get current performance metrics."""
        if not self.latencies:
            return {}
        
        return {
            'avg_latency_ms': np.mean(self.latencies),
            'p95_latency_ms': np.percentile(self.latencies, 95),
            'p99_latency_ms': np.percentile(self.latencies, 99),
            'error_count': len(self.errors),
            'error_rate': len(self.errors) / max(len(self.latencies), 1),
            'prediction_count': len(self.predictions)
        }
    
    def get_prediction_accuracy(self) -> Dict:
        """Calculate prediction accuracy metrics."""
        predictions_with_actual = [p for p in self.predictions if p['actual_return'] is not None]
        
        if not predictions_with_actual:
            return {}
        
        # Calculate metrics
        predicted = np.array([p['predicted_return'] for p in predictions_with_actual])
        actual = np.array([p['actual_return'] for p in predictions_with_actual])
        
        mse = np.mean((predicted - actual) ** 2)
        mae = np.mean(np.abs(predicted - actual))
        correlation = np.corrcoef(predicted, actual)[0, 1] if len(predicted) > 1 else 0
        
        # Direction accuracy
        direction_correct = np.sum(np.sign(predicted) == np.sign(actual))
        direction_accuracy = direction_correct / len(predicted) * 100
        
        return {
            'mse': float(mse),
            'mae': float(mae),
            'correlation': float(correlation),
            'direction_accuracy': float(direction_accuracy),
            'n_predictions': len(predictions_with_actual)
        }


# Singleton instances
_mlflow_manager: Optional[MLflowManager] = None
_feature_store: Optional[RedisFeatureStore] = None
_monitor: Optional[PerformanceMonitor] = None


def get_mlflow_manager() -> MLflowManager:
    """Get MLflow manager singleton."""
    global _mlflow_manager
    if _mlflow_manager is None:
        _mlflow_manager = MLflowManager()
    return _mlflow_manager


def get_feature_store() -> RedisFeatureStore:
    """Get feature store singleton."""
    global _feature_store
    if _feature_store is None:
        _feature_store = RedisFeatureStore()
    return _feature_store


def get_monitor() -> PerformanceMonitor:
    """Get performance monitor singleton."""
    global _monitor
    if _monitor is None:
        _monitor = PerformanceMonitor()
    return _monitor


if __name__ == '__main__':
    # Test infrastructure components
    logging.basicConfig(level=logging.INFO)
    
    print("Testing ML infrastructure...")
    
    # Test performance monitor
    print("\n1. Testing Performance Monitor...")
    monitor = get_monitor()
    
    monitor.record_latency("prediction", 50.0)
    monitor.record_latency("prediction", 75.0)
    monitor.record_latency("prediction", 120.0)  # Should trigger alert
    
    monitor.record_prediction("BTC/USD", 0.05, 0.04, 0.8)
    monitor.record_prediction("ETH/USD", -0.02, -0.01, 0.7)
    
    metrics = monitor.get_metrics()
    print(f"  Avg Latency: {metrics['avg_latency_ms']:.2f}ms")
    print(f"  P95 Latency: {metrics['p95_latency_ms']:.2f}ms")
    print(f"  Error Rate: {metrics['error_rate']:.2%}")
    
    accuracy = monitor.get_prediction_accuracy()
    print(f"  MAE: {accuracy['mae']:.4f}")
    print(f"  Direction Accuracy: {accuracy['direction_accuracy']:.2f}%")
    
    print("\n✅ ML infrastructure test complete!")
