/**
 * EvolutionEngine - Genetic Programming for Trading Strategy Evolution
 * 
 * Implements genetic algorithms to evolve trading strategies through
 * selection, crossover, mutation, and fitness evaluation
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { StrategyGenome } from './StrategyGenome';
import { 
  EvolutionMetrics,
  StrategyPerformance
} from '@noderr/types';

interface EvolutionConfig {
  populationSize: number;
  mutationRate: number;
  crossoverRate: number;
  eliteRatio: number;
  maxGenerations: number;
  targetFitness?: number;
  tournamentSize?: number;
  diversityBonus?: number;
  parallelEvaluations?: number;
}

interface FitnessFunction {
  (genome: StrategyGenome, historicalData: any[]): Promise<number>;
}

export class EvolutionEngine extends EventEmitter {
  private logger: Logger;
  private config: EvolutionConfig;
  private population: StrategyGenome[] = [];
  private generation = 0;
  private bestGenome: StrategyGenome | null = null;
  private convergenceHistory: number[] = [];
  private fitnessFunction: FitnessFunction;
  private isEvolving = false;
  
  constructor(logger: Logger, config: EvolutionConfig) {
    super();
    this.logger = logger;
    this.config = {
      tournamentSize: 3,
      diversityBonus: 0.1,
      parallelEvaluations: 4,
      ...config
    };
    
    // Default fitness function (Sharpe ratio based)
    this.fitnessFunction = async (genome: StrategyGenome, data: any[]) => {
      // Simplified fitness - would run full backtest in production
      const complexity = genome.getComplexity();
      const validity = genome.isValid() ? 1.0 : 0.1;
      const randomComponent = Math.random() * 0.1;
      
      // Penalize overly complex strategies
      const complexityPenalty = Math.exp(-complexity / 20);
      
      return validity * (0.5 + randomComponent) * complexityPenalty;
    };
  }
  
  /**
   * Initialize population
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Evolution Engine', {
      populationSize: this.config.populationSize,
      mutationRate: this.config.mutationRate
    });
    
    // Create initial random population
    this.population = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      this.population.push(StrategyGenome.createRandom());
    }
    
    this.logger.info('Evolution Engine initialized');
  }
  
  /**
   * Set custom fitness function
   */
  setFitnessFunction(fn: FitnessFunction): void {
    this.fitnessFunction = fn;
  }
  
  /**
   * Run evolution for specified generations
   */
  async evolve(historicalData: any[], generations?: number): Promise<StrategyGenome> {
    const maxGen = generations || this.config.maxGenerations;
    this.isEvolving = true;
    
    this.logger.info('Starting evolution', {
      generations: maxGen,
      populationSize: this.population.length
    });
    
    try {
      while (this.generation < maxGen && this.isEvolving) {
        await this.evolveGeneration(historicalData);
        
        // Check termination conditions
        if (this.shouldTerminate()) {
          break;
        }
      }
      
      return this.bestGenome || this.population[0];
      
    } finally {
      this.isEvolving = false;
    }
  }
  
  /**
   * Evolve a single generation
   */
  private async evolveGeneration(historicalData: any[]): Promise<void> {
    const startTime = Date.now();
    
    // Step 1: Evaluate fitness
    await this.evaluateFitness(historicalData);
    
    // Step 2: Sort by fitness
    this.population.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));
    
    // Update best genome
    if (!this.bestGenome || (this.population[0].fitness || 0) > (this.bestGenome.fitness || 0)) {
      this.bestGenome = this.population[0].clone();
      this.logger.info('New best genome found', {
        fitness: this.bestGenome.fitness,
        generation: this.generation,
        complexity: this.bestGenome.getComplexity()
      });
    }
    
    // Step 3: Create new population
    const newPopulation: StrategyGenome[] = [];
    
    // Elite selection
    const eliteCount = Math.floor(this.config.populationSize * this.config.eliteRatio);
    for (let i = 0; i < eliteCount; i++) {
      newPopulation.push(this.population[i].clone());
    }
    
    // Fill rest with offspring
    while (newPopulation.length < this.config.populationSize) {
      if (Math.random() < this.config.crossoverRate) {
        // Crossover
        const parent1 = this.selectParent();
        const parent2 = this.selectParent();
        const child = parent1.crossover(parent2);
        
        // Mutate child
        if (Math.random() < this.config.mutationRate) {
          child.mutate(this.config.mutationRate);
        }
        
        newPopulation.push(child);
      } else {
        // Clone and mutate
        const parent = this.selectParent();
        const child = parent.clone();
        child.mutate(this.config.mutationRate);
        newPopulation.push(child);
      }
    }
    
    // Replace population
    this.population = newPopulation;
    this.generation++;
    
    // Calculate metrics
    const metrics = this.calculateMetrics();
    
    // Track convergence
    this.convergenceHistory.push(metrics.bestFitness);
    if (this.convergenceHistory.length > 10) {
      this.convergenceHistory.shift();
    }
    
    // Emit progress
    this.emit('evolution:generation:complete', metrics);
    
    const elapsed = Date.now() - startTime;
    this.logger.debug('Generation completed', {
      generation: this.generation,
      bestFitness: metrics.bestFitness,
      avgFitness: metrics.avgFitness,
      diversity: metrics.diversity,
      elapsed
    });
  }
  
  /**
   * Evaluate fitness for all genomes
   */
  private async evaluateFitness(historicalData: any[]): Promise<void> {
    // Parallel evaluation
    const batchSize = this.config.parallelEvaluations || 4;
    
    for (let i = 0; i < this.population.length; i += batchSize) {
      const batch = this.population.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (genome) => {
          if (genome.fitness === undefined || genome.generation < this.generation) {
            genome.fitness = await this.evaluateGenome(genome, historicalData);
            genome.generation = this.generation;
          }
        })
      );
    }
  }
  
  /**
   * Evaluate a single genome
   */
  private async evaluateGenome(genome: StrategyGenome, historicalData: any[]): Promise<number> {
    try {
      // Apply diversity bonus
      const baseFitness = await this.fitnessFunction(genome, historicalData);
      const diversityBonus = this.calculateDiversityBonus(genome);
      
      return baseFitness + diversityBonus;
      
    } catch (error) {
      this.logger.error('Genome evaluation failed', { 
        error, 
        genomeId: genome.id 
      });
      return 0; // Worst fitness
    }
  }
  
  /**
   * Calculate diversity bonus for a genome
   */
  private calculateDiversityBonus(genome: StrategyGenome): number {
    if (!this.config.diversityBonus) return 0;
    
    // Compare with other genomes
    let totalDistance = 0;
    let count = 0;
    
    for (const other of this.population.slice(0, 10)) { // Compare with top 10
      if (other.id !== genome.id) {
        totalDistance += this.calculateGenomeDistance(genome, other);
        count++;
      }
    }
    
    const avgDistance = count > 0 ? totalDistance / count : 0;
    return avgDistance * this.config.diversityBonus;
  }
  
  /**
   * Calculate distance between two genomes
   */
  private calculateGenomeDistance(g1: StrategyGenome, g2: StrategyGenome): number {
    const genes1 = new Set(g1.genes.map(g => `${g.type}:${g.name}`));
    const genes2 = new Set(g2.genes.map(g => `${g.type}:${g.name}`));
    
    // Jaccard distance
    const intersection = new Set([...genes1].filter(x => genes2.has(x)));
    const union = new Set([...genes1, ...genes2]);
    
    return union.size > 0 ? 1 - intersection.size / union.size : 1;
  }
  
  /**
   * Select parent using tournament selection
   */
  private selectParent(): StrategyGenome {
    const tournamentSize = this.config.tournamentSize || 3;
    const tournament: StrategyGenome[] = [];
    
    // Select random individuals for tournament
    for (let i = 0; i < tournamentSize; i++) {
      const idx = Math.floor(Math.random() * this.population.length);
      tournament.push(this.population[idx]);
    }
    
    // Return the fittest
    return tournament.reduce((best, current) => 
      (current.fitness || 0) > (best.fitness || 0) ? current : best
    );
  }
  
  /**
   * Check if evolution should terminate
   */
  private shouldTerminate(): boolean {
    // Target fitness reached
    if (this.config.targetFitness && this.bestGenome) {
      if ((this.bestGenome.fitness || 0) >= this.config.targetFitness) {
        this.logger.info('Target fitness reached', {
          fitness: this.bestGenome.fitness,
          target: this.config.targetFitness
        });
        return true;
      }
    }
    
    // Check convergence
    if (this.convergenceHistory.length >= 10) {
      const variance = this.calculateVariance(this.convergenceHistory);
      if (variance < 0.001) {
        this.logger.info('Population converged', {
          variance,
          generation: this.generation
        });
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Calculate variance of array
   */
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(x => Math.pow(x - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }
  
  /**
   * Calculate evolution metrics
   */
  private calculateMetrics(): EvolutionMetrics {
    const fitnesses = this.population.map(g => g.fitness || 0);
    const bestFitness = Math.max(...fitnesses);
    const avgFitness = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;
    
    // Calculate diversity
    let totalDistance = 0;
    let comparisons = 0;
    
    for (let i = 0; i < Math.min(10, this.population.length); i++) {
      for (let j = i + 1; j < Math.min(10, this.population.length); j++) {
        totalDistance += this.calculateGenomeDistance(
          this.population[i], 
          this.population[j]
        );
        comparisons++;
      }
    }
    
    const diversity = comparisons > 0 ? totalDistance / comparisons : 0;
    
    // Count mutations since improvement
    const mutationsSinceImprovement = this.generation - 
      (this.bestGenome?.generation || 0);
    
    return {
      currentGeneration: this.generation,
      populationSize: this.population.length,
      bestFitness,
      avgFitness,
      diversity,
      convergenceRate: 1 - diversity,
      eliteStrategies: this.population.slice(0, 5),
      mutationsSinceImprovement
    };
  }
  
  /**
   * Deploy best strategies
   */
  async deployElite(count: number = 1): Promise<StrategyGenome[]> {
    // Sort by fitness
    this.population.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));
    
    const elite = this.population.slice(0, count);
    
    for (const genome of elite) {
      this.emit('evolution:strategy:deployed', genome);
      
      this.logger.info('Deploying elite strategy', {
        genomeId: genome.id,
        fitness: genome.fitness,
        complexity: genome.getComplexity(),
        generation: genome.generation
      });
    }
    
    return elite;
  }
  
  /**
   * Inject external genome into population
   */
  injectGenome(genome: StrategyGenome): void {
    // Replace worst performer
    this.population.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));
    this.population[this.population.length - 1] = genome;
    
    this.logger.info('External genome injected', {
      genomeId: genome.id,
      generation: this.generation
    });
  }
  
  /**
   * Get population statistics
   */
  getPopulationStats() {
    const fitnesses = this.population.map(g => g.fitness || 0);
    const complexities = this.population.map(g => g.getComplexity());
    
    return {
      size: this.population.length,
      generation: this.generation,
      fitness: {
        best: Math.max(...fitnesses),
        avg: fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length,
        worst: Math.min(...fitnesses)
      },
      complexity: {
        avg: complexities.reduce((a, b) => a + b, 0) / complexities.length,
        max: Math.max(...complexities),
        min: Math.min(...complexities)
      },
      diversity: this.calculateMetrics().diversity
    };
  }
  
  /**
   * Save population state
   */
  exportPopulation(): any {
    return {
      generation: this.generation,
      bestGenome: this.bestGenome,
      population: this.population.map(g => ({
        id: g.id,
        genes: g.genes,
        fitness: g.fitness,
        generation: g.generation,
        parents: g.parents
      }))
    };
  }
  
  /**
   * Load population state
   */
  importPopulation(data: any): void {
    this.generation = data.generation;
    this.bestGenome = data.bestGenome ? new StrategyGenome(data.bestGenome) : null;
    this.population = data.population.map((g: any) => new StrategyGenome(g));
    
    this.logger.info('Population imported', {
      generation: this.generation,
      size: this.population.length
    });
  }
  
  /**
   * Stop evolution
   */
  stop(): void {
    this.isEvolving = false;
    this.logger.info('Evolution stopped at generation', { 
      generation: this.generation 
    });
  }
} 