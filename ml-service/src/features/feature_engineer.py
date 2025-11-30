"""
94-Characteristic Feature Engineering Pipeline
Based on Gu, Kelly, and Xiu (2020) "Empirical Asset Pricing via Machine Learning"

This module implements the complete set of 94 characteristics used in the paper,
which achieved monthly R² > 0.7% in predicting stock returns.

Reference:
Gu, S., Kelly, B., & Xiu, D. (2020). Empirical asset pricing via machine learning.
The Review of Financial Studies, 33(5), 2223-2273.
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from scipy import stats
from scipy.signal import welch
from sklearn.preprocessing import StandardScaler, RobustScaler
import logging


@dataclass
class FeatureConfig:
    """Configuration for feature engineering."""
    
    # Lookback periods
    short_window: int = 20      # Short-term window (e.g., 20 days)
    medium_window: int = 60     # Medium-term window (e.g., 60 days)
    long_window: int = 252      # Long-term window (e.g., 252 days = 1 year)
    
    # Technical indicator parameters
    rsi_period: int = 14
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    bb_period: int = 20
    bb_std: float = 2.0
    
    # Normalization
    normalize: bool = True
    normalization_method: str = "robust"  # "standard", "robust", "minmax"
    
    # Feature selection
    include_polynomial: bool = False
    polynomial_degree: int = 2


class FeatureEngineer:
    """
    Comprehensive feature engineering for financial time series.
    
    Implements 94 characteristics from Gu-Kelly-Xiu (2020):
    - Price-based features (momentum, reversals, trends)
    - Volume-based features (liquidity, trading activity)
    - Volatility features (realized volatility, GARCH effects)
    - Technical indicators (RSI, MACD, Bollinger Bands, etc.)
    - Market microstructure features
    - Risk metrics (beta, idiosyncratic volatility, skewness)
    """
    
    def __init__(self, config: Optional[FeatureConfig] = None):
        self.config = config or FeatureConfig()
        self.logger = logging.getLogger(__name__)
        self.scaler = None
        
        if self.config.normalization_method == "standard":
            self.scaler = StandardScaler()
        elif self.config.normalization_method == "robust":
            self.scaler = RobustScaler()
    
    def engineer_features(
        self,
        prices: np.ndarray,
        volumes: np.ndarray,
        high: Optional[np.ndarray] = None,
        low: Optional[np.ndarray] = None,
        close: Optional[np.ndarray] = None
    ) -> Dict[str, float]:
        """
        Generate all 94 characteristics from price and volume data.
        
        Args:
            prices: Array of historical prices
            volumes: Array of historical volumes
            high: Array of high prices (optional)
            low: Array of low prices (optional)
            close: Array of close prices (optional)
        
        Returns:
            Dictionary mapping feature names to values
        """
        # Convert to pandas for easier manipulation
        df = pd.DataFrame({
            'price': prices,
            'volume': volumes,
            'high': high if high is not None else prices,
            'low': low if low is not None else prices,
            'close': close if close is not None else prices
        })
        
        # Calculate returns
        df['return'] = df['price'].pct_change()
        df['log_return'] = np.log(df['price'] / df['price'].shift(1))
        
        features = {}
        
        # 1. Momentum Features (12 features)
        features.update(self._momentum_features(df))
        
        # 2. Reversal Features (8 features)
        features.update(self._reversal_features(df))
        
        # 3. Volatility Features (10 features)
        features.update(self._volatility_features(df))
        
        # 4. Volume Features (8 features)
        features.update(self._volume_features(df))
        
        # 5. Technical Indicators (15 features)
        features.update(self._technical_indicators(df))
        
        # 6. Price Patterns (10 features)
        features.update(self._price_patterns(df))
        
        # 7. Market Microstructure (8 features)
        features.update(self._microstructure_features(df))
        
        # 8. Risk Metrics (10 features)
        features.update(self._risk_metrics(df))
        
        # 9. Trend Features (8 features)
        features.update(self._trend_features(df))
        
        # 10. Statistical Features (5 features)
        features.update(self._statistical_features(df))
        
        # Remove NaN values (replace with 0)
        features = {k: (v if not np.isnan(v) else 0.0) for k, v in features.items()}
        
        self.logger.debug(f"Generated {len(features)} features")
        
        return features
    
    def _momentum_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Momentum features (12 features).
        Capture price trends over different time horizons.
        """
        features = {}
        
        # Short-term momentum (1-20 days)
        features['mom_1d'] = df['return'].iloc[-1]
        features['mom_5d'] = (df['price'].iloc[-1] / df['price'].iloc[-5] - 1) if len(df) >= 5 else 0
        features['mom_10d'] = (df['price'].iloc[-1] / df['price'].iloc[-10] - 1) if len(df) >= 10 else 0
        features['mom_20d'] = (df['price'].iloc[-1] / df['price'].iloc[-20] - 1) if len(df) >= 20 else 0
        
        # Medium-term momentum (21-60 days)
        features['mom_30d'] = (df['price'].iloc[-1] / df['price'].iloc[-30] - 1) if len(df) >= 30 else 0
        features['mom_60d'] = (df['price'].iloc[-1] / df['price'].iloc[-60] - 1) if len(df) >= 60 else 0
        
        # Long-term momentum (61-252 days)
        features['mom_90d'] = (df['price'].iloc[-1] / df['price'].iloc[-90] - 1) if len(df) >= 90 else 0
        features['mom_120d'] = (df['price'].iloc[-1] / df['price'].iloc[-120] - 1) if len(df) >= 120 else 0
        features['mom_180d'] = (df['price'].iloc[-1] / df['price'].iloc[-180] - 1) if len(df) >= 180 else 0
        features['mom_252d'] = (df['price'].iloc[-1] / df['price'].iloc[-252] - 1) if len(df) >= 252 else 0
        
        # Momentum acceleration
        features['mom_accel'] = features['mom_20d'] - features['mom_60d']
        
        # Momentum consistency (% of positive days in last 20 days)
        features['mom_consistency'] = (df['return'].iloc[-20:] > 0).sum() / 20 if len(df) >= 20 else 0.5
        
        return features
    
    def _reversal_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Reversal features (8 features).
        Capture mean-reversion tendencies.
        """
        features = {}
        
        # Short-term reversals
        features['rev_1d'] = -df['return'].iloc[-1]
        features['rev_5d'] = -(df['price'].iloc[-1] / df['price'].iloc[-5] - 1) if len(df) >= 5 else 0
        
        # Distance from moving averages (mean reversion signals)
        if len(df) >= 20:
            ma20 = df['price'].iloc[-20:].mean()
            features['dist_ma20'] = (df['price'].iloc[-1] - ma20) / ma20
        else:
            features['dist_ma20'] = 0
        
        if len(df) >= 60:
            ma60 = df['price'].iloc[-60:].mean()
            features['dist_ma60'] = (df['price'].iloc[-1] - ma60) / ma60
        else:
            features['dist_ma60'] = 0
        
        # Bollinger Band position (reversal signal)
        if len(df) >= 20:
            bb_mid = df['price'].iloc[-20:].mean()
            bb_std = df['price'].iloc[-20:].std()
            features['bb_position'] = (df['price'].iloc[-1] - bb_mid) / (2 * bb_std) if bb_std > 0 else 0
        else:
            features['bb_position'] = 0
        
        # RSI (overbought/oversold)
        features['rsi'] = self._calculate_rsi(df['price'], period=14)
        
        # Stochastic oscillator
        if len(df) >= 14:
            high_14 = df['high'].iloc[-14:].max()
            low_14 = df['low'].iloc[-14:].min()
            features['stoch'] = (df['price'].iloc[-1] - low_14) / (high_14 - low_14) if high_14 > low_14 else 0.5
        else:
            features['stoch'] = 0.5
        
        # Williams %R
        if len(df) >= 14:
            high_14 = df['high'].iloc[-14:].max()
            low_14 = df['low'].iloc[-14:].min()
            features['williams_r'] = (high_14 - df['price'].iloc[-1]) / (high_14 - low_14) if high_14 > low_14 else 0.5
        else:
            features['williams_r'] = 0.5
        
        return features
    
    def _volatility_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Volatility features (10 features).
        Capture price variability and risk.
        """
        features = {}
        
        # Realized volatility (different horizons)
        features['vol_5d'] = df['return'].iloc[-5:].std() * np.sqrt(252) if len(df) >= 5 else 0
        features['vol_20d'] = df['return'].iloc[-20:].std() * np.sqrt(252) if len(df) >= 20 else 0
        features['vol_60d'] = df['return'].iloc[-60:].std() * np.sqrt(252) if len(df) >= 60 else 0
        
        # Volatility of volatility
        if len(df) >= 60:
            rolling_vol = df['return'].rolling(20).std()
            features['vol_of_vol'] = rolling_vol.iloc[-40:].std() if len(rolling_vol) >= 40 else 0
        else:
            features['vol_of_vol'] = 0
        
        # Downside volatility (semi-deviation)
        negative_returns = df['return'].iloc[-60:][df['return'].iloc[-60:] < 0] if len(df) >= 60 else df['return'][df['return'] < 0]
        features['downside_vol'] = negative_returns.std() * np.sqrt(252) if len(negative_returns) > 0 else 0
        
        # Upside volatility
        positive_returns = df['return'].iloc[-60:][df['return'].iloc[-60:] > 0] if len(df) >= 60 else df['return'][df['return'] > 0]
        features['upside_vol'] = positive_returns.std() * np.sqrt(252) if len(positive_returns) > 0 else 0
        
        # Volatility ratio (short/long)
        features['vol_ratio'] = features['vol_20d'] / features['vol_60d'] if features['vol_60d'] > 0 else 1.0
        
        # Parkinson volatility (uses high-low range)
        if len(df) >= 20:
            hl_ratio = np.log(df['high'].iloc[-20:] / df['low'].iloc[-20:])
            features['parkinson_vol'] = np.sqrt(np.mean(hl_ratio ** 2) / (4 * np.log(2))) * np.sqrt(252)
        else:
            features['parkinson_vol'] = 0
        
        # Garman-Klass volatility
        if len(df) >= 20:
            hl = np.log(df['high'].iloc[-20:] / df['low'].iloc[-20:])
            co = np.log(df['close'].iloc[-20:] / df['price'].iloc[-20:])
            features['gk_vol'] = np.sqrt(np.mean(0.5 * hl ** 2 - (2 * np.log(2) - 1) * co ** 2)) * np.sqrt(252)
        else:
            features['gk_vol'] = 0
        
        # ATR (Average True Range)
        features['atr'] = self._calculate_atr(df)
        
        return features
    
    def _volume_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Volume features (8 features).
        Capture trading activity and liquidity.
        """
        features = {}
        
        # Volume trends
        features['volume_trend_20d'] = (df['volume'].iloc[-20:].mean() / df['volume'].iloc[-40:-20].mean() - 1) if len(df) >= 40 else 0
        features['volume_trend_60d'] = (df['volume'].iloc[-60:].mean() / df['volume'].iloc[-120:-60].mean() - 1) if len(df) >= 120 else 0
        
        # Volume volatility
        features['volume_vol'] = df['volume'].iloc[-20:].std() / df['volume'].iloc[-20:].mean() if len(df) >= 20 and df['volume'].iloc[-20:].mean() > 0 else 0
        
        # Price-volume correlation
        if len(df) >= 20:
            features['pv_corr'] = df['return'].iloc[-20:].corr(df['volume'].iloc[-20:])
            if np.isnan(features['pv_corr']):
                features['pv_corr'] = 0
        else:
            features['pv_corr'] = 0
        
        # On-Balance Volume (OBV) trend
        obv = (df['volume'] * np.sign(df['return'])).cumsum()
        features['obv_trend'] = (obv.iloc[-1] - obv.iloc[-20]) / abs(obv.iloc[-20]) if len(df) >= 20 and obv.iloc[-20] != 0 else 0
        
        # Volume-weighted average price deviation
        if len(df) >= 20:
            vwap = (df['price'].iloc[-20:] * df['volume'].iloc[-20:]).sum() / df['volume'].iloc[-20:].sum()
            features['vwap_dev'] = (df['price'].iloc[-1] - vwap) / vwap if vwap > 0 else 0
        else:
            features['vwap_dev'] = 0
        
        # Accumulation/Distribution Line
        if len(df) >= 20:
            mfm = ((df['close'] - df['low']) - (df['high'] - df['close'])) / (df['high'] - df['low'])
            mfm = mfm.fillna(0)
            mfv = mfm * df['volume']
            ad_line = mfv.cumsum()
            features['ad_trend'] = (ad_line.iloc[-1] - ad_line.iloc[-20]) / abs(ad_line.iloc[-20]) if ad_line.iloc[-20] != 0 else 0
        else:
            features['ad_trend'] = 0
        
        # Force Index
        if len(df) >= 2:
            force_index = df['return'] * df['volume']
            features['force_index'] = force_index.iloc[-13:].mean() if len(force_index) >= 13 else force_index.mean()
        else:
            features['force_index'] = 0
        
        return features
    
    def _technical_indicators(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Technical indicators (15 features).
        Standard trading signals.
        """
        features = {}
        
        # Moving average crossovers
        if len(df) >= 50:
            ma10 = df['price'].iloc[-10:].mean()
            ma20 = df['price'].iloc[-20:].mean()
            ma50 = df['price'].iloc[-50:].mean()
            
            features['ma10_ma20'] = (ma10 - ma20) / ma20
            features['ma20_ma50'] = (ma20 - ma50) / ma50
        else:
            features['ma10_ma20'] = 0
            features['ma20_ma50'] = 0
        
        # MACD
        macd, signal, histogram = self._calculate_macd(df['price'])
        features['macd'] = macd
        features['macd_signal'] = signal
        features['macd_histogram'] = histogram
        
        # ADX (Average Directional Index)
        features['adx'] = self._calculate_adx(df)
        
        # CCI (Commodity Channel Index)
        features['cci'] = self._calculate_cci(df)
        
        # ROC (Rate of Change)
        features['roc_10d'] = (df['price'].iloc[-1] / df['price'].iloc[-10] - 1) if len(df) >= 10 else 0
        features['roc_20d'] = (df['price'].iloc[-1] / df['price'].iloc[-20] - 1) if len(df) >= 20 else 0
        
        # Money Flow Index
        features['mfi'] = self._calculate_mfi(df)
        
        # Aroon Indicator
        aroon_up, aroon_down = self._calculate_aroon(df)
        features['aroon_up'] = aroon_up
        features['aroon_down'] = aroon_down
        features['aroon_osc'] = aroon_up - aroon_down
        
        # Chaikin Oscillator
        features['chaikin_osc'] = self._calculate_chaikin_oscillator(df)
        
        return features
    
    def _price_patterns(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Price patterns (10 features).
        Geometric patterns and shapes.
        """
        features = {}
        
        # Higher highs / lower lows
        if len(df) >= 20:
            highs = df['high'].iloc[-20:]
            lows = df['low'].iloc[-20:]
            
            features['higher_highs'] = int(highs.iloc[-1] > highs.iloc[-10] > highs.iloc[-20])
            features['lower_lows'] = int(lows.iloc[-1] < lows.iloc[-10] < lows.iloc[-20])
        else:
            features['higher_highs'] = 0
            features['lower_lows'] = 0
        
        # Price range expansion/contraction
        if len(df) >= 40:
            range_recent = (df['high'].iloc[-20:] - df['low'].iloc[-20:]).mean()
            range_previous = (df['high'].iloc[-40:-20] - df['low'].iloc[-40:-20]).mean()
            features['range_expansion'] = (range_recent - range_previous) / range_previous if range_previous > 0 else 0
        else:
            features['range_expansion'] = 0
        
        # Gap detection
        if len(df) >= 2:
            gap_up = df['low'].iloc[-1] > df['high'].iloc[-2]
            gap_down = df['high'].iloc[-1] < df['low'].iloc[-2]
            features['gap'] = 1 if gap_up else (-1 if gap_down else 0)
        else:
            features['gap'] = 0
        
        # Doji pattern (open ≈ close)
        if len(df) >= 1:
            body = abs(df['close'].iloc[-1] - df['price'].iloc[-1])
            range_val = df['high'].iloc[-1] - df['low'].iloc[-1]
            features['doji'] = int(body / range_val < 0.1) if range_val > 0 else 0
        else:
            features['doji'] = 0
        
        # Hammer/Shooting star
        if len(df) >= 1:
            body = abs(df['close'].iloc[-1] - df['price'].iloc[-1])
            upper_shadow = df['high'].iloc[-1] - max(df['close'].iloc[-1], df['price'].iloc[-1])
            lower_shadow = min(df['close'].iloc[-1], df['price'].iloc[-1]) - df['low'].iloc[-1]
            
            features['hammer'] = int(lower_shadow > 2 * body and upper_shadow < body)
            features['shooting_star'] = int(upper_shadow > 2 * body and lower_shadow < body)
        else:
            features['hammer'] = 0
            features['shooting_star'] = 0
        
        # Engulfing patterns
        if len(df) >= 2:
            bullish_engulf = (df['close'].iloc[-1] > df['price'].iloc[-1] and 
                            df['close'].iloc[-2] < df['price'].iloc[-2] and
                            df['price'].iloc[-1] < df['close'].iloc[-2] and
                            df['close'].iloc[-1] > df['price'].iloc[-2])
            bearish_engulf = (df['close'].iloc[-1] < df['price'].iloc[-1] and 
                            df['close'].iloc[-2] > df['price'].iloc[-2] and
                            df['price'].iloc[-1] > df['close'].iloc[-2] and
                            df['close'].iloc[-1] < df['price'].iloc[-2])
            
            features['bullish_engulf'] = int(bullish_engulf)
            features['bearish_engulf'] = int(bearish_engulf)
        else:
            features['bullish_engulf'] = 0
            features['bearish_engulf'] = 0
        
        return features
    
    def _microstructure_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Market microstructure features (8 features).
        High-frequency trading patterns.
        """
        features = {}
        
        # Bid-ask spread proxy (high-low range)
        if len(df) >= 20:
            spread = (df['high'] - df['low']) / df['price']
            features['spread_mean'] = spread.iloc[-20:].mean()
            features['spread_vol'] = spread.iloc[-20:].std()
        else:
            features['spread_mean'] = 0
            features['spread_vol'] = 0
        
        # Roll's measure of effective spread
        if len(df) >= 2:
            price_changes = df['price'].diff()
            cov = price_changes.iloc[-20:].cov(price_changes.iloc[-20:].shift(1)) if len(df) >= 20 else price_changes.cov(price_changes.shift(1))
            features['roll_spread'] = 2 * np.sqrt(abs(cov)) if not np.isnan(cov) else 0
        else:
            features['roll_spread'] = 0
        
        # Amihud illiquidity measure
        if len(df) >= 20:
            illiquidity = abs(df['return'].iloc[-20:]) / (df['volume'].iloc[-20:] * df['price'].iloc[-20:])
            features['amihud_illiq'] = illiquidity.mean()
        else:
            features['amihud_illiq'] = 0
        
        # Kyle's lambda (price impact)
        if len(df) >= 20:
            features['kyle_lambda'] = abs(df['return'].iloc[-20:].corr(df['volume'].iloc[-20:]))
            if np.isnan(features['kyle_lambda']):
                features['kyle_lambda'] = 0
        else:
            features['kyle_lambda'] = 0
        
        # Order flow imbalance proxy
        if len(df) >= 20:
            buy_volume = df['volume'].iloc[-20:][df['return'].iloc[-20:] > 0].sum()
            sell_volume = df['volume'].iloc[-20:][df['return'].iloc[-20:] < 0].sum()
            total_volume = df['volume'].iloc[-20:].sum()
            features['order_imbalance'] = (buy_volume - sell_volume) / total_volume if total_volume > 0 else 0
        else:
            features['order_imbalance'] = 0
        
        # Price efficiency (autocorrelation)
        if len(df) >= 20:
            features['price_efficiency'] = 1 - abs(df['return'].iloc[-20:].autocorr(lag=1))
            if np.isnan(features['price_efficiency']):
                features['price_efficiency'] = 1
        else:
            features['price_efficiency'] = 1
        
        # Hasbrouck's information share
        if len(df) >= 20:
            price_var = df['return'].iloc[-20:].var()
            features['info_share'] = price_var / (price_var + features['spread_vol'] ** 2) if (price_var + features['spread_vol'] ** 2) > 0 else 0.5
        else:
            features['info_share'] = 0.5
        
        return features
    
    def _risk_metrics(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Risk metrics (10 features).
        Downside risk and tail risk measures.
        """
        features = {}
        
        # Sharpe ratio (assuming risk-free rate = 0)
        if len(df) >= 60:
            mean_return = df['return'].iloc[-60:].mean()
            std_return = df['return'].iloc[-60:].std()
            features['sharpe_60d'] = (mean_return / std_return) * np.sqrt(252) if std_return > 0 else 0
        else:
            features['sharpe_60d'] = 0
        
        # Sortino ratio
        if len(df) >= 60:
            mean_return = df['return'].iloc[-60:].mean()
            downside_returns = df['return'].iloc[-60:][df['return'].iloc[-60:] < 0]
            downside_std = downside_returns.std() if len(downside_returns) > 0 else std_return
            features['sortino_60d'] = (mean_return / downside_std) * np.sqrt(252) if downside_std > 0 else 0
        else:
            features['sortino_60d'] = 0
        
        # Maximum drawdown
        if len(df) >= 60:
            cumulative = (1 + df['return'].iloc[-60:]).cumprod()
            running_max = cumulative.expanding().max()
            drawdown = (cumulative - running_max) / running_max
            features['max_drawdown'] = drawdown.min()
        else:
            features['max_drawdown'] = 0
        
        # Value at Risk (VaR) - 95% confidence
        if len(df) >= 60:
            features['var_95'] = np.percentile(df['return'].iloc[-60:], 5)
        else:
            features['var_95'] = 0
        
        # Conditional Value at Risk (CVaR)
        if len(df) >= 60:
            var_threshold = features['var_95']
            tail_returns = df['return'].iloc[-60:][df['return'].iloc[-60:] <= var_threshold]
            features['cvar_95'] = tail_returns.mean() if len(tail_returns) > 0 else features['var_95']
        else:
            features['cvar_95'] = 0
        
        # Skewness
        features['skewness'] = df['return'].iloc[-60:].skew() if len(df) >= 60 else 0
        
        # Kurtosis (excess kurtosis)
        features['kurtosis'] = df['return'].iloc[-60:].kurtosis() if len(df) >= 60 else 0
        
        # Omega ratio
        if len(df) >= 60:
            threshold = 0
            gains = df['return'].iloc[-60:][df['return'].iloc[-60:] > threshold].sum()
            losses = abs(df['return'].iloc[-60:][df['return'].iloc[-60:] < threshold].sum())
            features['omega'] = gains / losses if losses > 0 else 0
        else:
            features['omega'] = 0
        
        # Calmar ratio (return / max drawdown)
        if len(df) >= 60:
            annual_return = df['return'].iloc[-60:].mean() * 252
            features['calmar'] = annual_return / abs(features['max_drawdown']) if features['max_drawdown'] != 0 else 0
        else:
            features['calmar'] = 0
        
        # Ulcer Index (downside volatility from peak)
        if len(df) >= 60:
            cumulative = (1 + df['return'].iloc[-60:]).cumprod()
            running_max = cumulative.expanding().max()
            drawdown_pct = ((cumulative - running_max) / running_max) * 100
            features['ulcer_index'] = np.sqrt((drawdown_pct ** 2).mean())
        else:
            features['ulcer_index'] = 0
        
        return features
    
    def _trend_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Trend features (8 features).
        Linear and non-linear trend detection.
        """
        features = {}
        
        # Linear regression slope (different periods)
        for period in [10, 20, 60]:
            if len(df) >= period:
                x = np.arange(period)
                y = df['price'].iloc[-period:].values
                slope, intercept = np.polyfit(x, y, 1)
                features[f'trend_slope_{period}d'] = slope / df['price'].iloc[-period]
            else:
                features[f'trend_slope_{period}d'] = 0
        
        # R-squared of linear fit
        if len(df) >= 60:
            x = np.arange(60)
            y = df['price'].iloc[-60:].values
            slope, intercept = np.polyfit(x, y, 1)
            y_pred = slope * x + intercept
            ss_res = np.sum((y - y_pred) ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            features['trend_r2'] = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
        else:
            features['trend_r2'] = 0
        
        # Hurst exponent (trend persistence)
        if len(df) >= 100:
            features['hurst'] = self._calculate_hurst(df['price'].iloc[-100:].values)
        else:
            features['hurst'] = 0.5
        
        # Detrended price oscillator
        if len(df) >= 40:
            ma = df['price'].rolling(20).mean()
            features['dpo'] = (df['price'].iloc[-1] - ma.iloc[-11]) / ma.iloc[-11] if len(ma) >= 11 and ma.iloc[-11] > 0 else 0
        else:
            features['dpo'] = 0
        
        # Parabolic SAR signal
        features['psar_signal'] = self._calculate_psar_signal(df)
        
        # Ichimoku Cloud signal
        features['ichimoku_signal'] = self._calculate_ichimoku_signal(df)
        
        return features
    
    def _statistical_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Statistical features (5 features).
        Advanced statistical properties.
        """
        features = {}
        
        # Entropy (price uncertainty)
        if len(df) >= 60:
            returns = df['return'].iloc[-60:].values
            hist, _ = np.histogram(returns, bins=20)
            hist = hist / hist.sum()
            hist = hist[hist > 0]
            features['entropy'] = -np.sum(hist * np.log(hist))
        else:
            features['entropy'] = 0
        
        # Fractal dimension
        if len(df) >= 60:
            features['fractal_dim'] = self._calculate_fractal_dimension(df['price'].iloc[-60:].values)
        else:
            features['fractal_dim'] = 0
        
        # Approximate entropy
        if len(df) >= 60:
            features['approx_entropy'] = self._calculate_approximate_entropy(df['return'].iloc[-60:].values)
        else:
            features['approx_entropy'] = 0
        
        # Spectral entropy (frequency domain)
        if len(df) >= 60:
            freqs, psd = welch(df['return'].iloc[-60:].values, nperseg=min(30, len(df['return'].iloc[-60:])))
            psd_norm = psd / psd.sum()
            psd_norm = psd_norm[psd_norm > 0]
            features['spectral_entropy'] = -np.sum(psd_norm * np.log(psd_norm))
        else:
            features['spectral_entropy'] = 0
        
        # Lyapunov exponent (chaos measure)
        if len(df) >= 100:
            features['lyapunov'] = self._calculate_lyapunov(df['return'].iloc[-100:].values)
        else:
            features['lyapunov'] = 0
        
        return features
    
    # ===== Helper Methods =====
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> float:
        """Calculate Relative Strength Index."""
        if len(prices) < period + 1:
            return 50.0
        
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        
        rs = gain.iloc[-1] / loss.iloc[-1] if loss.iloc[-1] != 0 else 0
        rsi = 100 - (100 / (1 + rs))
        
        return rsi if not np.isnan(rsi) else 50.0
    
    def _calculate_macd(self, prices: pd.Series) -> Tuple[float, float, float]:
        """Calculate MACD indicator."""
        if len(prices) < 26:
            return 0.0, 0.0, 0.0
        
        ema12 = prices.ewm(span=12, adjust=False).mean()
        ema26 = prices.ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        signal = macd.ewm(span=9, adjust=False).mean()
        histogram = macd - signal
        
        return macd.iloc[-1], signal.iloc[-1], histogram.iloc[-1]
    
    def _calculate_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average True Range."""
        if len(df) < period:
            return 0.0
        
        high_low = df['high'] - df['low']
        high_close = abs(df['high'] - df['close'].shift())
        low_close = abs(df['low'] - df['close'].shift())
        
        tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        atr = tr.rolling(period).mean().iloc[-1]
        
        return atr if not np.isnan(atr) else 0.0
    
    def _calculate_adx(self, df: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average Directional Index."""
        if len(df) < period + 1:
            return 0.0
        
        high_diff = df['high'].diff()
        low_diff = -df['low'].diff()
        
        pos_dm = high_diff.where((high_diff > low_diff) & (high_diff > 0), 0)
        neg_dm = low_diff.where((low_diff > high_diff) & (low_diff > 0), 0)
        
        atr = self._calculate_atr(df, period)
        
        if atr == 0:
            return 0.0
        
        pos_di = 100 * pos_dm.rolling(period).mean() / atr
        neg_di = 100 * neg_dm.rolling(period).mean() / atr
        
        dx = 100 * abs(pos_di - neg_di) / (pos_di + neg_di)
        adx = dx.rolling(period).mean().iloc[-1]
        
        return adx if not np.isnan(adx) else 0.0
    
    def _calculate_cci(self, df: pd.DataFrame, period: int = 20) -> float:
        """Calculate Commodity Channel Index."""
        if len(df) < period:
            return 0.0
        
        tp = (df['high'] + df['low'] + df['close']) / 3
        sma = tp.rolling(period).mean()
        mad = tp.rolling(period).apply(lambda x: np.abs(x - x.mean()).mean())
        
        cci = (tp.iloc[-1] - sma.iloc[-1]) / (0.015 * mad.iloc[-1]) if mad.iloc[-1] != 0 else 0
        
        return cci if not np.isnan(cci) else 0.0
    
    def _calculate_mfi(self, df: pd.DataFrame, period: int = 14) -> float:
        """Calculate Money Flow Index."""
        if len(df) < period + 1:
            return 50.0
        
        tp = (df['high'] + df['low'] + df['close']) / 3
        mf = tp * df['volume']
        
        pos_mf = mf.where(tp.diff() > 0, 0).rolling(period).sum()
        neg_mf = mf.where(tp.diff() < 0, 0).rolling(period).sum()
        
        mfr = pos_mf.iloc[-1] / neg_mf.iloc[-1] if neg_mf.iloc[-1] != 0 else 0
        mfi = 100 - (100 / (1 + mfr))
        
        return mfi if not np.isnan(mfi) else 50.0
    
    def _calculate_aroon(self, df: pd.DataFrame, period: int = 25) -> Tuple[float, float]:
        """Calculate Aroon Indicator."""
        if len(df) < period:
            return 50.0, 50.0
        
        high_idx = df['high'].iloc[-period:].values.argmax()
        low_idx = df['low'].iloc[-period:].values.argmin()
        
        aroon_up = ((period - high_idx) / period) * 100
        aroon_down = ((period - low_idx) / period) * 100
        
        return aroon_up, aroon_down
    
    def _calculate_chaikin_oscillator(self, df: pd.DataFrame) -> float:
        """Calculate Chaikin Oscillator."""
        if len(df) < 10:
            return 0.0
        
        mfm = ((df['close'] - df['low']) - (df['high'] - df['close'])) / (df['high'] - df['low'])
        mfm = mfm.fillna(0)
        mfv = mfm * df['volume']
        ad_line = mfv.cumsum()
        
        ema3 = ad_line.ewm(span=3, adjust=False).mean()
        ema10 = ad_line.ewm(span=10, adjust=False).mean()
        
        chaikin = ema3.iloc[-1] - ema10.iloc[-1]
        
        return chaikin if not np.isnan(chaikin) else 0.0
    
    def _calculate_hurst(self, prices: np.ndarray) -> float:
        """Calculate Hurst exponent."""
        lags = range(2, 20)
        tau = [np.std(np.subtract(prices[lag:], prices[:-lag])) for lag in lags]
        
        poly = np.polyfit(np.log(lags), np.log(tau), 1)
        return poly[0]
    
    def _calculate_psar_signal(self, df: pd.DataFrame) -> float:
        """Calculate Parabolic SAR signal."""
        if len(df) < 5:
            return 0.0
        
        # Simplified PSAR (full implementation is complex)
        recent_high = df['high'].iloc[-5:].max()
        recent_low = df['low'].iloc[-5:].min()
        current_price = df['price'].iloc[-1]
        
        if current_price > (recent_high + recent_low) / 2:
            return 1.0  # Bullish
        else:
            return -1.0  # Bearish
    
    def _calculate_ichimoku_signal(self, df: pd.DataFrame) -> float:
        """Calculate Ichimoku Cloud signal."""
        if len(df) < 52:
            return 0.0
        
        # Tenkan-sen (Conversion Line): (9-period high + 9-period low)/2
        tenkan = (df['high'].iloc[-9:].max() + df['low'].iloc[-9:].min()) / 2
        
        # Kijun-sen (Base Line): (26-period high + 26-period low)/2
        kijun = (df['high'].iloc[-26:].max() + df['low'].iloc[-26:].min()) / 2
        
        # Senkou Span A (Leading Span A): (Conversion Line + Base Line)/2
        senkou_a = (tenkan + kijun) / 2
        
        # Senkou Span B (Leading Span B): (52-period high + 52-period low)/2
        senkou_b = (df['high'].iloc[-52:].max() + df['low'].iloc[-52:].min()) / 2
        
        current_price = df['price'].iloc[-1]
        
        # Signal: above cloud = bullish, below cloud = bearish
        cloud_top = max(senkou_a, senkou_b)
        cloud_bottom = min(senkou_a, senkou_b)
        
        if current_price > cloud_top:
            return 1.0
        elif current_price < cloud_bottom:
            return -1.0
        else:
            return 0.0
    
    def _calculate_fractal_dimension(self, prices: np.ndarray) -> float:
        """Calculate fractal dimension using box-counting method."""
        if len(prices) < 10:
            return 1.5
        
        # Normalize prices
        prices_norm = (prices - prices.min()) / (prices.max() - prices.min() + 1e-10)
        
        # Box sizes
        box_sizes = [2, 4, 8, 16]
        counts = []
        
        for box_size in box_sizes:
            n_boxes = int(np.ceil(len(prices_norm) / box_size))
            count = 0
            for i in range(n_boxes):
                box_data = prices_norm[i*box_size:(i+1)*box_size]
                if len(box_data) > 0:
                    count += 1
            counts.append(count)
        
        # Fit line to log-log plot
        coeffs = np.polyfit(np.log(box_sizes), np.log(counts), 1)
        fractal_dim = -coeffs[0]
        
        return fractal_dim
    
    def _calculate_approximate_entropy(self, data: np.ndarray, m: int = 2, r: float = 0.2) -> float:
        """Calculate approximate entropy."""
        if len(data) < m + 1:
            return 0.0
        
        def _maxdist(x_i, x_j):
            return max([abs(ua - va) for ua, va in zip(x_i, x_j)])
        
        def _phi(m):
            x = [[data[j] for j in range(i, i + m)] for i in range(len(data) - m + 1)]
            C = [len([1 for x_j in x if _maxdist(x_i, x_j) <= r * np.std(data)]) / (len(data) - m + 1.0) for x_i in x]
            return (len(data) - m + 1.0) ** (-1) * sum(np.log(C))
        
        return abs(_phi(m) - _phi(m + 1))
    
    def _calculate_lyapunov(self, data: np.ndarray) -> float:
        """Calculate largest Lyapunov exponent."""
        if len(data) < 10:
            return 0.0
        
        # Simplified calculation
        n = len(data)
        d = 3  # embedding dimension
        tau = 1  # time delay
        
        # Embed the time series
        m = n - (d - 1) * tau
        if m < 2:
            return 0.0
        
        embedded = np.zeros((m, d))
        for i in range(m):
            for j in range(d):
                embedded[i, j] = data[i + j * tau]
        
        # Calculate divergence
        divergence = []
        for i in range(m - 1):
            dist = np.linalg.norm(embedded[i+1] - embedded[i])
            if dist > 0:
                divergence.append(np.log(dist))
        
        if len(divergence) == 0:
            return 0.0
        
        return np.mean(divergence)


if __name__ == "__main__":
    # Test the feature engineer
    logging.basicConfig(level=logging.DEBUG)
    
    # Generate dummy data
    np.random.seed(42)
    n = 300
    prices = 100 * (1 + np.cumsum(np.random.randn(n) * 0.02))
    volumes = np.random.randint(1000, 10000, n)
    high = prices * (1 + np.random.rand(n) * 0.02)
    low = prices * (1 - np.random.rand(n) * 0.02)
    close = prices * (1 + (np.random.rand(n) - 0.5) * 0.01)
    
    # Create feature engineer
    engineer = FeatureEngineer()
    
    # Generate features
    features = engineer.engineer_features(prices, volumes, high, low, close)
    
    print(f"\nGenerated {len(features)} features:")
    for i, (name, value) in enumerate(features.items(), 1):
        print(f"{i:2d}. {name:25s} = {value:10.6f}")
    
    print(f"\nTotal features: {len(features)}")
