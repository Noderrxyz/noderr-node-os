"""
Mean-Semivariance-Robust-Return (MSRR) Portfolio Optimizer

This module implements advanced portfolio optimization that:
1. Minimizes downside risk (semivariance) instead of total variance
2. Maximizes risk-adjusted returns with robustness to outliers
3. Accounts for realistic transaction costs
4. Provides factor-based risk decomposition

References:
- Markowitz, H. (1952). Portfolio Selection
- Sortino, F. A., & Price, L. N. (1994). Performance Measurement in a Downside Risk Framework
- DeMiguel, V., Garlappi, L., & Uppal, R. (2009). Optimal Versus Naive Diversification
"""

import numpy as np
from scipy.optimize import minimize, LinearConstraint, Bounds
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class OptimizationConfig:
    """Configuration for portfolio optimization."""
    
    # Risk parameters
    target_return: Optional[float] = None  # Target return (if None, maximize Sharpe)
    risk_aversion: float = 1.0             # Risk aversion parameter (higher = more conservative)
    downside_threshold: float = 0.0        # Threshold for downside risk (usually 0 or risk-free rate)
    
    # Constraints
    min_weight: float = 0.0                # Minimum weight per asset
    max_weight: float = 1.0                # Maximum weight per asset
    max_leverage: float = 1.0              # Maximum leverage (1.0 = no leverage)
    min_assets: int = 1                    # Minimum number of assets to hold
    max_assets: Optional[int] = None       # Maximum number of assets to hold
    
    # Transaction costs
    fixed_cost: float = 0.0                # Fixed cost per trade
    proportional_cost: float = 0.001       # Proportional cost (0.1% default)
    market_impact: float = 0.0001          # Market impact cost
    
    # Optimization
    max_iterations: int = 1000             # Maximum optimization iterations
    tolerance: float = 1e-6                # Convergence tolerance
    
    # Robustness
    use_robust_estimation: bool = True     # Use robust covariance estimation
    shrinkage_factor: float = 0.1          # Shrinkage towards equal weights


class MSRROptimizer:
    """
    Mean-Semivariance-Robust-Return Portfolio Optimizer.
    
    Implements sophisticated portfolio optimization with:
    - Downside risk minimization (semivariance)
    - Robust estimation of returns and covariances
    - Transaction cost modeling
    - Factor-based risk decomposition
    """
    
    def __init__(self, config: Optional[OptimizationConfig] = None):
        self.config = config or OptimizationConfig()
        self.logger = logging.getLogger(__name__)
    
    def optimize(
        self,
        returns: np.ndarray,
        current_weights: Optional[np.ndarray] = None,
        factor_exposures: Optional[np.ndarray] = None
    ) -> Dict:
        """
        Optimize portfolio weights.
        
        Args:
            returns: Historical returns (n_samples, n_assets)
            current_weights: Current portfolio weights (if rebalancing)
            factor_exposures: Factor exposures for risk decomposition (n_assets, n_factors)
        
        Returns:
            Dictionary with optimal weights and diagnostics
        """
        n_samples, n_assets = returns.shape
        
        # Estimate expected returns (robust)
        expected_returns = self._estimate_returns(returns)
        
        # Estimate downside covariance matrix
        downside_cov = self._estimate_downside_covariance(returns)
        
        # Apply shrinkage if configured
        if self.config.use_robust_estimation:
            downside_cov = self._shrink_covariance(downside_cov)
        
        # Set up optimization problem
        if current_weights is None:
            current_weights = np.zeros(n_assets)
        
        # Objective function: maximize risk-adjusted return minus transaction costs
        def objective(weights):
            # Expected return
            portfolio_return = np.dot(weights, expected_returns)
            
            # Downside risk (semivariance)
            portfolio_risk = np.sqrt(np.dot(weights, np.dot(downside_cov, weights)))
            
            # Transaction costs
            turnover = np.sum(np.abs(weights - current_weights))
            transaction_cost = (
                self.config.fixed_cost * np.sum(weights != current_weights) +
                self.config.proportional_cost * turnover +
                self.config.market_impact * turnover ** 2
            )
            
            # Risk-adjusted return minus costs
            utility = portfolio_return - self.config.risk_aversion * portfolio_risk - transaction_cost
            
            return -utility  # Minimize negative utility = maximize utility
        
        # Constraints
        constraints = []
        
        # Weights sum to max_leverage
        constraints.append({
            'type': 'eq',
            'fun': lambda w: np.sum(w) - self.config.max_leverage
        })
        
        # Target return constraint (if specified)
        if self.config.target_return is not None:
            constraints.append({
                'type': 'ineq',
                'fun': lambda w: np.dot(w, expected_returns) - self.config.target_return
            })
        
        # Bounds on individual weights
        bounds = Bounds(
            lb=np.full(n_assets, self.config.min_weight),
            ub=np.full(n_assets, self.config.max_weight)
        )
        
        # Initial guess (equal weights or current weights)
        if np.sum(current_weights) > 0:
            x0 = current_weights
        else:
            x0 = np.full(n_assets, self.config.max_leverage / n_assets)
        
        # Optimize
        result = minimize(
            objective,
            x0,
            method='SLSQP',
            bounds=bounds,
            constraints=constraints,
            options={
                'maxiter': self.config.max_iterations,
                'ftol': self.config.tolerance
            }
        )
        
        if not result.success:
            self.logger.warning(f"Optimization did not converge: {result.message}")
        
        optimal_weights = result.x
        
        # Apply cardinality constraints (min/max assets)
        optimal_weights = self._apply_cardinality_constraints(optimal_weights)
        
        # Compute portfolio statistics
        portfolio_return = np.dot(optimal_weights, expected_returns)
        portfolio_risk = np.sqrt(np.dot(optimal_weights, np.dot(downside_cov, optimal_weights)))
        sharpe_ratio = portfolio_return / portfolio_risk if portfolio_risk > 0 else 0
        
        # Factor risk decomposition (if factor exposures provided)
        factor_risk = None
        if factor_exposures is not None:
            factor_risk = self._decompose_factor_risk(
                optimal_weights,
                factor_exposures,
                downside_cov
            )
        
        # Transaction costs
        turnover = np.sum(np.abs(optimal_weights - current_weights))
        transaction_cost = (
            self.config.fixed_cost * np.sum(optimal_weights != current_weights) +
            self.config.proportional_cost * turnover +
            self.config.market_impact * turnover ** 2
        )
        
        return {
            'weights': optimal_weights,
            'expected_return': portfolio_return,
            'downside_risk': portfolio_risk,
            'sharpe_ratio': sharpe_ratio,
            'turnover': turnover,
            'transaction_cost': transaction_cost,
            'n_assets_held': np.sum(optimal_weights > 1e-6),
            'factor_risk': factor_risk,
            'success': result.success,
            'message': result.message
        }
    
    def _estimate_returns(self, returns: np.ndarray) -> np.ndarray:
        """
        Estimate expected returns with robust estimation.
        
        Uses median instead of mean for robustness to outliers.
        """
        if self.config.use_robust_estimation:
            # Use median (more robust than mean)
            return np.median(returns, axis=0)
        else:
            # Use mean
            return np.mean(returns, axis=0)
    
    def _estimate_downside_covariance(self, returns: np.ndarray) -> np.ndarray:
        """
        Estimate downside covariance matrix (semivariance).
        
        Only considers returns below the downside threshold.
        """
        n_samples, n_assets = returns.shape
        
        # Identify downside returns
        downside_returns = returns.copy()
        downside_returns[downside_returns > self.config.downside_threshold] = 0
        
        # Compute downside covariance
        downside_cov = np.cov(downside_returns.T)
        
        # Ensure positive definite
        min_eigenvalue = np.min(np.linalg.eigvalsh(downside_cov))
        if min_eigenvalue < 1e-8:
            downside_cov += np.eye(n_assets) * (1e-8 - min_eigenvalue)
        
        return downside_cov
    
    def _shrink_covariance(self, cov: np.ndarray) -> np.ndarray:
        """
        Apply shrinkage to covariance matrix (Ledoit-Wolf).
        
        Shrinks towards constant correlation matrix.
        """
        n_assets = cov.shape[0]
        
        # Target: constant correlation matrix
        variances = np.diag(cov)
        avg_correlation = (np.sum(cov) - np.sum(variances)) / (n_assets * (n_assets - 1))
        
        target = np.outer(np.sqrt(variances), np.sqrt(variances)) * avg_correlation
        np.fill_diagonal(target, variances)
        
        # Shrink
        shrunk_cov = (1 - self.config.shrinkage_factor) * cov + self.config.shrinkage_factor * target
        
        return shrunk_cov
    
    def _apply_cardinality_constraints(self, weights: np.ndarray) -> np.ndarray:
        """
        Apply cardinality constraints (min/max number of assets).
        
        Zeros out smallest weights if too many assets.
        """
        n_assets = len(weights)
        n_held = np.sum(weights > 1e-6)
        
        # Check max assets constraint
        if self.config.max_assets is not None and n_held > self.config.max_assets:
            # Keep only top max_assets by weight
            threshold_idx = np.argsort(weights)[-self.config.max_assets]
            threshold = weights[threshold_idx]
            weights[weights < threshold] = 0
            
            # Renormalize
            weights = weights / np.sum(weights) * self.config.max_leverage
        
        # Check min assets constraint
        if n_held < self.config.min_assets:
            self.logger.warning(f"Only {n_held} assets held, less than min_assets={self.config.min_assets}")
        
        return weights
    
    def _decompose_factor_risk(
        self,
        weights: np.ndarray,
        factor_exposures: np.ndarray,
        cov: np.ndarray
    ) -> Dict:
        """
        Decompose portfolio risk into factor and idiosyncratic components.
        
        Args:
            weights: Portfolio weights (n_assets,)
            factor_exposures: Factor exposures (n_assets, n_factors)
            cov: Covariance matrix (n_assets, n_assets)
        
        Returns:
            Dictionary with factor risk decomposition
        """
        n_assets, n_factors = factor_exposures.shape
        
        # Portfolio factor exposures
        portfolio_exposures = np.dot(weights, factor_exposures)
        
        # Factor covariance matrix
        factor_cov = np.dot(factor_exposures.T, np.dot(cov, factor_exposures))
        
        # Factor risk contribution
        factor_risk = np.sqrt(np.dot(portfolio_exposures, np.dot(factor_cov, portfolio_exposures)))
        
        # Total risk
        total_risk = np.sqrt(np.dot(weights, np.dot(cov, weights)))
        
        # Idiosyncratic risk
        idiosyncratic_risk = np.sqrt(max(0, total_risk**2 - factor_risk**2))
        
        return {
            'total_risk': total_risk,
            'factor_risk': factor_risk,
            'idiosyncratic_risk': idiosyncratic_risk,
            'factor_exposures': portfolio_exposures,
            'factor_contribution': factor_risk / total_risk if total_risk > 0 else 0
        }


def create_synthetic_returns(
    n_samples: int = 252,
    n_assets: int = 10,
    mean_return: float = 0.0005,
    volatility: float = 0.02
) -> np.ndarray:
    """
    Create synthetic returns for testing.
    
    Args:
        n_samples: Number of time periods
        n_assets: Number of assets
        mean_return: Mean return per period
        volatility: Volatility per period
    
    Returns:
        Returns matrix (n_samples, n_assets)
    """
    # Generate correlated returns
    correlation = 0.3
    cov_matrix = np.full((n_assets, n_assets), correlation * volatility**2)
    np.fill_diagonal(cov_matrix, volatility**2)
    
    returns = np.random.multivariate_normal(
        mean=np.full(n_assets, mean_return),
        cov=cov_matrix,
        size=n_samples
    )
    
    return returns


if __name__ == '__main__':
    # Test MSRR optimizer
    logging.basicConfig(level=logging.INFO)
    
    print("Generating synthetic returns...")
    returns = create_synthetic_returns(n_samples=252, n_assets=10)
    
    print("\nOptimizing portfolio...")
    optimizer = MSRROptimizer()
    result = optimizer.optimize(returns)
    
    print(f"\n{'='*60}")
    print("MSRR Portfolio Optimization Results")
    print(f"{'='*60}")
    print(f"Expected Return:     {result['expected_return']*252:.2%} (annualized)")
    print(f"Downside Risk:       {result['downside_risk']*np.sqrt(252):.2%} (annualized)")
    print(f"Sharpe Ratio:        {result['sharpe_ratio']*np.sqrt(252):.2f}")
    print(f"Transaction Cost:    {result['transaction_cost']:.4f}")
    print(f"Turnover:            {result['turnover']:.2%}")
    print(f"Assets Held:         {result['n_assets_held']}")
    print(f"Optimization Status: {result['message']}")
    print(f"\nOptimal Weights:")
    for i, weight in enumerate(result['weights']):
        if weight > 0.001:
            print(f"  Asset {i+1}: {weight:.2%}")
    
    print(f"\n{'='*60}")
    print("✅ MSRR Optimizer test complete!")
