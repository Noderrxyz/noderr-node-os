"""
Production-ready gRPC server for ML model serving.

This server provides high-performance inference for:
- Transformer price prediction (NN1-NN5 ensemble)
- GAF regime classification
- 94-feature generation

Features:
- Model loading and caching
- Health checks and monitoring
- Performance metrics
- Error handling and logging
- Graceful shutdown
"""

import grpc
from concurrent import futures
import logging
import time
import signal
import sys
from typing import Dict, Optional
import numpy as np
import torch

# Import generated gRPC code
import ml_service_pb2
import ml_service_pb2_grpc

# Import our ML models
from models.transformer import TransformerPredictor, TransformerConfig, create_ensemble
from models.gaf import GAFRegimeClassifier, GAFConfig, MarketRegime
from features.feature_engineer import FeatureEngineer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class MLServiceServicer(ml_service_pb2_grpc.MLServiceServicer):
    """
    gRPC service implementation for ML inference.
    
    Handles all ML-related requests with proper error handling,
    logging, and performance monitoring.
    """
    
    def __init__(self):
        """Initialize the ML service with all models."""
        logger.info("Initializing ML Service...")
        
        # Initialize feature engineer
        self.feature_engineer = FeatureEngineer()
        logger.info("Feature engineer initialized")
        
        # Initialize Transformer ensemble (NN1-NN5)
        logger.info("Loading Transformer ensemble...")
        self.transformer_ensemble = self._load_transformer_ensemble()
        logger.info(f"Loaded {len(self.transformer_ensemble)} Transformer models")
        
        # Initialize GAF classifier
        logger.info("Loading GAF classifier...")
        self.gaf_classifier = GAFRegimeClassifier()
        logger.info("GAF classifier initialized")
        
        # Performance metrics
        self.request_count = 0
        self.total_latency = 0.0
        self.start_time = time.time()
        
        logger.info("ML Service initialization complete")
    
    def _load_transformer_ensemble(self) -> Dict[str, TransformerPredictor]:
        """
        Load the Transformer ensemble (NN1-NN5).
        
        In production, this would load pre-trained weights.
        For now, we create the architecture ready for training.
        """
        ensemble = create_ensemble(
            n_features=94,
            seq_len=60
        )
        
        # In production, load weights here:
        # for name, model in ensemble.items():
        #     model.load_model(f'models/weights/{name}.pth')
        
        return ensemble
    
    def Predict(self, request, context):
        """
        Get price predictions from Transformer ensemble.
        
        Args:
            request: PredictRequest with features and prices
            context: gRPC context
        
        Returns:
            PredictResponse with predictions
        """
        start_time = time.time()
        
        try:
            logger.debug(f"Predict request for symbol: {request.symbol}")
            
            # Convert request data to numpy arrays
            features = np.array(request.features).reshape(request.batch_size, request.seq_len, request.n_features)
            
            # Get ensemble predictions
            predictions = []
            confidences = []
            
            for name, model in self.transformer_ensemble.items():
                # Convert to torch tensor
                features_tensor = torch.from_numpy(features).float()
                
                # Get prediction
                pred = model.predict(features_tensor)
                
                predictions.append({
                    'return': pred['return'][0],
                    'volatility': pred['volatility'][0],
                    'confidence': pred['confidence'][0]
                })
                confidences.append(pred['confidence'][0])
            
            # Ensemble averaging weighted by confidence
            total_confidence = sum(confidences)
            weights = [c / total_confidence for c in confidences]
            
            ensemble_return = sum(p['return'] * w for p, w in zip(predictions, weights))
            ensemble_volatility = sum(p['volatility'] * w for p, w in zip(predictions, weights))
            ensemble_confidence = sum(confidences) / len(confidences)
            
            # Update metrics
            latency = time.time() - start_time
            self.request_count += 1
            self.total_latency += latency
            
            logger.debug(f"Prediction complete in {latency*1000:.2f}ms")
            
            # Build response
            response = ml_service_pb2.PredictResponse(
                symbol=request.symbol,
                predicted_return=float(ensemble_return),
                predicted_volatility=float(ensemble_volatility),
                confidence=float(ensemble_confidence),
                model_count=len(self.transformer_ensemble),
                latency_ms=latency * 1000
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Prediction error: {str(e)}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Prediction failed: {str(e)}")
            return ml_service_pb2.PredictResponse()
    
    def ClassifyRegime(self, request, context):
        """
        Classify market regime using GAF-CNN.
        
        Args:
            request: RegimeRequest with price history
            context: gRPC context
        
        Returns:
            RegimeResponse with regime classification
        """
        start_time = time.time()
        
        try:
            logger.debug(f"Regime classification for symbol: {request.symbol}")
            
            # Convert prices to numpy array
            prices = np.array(request.prices)
            
            # Classify regime
            result = self.gaf_classifier.classify(prices, return_image=False)
            
            # Update metrics
            latency = time.time() - start_time
            self.request_count += 1
            self.total_latency += latency
            
            logger.debug(f"Regime classification complete in {latency*1000:.2f}ms")
            
            # Build response
            response = ml_service_pb2.RegimeResponse(
                symbol=request.symbol,
                regime=result['regime'],
                confidence=result['confidence'],
                bull_prob=result['probabilities']['BULL'],
                bear_prob=result['probabilities']['BEAR'],
                sideways_prob=result['probabilities']['SIDEWAYS'],
                volatile_prob=result['probabilities']['VOLATILE'],
                latency_ms=latency * 1000
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Regime classification error: {str(e)}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Regime classification failed: {str(e)}")
            return ml_service_pb2.RegimeResponse()
    
    def GenerateFeatures(self, request, context):
        """
        Generate 94-characteristic features.
        
        Args:
            request: FeatureRequest with OHLCV data
            context: gRPC context
        
        Returns:
            FeatureResponse with generated features
        """
        start_time = time.time()
        
        try:
            logger.debug(f"Feature generation for symbol: {request.symbol}")
            
            # Convert OHLCV data to numpy arrays
            open_prices = np.array(request.open)
            high_prices = np.array(request.high)
            low_prices = np.array(request.low)
            close_prices = np.array(request.close)
            volumes = np.array(request.volume)
            
            # Generate features using the feature engineer
            # engineer_features expects: prices, volumes, high, low, close
            features_dict = self.feature_engineer.engineer_features(
                prices=close_prices,
                volumes=volumes,
                high=high_prices,
                low=low_prices,
                close=close_prices
            )
            
            # Convert dict to flat array
            features = np.array(list(features_dict.values()), dtype=np.float32)
            
            # Update metrics
            latency = time.time() - start_time
            self.request_count += 1
            self.total_latency += latency
            
            logger.debug(f"Feature generation complete in {latency*1000:.2f}ms")
            
            # Build response
            response = ml_service_pb2.FeatureResponse(
                symbol=request.symbol,
                features=features.tolist(),
                feature_count=len(features),
                latency_ms=latency * 1000
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Feature generation error: {str(e)}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Feature generation failed: {str(e)}")
            return ml_service_pb2.FeatureResponse()
    
    def BatchPredict(self, request, context):
        """
        Get predictions for multiple symbols in batch.
        
        Args:
            request: BatchPredictRequest with multiple symbols
            context: gRPC context
        
        Returns:
            BatchPredictResponse with predictions for all symbols
        """
        start_time = time.time()
        
        try:
            logger.debug(f"Batch prediction for {len(request.symbols)} symbols")
            
            predictions = []
            
            for i, symbol in enumerate(request.symbols):
                # Extract features for this symbol
                start_idx = i * request.seq_len * request.n_features
                end_idx = start_idx + request.seq_len * request.n_features
                symbol_features = request.features[start_idx:end_idx]
                
                # Create individual predict request
                pred_request = ml_service_pb2.PredictRequest(
                    symbol=symbol,
                    features=symbol_features,
                    batch_size=1,
                    seq_len=request.seq_len,
                    n_features=request.n_features
                )
                
                # Get prediction
                pred_response = self.Predict(pred_request, context)
                predictions.append(pred_response)
            
            # Update metrics
            latency = time.time() - start_time
            
            logger.debug(f"Batch prediction complete in {latency*1000:.2f}ms")
            
            # Build response
            response = ml_service_pb2.BatchPredictResponse(
                predictions=predictions,
                total_latency_ms=latency * 1000
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Batch prediction error: {str(e)}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Batch prediction failed: {str(e)}")
            return ml_service_pb2.BatchPredictResponse()
    
    def HealthCheck(self, request, context):
        """
        Check service health.
        
        Returns:
            HealthCheckResponse with service status
        """
        try:
            uptime = time.time() - self.start_time
            avg_latency = self.total_latency / max(self.request_count, 1)
            
            response = ml_service_pb2.HealthCheckResponse(
                status="healthy",
                uptime_seconds=int(uptime),
                request_count=self.request_count,
                avg_latency_ms=avg_latency * 1000
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Health check error: {str(e)}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Health check failed: {str(e)}")
            return ml_service_pb2.HealthCheckResponse(status="unhealthy")


def serve(port: int = 50051, max_workers: int = 10):
    """
    Start the gRPC server.
    
    Args:
        port: Port to listen on
        max_workers: Maximum number of worker threads
    """
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=max_workers),
        options=[
            ('grpc.max_send_message_length', 50 * 1024 * 1024),  # 50MB
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),  # 50MB
        ]
    )
    
    ml_service_pb2_grpc.add_MLServiceServicer_to_server(
        MLServiceServicer(), server
    )
    
    server.add_insecure_port(f'[::]:{port}')
    
    logger.info(f"Starting ML Service on port {port}...")
    server.start()
    logger.info(f"ML Service listening on port {port}")
    
    # Graceful shutdown handler
    def handle_shutdown(signum, frame):
        logger.info("Received shutdown signal, stopping server...")
        server.stop(grace=5)
        logger.info("Server stopped")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)
    
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Server interrupted, shutting down...")
        server.stop(grace=5)


if __name__ == '__main__':
    serve()
