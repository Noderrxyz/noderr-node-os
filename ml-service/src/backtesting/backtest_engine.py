"""
Comprehensive Backtesting Framework for Trading Strategies

This module implements event-driven backtesting with:
1. Realistic order execution and slippage
2. Transaction cost modeling
3. Comprehensive risk metrics
4. Performance attribution
5. Walk-forward validation

References:
- Prado, M. L. (2018). Advances in Financial Machine Learning
- Bailey, D. H., et al. (2014). Pseudo-Mathematics and Financial Charlatanism
- Harvey, C. R., et al. (2016). ... and the Cross-Section of Expected Returns
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class OrderSide(Enum):
    """Order side."""
    BUY = "buy"
    SELL = "sell"


class OrderStatus(Enum):
    """Order status."""
    PENDING = "pending"
    FILLED = "filled"
    CANCELLED = "cancelled"


@dataclass
class Order:
    """Trading order."""
    symbol: str
    side: OrderSide
    quantity: float
    price: float
    timestamp: datetime
    status: OrderStatus = OrderStatus.PENDING
    fill_price: Optional[float] = None
    fill_timestamp: Optional[datetime] = None


@dataclass
class Position:
    """Trading position."""
    symbol: str
    quantity: float
    entry_price: float
    entry_timestamp: datetime
    current_price: float = 0.0
    unrealized_pnl: float = 0.0


@dataclass
class Trade:
    """Completed trade."""
    symbol: str
    side: OrderSide
    quantity: float
    entry_price: float
    exit_price: float
    entry_timestamp: datetime
    exit_timestamp: datetime
    pnl: float
    return_pct: float
    holding_period: timedelta


@dataclass
class BacktestConfig:
    """Configuration for backtesting."""
    
    # Capital
    initial_capital: float = 100000.0
    
    # Transaction costs
    commission_rate: float = 0.001  # 0.1%
    slippage_bps: float = 5.0       # 5 basis points
    market_impact_coef: float = 0.1  # Market impact coefficient
    
    # Risk management
    max_position_size: float = 0.2   # 20% of capital per position
    max_leverage: float = 1.0        # No leverage by default
    stop_loss_pct: Optional[float] = None  # Stop loss percentage
    take_profit_pct: Optional[float] = None  # Take profit percentage
    
    # Execution
    execution_delay: int = 1         # Bars delay for execution
    use_market_orders: bool = True   # Use market vs limit orders
    
    # Walk-forward
    train_period_days: int = 252     # Training period (1 year)
    test_period_days: int = 63       # Test period (3 months)
    step_days: int = 21              # Step size (1 month)


class BacktestEngine:
    """
    Event-driven backtesting engine.
    
    Implements realistic backtesting with proper order execution,
    transaction costs, and comprehensive performance metrics.
    """
    
    def __init__(self, config: Optional[BacktestConfig] = None):
        self.config = config or BacktestConfig()
        self.logger = logging.getLogger(__name__)
        
        # State
        self.capital = self.config.initial_capital
        self.positions: Dict[str, Position] = {}
        self.orders: List[Order] = []
        self.trades: List[Trade] = []
        self.equity_curve: List[float] = [self.capital]
        self.timestamps: List[datetime] = []
        
        # Performance tracking
        self.total_pnl = 0.0
        self.total_commission = 0.0
        self.total_slippage = 0.0
    
    def run_backtest(
        self,
        data: pd.DataFrame,
        strategy: Callable,
        **strategy_params
    ) -> Dict:
        """
        Run backtest on historical data.
        
        Args:
            data: DataFrame with OHLCV data
            strategy: Strategy function that returns signals
            **strategy_params: Parameters to pass to strategy
        
        Returns:
            Dictionary with backtest results
        """
        self.logger.info("Starting backtest...")
        
        # Reset state
        self._reset()
        
        # Run through historical data
        for i in range(len(data)):
            timestamp = data.index[i]
            bar = data.iloc[i]
            
            # Update positions with current prices
            self._update_positions(bar)
            
            # Execute pending orders
            self._execute_orders(bar)
            
            # Check stop loss / take profit
            self._check_risk_management(bar)
            
            # Get strategy signal
            if i >= self.config.execution_delay:
                signal = strategy(data.iloc[:i+1], **strategy_params)
                
                if signal is not None:
                    self._process_signal(signal, bar, timestamp)
            
            # Record equity
            equity = self._calculate_equity(bar)
            self.equity_curve.append(equity)
            self.timestamps.append(timestamp)
        
        # Close all positions at end
        final_bar = data.iloc[-1]
        self._close_all_positions(final_bar, data.index[-1])
        
        # Calculate performance metrics
        results = self._calculate_metrics()
        
        self.logger.info("Backtest complete")
        
        return results
    
    def run_walk_forward(
        self,
        data: pd.DataFrame,
        strategy_factory: Callable,
        **strategy_params
    ) -> Dict:
        """
        Run walk-forward analysis.
        
        Args:
            data: DataFrame with OHLCV data
            strategy_factory: Function that creates and trains strategy
            **strategy_params: Parameters for strategy
        
        Returns:
            Dictionary with walk-forward results
        """
        self.logger.info("Starting walk-forward analysis...")
        
        results = []
        
        # Calculate number of windows
        total_days = len(data)
        train_days = self.config.train_period_days
        test_days = self.config.test_period_days
        step_days = self.config.step_days
        
        start_idx = 0
        
        while start_idx + train_days + test_days <= total_days:
            # Split data
            train_end = start_idx + train_days
            test_end = train_end + test_days
            
            train_data = data.iloc[start_idx:train_end]
            test_data = data.iloc[train_end:test_end]
            
            self.logger.info(f"Window: train={train_data.index[0]} to {train_data.index[-1]}, "
                           f"test={test_data.index[0]} to {test_data.index[-1]}")
            
            # Train strategy
            strategy = strategy_factory(train_data, **strategy_params)
            
            # Test strategy
            result = self.run_backtest(test_data, strategy)
            result['train_start'] = train_data.index[0]
            result['train_end'] = train_data.index[-1]
            result['test_start'] = test_data.index[0]
            result['test_end'] = test_data.index[-1]
            
            results.append(result)
            
            # Move window forward
            start_idx += step_days
        
        # Aggregate results
        aggregated = self._aggregate_walk_forward_results(results)
        
        self.logger.info("Walk-forward analysis complete")
        
        return aggregated
    
    def _reset(self):
        """Reset backtest state."""
        self.capital = self.config.initial_capital
        self.positions = {}
        self.orders = []
        self.trades = []
        self.equity_curve = [self.capital]
        self.timestamps = []
        self.total_pnl = 0.0
        self.total_commission = 0.0
        self.total_slippage = 0.0
    
    def _update_positions(self, bar: pd.Series):
        """Update positions with current prices."""
        for symbol, position in self.positions.items():
            if symbol in bar:
                position.current_price = bar[symbol]
                position.unrealized_pnl = (
                    (position.current_price - position.entry_price) * position.quantity
                )
    
    def _execute_orders(self, bar: pd.Series):
        """Execute pending orders."""
        for order in self.orders:
            if order.status == OrderStatus.PENDING:
                # Calculate fill price with slippage
                if self.config.use_market_orders:
                    slippage = self.config.slippage_bps / 10000
                    if order.side == OrderSide.BUY:
                        fill_price = order.price * (1 + slippage)
                    else:
                        fill_price = order.price * (1 - slippage)
                else:
                    fill_price = order.price
                
                # Calculate commission
                commission = abs(order.quantity * fill_price * self.config.commission_rate)
                
                # Execute order
                order.fill_price = fill_price
                order.fill_timestamp = bar.name
                order.status = OrderStatus.FILLED
                
                self.total_commission += commission
                self.total_slippage += abs(fill_price - order.price) * abs(order.quantity)
                
                # Update positions
                if order.side == OrderSide.BUY:
                    if order.symbol in self.positions:
                        # Add to existing position
                        pos = self.positions[order.symbol]
                        total_quantity = pos.quantity + order.quantity
                        pos.entry_price = (
                            (pos.entry_price * pos.quantity + fill_price * order.quantity) / 
                            total_quantity
                        )
                        pos.quantity = total_quantity
                    else:
                        # Open new position
                        self.positions[order.symbol] = Position(
                            symbol=order.symbol,
                            quantity=order.quantity,
                            entry_price=fill_price,
                            entry_timestamp=order.fill_timestamp,
                            current_price=fill_price
                        )
                    
                    self.capital -= order.quantity * fill_price + commission
                
                else:  # SELL
                    if order.symbol in self.positions:
                        pos = self.positions[order.symbol]
                        
                        # Close position (partial or full)
                        close_quantity = min(order.quantity, pos.quantity)
                        pnl = (fill_price - pos.entry_price) * close_quantity - commission
                        
                        # Record trade
                        trade = Trade(
                            symbol=order.symbol,
                            side=OrderSide.SELL,
                            quantity=close_quantity,
                            entry_price=pos.entry_price,
                            exit_price=fill_price,
                            entry_timestamp=pos.entry_timestamp,
                            exit_timestamp=order.fill_timestamp,
                            pnl=pnl,
                            return_pct=(fill_price / pos.entry_price - 1) * 100,
                            holding_period=order.fill_timestamp - pos.entry_timestamp
                        )
                        self.trades.append(trade)
                        
                        self.total_pnl += pnl
                        self.capital += close_quantity * fill_price - commission
                        
                        # Update or remove position
                        pos.quantity -= close_quantity
                        if pos.quantity <= 0:
                            del self.positions[order.symbol]
    
    def _check_risk_management(self, bar: pd.Series):
        """Check stop loss and take profit."""
        if self.config.stop_loss_pct is None and self.config.take_profit_pct is None:
            return
        
        for symbol, position in list(self.positions.items()):
            if symbol not in bar:
                continue
            
            current_price = bar[symbol]
            return_pct = (current_price / position.entry_price - 1) * 100
            
            # Check stop loss
            if self.config.stop_loss_pct is not None and return_pct <= -self.config.stop_loss_pct:
                self.logger.debug(f"Stop loss triggered for {symbol} at {return_pct:.2f}%")
                self._place_order(symbol, OrderSide.SELL, position.quantity, current_price, bar.name)
            
            # Check take profit
            if self.config.take_profit_pct is not None and return_pct >= self.config.take_profit_pct:
                self.logger.debug(f"Take profit triggered for {symbol} at {return_pct:.2f}%")
                self._place_order(symbol, OrderSide.SELL, position.quantity, current_price, bar.name)
    
    def _process_signal(self, signal: Dict, bar: pd.Series, timestamp: datetime):
        """Process trading signal."""
        symbol = signal['symbol']
        action = signal['action']
        
        if action == 'buy':
            # Calculate position size
            price = bar.get(symbol, 0)
            if price == 0:
                return
            
            max_quantity = (self.capital * self.config.max_position_size) / price
            quantity = signal.get('quantity', max_quantity)
            quantity = min(quantity, max_quantity)
            
            if quantity > 0:
                self._place_order(symbol, OrderSide.BUY, quantity, price, timestamp)
        
        elif action == 'sell':
            if symbol in self.positions:
                position = self.positions[symbol]
                price = bar.get(symbol, 0)
                quantity = signal.get('quantity', position.quantity)
                
                if quantity > 0:
                    self._place_order(symbol, OrderSide.SELL, quantity, price, timestamp)
    
    def _place_order(self, symbol: str, side: OrderSide, quantity: float, price: float, timestamp: datetime):
        """Place an order."""
        order = Order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=price,
            timestamp=timestamp
        )
        self.orders.append(order)
    
    def _close_all_positions(self, bar: pd.Series, timestamp: datetime):
        """Close all open positions."""
        for symbol, position in list(self.positions.items()):
            if symbol in bar:
                price = bar[symbol]
                self._place_order(symbol, OrderSide.SELL, position.quantity, price, timestamp)
                self._execute_orders(bar)
    
    def _calculate_equity(self, bar: pd.Series) -> float:
        """Calculate current equity."""
        equity = self.capital
        
        for symbol, position in self.positions.items():
            if symbol in bar:
                equity += position.quantity * bar[symbol]
        
        return equity
    
    def _calculate_metrics(self) -> Dict:
        """Calculate comprehensive performance metrics."""
        equity_curve = np.array(self.equity_curve)
        returns = np.diff(equity_curve) / equity_curve[:-1]
        
        # Basic metrics
        total_return = (equity_curve[-1] / equity_curve[0] - 1) * 100
        
        # Risk metrics
        sharpe_ratio = np.mean(returns) / np.std(returns) * np.sqrt(252) if len(returns) > 0 else 0
        
        # Sortino ratio (downside deviation)
        downside_returns = returns[returns < 0]
        downside_std = np.std(downside_returns) if len(downside_returns) > 0 else 0
        sortino_ratio = np.mean(returns) / downside_std * np.sqrt(252) if downside_std > 0 else 0
        
        # Maximum drawdown
        cumulative = np.cumprod(1 + returns)
        running_max = np.maximum.accumulate(cumulative)
        drawdown = (cumulative - running_max) / running_max
        max_drawdown = np.min(drawdown) * 100 if len(drawdown) > 0 else 0
        
        # Win rate
        winning_trades = [t for t in self.trades if t.pnl > 0]
        win_rate = len(winning_trades) / len(self.trades) * 100 if self.trades else 0
        
        # Average trade
        avg_win = np.mean([t.pnl for t in winning_trades]) if winning_trades else 0
        losing_trades = [t for t in self.trades if t.pnl <= 0]
        avg_loss = np.mean([t.pnl for t in losing_trades]) if losing_trades else 0
        
        # Profit factor
        total_wins = sum(t.pnl for t in winning_trades)
        total_losses = abs(sum(t.pnl for t in losing_trades))
        profit_factor = total_wins / total_losses if total_losses > 0 else 0
        
        return {
            'total_return': total_return,
            'sharpe_ratio': sharpe_ratio,
            'sortino_ratio': sortino_ratio,
            'max_drawdown': max_drawdown,
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'total_trades': len(self.trades),
            'avg_win': avg_win,
            'avg_loss': avg_loss,
            'total_commission': self.total_commission,
            'total_slippage': self.total_slippage,
            'final_equity': equity_curve[-1],
            'equity_curve': equity_curve,
            'returns': returns,
            'trades': self.trades
        }
    
    def _aggregate_walk_forward_results(self, results: List[Dict]) -> Dict:
        """Aggregate walk-forward results."""
        return {
            'n_windows': len(results),
            'avg_sharpe': np.mean([r['sharpe_ratio'] for r in results]),
            'avg_return': np.mean([r['total_return'] for r in results]),
            'avg_max_drawdown': np.mean([r['max_drawdown'] for r in results]),
            'avg_win_rate': np.mean([r['win_rate'] for r in results]),
            'consistency': np.std([r['sharpe_ratio'] for r in results]),
            'windows': results
        }


def create_synthetic_data(n_days: int = 252) -> pd.DataFrame:
    """Create synthetic OHLCV data for testing."""
    dates = pd.date_range(start='2024-01-01', periods=n_days, freq='D')
    
    # Generate random walk with drift
    returns = np.random.normal(0.001, 0.02, n_days)
    prices = 100 * np.exp(np.cumsum(returns))
    
    data = pd.DataFrame({
        'BTC': prices,
        'open': prices * 0.99,
        'high': prices * 1.01,
        'low': prices * 0.98,
        'close': prices,
        'volume': np.random.uniform(1000, 10000, n_days)
    }, index=dates)
    
    return data


def simple_strategy(data: pd.DataFrame) -> Optional[Dict]:
    """Simple moving average crossover strategy."""
    if len(data) < 50:
        return None
    
    # Calculate moving averages
    short_ma = data['BTC'].rolling(10).mean().iloc[-1]
    long_ma = data['BTC'].rolling(50).mean().iloc[-1]
    
    # Generate signal
    if short_ma > long_ma:
        return {'symbol': 'BTC', 'action': 'buy'}
    elif short_ma < long_ma:
        return {'symbol': 'BTC', 'action': 'sell'}
    
    return None


if __name__ == '__main__':
    # Test backtest engine
    logging.basicConfig(level=logging.INFO)
    
    print("Generating synthetic data...")
    data = create_synthetic_data(n_days=252)
    
    print("\nRunning backtest...")
    engine = BacktestEngine()
    results = engine.run_backtest(data, simple_strategy)
    
    print(f"\n{'='*80}")
    print("Backtest Results")
    print(f"{'='*80}")
    print(f"Total Return:        {results['total_return']:.2f}%")
    print(f"Sharpe Ratio:        {results['sharpe_ratio']:.2f}")
    print(f"Sortino Ratio:       {results['sortino_ratio']:.2f}")
    print(f"Max Drawdown:        {results['max_drawdown']:.2f}%")
    print(f"Win Rate:            {results['win_rate']:.2f}%")
    print(f"Profit Factor:       {results['profit_factor']:.2f}")
    print(f"Total Trades:        {results['total_trades']}")
    print(f"Avg Win:             ${results['avg_win']:.2f}")
    print(f"Avg Loss:            ${results['avg_loss']:.2f}")
    print(f"Total Commission:    ${results['total_commission']:.2f}")
    print(f"Final Equity:        ${results['final_equity']:.2f}")
    
    print(f"\n{'='*80}")
    print("✅ Backtest engine test complete!")
