import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface StrategyGenome {
  id: string;
  strategyId: string;
  generation: number;
  parameters: Record<string, number>;
  fitness: number;
  metrics: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    avgTrade: number;
  };
  parentIds: string[];
  mutationRate: number;
}

interface EvolutionConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  crossoverRate: number;
  eliteCount: number;
  tournamentSize: number;
  fitnessWeights: {
    sharpe: number;
    drawdown: number;
    winRate: number;
    profitFactor: number;
  };
}

interface ParameterBounds {
  name: string;
  min: number;
  max: number;
  step: number;
  type: 'int' | 'float';
}

interface EvolutionResult {
  bestGenome: StrategyGenome;
  finalPopulation: StrategyGenome[];
  evolutionHistory: GenerationStats[];
  convergenceGeneration: number;
  improvementRate: number;
}

interface GenerationStats {
  generation: number;
  avgFitness: number;
  maxFitness: number;
  minFitness: number;
  diversity: number;
  bestGenome: StrategyGenome;
}

export class StrategyEvolution extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: EvolutionConfig;
  private population: StrategyGenome[] = [];
  private generation: number = 0;
  private evolutionHistory: GenerationStats[] = [];
  private parameterBounds: Map<string, ParameterBounds> = new Map();
  private isEvolving: boolean = false;
  
  constructor(config: EvolutionConfig) {
    super();
    this.logger = createLogger('StrategyEvolution');
    // Default configuration
    const defaultConfig: EvolutionConfig = {
      populationSize: 50,
      generations: 100,
      mutationRate: 0.1,
      crossoverRate: 0.7,
      eliteCount: 5,
      tournamentSize: 3,
      fitnessWeights: {
        sharpe: 0.4,
        drawdown: 0.3,
        winRate: 0.2,
        profitFactor: 0.1
      }
    };
    
    this.config = { ...defaultConfig, ...config };
  }
  
  public defineParameters(strategyId: string, parameters: ParameterBounds[]): void {
    parameters.forEach(param => {
      this.parameterBounds.set(`${strategyId}_${param.name}`, param);
    });
    
    this.logger.info('Defined strategy parameters', {
      strategyId,
      parameters: parameters.length
    });
  }
  
  public async evolveStrategy(
    strategyId: string,
    backtestFunc: (params: Record<string, number>) => Promise<any>
  ): Promise<EvolutionResult> {
    this.logger.info('Starting strategy evolution', {
      strategyId,
      populationSize: this.config.populationSize,
      generations: this.config.generations
    });
    
    this.isEvolving = true;
    this.generation = 0;
    this.evolutionHistory = [];
    
    try {
      // Initialize population
      await this.initializePopulation(strategyId, backtestFunc);
      
      // Evolution loop
      for (let gen = 0; gen < this.config.generations; gen++) {
        this.generation = gen;
        
        // Evaluate fitness
        await this.evaluateFitness(backtestFunc);
        
        // Record generation stats
        const stats = this.recordGenerationStats();
        this.evolutionHistory.push(stats);
        
        this.logger.info(`Generation ${gen} complete`, {
          avgFitness: stats.avgFitness.toFixed(4),
          maxFitness: stats.maxFitness.toFixed(4),
          diversity: stats.diversity.toFixed(4)
        });
        
        this.emit('generation-complete', stats);
        
        // Check convergence
        if (this.hasConverged()) {
          this.logger.info('Evolution converged early', { generation: gen });
          break;
        }
        
        // Create next generation
        this.population = await this.createNextGeneration(backtestFunc);
      }
      
      // Final evaluation
      await this.evaluateFitness(backtestFunc);
      
      const result = this.generateResult();
      
      this.logger.info('Evolution complete', {
        bestFitness: result.bestGenome.fitness,
        improvementRate: result.improvementRate,
        convergenceGen: result.convergenceGeneration
      });
      
      this.emit('evolution-complete', result);
      
      return result;
      
    } finally {
      this.isEvolving = false;
    }
  }
  
  private async initializePopulation(
    strategyId: string,
    backtestFunc: (params: Record<string, number>) => Promise<any>
  ): Promise<void> {
    this.population = [];
    
    // Get parameter bounds for this strategy
    const paramKeys = Array.from(this.parameterBounds.keys())
      .filter(key => key.startsWith(strategyId));
    
    for (let i = 0; i < this.config.populationSize; i++) {
      const genome = this.createRandomGenome(strategyId, paramKeys);
      
      // Run initial backtest
      const results = await backtestFunc(genome.parameters);
      genome.metrics = this.extractMetrics(results);
      genome.fitness = this.calculateFitness(genome.metrics);
      
      this.population.push(genome);
      
      this.emit('genome-evaluated', {
        generation: 0,
        genomeIndex: i,
        fitness: genome.fitness
      });
    }
    
    // Sort by fitness
    this.population.sort((a, b) => b.fitness - a.fitness);
  }
  
  private createRandomGenome(strategyId: string, paramKeys: string[]): StrategyGenome {
    const parameters: Record<string, number> = {};
    
    paramKeys.forEach(key => {
      const bounds = this.parameterBounds.get(key)!;
      const paramName = key.replace(`${strategyId}_`, '');
      
      if (bounds.type === 'int') {
        parameters[paramName] = Math.floor(
          bounds.min + Math.random() * (bounds.max - bounds.min)
        );
      } else {
        parameters[paramName] = bounds.min + Math.random() * (bounds.max - bounds.min);
      }
    });
    
    return {
      id: `genome_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      strategyId,
      generation: this.generation,
      parameters,
      fitness: 0,
      metrics: {
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        avgTrade: 0
      },
      parentIds: [],
      mutationRate: this.config.mutationRate
    };
  }
  
  private extractMetrics(backtestResults: any): StrategyGenome['metrics'] {
    // Extract metrics from backtest results
    return {
      sharpeRatio: backtestResults.sharpeRatio || 0,
      maxDrawdown: Math.abs(backtestResults.maxDrawdown || 0),
      winRate: backtestResults.winRate || 0,
      profitFactor: backtestResults.profitFactor || 0,
      avgTrade: backtestResults.avgTrade || 0
    };
  }
  
  private calculateFitness(metrics: StrategyGenome['metrics']): number {
    const weights = this.config.fitnessWeights;
    
    // Normalize metrics
    const normalizedSharpe = Math.max(0, Math.min(5, metrics.sharpeRatio)) / 5;
    const normalizedDrawdown = 1 - Math.min(1, metrics.maxDrawdown);
    const normalizedWinRate = metrics.winRate;
    const normalizedProfitFactor = Math.max(0, Math.min(3, metrics.profitFactor)) / 3;
    
    // Calculate weighted fitness
    const fitness = 
      weights.sharpe * normalizedSharpe +
      weights.drawdown * normalizedDrawdown +
      weights.winRate * normalizedWinRate +
      weights.profitFactor * normalizedProfitFactor;
    
    return fitness;
  }
  
  private async evaluateFitness(
    backtestFunc: (params: Record<string, number>) => Promise<any>
  ): Promise<void> {
    // Re-evaluate any genomes without fitness
    const unevaluated = this.population.filter(g => g.fitness === 0);
    
    for (const genome of unevaluated) {
      const results = await backtestFunc(genome.parameters);
      genome.metrics = this.extractMetrics(results);
      genome.fitness = this.calculateFitness(genome.metrics);
    }
    
    // Sort by fitness
    this.population.sort((a, b) => b.fitness - a.fitness);
  }
  
  private recordGenerationStats(): GenerationStats {
    const fitnesses = this.population.map(g => g.fitness);
    const avgFitness = fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length;
    const maxFitness = Math.max(...fitnesses);
    const minFitness = Math.min(...fitnesses);
    
    // Calculate diversity (standard deviation of parameters)
    const diversity = this.calculateDiversity();
    
    return {
      generation: this.generation,
      avgFitness,
      maxFitness,
      minFitness,
      diversity,
      bestGenome: { ...this.population[0] }
    };
  }
  
  private calculateDiversity(): number {
    if (this.population.length < 2) return 0;
    
    // Calculate parameter variance across population
    const paramNames = Object.keys(this.population[0].parameters);
    let totalVariance = 0;
    
    paramNames.forEach(param => {
      const values = this.population.map(g => g.parameters[param]);
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      totalVariance += variance;
    });
    
    return Math.sqrt(totalVariance / paramNames.length);
  }
  
  private hasConverged(): boolean {
    if (this.evolutionHistory.length < 10) return false;
    
    // Check if fitness hasn't improved in last 10 generations
    const recent = this.evolutionHistory.slice(-10);
    const improvements: number[] = [];
    
    for (let i = 1; i < recent.length; i++) {
      improvements.push(recent[i].maxFitness - recent[i-1].maxFitness);
    }
    
    const avgImprovement = improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
    
    return avgImprovement < 0.001; // Less than 0.1% improvement
  }
  
  private async createNextGeneration(
    backtestFunc: (params: Record<string, number>) => Promise<any>
  ): Promise<StrategyGenome[]> {
    const nextGen: StrategyGenome[] = [];
    
    // Elite selection - keep best genomes
    for (let i = 0; i < this.config.eliteCount; i++) {
      nextGen.push(this.cloneGenome(this.population[i]));
    }
    
    // Create rest of population through crossover and mutation
    while (nextGen.length < this.config.populationSize) {
      if (Math.random() < this.config.crossoverRate && nextGen.length < this.config.populationSize - 1) {
        // Crossover
        const parent1 = this.tournamentSelect();
        const parent2 = this.tournamentSelect();
        const [child1, child2] = this.crossover(parent1, parent2);
        
        nextGen.push(child1);
        if (nextGen.length < this.config.populationSize) {
          nextGen.push(child2);
        }
      } else {
        // Mutation
        const parent = this.tournamentSelect();
        const child = this.mutate(parent);
        nextGen.push(child);
      }
    }
    
    // Update generation number
    nextGen.forEach(genome => {
      genome.generation = this.generation + 1;
      genome.fitness = 0; // Reset for re-evaluation
    });
    
    return nextGen;
  }
  
  private cloneGenome(genome: StrategyGenome): StrategyGenome {
    return {
      ...genome,
      id: `genome_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      parameters: { ...genome.parameters },
      metrics: { ...genome.metrics }
    };
  }
  
  private tournamentSelect(): StrategyGenome {
    const tournament: StrategyGenome[] = [];
    
    // Select random individuals for tournament
    for (let i = 0; i < this.config.tournamentSize; i++) {
      const idx = Math.floor(Math.random() * this.population.length);
      tournament.push(this.population[idx]);
    }
    
    // Return the fittest
    return tournament.reduce((best, current) => 
      current.fitness > best.fitness ? current : best
    );
  }
  
  private crossover(parent1: StrategyGenome, parent2: StrategyGenome): [StrategyGenome, StrategyGenome] {
    const child1 = this.cloneGenome(parent1);
    const child2 = this.cloneGenome(parent2);
    
    child1.parentIds = [parent1.id, parent2.id];
    child2.parentIds = [parent1.id, parent2.id];
    
    // Uniform crossover
    Object.keys(parent1.parameters).forEach(param => {
      if (Math.random() < 0.5) {
        // Swap parameters
        const temp = child1.parameters[param];
        child1.parameters[param] = child2.parameters[param];
        child2.parameters[param] = temp;
      }
    });
    
    return [child1, child2];
  }
  
  private mutate(parent: StrategyGenome): StrategyGenome {
    const child = this.cloneGenome(parent);
    child.parentIds = [parent.id];
    
    const strategyId = parent.strategyId;
    
    Object.keys(parent.parameters).forEach(param => {
      if (Math.random() < child.mutationRate) {
        const boundKey = `${strategyId}_${param}`;
        const bounds = this.parameterBounds.get(boundKey);
        
        if (bounds) {
          // Gaussian mutation
          const stdDev = (bounds.max - bounds.min) * 0.1;
          let newValue = child.parameters[param] + this.gaussianRandom() * stdDev;
          
          // Clamp to bounds
          newValue = Math.max(bounds.min, Math.min(bounds.max, newValue));
          
          if (bounds.type === 'int') {
            newValue = Math.round(newValue);
          }
          
          child.parameters[param] = newValue;
        }
      }
    });
    
    // Adaptive mutation rate
    if (this.generation > 50) {
      child.mutationRate = Math.max(0.01, child.mutationRate * 0.95);
    }
    
    return child;
  }
  
  private gaussianRandom(): number {
    // Box-Muller transform for Gaussian distribution
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  
  private generateResult(): EvolutionResult {
    const bestGenome = this.population[0];
    
    // Find convergence generation
    let convergenceGen = this.config.generations;
    for (let i = 10; i < this.evolutionHistory.length; i++) {
      const recent = this.evolutionHistory.slice(i-10, i);
      const improvements: number[] = [];
      
      for (let j = 1; j < recent.length; j++) {
        improvements.push(recent[j].maxFitness - recent[j-1].maxFitness);
      }
      
      const avgImprovement = improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
      
      if (avgImprovement < 0.001) {
        convergenceGen = i;
        break;
      }
    }
    
    // Calculate improvement rate
    const initialFitness = this.evolutionHistory[0].maxFitness;
    const finalFitness = bestGenome.fitness;
    const improvementRate = (finalFitness - initialFitness) / initialFitness;
    
    return {
      bestGenome,
      finalPopulation: [...this.population],
      evolutionHistory: [...this.evolutionHistory],
      convergenceGeneration: convergenceGen,
      improvementRate
    };
  }
  
  public async optimizeMultipleStrategies(
    strategies: { id: string; params: ParameterBounds[] }[],
    backtestFunc: (strategyId: string, params: Record<string, number>) => Promise<any>
  ): Promise<Map<string, EvolutionResult>> {
    const results = new Map<string, EvolutionResult>();
    
    for (const strategy of strategies) {
      this.defineParameters(strategy.id, strategy.params);
      
      const wrappedBacktest = (params: Record<string, number>) => 
        backtestFunc(strategy.id, params);
      
      const result = await this.evolveStrategy(strategy.id, wrappedBacktest);
      results.set(strategy.id, result);
    }
    
    return results;
  }
  
  public exportBestParameters(result: EvolutionResult): string {
    const config = {
      strategyId: result.bestGenome.strategyId,
      generation: result.bestGenome.generation,
      fitness: result.bestGenome.fitness,
      metrics: result.bestGenome.metrics,
      parameters: result.bestGenome.parameters,
      evolutionStats: {
        totalGenerations: result.evolutionHistory.length,
        convergenceGeneration: result.convergenceGeneration,
        improvementRate: result.improvementRate,
        finalDiversity: result.evolutionHistory[result.evolutionHistory.length - 1].diversity
      }
    };
    
    return JSON.stringify(config, null, 2);
  }
} 