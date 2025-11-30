import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Strategy genome representing a trading strategy
 */
export interface StrategyGenome {
  id: string;
  genes: StrategyGenes;
  fitness: number;
  generation: number;
  parentIds: string[];
  createdAt: Date;
}

/**
 * Strategy genes (parameters)
 */
export interface StrategyGenes {
  // Entry conditions
  entryRsiThreshold: number;        // 20-80
  entryMacdSignal: number;          // -1 to 1
  entryVolumeMultiplier: number;    // 0.5-3.0
  entryBollingerPosition: number;   // 0-1 (position within bands)
  
  // Exit conditions
  exitProfitTarget: number;         // 0.001-0.05 (0.1%-5%)
  exitStopLoss: number;             // 0.001-0.02 (0.1%-2%)
  exitTimeLimit: number;            // 60-3600 seconds
  exitTrailingStop: number;         // 0.001-0.01 (0.1%-1%)
  
  // Risk management
  positionSizeMultiplier: number;   // 0.1-2.0
  maxDrawdownTolerance: number;     // 0.05-0.20 (5%-20%)
  correlationThreshold: number;     // 0.3-0.8
  
  // ML features
  useMLSignals: boolean;
  mlConfidenceThreshold: number;    // 0.5-0.95
  mlFeatureWeights: number[];       // Variable length
}

/**
 * Evolution configuration
 */
export interface EvolutionConfig {
  populationSize: number;
  eliteSize: number;
  mutationRate: number;
  crossoverRate: number;
  tournamentSize: number;
  maxGenerations: number;
  convergenceThreshold: number;
  
  // Fitness weights
  fitnessWeights: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
  };
}

/**
 * Strategy performance metrics
 */
export interface StrategyPerformance {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgHoldTime: number;
}

/**
 * Strategy evolution engine using genetic programming
 */
export class StrategyEvolutionEngine extends EventEmitter {
  private config: EvolutionConfig;
  private logger: winston.Logger;
  private population: StrategyGenome[] = [];
  private generation: number = 0;
  private bestGenome: StrategyGenome | null = null;
  private convergenceHistory: number[] = [];
  
  constructor(config: EvolutionConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
  }
  
  /**
   * Initialize population with random genomes
   */
  initializePopulation(): void {
    this.population = [];
    
    for (let i = 0; i < this.config.populationSize; i++) {
      const genome = this.createRandomGenome();
      this.population.push(genome);
    }
    
    this.generation = 0;
    this.logger.info('Population initialized', {
      size: this.config.populationSize,
      generation: this.generation
    });
  }
  
  /**
   * Create a random genome
   */
  private createRandomGenome(): StrategyGenome {
    const mlFeatureCount = 10; // Number of ML features
    
    return {
      id: this.generateId(),
      genes: {
        // Entry conditions
        entryRsiThreshold: this.randomRange(20, 80),
        entryMacdSignal: this.randomRange(-1, 1),
        entryVolumeMultiplier: this.randomRange(0.5, 3.0),
        entryBollingerPosition: this.randomRange(0, 1),
        
        // Exit conditions
        exitProfitTarget: this.randomRange(0.001, 0.05),
        exitStopLoss: this.randomRange(0.001, 0.02),
        exitTimeLimit: this.randomRange(60, 3600),
        exitTrailingStop: this.randomRange(0.001, 0.01),
        
        // Risk management
        positionSizeMultiplier: this.randomRange(0.1, 2.0),
        maxDrawdownTolerance: this.randomRange(0.05, 0.20),
        correlationThreshold: this.randomRange(0.3, 0.8),
        
        // ML features
        useMLSignals: Math.random() > 0.5,
        mlConfidenceThreshold: this.randomRange(0.5, 0.95),
        mlFeatureWeights: Array(mlFeatureCount).fill(0).map(() => this.randomRange(-1, 1))
      },
      fitness: 0,
      generation: this.generation,
      parentIds: [],
      createdAt: new Date()
    };
  }
  
  /**
   * Evolve population for one generation
   */
  async evolveGeneration(
    evaluator: (genome: StrategyGenome) => Promise<StrategyPerformance>
  ): Promise<void> {
    // Evaluate fitness for all genomes
    await this.evaluatePopulation(evaluator);
    
    // Sort by fitness
    this.population.sort((a, b) => b.fitness - a.fitness);
    
    // Track best genome
    if (!this.bestGenome || this.population[0].fitness > this.bestGenome.fitness) {
      this.bestGenome = { ...this.population[0] };
      this.emit('newBest', this.bestGenome);
    }
    
    // Check convergence
    const avgFitness = this.population.reduce((sum, g) => sum + g.fitness, 0) / this.population.length;
    this.convergenceHistory.push(avgFitness);
    if (this.convergenceHistory.length > 10) {
      this.convergenceHistory.shift();
    }
    
    if (this.checkConvergence()) {
      this.emit('converged', {
        generation: this.generation,
        bestFitness: this.bestGenome.fitness,
        avgFitness
      });
      return;
    }
    
    // Create next generation
    const nextGeneration: StrategyGenome[] = [];
    
    // Elite selection
    for (let i = 0; i < this.config.eliteSize; i++) {
      nextGeneration.push({ ...this.population[i] });
    }
    
    // Generate rest of population
    while (nextGeneration.length < this.config.populationSize) {
      if (Math.random() < this.config.crossoverRate) {
        // Crossover
        const parent1 = this.tournamentSelection();
        const parent2 = this.tournamentSelection();
        const child = this.crossover(parent1, parent2);
        nextGeneration.push(child);
      } else {
        // Clone and mutate
        const parent = this.tournamentSelection();
        const child = this.mutate({ ...parent });
        nextGeneration.push(child);
      }
    }
    
    this.population = nextGeneration;
    this.generation++;
    
    this.emit('generationComplete', {
      generation: this.generation,
      bestFitness: this.bestGenome.fitness,
      avgFitness
    });
  }
  
  /**
   * Evaluate fitness for all genomes
   */
  private async evaluatePopulation(
    evaluator: (genome: StrategyGenome) => Promise<StrategyPerformance>
  ): Promise<void> {
    const evaluations = await Promise.all(
      this.population.map(async (genome) => {
        try {
          const performance = await evaluator(genome);
          genome.fitness = this.calculateFitness(performance);
          return { genome, performance };
        } catch (error) {
          this.logger.error('Genome evaluation failed', { genomeId: genome.id, error });
          genome.fitness = 0;
          return null;
        }
      })
    );
    
    // Log evaluation results
    const successful = evaluations.filter(e => e !== null).length;
    this.logger.info('Population evaluated', {
      generation: this.generation,
      successful,
      failed: this.population.length - successful
    });
  }
  
  /**
   * Calculate fitness from performance metrics
   */
  private calculateFitness(performance: StrategyPerformance): number {
    const weights = this.config.fitnessWeights;
    
    // Normalize metrics
    const normalizedSharpe = Math.max(0, Math.min(5, performance.sharpeRatio)) / 5;
    const normalizedReturn = Math.max(0, Math.min(2, performance.totalReturn + 1)) / 2;
    const normalizedDrawdown = Math.max(0, 1 - performance.maxDrawdown);
    const normalizedWinRate = performance.winRate;
    const normalizedProfitFactor = Math.max(0, Math.min(3, performance.profitFactor)) / 3;
    
    // Weighted sum
    const fitness = 
      weights.sharpeRatio * normalizedSharpe +
      weights.totalReturn * normalizedReturn +
      weights.maxDrawdown * normalizedDrawdown +
      weights.winRate * normalizedWinRate +
      weights.profitFactor * normalizedProfitFactor;
    
    return fitness;
  }
  
  /**
   * Tournament selection
   */
  private tournamentSelection(): StrategyGenome {
    const tournament: StrategyGenome[] = [];
    
    for (let i = 0; i < this.config.tournamentSize; i++) {
      const idx = Math.floor(Math.random() * this.population.length);
      tournament.push(this.population[idx]);
    }
    
    tournament.sort((a, b) => b.fitness - a.fitness);
    return tournament[0];
  }
  
  /**
   * Crossover two genomes
   */
  private crossover(parent1: StrategyGenome, parent2: StrategyGenome): StrategyGenome {
    const child: StrategyGenome = {
      id: this.generateId(),
      genes: {} as StrategyGenes,
      fitness: 0,
      generation: this.generation + 1,
      parentIds: [parent1.id, parent2.id],
      createdAt: new Date()
    };
    
    // Uniform crossover
    const genes1 = parent1.genes;
    const genes2 = parent2.genes;
    
    // Numeric genes
    child.genes.entryRsiThreshold = Math.random() > 0.5 ? genes1.entryRsiThreshold : genes2.entryRsiThreshold;
    child.genes.entryMacdSignal = Math.random() > 0.5 ? genes1.entryMacdSignal : genes2.entryMacdSignal;
    child.genes.entryVolumeMultiplier = Math.random() > 0.5 ? genes1.entryVolumeMultiplier : genes2.entryVolumeMultiplier;
    child.genes.entryBollingerPosition = Math.random() > 0.5 ? genes1.entryBollingerPosition : genes2.entryBollingerPosition;
    
    child.genes.exitProfitTarget = Math.random() > 0.5 ? genes1.exitProfitTarget : genes2.exitProfitTarget;
    child.genes.exitStopLoss = Math.random() > 0.5 ? genes1.exitStopLoss : genes2.exitStopLoss;
    child.genes.exitTimeLimit = Math.random() > 0.5 ? genes1.exitTimeLimit : genes2.exitTimeLimit;
    child.genes.exitTrailingStop = Math.random() > 0.5 ? genes1.exitTrailingStop : genes2.exitTrailingStop;
    
    child.genes.positionSizeMultiplier = Math.random() > 0.5 ? genes1.positionSizeMultiplier : genes2.positionSizeMultiplier;
    child.genes.maxDrawdownTolerance = Math.random() > 0.5 ? genes1.maxDrawdownTolerance : genes2.maxDrawdownTolerance;
    child.genes.correlationThreshold = Math.random() > 0.5 ? genes1.correlationThreshold : genes2.correlationThreshold;
    
    // Boolean gene
    child.genes.useMLSignals = Math.random() > 0.5 ? genes1.useMLSignals : genes2.useMLSignals;
    child.genes.mlConfidenceThreshold = Math.random() > 0.5 ? genes1.mlConfidenceThreshold : genes2.mlConfidenceThreshold;
    
    // Array crossover (blend)
    child.genes.mlFeatureWeights = genes1.mlFeatureWeights.map((w1, i) => {
      const w2 = genes2.mlFeatureWeights[i];
      return Math.random() > 0.5 ? w1 : w2;
    });
    
    return child;
  }
  
  /**
   * Mutate a genome
   */
  private mutate(genome: StrategyGenome): StrategyGenome {
    const mutated = { ...genome };
    mutated.id = this.generateId();
    mutated.generation = this.generation + 1;
    mutated.parentIds = [genome.id];
    mutated.createdAt = new Date();
    
    const genes = { ...genome.genes };
    
    // Mutate each gene with probability
    if (Math.random() < this.config.mutationRate) {
      genes.entryRsiThreshold = this.mutateValue(genes.entryRsiThreshold, 20, 80);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.entryMacdSignal = this.mutateValue(genes.entryMacdSignal, -1, 1);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.entryVolumeMultiplier = this.mutateValue(genes.entryVolumeMultiplier, 0.5, 3.0);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.entryBollingerPosition = this.mutateValue(genes.entryBollingerPosition, 0, 1);
    }
    
    if (Math.random() < this.config.mutationRate) {
      genes.exitProfitTarget = this.mutateValue(genes.exitProfitTarget, 0.001, 0.05);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.exitStopLoss = this.mutateValue(genes.exitStopLoss, 0.001, 0.02);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.exitTimeLimit = this.mutateValue(genes.exitTimeLimit, 60, 3600);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.exitTrailingStop = this.mutateValue(genes.exitTrailingStop, 0.001, 0.01);
    }
    
    if (Math.random() < this.config.mutationRate) {
      genes.positionSizeMultiplier = this.mutateValue(genes.positionSizeMultiplier, 0.1, 2.0);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.maxDrawdownTolerance = this.mutateValue(genes.maxDrawdownTolerance, 0.05, 0.20);
    }
    if (Math.random() < this.config.mutationRate) {
      genes.correlationThreshold = this.mutateValue(genes.correlationThreshold, 0.3, 0.8);
    }
    
    if (Math.random() < this.config.mutationRate) {
      genes.useMLSignals = !genes.useMLSignals;
    }
    if (Math.random() < this.config.mutationRate) {
      genes.mlConfidenceThreshold = this.mutateValue(genes.mlConfidenceThreshold, 0.5, 0.95);
    }
    
    // Mutate feature weights
    genes.mlFeatureWeights = genes.mlFeatureWeights.map(w => {
      if (Math.random() < this.config.mutationRate) {
        return this.mutateValue(w, -1, 1);
      }
      return w;
    });
    
    mutated.genes = genes;
    return mutated;
  }
  
  /**
   * Mutate a numeric value
   */
  private mutateValue(value: number, min: number, max: number): number {
    const range = max - min;
    const mutation = (Math.random() - 0.5) * range * 0.2; // 20% max change
    const newValue = value + mutation;
    return Math.max(min, Math.min(max, newValue));
  }
  
  /**
   * Check for convergence
   */
  private checkConvergence(): boolean {
    if (this.convergenceHistory.length < 10) {
      return false;
    }
    
    // Calculate variance in fitness over last 10 generations
    const mean = this.convergenceHistory.reduce((a, b) => a + b, 0) / this.convergenceHistory.length;
    const variance = this.convergenceHistory.reduce((sum, val) => {
      const diff = val - mean;
      return sum + diff * diff;
    }, 0) / this.convergenceHistory.length;
    
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / mean;
    
    return coefficientOfVariation < this.config.convergenceThreshold;
  }
  
  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `genome_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Random value in range
   */
  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
  
  /**
   * Get current population
   */
  getPopulation(): StrategyGenome[] {
    return [...this.population];
  }
  
  /**
   * Get best genome
   */
  getBestGenome(): StrategyGenome | null {
    return this.bestGenome ? { ...this.bestGenome } : null;
  }
  
  /**
   * Get evolution statistics
   */
  getStatistics(): EvolutionStatistics {
    const fitnesses = this.population.map(g => g.fitness);
    const avgFitness = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;
    const maxFitness = Math.max(...fitnesses);
    const minFitness = Math.min(...fitnesses);
    
    return {
      generation: this.generation,
      populationSize: this.population.length,
      avgFitness,
      maxFitness,
      minFitness,
      bestGenomeId: this.bestGenome?.id || null,
      convergenceHistory: [...this.convergenceHistory]
    };
  }
}

/**
 * Evolution statistics
 */
export interface EvolutionStatistics {
  generation: number;
  populationSize: number;
  avgFitness: number;
  maxFitness: number;
  minFitness: number;
  bestGenomeId: string | null;
  convergenceHistory: number[];
} 