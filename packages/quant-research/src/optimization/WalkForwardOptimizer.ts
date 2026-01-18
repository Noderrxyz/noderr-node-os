/**
 * WalkForwardOptimizer - Elite walk-forward optimization engine
 * 
 * Implements rolling window optimization to prevent overfitting and ensure
 * strategy robustness across different market regimes.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  OptimizationConfig,
  OptimizationResult,
  OptimizationMethod,
  OptimizationObjective,
  ParameterRange,
  WalkForwardConfig,
  BacktestConfig,
  StrategyPerformance
} from '../types';
import { Backtester } from '../backtesting/Backtester';

interface OptimizationStep {
  iteration: number;
  parameters: { [key: string]: any };
  performance: number;
  inSample: StrategyPerformance;
  outOfSample?: StrategyPerformance;
}

interface WalkForwardWindow {
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
  optimalParams?: { [key: string]: any };
  testPerformance?: StrategyPerformance;
}

export class WalkForwardOptimizer extends EventEmitter {
  private logger: Logger;
  private backtester: Backtester;
  private currentConfig?: OptimizationConfig;
  private iterationCount: number = 0;
  private bestParameters: { [key: string]: any } = {};
  private bestScore: number = -Infinity;
  private convergenceHistory: number[] = [];
  private parameterHistory: OptimizationStep[] = [];
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.backtester = new Backtester(logger);
  }
  
  /**
   * Initialize optimizer
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing WalkForwardOptimizer');
    await this.backtester.initialize();
  }
  
  /**
   * Run optimization
   */
  async optimize(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info(`Starting optimization with method: ${config.method}`);
    
    this.currentConfig = config;
    this.reset();
    
    let result: OptimizationResult;
    
    // Run optimization based on method
    switch (config.method) {
      case OptimizationMethod.GRID_SEARCH:
        result = await this.gridSearch(config);
        break;
        
      case OptimizationMethod.RANDOM_SEARCH:
        result = await this.randomSearch(config);
        break;
        
      case OptimizationMethod.BAYESIAN:
        result = await this.bayesianOptimization(config);
        break;
        
      case OptimizationMethod.GENETIC:
        result = await this.geneticAlgorithm(config);
        break;
        
      case OptimizationMethod.PSO:
        result = await this.particleSwarmOptimization(config);
        break;
        
      case OptimizationMethod.DIFFERENTIAL_EVOLUTION:
        result = await this.differentialEvolution(config);
        break;
        
      default:
        throw new Error(`Unknown optimization method: ${config.method}`);
    }
    
    // Run walk-forward analysis if configured
    if (config.walkForward) {
      const walkForwardResults = await this.runWalkForward(config);
      result.outOfSamplePerformance = walkForwardResults.aggregatePerformance;
      result.robustnessScore = this.calculateRobustnessScore(walkForwardResults);
    }
    
    // Calculate parameter importance
    result.parameterImportance = this.analyzeParameterImportance();
    
    return result;
  }
  
  /**
   * Private: Reset state
   */
  private reset(): void {
    this.iterationCount = 0;
    this.bestParameters = {};
    this.bestScore = -Infinity;
    this.convergenceHistory = [];
    this.parameterHistory = [];
  }
  
  /**
   * Private: Grid search optimization
   */
  private async gridSearch(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info('Running grid search optimization');
    
    const parameterGrid = this.generateParameterGrid(config.parameters);
    const totalCombinations = parameterGrid.length;
    
    this.logger.info(`Testing ${totalCombinations} parameter combinations`);
    
    // Test each combination
    for (let i = 0; i < parameterGrid.length; i++) {
      const parameters = parameterGrid[i];
      
      // Check constraints
      if (!this.checkConstraints(parameters, config)) {
        continue;
      }
      
      // Run backtest
      const performance = await this.evaluateParameters(parameters, config);
      
      // Update best
      if (performance > this.bestScore) {
        this.bestScore = performance;
        this.bestParameters = parameters;
      }
      
      this.convergenceHistory.push(this.bestScore);
      this.iterationCount++;
      
      // Emit progress
      this.emit('iterationComplete', {
        iteration: this.iterationCount,
        current: parameters,
        score: performance,
        best: this.bestScore,
        progress: (i + 1) / totalCombinations
      });
      
      // Check convergence
      if (this.hasConverged(config)) {
        break;
      }
    }
    
    return this.createResult();
  }
  
  /**
   * Private: Random search optimization
   */
  private async randomSearch(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info('Running random search optimization');
    
    const maxIterations = config.maxIterations || 100;
    
    for (let i = 0; i < maxIterations; i++) {
      // Generate random parameters
      const parameters = this.generateRandomParameters(config.parameters);
      
      // Check constraints
      if (!this.checkConstraints(parameters, config)) {
        i--; // Don't count invalid attempts
        continue;
      }
      
      // Run backtest
      const performance = await this.evaluateParameters(parameters, config);
      
      // Update best
      if (performance > this.bestScore) {
        this.bestScore = performance;
        this.bestParameters = parameters;
      }
      
      this.convergenceHistory.push(this.bestScore);
      this.iterationCount++;
      
      // Emit progress
      this.emit('iterationComplete', {
        iteration: this.iterationCount,
        current: parameters,
        score: performance,
        best: this.bestScore,
        progress: (i + 1) / maxIterations
      });
      
      // Check convergence
      if (this.hasConverged(config)) {
        break;
      }
    }
    
    return this.createResult();
  }
  
  /**
   * Private: Bayesian optimization
   */
  private async bayesianOptimization(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info('Running Bayesian optimization');
    
    // Initialize with random samples
    const initialSamples = Math.min(10, config.maxIterations || 100);
    const observations: { params: any; score: number }[] = [];
    
    // Initial random sampling
    for (let i = 0; i < initialSamples; i++) {
      const parameters = this.generateRandomParameters(config.parameters);
      const score = await this.evaluateParameters(parameters, config);
      
      observations.push({ params: parameters, score });
      
      if (score > this.bestScore) {
        this.bestScore = score;
        this.bestParameters = parameters;
      }
      
      this.iterationCount++;
    }
    
    // Bayesian optimization loop
    const maxIterations = config.maxIterations || 100;
    
    while (this.iterationCount < maxIterations) {
      // Use Gaussian Process to predict next best parameters
      const nextParams = this.predictNextBestParams(observations, config.parameters);
      
      // Evaluate
      const score = await this.evaluateParameters(nextParams, config);
      observations.push({ params: nextParams, score });
      
      if (score > this.bestScore) {
        this.bestScore = score;
        this.bestParameters = nextParams;
      }
      
      this.convergenceHistory.push(this.bestScore);
      this.iterationCount++;
      
      // Emit progress
      this.emit('iterationComplete', {
        iteration: this.iterationCount,
        current: nextParams,
        score,
        best: this.bestScore,
        progress: this.iterationCount / maxIterations
      });
      
      if (this.hasConverged(config)) {
        break;
      }
    }
    
    return this.createResult();
  }
  
  /**
   * Private: Genetic algorithm
   */
  private async geneticAlgorithm(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info('Running genetic algorithm optimization');
    
    const populationSize = 50;
    const generations = Math.floor((config.maxIterations || 1000) / populationSize);
    const mutationRate = 0.1;
    const crossoverRate = 0.7;
    const eliteRatio = 0.1;
    
    // Initialize population
    let population: Array<{ params: any; fitness: number }> = [];
    
    for (let i = 0; i < populationSize; i++) {
      const params = this.generateRandomParameters(config.parameters);
      const fitness = await this.evaluateParameters(params, config);
      population.push({ params, fitness });
      
      if (fitness > this.bestScore) {
        this.bestScore = fitness;
        this.bestParameters = params;
      }
    }
    
    // Evolution loop
    for (let gen = 0; gen < generations; gen++) {
      // Sort by fitness
      population.sort((a, b) => b.fitness - a.fitness);
      
      // Select elite
      const eliteCount = Math.floor(populationSize * eliteRatio);
      const newPopulation = population.slice(0, eliteCount);
      
      // Generate offspring
      while (newPopulation.length < populationSize) {
        // Tournament selection
        const parent1 = this.tournamentSelection(population);
        const parent2 = this.tournamentSelection(population);
        
        let offspring: any;
        
        // Crossover
        if (Math.random() < crossoverRate) {
          offspring = this.crossover(parent1.params, parent2.params, config.parameters);
        } else {
          offspring = { ...parent1.params };
        }
        
        // Mutation
        if (Math.random() < mutationRate) {
          offspring = this.mutate(offspring, config.parameters);
        }
        
        // Evaluate offspring
        const fitness = await this.evaluateParameters(offspring, config);
        newPopulation.push({ params: offspring, fitness });
        
        if (fitness > this.bestScore) {
          this.bestScore = fitness;
          this.bestParameters = offspring;
        }
        
        this.iterationCount++;
      }
      
      population = newPopulation;
      this.convergenceHistory.push(this.bestScore);
      
      // Emit progress
      this.emit('iterationComplete', {
        iteration: this.iterationCount,
        generation: gen,
        bestFitness: this.bestScore,
        progress: (gen + 1) / generations
      });
      
      if (this.hasConverged(config)) {
        break;
      }
    }
    
    return this.createResult();
  }
  
  /**
   * Private: Particle swarm optimization
   */
  private async particleSwarmOptimization(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info('Running particle swarm optimization');
    
    const swarmSize = 30;
    const maxIterations = config.maxIterations || 100;
    const w = 0.7; // Inertia weight
    const c1 = 1.5; // Cognitive coefficient
    const c2 = 1.5; // Social coefficient
    
    // Initialize particles
    const particles: Array<{
      position: any;
      velocity: any;
      personalBest: any;
      personalBestScore: number;
    }> = [];
    
    let globalBest = {};
    let globalBestScore = -Infinity;
    
    // Initialize swarm
    for (let i = 0; i < swarmSize; i++) {
      const position = this.generateRandomParameters(config.parameters);
      const velocity = this.initializeVelocity(config.parameters);
      const score = await this.evaluateParameters(position, config);
      
      particles.push({
        position,
        velocity,
        personalBest: position,
        personalBestScore: score
      });
      
      if (score > globalBestScore) {
        globalBestScore = score;
        globalBest = position;
        this.bestScore = score;
        this.bestParameters = position;
      }
    }
    
    // PSO iterations
    for (let iter = 0; iter < maxIterations; iter++) {
      for (const particle of particles) {
        // Update velocity
        particle.velocity = this.updateVelocity(
          particle.velocity,
          particle.position,
          particle.personalBest,
          globalBest,
          w, c1, c2,
          config.parameters
        );
        
        // Update position
        particle.position = this.updatePosition(
          particle.position,
          particle.velocity,
          config.parameters
        );
        
        // Evaluate new position
        const score = await this.evaluateParameters(particle.position, config);
        
        // Update personal best
        if (score > particle.personalBestScore) {
          particle.personalBestScore = score;
          particle.personalBest = particle.position;
        }
        
        // Update global best
        if (score > globalBestScore) {
          globalBestScore = score;
          globalBest = particle.position;
          this.bestScore = score;
          this.bestParameters = particle.position;
        }
        
        this.iterationCount++;
      }
      
      this.convergenceHistory.push(this.bestScore);
      
      // Emit progress
      this.emit('iterationComplete', {
        iteration: iter,
        bestScore: this.bestScore,
        progress: (iter + 1) / maxIterations
      });
      
      if (this.hasConverged(config)) {
        break;
      }
    }
    
    return this.createResult();
  }
  
  /**
   * Private: Differential evolution
   */
  private async differentialEvolution(config: OptimizationConfig): Promise<OptimizationResult> {
    this.logger.info('Running differential evolution optimization');
    
    const populationSize = 50;
    const F = 0.8; // Differential weight
    const CR = 0.9; // Crossover probability
    const maxGenerations = Math.floor((config.maxIterations || 1000) / populationSize);
    
    // Initialize population
    let population: Array<{ params: any; fitness: number }> = [];
    
    for (let i = 0; i < populationSize; i++) {
      const params = this.generateRandomParameters(config.parameters);
      const fitness = await this.evaluateParameters(params, config);
      population.push({ params, fitness });
      
      if (fitness > this.bestScore) {
        this.bestScore = fitness;
        this.bestParameters = params;
      }
    }
    
    // Evolution loop
    for (let gen = 0; gen < maxGenerations; gen++) {
      const newPopulation: typeof population = [];
      
      for (let i = 0; i < population.length; i++) {
        const target = population[i];
        
        // Select three random individuals
        const indices = this.selectRandomIndices(populationSize, 3, i);
        const a = population[indices[0]];
        const b = population[indices[1]];
        const c = population[indices[2]];
        
        // Mutation
        const mutant = this.differentialMutation(a.params, b.params, c.params, F, config.parameters);
        
        // Crossover
        const trial = this.differentialCrossover(target.params, mutant, CR, config.parameters);
        
        // Selection
        const trialFitness = await this.evaluateParameters(trial, config);
        
        if (trialFitness > target.fitness) {
          newPopulation.push({ params: trial, fitness: trialFitness });
          
          if (trialFitness > this.bestScore) {
            this.bestScore = trialFitness;
            this.bestParameters = trial;
          }
        } else {
          newPopulation.push(target);
        }
        
        this.iterationCount++;
      }
      
      population = newPopulation;
      this.convergenceHistory.push(this.bestScore);
      
      // Emit progress
      this.emit('iterationComplete', {
        iteration: this.iterationCount,
        generation: gen,
        bestScore: this.bestScore,
        progress: (gen + 1) / maxGenerations
      });
      
      if (this.hasConverged(config)) {
        break;
      }
    }
    
    return this.createResult();
  }
  
  /**
   * Private: Run walk-forward analysis
   */
  private async runWalkForward(config: OptimizationConfig): Promise<any> {
    if (!config.walkForward) {
      throw new Error('Walk-forward config not provided');
    }
    
    const wf = config.walkForward;
    const windows = this.generateWalkForwardWindows(config, wf);
    const results: WalkForwardWindow[] = [];
    
    this.logger.info(`Running walk-forward analysis with ${windows.length} windows`);
    
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      
      this.logger.info(`Window ${i + 1}/${windows.length}: Train ${window.trainStart} to ${window.trainEnd}`);
      
      // Optimize on training window
      const trainConfig: OptimizationConfig = {
        ...config,
        strategy: {
          ...config.strategy,
          parameters: this.bestParameters // Use previous window's params as starting point
        },
        walkForward: undefined // Prevent recursion
      };
      
      const trainBacktestConfig: BacktestConfig = {
        strategy: trainConfig.strategy,
        startDate: window.trainStart,
        endDate: window.trainEnd,
        initialCapital: 100000,
        dataFrequency: '1h',
        includeFees: true
      };
      
      // Find optimal parameters for this window
      const optimalParams = await this.optimizeWindow(trainConfig, trainBacktestConfig);
      window.optimalParams = optimalParams;
      
      // Test on out-of-sample window
      const testBacktestConfig: BacktestConfig = {
        strategy: {
          ...config.strategy,
          parameters: optimalParams
        },
        startDate: window.testStart,
        endDate: window.testEnd,
        initialCapital: 100000,
        dataFrequency: '1h',
        includeFees: true
      };
      
      const testResult = await this.backtester.run(testBacktestConfig, {});
      window.testPerformance = testResult.performance;
      
      results.push(window);
      
      this.emit('walkForwardProgress', {
        window: i + 1,
        total: windows.length,
        performance: window.testPerformance
      });
    }
    
    // Aggregate results
    const aggregatePerformance = this.aggregateWalkForwardResults(results);
    
    return {
      windows: results,
      aggregatePerformance
    };
  }
  
  /**
   * Private: Generate walk-forward windows
   */
  private generateWalkForwardWindows(
    config: OptimizationConfig,
    wfConfig: WalkForwardConfig
  ): WalkForwardWindow[] {
    const windows: WalkForwardWindow[] = [];
    
    // Determine date range
    const startDate = new Date('2020-01-01'); // Would come from config
    const endDate = new Date();
    
    const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const windowSizeDays = wfConfig.windowSize;
    const stepSizeDays = wfConfig.stepSize;
    const testSizeDays = Math.floor(windowSizeDays * wfConfig.outOfSampleRatio);
    const trainSizeDays = windowSizeDays - testSizeDays;
    
    let currentStart = startDate.getTime();
    
    while (currentStart + windowSizeDays * 24 * 60 * 60 * 1000 <= endDate.getTime()) {
      const trainStart = new Date(currentStart);
      const trainEnd = new Date(currentStart + trainSizeDays * 24 * 60 * 60 * 1000);
      const testStart = new Date(trainEnd.getTime() + 24 * 60 * 60 * 1000);
      const testEnd = new Date(currentStart + windowSizeDays * 24 * 60 * 60 * 1000);
      
      windows.push({
        trainStart,
        trainEnd,
        testStart,
        testEnd
      });
      
      currentStart += stepSizeDays * 24 * 60 * 60 * 1000;
    }
    
    return windows;
  }
  
  /**
   * Private: Optimize single window
   */
  private async optimizeWindow(
    config: OptimizationConfig,
    backtestConfig: BacktestConfig
  ): Promise<any> {
    // Use simpler optimization for walk-forward windows
    const iterations = 20; // Reduced iterations per window
    let bestParams = config.strategy.parameters;
    let bestScore = -Infinity;
    
    for (let i = 0; i < iterations; i++) {
      const params = i === 0 ? bestParams : this.generateRandomParameters(config.parameters);
      
      const testConfig: BacktestConfig = {
        ...backtestConfig,
        strategy: {
          ...backtestConfig.strategy,
          parameters: params
        }
      };
      
      const result = await this.backtester.run(testConfig, {});
      const score = this.calculateObjectiveScore(result.performance, config.objective);
      
      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
      }
    }
    
    return bestParams;
  }
  
  /**
   * Private: Aggregate walk-forward results
   */
  private aggregateWalkForwardResults(windows: WalkForwardWindow[]): StrategyPerformance {
    const performances = windows.map(w => w.testPerformance!).filter(p => p !== undefined);
    
    if (performances.length === 0) {
      throw new Error('No walk-forward results to aggregate');
    }
    
    // Calculate weighted averages
    const weights = performances.map(p => p.trades); // Weight by number of trades
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    
    return {
      totalReturn: performances.reduce((sum, p, i) => sum + p.totalReturn * weights[i], 0) / totalWeight,
      annualizedReturn: performances.reduce((sum, p, i) => sum + p.annualizedReturn * weights[i], 0) / totalWeight,
      volatility: performances.reduce((sum, p, i) => sum + p.volatility * weights[i], 0) / totalWeight,
      sharpeRatio: performances.reduce((sum, p, i) => sum + p.sharpeRatio * weights[i], 0) / totalWeight,
      sortinoRatio: performances.reduce((sum, p, i) => sum + p.sortinoRatio * weights[i], 0) / totalWeight,
      calmarRatio: performances.reduce((sum, p, i) => sum + p.calmarRatio * weights[i], 0) / totalWeight,
      maxDrawdown: Math.max(...performances.map(p => p.maxDrawdown)),
      winRate: performances.reduce((sum, p, i) => sum + p.winRate * weights[i], 0) / totalWeight,
      profitFactor: performances.reduce((sum, p, i) => sum + p.profitFactor * weights[i], 0) / totalWeight,
      averageWin: performances.reduce((sum, p, i) => sum + p.averageWin * weights[i], 0) / totalWeight,
      averageLoss: performances.reduce((sum, p, i) => sum + p.averageLoss * weights[i], 0) / totalWeight,
      expectancy: performances.reduce((sum, p, i) => sum + p.expectancy * weights[i], 0) / totalWeight,
      trades: performances.reduce((sum, p) => sum + p.trades, 0)
    };
  }
  
  /**
   * Private: Calculate robustness score
   */
  private calculateRobustnessScore(walkForwardResults: any): number {
    const performances = walkForwardResults.windows
      .map((w: WalkForwardWindow) => w.testPerformance?.sharpeRatio || 0);
    
    if (performances.length === 0) return 0;
    
    // Calculate consistency of performance
    const mean = performances.reduce((a: number, b: number) => a + b, 0) / performances.length;
    const variance = performances.reduce((sum: number, p: number) => sum + Math.pow(p - mean, 2), 0) / performances.length;
    const std = Math.sqrt(variance);
    
    // Lower std relative to mean indicates more robust
    const cv = mean > 0 ? std / mean : 1; // Coefficient of variation
    const consistency = 1 / (1 + cv);
    
    // Check if all windows are profitable
    const profitableWindows = performances.filter((p: number) => p > 0).length;
    const profitability = profitableWindows / performances.length;
    
    // Combined robustness score
    return consistency * 0.6 + profitability * 0.4;
  }
  
  /**
   * Private: Generate parameter grid
   */
  private generateParameterGrid(parameters: ParameterRange[]): any[] {
    const grid: any[] = [];
    
    // Generate all combinations
    const generateCombinations = (index: number, current: any) => {
      if (index === parameters.length) {
        grid.push({ ...current });
        return;
      }
      
      const param = parameters[index];
      const values = this.getParameterValues(param);
      
      for (const value of values) {
        current[param.name] = value;
        generateCombinations(index + 1, current);
      }
    };
    
    generateCombinations(0, {});
    return grid;
  }
  
  /**
   * Private: Get parameter values
   */
  private getParameterValues(param: ParameterRange): any[] {
    if (param.type === 'categorical') {
      return param.values || [];
    }
    
    if (param.type === 'discrete') {
      const values: number[] = [];
      const min = param.min || 0;
      const max = param.max || 100;
      const step = param.step || 1;
      
      for (let v = min; v <= max; v += step) {
        values.push(v);
      }
      
      return values;
    }
    
    // Continuous - discretize for grid search
    const values: number[] = [];
    const min = param.min || 0;
    const max = param.max || 1;
    const steps = 10; // Default grid size
    
    for (let i = 0; i <= steps; i++) {
      values.push(min + (max - min) * i / steps);
    }
    
    return values;
  }
  
  /**
   * Private: Generate random parameters
   */
  private generateRandomParameters(parameters: ParameterRange[]): any {
    const params: any = {};
    
    for (const param of parameters) {
      if (param.type === 'categorical') {
        const values = param.values || [];
        params[param.name] = values[Math.floor(Math.random() * values.length)];
      } else if (param.type === 'discrete') {
        const min = param.min || 0;
        const max = param.max || 100;
        const step = param.step || 1;
        const steps = Math.floor((max - min) / step);
        params[param.name] = min + Math.floor(Math.random() * steps) * step;
      } else {
        // Continuous
        const min = param.min || 0;
        const max = param.max || 1;
        params[param.name] = min + Math.random() * (max - min);
      }
    }
    
    return params;
  }
  
  /**
   * Private: Evaluate parameters
   */
  private async evaluateParameters(
    parameters: any,
    config: OptimizationConfig
  ): Promise<number> {
    // Create backtest config
    const backtestConfig: BacktestConfig = {
      strategy: {
        ...config.strategy,
        parameters: {
          ...config.strategy.parameters,
          ...parameters
        }
      },
      startDate: new Date('2022-01-01'), // Would come from config
      endDate: new Date('2023-01-01'),
      initialCapital: 100000,
      dataFrequency: '1h',
      includeFees: true
    };
    
    // Run backtest
    const result = await this.backtester.run(backtestConfig, {});
    
    // Store for analysis
    this.parameterHistory.push({
      iteration: this.iterationCount,
      parameters,
      performance: result.performance.sharpeRatio,
      inSample: result.performance
    });
    
    // Calculate objective score
    return this.calculateObjectiveScore(result.performance, config.objective);
  }
  
  /**
   * Private: Calculate objective score
   */
  private calculateObjectiveScore(
    performance: StrategyPerformance,
    objective: OptimizationObjective
  ): number {
    switch (objective) {
      case OptimizationObjective.SHARPE_RATIO:
        return performance.sharpeRatio;
        
      case OptimizationObjective.TOTAL_RETURN:
        return performance.totalReturn;
        
      case OptimizationObjective.CALMAR_RATIO:
        return performance.calmarRatio;
        
      case OptimizationObjective.SORTINO_RATIO:
        return performance.sortinoRatio;
        
      case OptimizationObjective.PROFIT_FACTOR:
        return performance.profitFactor;
        
      case OptimizationObjective.WIN_RATE:
        return performance.winRate;
        
      default:
        // Custom objective - weighted combination
        return performance.sharpeRatio * 0.4 +
               performance.winRate * 0.3 +
               (1 - performance.maxDrawdown) * 0.3;
    }
  }
  
  /**
   * Private: Check constraints
   */
  private checkConstraints(parameters: any, config: OptimizationConfig): boolean {
    if (!config.constraints) return true;
    
    // Would implement constraint checking
    // For now, always return true
    return true;
  }
  
  /**
   * Private: Check convergence
   */
  private hasConverged(config: OptimizationConfig): boolean {
    if (this.convergenceHistory.length < 10) return false;
    
    const tolerance = config.convergenceTolerance || 0.0001;
    const recent = this.convergenceHistory.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    
    return variance < tolerance;
  }
  
  /**
   * Private: Analyze parameter importance
   */
  private analyzeParameterImportance(): { [key: string]: number } {
    if (this.parameterHistory.length < 10) return {};
    
    const importance: { [key: string]: number } = {};
    const paramNames = Object.keys(this.parameterHistory[0].parameters);
    
    // Simple correlation-based importance
    for (const paramName of paramNames) {
      const values = this.parameterHistory.map(h => h.parameters[paramName]);
      const scores = this.parameterHistory.map(h => h.performance);
      
      // Calculate correlation
      const correlation = this.calculateCorrelation(values, scores);
      importance[paramName] = Math.abs(correlation);
    }
    
    return importance;
  }
  
  /**
   * Private: Calculate correlation
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
    
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return den === 0 ? 0 : num / den;
  }
  
  /**
   * Private: Tournament selection (for GA)
   */
  private tournamentSelection(population: Array<{ params: any; fitness: number }>): any {
    const tournamentSize = 3;
    let best = population[Math.floor(Math.random() * population.length)];
    
    for (let i = 1; i < tournamentSize; i++) {
      const contestant = population[Math.floor(Math.random() * population.length)];
      if (contestant.fitness > best.fitness) {
        best = contestant;
      }
    }
    
    return best;
  }
  
  /**
   * Private: Crossover (for GA)
   */
  private crossover(parent1: any, parent2: any, parameters: ParameterRange[]): any {
    const child: any = {};
    
    for (const param of parameters) {
      if (Math.random() < 0.5) {
        child[param.name] = parent1[param.name];
      } else {
        child[param.name] = parent2[param.name];
      }
    }
    
    return child;
  }
  
  /**
   * Private: Mutation (for GA)
   */
  private mutate(individual: any, parameters: ParameterRange[]): any {
    const mutated = { ...individual };
    
    // Mutate one random parameter
    const param = parameters[Math.floor(Math.random() * parameters.length)];
    
    if (param.type === 'categorical') {
      const values = param.values || [];
      mutated[param.name] = values[Math.floor(Math.random() * values.length)];
    } else {
      // Add gaussian noise
      const range = (param.max || 1) - (param.min || 0);
      const noise = (Math.random() - 0.5) * range * 0.1; // 10% of range
      mutated[param.name] = Math.max(
        param.min || 0,
        Math.min(param.max || 1, mutated[param.name] + noise)
      );
    }
    
    return mutated;
  }
  
  /**
   * Private: Predict next best params (for Bayesian)
   */
  private predictNextBestParams(
    observations: Array<{ params: any; score: number }>,
    parameters: ParameterRange[]
  ): any {
    // Simplified acquisition function
    // In production, would use Gaussian Process
    
    // Find area with high uncertainty
    const candidateParams = this.generateRandomParameters(parameters);
    
    // Check distance from existing observations
    let minDistance = Infinity;
    
    for (const obs of observations) {
      const distance = this.parameterDistance(candidateParams, obs.params, parameters);
      minDistance = Math.min(minDistance, distance);
    }
    
    // Balance exploration vs exploitation
    const bestScore = Math.max(...observations.map(o => o.score));
    const exploration = minDistance;
    const exploitation = bestScore;
    
    // Return candidate with some randomness
    return candidateParams;
  }
  
  /**
   * Private: Calculate parameter distance
   */
  private parameterDistance(params1: any, params2: any, parameters: ParameterRange[]): number {
    let distance = 0;
    
    for (const param of parameters) {
      if (param.type === 'categorical') {
        distance += params1[param.name] !== params2[param.name] ? 1 : 0;
      } else {
        const range = (param.max || 1) - (param.min || 0);
        const diff = Math.abs(params1[param.name] - params2[param.name]);
        distance += diff / range;
      }
    }
    
    return distance / parameters.length;
  }
  
  /**
   * Private: Initialize velocity (for PSO)
   */
  private initializeVelocity(parameters: ParameterRange[]): any {
    const velocity: any = {};
    
    for (const param of parameters) {
      if (param.type === 'categorical') {
        velocity[param.name] = 0;
      } else {
        const range = (param.max || 1) - (param.min || 0);
        velocity[param.name] = (Math.random() - 0.5) * range * 0.1;
      }
    }
    
    return velocity;
  }
  
  /**
   * Private: Update velocity (for PSO)
   */
  private updateVelocity(
    velocity: any,
    position: any,
    personalBest: any,
    globalBest: any,
    w: number,
    c1: number,
    c2: number,
    parameters: ParameterRange[]
  ): any {
    const newVelocity: any = {};
    
    for (const param of parameters) {
      if (param.type === 'categorical') {
        // Skip categorical parameters
        newVelocity[param.name] = 0;
      } else {
        const r1 = Math.random();
        const r2 = Math.random();
        
        newVelocity[param.name] = 
          w * velocity[param.name] +
          c1 * r1 * (personalBest[param.name] - position[param.name]) +
          c2 * r2 * (globalBest[param.name] - position[param.name]);
      }
    }
    
    return newVelocity;
  }
  
  /**
   * Private: Update position (for PSO)
   */
  private updatePosition(
    position: any,
    velocity: any,
    parameters: ParameterRange[]
  ): any {
    const newPosition: any = {};
    
    for (const param of parameters) {
      if (param.type === 'categorical') {
        // Keep categorical values unchanged
        newPosition[param.name] = position[param.name];
      } else {
        // Update continuous/discrete values
        newPosition[param.name] = position[param.name] + velocity[param.name];
        
        // Clamp to bounds
        newPosition[param.name] = Math.max(
          param.min || 0,
          Math.min(param.max || 1, newPosition[param.name])
        );
        
        // Discretize if needed
        if (param.type === 'discrete' && param.step) {
          const min = param.min || 0;
          newPosition[param.name] = min + 
            Math.round((newPosition[param.name] - min) / param.step) * param.step;
        }
      }
    }
    
    return newPosition;
  }
  
  /**
   * Private: Select random indices
   */
  private selectRandomIndices(
    populationSize: number,
    count: number,
    exclude?: number
  ): number[] {
    const indices: number[] = [];
    
    while (indices.length < count) {
      const idx = Math.floor(Math.random() * populationSize);
      if (idx !== exclude && !indices.includes(idx)) {
        indices.push(idx);
      }
    }
    
    return indices;
  }
  
  /**
   * Private: Differential mutation
   */
  private differentialMutation(
    a: any,
    b: any,
    c: any,
    F: number,
    parameters: ParameterRange[]
  ): any {
    const mutant: any = {};
    
    for (const param of parameters) {
      if (param.type === 'categorical') {
        // Use majority voting for categorical
        const values = [a[param.name], b[param.name], c[param.name]];
        mutant[param.name] = values[Math.floor(Math.random() * values.length)];
      } else {
        // Differential mutation for numeric
        mutant[param.name] = a[param.name] + F * (b[param.name] - c[param.name]);
        
        // Clamp to bounds
        mutant[param.name] = Math.max(
          param.min || 0,
          Math.min(param.max || 1, mutant[param.name])
        );
      }
    }
    
    return mutant;
  }
  
  /**
   * Private: Differential crossover
   */
  private differentialCrossover(
    target: any,
    mutant: any,
    CR: number,
    parameters: ParameterRange[]
  ): any {
    const trial: any = {};
    
    // Ensure at least one parameter from mutant
    const forcedIdx = Math.floor(Math.random() * parameters.length);
    
    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      
      if (i === forcedIdx || Math.random() < CR) {
        trial[param.name] = mutant[param.name];
      } else {
        trial[param.name] = target[param.name];
      }
    }
    
    return trial;
  }
  
  /**
   * Private: Create result
   */
  private createResult(): OptimizationResult {
    return {
      bestParameters: this.bestParameters,
      bestScore: this.bestScore,
      iterations: this.iterationCount,
      convergenceHistory: this.convergenceHistory
    };
  }
  
  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down WalkForwardOptimizer');
    await this.backtester.shutdown();
  }
} 