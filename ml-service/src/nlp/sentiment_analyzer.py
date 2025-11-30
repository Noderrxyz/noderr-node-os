"""
NLP Sentiment Analysis Pipeline for Crypto Trading

This module implements sentiment analysis using:
1. Fine-tuned BERT for financial text classification
2. GPT API for advanced reasoning and context understanding
3. Multi-source aggregation (Twitter, Reddit, news, Discord)
4. Real-time sentiment scoring

References:
- Devlin, J., et al. (2018). BERT: Pre-training of Deep Bidirectional Transformers
- Brown, T., et al. (2020). Language Models are Few-Shot Learners (GPT-3)
- Loughran, T., & McDonald, B. (2011). When is a Liability not a Liability?
"""

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import logging
import numpy as np
from datetime import datetime
import os

logger = logging.getLogger(__name__)


@dataclass
class SentimentConfig:
    """Configuration for sentiment analysis."""
    
    # Model configuration
    bert_model: str = "ProsusAI/finbert"  # Pre-trained financial BERT
    max_length: int = 512                  # Maximum sequence length
    batch_size: int = 32                   # Batch size for inference
    
    # GPT configuration
    gpt_model: str = "gpt-4.1-mini"       # GPT model for advanced analysis
    gpt_enabled: bool = True               # Enable GPT API calls
    gpt_api_key: Optional[str] = None      # OpenAI API key
    
    # Aggregation
    time_decay: float = 0.1                # Time decay for older signals
    source_weights: Dict[str, float] = None  # Weights for different sources
    
    # Thresholds
    confidence_threshold: float = 0.6      # Minimum confidence for signals
    volume_threshold: int = 10             # Minimum number of mentions


class SentimentAnalyzer:
    """
    Multi-source sentiment analyzer for crypto trading.
    
    Combines BERT-based classification with GPT reasoning
    to generate high-quality sentiment signals.
    """
    
    def __init__(self, config: Optional[SentimentConfig] = None):
        self.config = config or SentimentConfig()
        
        # Set default source weights
        if self.config.source_weights is None:
            self.config.source_weights = {
                'twitter': 0.3,
                'reddit': 0.25,
                'news': 0.35,
                'discord': 0.1
            }
        
        self.logger = logging.getLogger(__name__)
        
        # Load BERT model
        self.logger.info(f"Loading BERT model: {self.config.bert_model}")
        self.tokenizer = AutoTokenizer.from_pretrained(self.config.bert_model)
        self.model = AutoModelForSequenceClassification.from_pretrained(self.config.bert_model)
        self.model.eval()
        
        # Set device
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
        
        self.logger.info(f"Sentiment analyzer initialized on {self.device}")
        
        # GPT client (if enabled)
        self.gpt_client = None
        if self.config.gpt_enabled:
            self._initialize_gpt()
    
    def _initialize_gpt(self):
        """Initialize GPT client for advanced analysis."""
        try:
            from openai import OpenAI
            
            api_key = self.config.gpt_api_key or os.getenv('OPENAI_API_KEY')
            if not api_key:
                self.logger.warning("No OpenAI API key found, GPT analysis disabled")
                self.config.gpt_enabled = False
                return
            
            self.gpt_client = OpenAI()
            self.logger.info("GPT client initialized")
            
        except ImportError:
            self.logger.warning("OpenAI package not installed, GPT analysis disabled")
            self.config.gpt_enabled = False
    
    def analyze_text(self, text: str) -> Dict:
        """
        Analyze sentiment of a single text using BERT.
        
        Args:
            text: Text to analyze
        
        Returns:
            Dictionary with sentiment scores
        """
        # Tokenize
        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            max_length=self.config.max_length,
            truncation=True,
            padding=True
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        # Get predictions
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            probs = torch.softmax(logits, dim=-1)
        
        # Convert to sentiment scores
        # FinBERT outputs: [negative, neutral, positive]
        negative, neutral, positive = probs[0].cpu().numpy()
        
        # Compute compound score (-1 to 1)
        compound = positive - negative
        
        # Determine label
        if compound > 0.2:
            label = 'positive'
        elif compound < -0.2:
            label = 'negative'
        else:
            label = 'neutral'
        
        return {
            'label': label,
            'compound': float(compound),
            'positive': float(positive),
            'neutral': float(neutral),
            'negative': float(negative),
            'confidence': float(max(positive, neutral, negative))
        }
    
    def analyze_batch(self, texts: List[str]) -> List[Dict]:
        """
        Analyze sentiment of multiple texts in batch.
        
        Args:
            texts: List of texts to analyze
        
        Returns:
            List of sentiment dictionaries
        """
        results = []
        
        # Process in batches
        for i in range(0, len(texts), self.config.batch_size):
            batch = texts[i:i + self.config.batch_size]
            
            # Tokenize batch
            inputs = self.tokenizer(
                batch,
                return_tensors="pt",
                max_length=self.config.max_length,
                truncation=True,
                padding=True
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            # Get predictions
            with torch.no_grad():
                outputs = self.model(**inputs)
                logits = outputs.logits
                probs = torch.softmax(logits, dim=-1)
            
            # Convert to sentiment scores
            for j, prob in enumerate(probs):
                negative, neutral, positive = prob.cpu().numpy()
                compound = positive - negative
                
                if compound > 0.2:
                    label = 'positive'
                elif compound < -0.2:
                    label = 'negative'
                else:
                    label = 'neutral'
                
                results.append({
                    'label': label,
                    'compound': float(compound),
                    'positive': float(positive),
                    'neutral': float(neutral),
                    'negative': float(negative),
                    'confidence': float(max(positive, neutral, negative))
                })
        
        return results
    
    def analyze_with_gpt(self, text: str, context: Optional[str] = None) -> Dict:
        """
        Analyze sentiment using GPT for advanced reasoning.
        
        Args:
            text: Text to analyze
            context: Additional context (e.g., market conditions)
        
        Returns:
            Dictionary with GPT sentiment analysis
        """
        if not self.config.gpt_enabled or self.gpt_client is None:
            self.logger.warning("GPT analysis not available")
            return self.analyze_text(text)
        
        try:
            # Construct prompt
            prompt = f"""Analyze the sentiment of the following crypto/trading text and provide:
1. Overall sentiment (bullish/bearish/neutral)
2. Confidence score (0-1)
3. Key factors influencing the sentiment
4. Potential market impact

Text: {text}"""
            
            if context:
                prompt += f"\n\nContext: {context}"
            
            # Call GPT API
            response = self.gpt_client.chat.completions.create(
                model=self.config.gpt_model,
                messages=[
                    {"role": "system", "content": "You are an expert crypto trader analyzing market sentiment."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=500
            )
            
            # Parse response
            gpt_analysis = response.choices[0].message.content
            
            # Also get BERT score for comparison
            bert_score = self.analyze_text(text)
            
            return {
                'gpt_analysis': gpt_analysis,
                'bert_score': bert_score,
                'combined_confidence': (bert_score['confidence'] + 0.8) / 2  # Assume GPT is 0.8 confident
            }
            
        except Exception as e:
            self.logger.error(f"GPT analysis failed: {str(e)}")
            return self.analyze_text(text)
    
    def aggregate_multi_source(
        self,
        sources: Dict[str, List[Dict]]
    ) -> Dict:
        """
        Aggregate sentiment from multiple sources.
        
        Args:
            sources: Dictionary mapping source names to lists of sentiment scores
        
        Returns:
            Aggregated sentiment score
        """
        weighted_scores = []
        total_weight = 0
        
        for source, sentiments in sources.items():
            if source not in self.config.source_weights:
                self.logger.warning(f"Unknown source: {source}, skipping")
                continue
            
            if len(sentiments) < self.config.volume_threshold:
                self.logger.debug(f"Insufficient volume for {source}: {len(sentiments)}")
                continue
            
            # Compute average sentiment for this source
            avg_compound = np.mean([s['compound'] for s in sentiments])
            avg_confidence = np.mean([s['confidence'] for s in sentiments])
            
            # Apply source weight
            source_weight = self.config.source_weights[source]
            weighted_scores.append({
                'source': source,
                'compound': avg_compound,
                'confidence': avg_confidence,
                'weight': source_weight,
                'count': len(sentiments)
            })
            
            total_weight += source_weight
        
        if not weighted_scores:
        return {
            'compound': 0.0,
            'confidence': 0.0,
            'label': 'neutral',
            'sources': [],
            'total_mentions': 0
        }
        
        # Compute weighted average
        weighted_compound = sum(s['compound'] * s['weight'] for s in weighted_scores) / total_weight
        weighted_confidence = sum(s['confidence'] * s['weight'] for s in weighted_scores) / total_weight
        
        # Determine label
        if weighted_compound > 0.2:
            label = 'bullish'
        elif weighted_compound < -0.2:
            label = 'bearish'
        else:
            label = 'neutral'
        
        return {
            'compound': float(weighted_compound),
            'confidence': float(weighted_confidence),
            'label': label,
            'sources': weighted_scores,
            'total_mentions': sum(s['count'] for s in weighted_scores)
        }
    
    def get_trading_signal(
        self,
        symbol: str,
        sources: Dict[str, List[Dict]],
        market_context: Optional[Dict] = None
    ) -> Dict:
        """
        Generate trading signal from sentiment analysis.
        
        Args:
            symbol: Trading symbol (e.g., 'BTC/USD')
            sources: Multi-source sentiment data
            market_context: Current market conditions
        
        Returns:
            Trading signal with sentiment score
        """
        # Aggregate sentiment
        sentiment = self.aggregate_multi_source(sources)
        
        # Check confidence threshold
        if sentiment['confidence'] < self.config.confidence_threshold:
            return {
                'symbol': symbol,
                'action': 'hold',
                'sentiment': sentiment,
                'reason': 'Insufficient confidence'
            }
        
        # Generate signal
        if sentiment['label'] == 'bullish' and sentiment['compound'] > 0.3:
            action = 'buy'
            strength = min(sentiment['compound'], 1.0)
        elif sentiment['label'] == 'bearish' and sentiment['compound'] < -0.3:
            action = 'sell'
            strength = min(abs(sentiment['compound']), 1.0)
        else:
            action = 'hold'
            strength = 0.0
        
        return {
            'symbol': symbol,
            'action': action,
            'strength': strength,
            'sentiment': sentiment,
            'confidence': sentiment['confidence'],
            'timestamp': datetime.now().isoformat()
        }


def create_synthetic_texts() -> List[str]:
    """Create synthetic texts for testing."""
    return [
        "Bitcoin surges to new all-time high as institutional adoption accelerates",
        "Ethereum network congestion causes gas fees to spike dramatically",
        "Major crypto exchange announces bankruptcy, users unable to withdraw funds",
        "DeFi protocol launches innovative yield farming strategy with 100% APY",
        "Regulatory concerns mount as SEC targets major cryptocurrency projects",
        "Bullish momentum continues as Bitcoin breaks through key resistance level",
        "Market correction underway as whales dump holdings onto exchanges",
        "New partnership announced between leading blockchain and Fortune 500 company",
        "Technical analysis suggests bearish divergence forming on daily charts",
        "Crypto market remains sideways as traders await Fed interest rate decision"
    ]


if __name__ == '__main__':
    # Test sentiment analyzer
    logging.basicConfig(level=logging.INFO)
    
    print("Initializing sentiment analyzer...")
    analyzer = SentimentAnalyzer()
    
    print("\nAnalyzing synthetic texts...")
    texts = create_synthetic_texts()
    
    results = analyzer.analyze_batch(texts)
    
    print(f"\n{'='*80}")
    print("Sentiment Analysis Results")
    print(f"{'='*80}")
    
    for i, (text, result) in enumerate(zip(texts, results)):
        print(f"\n{i+1}. {text[:70]}...")
        print(f"   Label:      {result['label']}")
        print(f"   Compound:   {result['compound']:+.3f}")
        print(f"   Confidence: {result['confidence']:.3f}")
    
    # Test multi-source aggregation
    print(f"\n{'='*80}")
    print("Multi-Source Aggregation Test")
    print(f"{'='*80}")
    
    sources = {
        'twitter': results[:3],
        'reddit': results[3:6],
        'news': results[6:9]
    }
    
    aggregated = analyzer.aggregate_multi_source(sources)
    
    print(f"\nAggregated Sentiment:")
    print(f"  Label:       {aggregated['label']}")
    print(f"  Compound:    {aggregated['compound']:+.3f}")
    print(f"  Confidence:  {aggregated['confidence']:.3f}")
    print(f"  Total Mentions: {aggregated['total_mentions']}")
    
    # Test trading signal
    signal = analyzer.get_trading_signal('BTC/USD', sources)
    
    print(f"\nTrading Signal:")
    print(f"  Symbol:      {signal['symbol']}")
    print(f"  Action:      {signal['action']}")
    print(f"  Strength:    {signal['strength']:.3f}")
    print(f"  Confidence:  {signal['confidence']:.3f}")
    
    print(f"\n{'='*80}")
    print("✅ Sentiment analyzer test complete!")
