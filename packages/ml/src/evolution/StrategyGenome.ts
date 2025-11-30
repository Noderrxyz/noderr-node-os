/**
 * StrategyGenome - Genetic Representation of Trading Strategies
 * 
 * Encodes trading strategies as genes that can be mutated, crossed over,
 * and evolved to discover optimal trading behavior
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  StrategyGenome as IStrategyGenome, 
  StrategyGene, 
  MutationRecord 
} from '@noderr/types';

/**
 * Gene types and their parameters
 */
export const GENE_TEMPLATES = {
  // Entry conditions
  entry: {
    rsi_oversold: {
      type: 'entry' as const,
      name: 'RSI Oversold Entry',
      parameters: {
        period: { min: 5, max: 50, default: 14 },
        threshold: { min: 10, max: 40, default: 30 },
        timeframe: { options: ['1m', '5m', '15m', '1h'], default: '15m' }
      }
    },
    macd_cross: {
      type: 'entry' as const,
      name: 'MACD Crossover Entry',
      parameters: {
        fast: { min: 5, max: 20, default: 12 },
        slow: { min: 20, max: 50, default: 26 },
        signal: { min: 5, max: 15, default: 9 }
      }
    },
    breakout: {
      type: 'entry' as const,
      name: 'Breakout Entry',
      parameters: {
        lookback: { min: 10, max: 100, default: 20 },
        multiplier: { min: 1.5, max: 3.0, default: 2.0 },
        volumeConfirm: { min: 1.0, max: 3.0, default: 1.5 }
      }
    },
    momentum: {
      type: 'entry' as const,
      name: 'Momentum Entry',
      parameters: {
        period: { min: 5, max: 30, default: 10 },
        threshold: { min: 0.01, max: 0.1, default: 0.03 }
      }
    }
  },
  
  // Exit conditions
  exit: {
    rsi_overbought: {
      type: 'exit' as const,
      name: 'RSI Overbought Exit',
      parameters: {
        period: { min: 5, max: 50, default: 14 },
        threshold: { min: 60, max: 90, default: 70 }
      }
    },
    trailing_stop: {
      type: 'exit' as const,
      name: 'Trailing Stop Exit',
      parameters: {
        initial: { min: 0.005, max: 0.05, default: 0.02 },
        trailing: { min: 0.002, max: 0.02, default: 0.01 }
      }
    },
    profit_target: {
      type: 'exit' as const,
      name: 'Profit Target Exit',
      parameters: {
        target: { min: 0.01, max: 0.1, default: 0.03 },
        partial: { min: 0.0, max: 1.0, default: 0.5 }
      }
    },
    time_exit: {
      type: 'exit' as const,
      name: 'Time-based Exit',
      parameters: {
        maxHoldBars: { min: 10, max: 1000, default: 100 }
      }
    }
  },
  
  // Filters
  filter: {
    trend_filter: {
      type: 'filter' as const,
      name: 'Trend Filter',
      parameters: {
        maPeriod: { min: 20, max: 200, default: 50 },
        direction: { options: ['long', 'short', 'both'], default: 'both' }
      }
    },
    volatility_filter: {
      type: 'filter' as const,
      name: 'Volatility Filter',
      parameters: {
        period: { min: 10, max: 50, default: 20 },
        minVol: { min: 0.0, max: 0.5, default: 0.01 },
        maxVol: { min: 0.1, max: 2.0, default: 0.5 }
      }
    },
    volume_filter: {
      type: 'filter' as const,
      name: 'Volume Filter',
      parameters: {
        period: { min: 5, max: 50, default: 20 },
        multiplier: { min: 0.5, max: 3.0, default: 1.2 }
      }
    },
    time_filter: {
      type: 'filter' as const,
      name: 'Time of Day Filter',
      parameters: {
        startHour: { min: 0, max: 23, default: 9 },
        endHour: { min: 0, max: 23, default: 17 }
      }
    }
  },
  
  // Position sizing
  sizing: {
    fixed_size: {
      type: 'sizing' as const,
      name: 'Fixed Position Size',
      parameters: {
        size: { min: 0.01, max: 0.2, default: 0.05 }
      }
    },
    kelly_sizing: {
      type: 'sizing' as const,
      name: 'Kelly Criterion Sizing',
      parameters: {
        fraction: { min: 0.1, max: 1.0, default: 0.25 },
        maxSize: { min: 0.05, max: 0.5, default: 0.2 }
      }
    },
    volatility_sizing: {
      type: 'sizing' as const,
      name: 'Volatility-based Sizing',
      parameters: {
        targetVol: { min: 0.01, max: 0.2, default: 0.05 },
        lookback: { min: 10, max: 100, default: 20 }
      }
    },
    risk_parity: {
      type: 'sizing' as const,
      name: 'Risk Parity Sizing',
      parameters: {
        riskBudget: { min: 0.01, max: 0.1, default: 0.02 }
      }
    }
  },
  
  // Risk management
  risk: {
    stop_loss: {
      type: 'risk' as const,
      name: 'Stop Loss',
      parameters: {
        percent: { min: 0.005, max: 0.1, default: 0.02 },
        atr_multiplier: { min: 1.0, max: 5.0, default: 2.0 }
      }
    },
    max_drawdown: {
      type: 'risk' as const,
      name: 'Max Drawdown Limit',
      parameters: {
        limit: { min: 0.05, max: 0.3, default: 0.15 },
        lookback: { min: 20, max: 200, default: 50 }
      }
    },
    position_limit: {
      type: 'risk' as const,
      name: 'Position Limits',
      parameters: {
        maxPositions: { min: 1, max: 20, default: 5 },
        maxPerAsset: { min: 0.05, max: 0.5, default: 0.2 }
      }
    },
    correlation_limit: {
      type: 'risk' as const,
      name: 'Correlation Limits',
      parameters: {
        maxCorrelation: { min: 0.3, max: 0.9, default: 0.7 },
        lookback: { min: 20, max: 100, default: 50 }
      }
    }
  }
};

/**
 * Strategy Genome implementation
 */
export class StrategyGenome implements IStrategyGenome {
  id: string;
  genes: StrategyGene[];
  fitness?: number;
  generation: number;
  parents?: string[];
  mutations?: MutationRecord[];
  
  constructor(params?: Partial<IStrategyGenome>) {
    this.id = params?.id || uuidv4();
    this.genes = params?.genes || [];
    this.fitness = params?.fitness;
    this.generation = params?.generation || 0;
    this.parents = params?.parents;
    this.mutations = params?.mutations || [];
  }
  
  /**
   * Create a random genome
   */
  static createRandom(): StrategyGenome {
    const genome = new StrategyGenome();
    
    // Add at least one gene of each type
    const geneTypes: Array<keyof typeof GENE_TEMPLATES> = ['entry', 'exit', 'filter', 'sizing', 'risk'];
    
    for (const type of geneTypes) {
      const templates = GENE_TEMPLATES[type];
      const templateKeys = Object.keys(templates);
      const randomKey = templateKeys[Math.floor(Math.random() * templateKeys.length)];
      const template = templates[randomKey as keyof typeof templates];
      
      genome.addGene(StrategyGenome.createGeneFromTemplate(template, randomKey));
    }
    
    return genome;
  }
  
  /**
   * Create gene from template
   */
  static createGeneFromTemplate(template: any, key: string): StrategyGene {
    const parameters: Record<string, any> = {};
    
    // Initialize parameters with random values
    for (const [paramName, paramConfig] of Object.entries(template.parameters)) {
      const config = paramConfig as any;
      
      if (config.options) {
        // Select random option
        parameters[paramName] = config.options[Math.floor(Math.random() * config.options.length)];
      } else if (config.min !== undefined && config.max !== undefined) {
        // Generate random value in range
        parameters[paramName] = config.min + Math.random() * (config.max - config.min);
      } else {
        // Use default
        parameters[paramName] = config.default;
      }
    }
    
    return {
      type: template.type,
      name: key,
      parameters,
      weight: Math.random(),
      active: true
    };
  }
  
  /**
   * Add a gene to the genome
   */
  addGene(gene: StrategyGene): void {
    this.genes.push(gene);
  }
  
  /**
   * Remove a gene
   */
  removeGene(index: number): void {
    if (index >= 0 && index < this.genes.length) {
      const removed = this.genes.splice(index, 1)[0];
      this.recordMutation({
        timestamp: Date.now(),
        type: 'remove',
        gene: removed.name,
        oldValue: removed,
        newValue: null
      });
    }
  }
  
  /**
   * Mutate the genome
   */
  mutate(mutationRate: number = 0.1): void {
    for (let i = 0; i < this.genes.length; i++) {
      if (Math.random() < mutationRate) {
        this.mutateGene(i);
      }
    }
    
    // Chance to add/remove genes
    if (Math.random() < mutationRate) {
      if (Math.random() < 0.5 && this.genes.length > 3) {
        // Remove random gene
        const idx = Math.floor(Math.random() * this.genes.length);
        this.removeGene(idx);
      } else if (this.genes.length < 15) {
        // Add random gene
        const types = Object.keys(GENE_TEMPLATES) as Array<keyof typeof GENE_TEMPLATES>;
        const type = types[Math.floor(Math.random() * types.length)];
        const templates = GENE_TEMPLATES[type];
        const keys = Object.keys(templates);
        const key = keys[Math.floor(Math.random() * keys.length)];
        const template = templates[key as keyof typeof templates];
        
        this.addGene(StrategyGenome.createGeneFromTemplate(template, key));
        
        this.recordMutation({
          timestamp: Date.now(),
          type: 'add',
          gene: key,
          oldValue: null,
          newValue: this.genes[this.genes.length - 1]
        });
      }
    }
  }
  
  /**
   * Mutate a single gene
   */
  private mutateGene(index: number): void {
    const gene = this.genes[index];
    const oldValue = { ...gene, parameters: { ...gene.parameters } };
    
    // Mutate parameters
    const template = this.findTemplate(gene);
    if (!template) return;
    
    for (const [paramName, paramConfig] of Object.entries(template.parameters)) {
      if (Math.random() < 0.3) { // 30% chance to mutate each parameter
        const config = paramConfig as any;
        
        if (config.options) {
          // Select different option
          const current = gene.parameters[paramName];
          const options = config.options.filter((o: any) => o !== current);
          if (options.length > 0) {
            gene.parameters[paramName] = options[Math.floor(Math.random() * options.length)];
          }
        } else if (config.min !== undefined && config.max !== undefined) {
          // Nudge numeric value
          const current = gene.parameters[paramName];
          const range = config.max - config.min;
          const delta = (Math.random() - 0.5) * range * 0.2; // ±10% of range
          gene.parameters[paramName] = Math.max(config.min, Math.min(config.max, current + delta));
        }
      }
    }
    
    // Mutate weight
    if (Math.random() < 0.3) {
      gene.weight = Math.max(0, Math.min(1, gene.weight + (Math.random() - 0.5) * 0.2));
    }
    
    // Mutate active state
    if (Math.random() < 0.1) {
      gene.active = !gene.active;
    }
    
    this.recordMutation({
      timestamp: Date.now(),
      type: 'modify',
      gene: gene.name,
      oldValue,
      newValue: gene
    });
  }
  
  /**
   * Crossover with another genome
   */
  crossover(other: StrategyGenome): StrategyGenome {
    const child = new StrategyGenome({
      generation: Math.max(this.generation, other.generation) + 1,
      parents: [this.id, other.id]
    });
    
    // Uniform crossover for genes
    const allGeneTypes = new Set([
      ...this.genes.map(g => `${g.type}:${g.name}`),
      ...other.genes.map(g => `${g.type}:${g.name}`)
    ]);
    
    for (const geneKey of allGeneTypes) {
      const gene1 = this.genes.find(g => `${g.type}:${g.name}` === geneKey);
      const gene2 = other.genes.find(g => `${g.type}:${g.name}` === geneKey);
      
      if (gene1 && gene2) {
        // Both parents have this gene - choose one or blend
        if (Math.random() < 0.5) {
          child.addGene(this.cloneGene(gene1));
        } else {
          child.addGene(this.cloneGene(gene2));
        }
      } else if (gene1 || gene2) {
        // Only one parent has this gene - 50% chance to inherit
        if (Math.random() < 0.5) {
          child.addGene(this.cloneGene(gene1 || gene2!));
        }
      }
    }
    
    // Ensure child has at least one gene of each type
    this.ensureGeneTypes(child);
    
    // Record crossover
    child.recordMutation({
      timestamp: Date.now(),
      type: 'crossover',
      gene: 'genome',
      oldValue: null,
      newValue: { parents: [this.id, other.id] }
    });
    
    return child;
  }
  
  /**
   * Clone a gene
   */
  private cloneGene(gene: StrategyGene): StrategyGene {
    return {
      type: gene.type,
      name: gene.name,
      parameters: { ...gene.parameters },
      weight: gene.weight,
      active: gene.active
    };
  }
  
  /**
   * Ensure genome has at least one gene of each type
   */
  private ensureGeneTypes(genome: StrategyGenome): void {
    const requiredTypes: Array<StrategyGene['type']> = ['entry', 'exit', 'risk'];
    const existingTypes = new Set(genome.genes.map(g => g.type));
    
    for (const type of requiredTypes) {
      if (!existingTypes.has(type)) {
        // Add a default gene of this type
        const templates = GENE_TEMPLATES[type];
        const keys = Object.keys(templates);
        const key = keys[0]; // Use first template as default
        const template = templates[key as keyof typeof templates];
        
        genome.addGene(StrategyGenome.createGeneFromTemplate(template, key));
      }
    }
  }
  
  /**
   * Find template for a gene
   */
  private findTemplate(gene: StrategyGene): any {
    const templates = GENE_TEMPLATES[gene.type];
    return templates[gene.name as keyof typeof templates];
  }
  
  /**
   * Record a mutation
   */
  private recordMutation(mutation: MutationRecord): void {
    if (!this.mutations) {
      this.mutations = [];
    }
    this.mutations.push(mutation);
    
    // Keep only last 100 mutations
    if (this.mutations.length > 100) {
      this.mutations = this.mutations.slice(-100);
    }
  }
  
  /**
   * Calculate genome complexity
   */
  getComplexity(): number {
    let complexity = 0;
    
    // Number of active genes
    complexity += this.genes.filter(g => g.active).length;
    
    // Parameter complexity
    for (const gene of this.genes) {
      if (gene.active) {
        complexity += Object.keys(gene.parameters).length * 0.5;
      }
    }
    
    return complexity;
  }
  
  /**
   * Get active genes by type
   */
  getActiveGenesByType(type: StrategyGene['type']): StrategyGene[] {
    return this.genes.filter(g => g.type === type && g.active);
  }
  
  /**
   * Validate genome
   */
  isValid(): boolean {
    // Must have at least one entry and exit condition
    const hasEntry = this.genes.some(g => g.type === 'entry' && g.active);
    const hasExit = this.genes.some(g => g.type === 'exit' && g.active);
    const hasRisk = this.genes.some(g => g.type === 'risk' && g.active);
    
    return hasEntry && hasExit && hasRisk;
  }
  
  /**
   * Convert to executable strategy code
   */
  toStrategyCode(): string {
    const entries = this.getActiveGenesByType('entry');
    const exits = this.getActiveGenesByType('exit');
    const filters = this.getActiveGenesByType('filter');
    const sizing = this.getActiveGenesByType('sizing')[0]; // Use first sizing rule
    const risks = this.getActiveGenesByType('risk');
    
    let code = `// Auto-generated strategy from genome ${this.id}\n\n`;
    
    // Entry conditions
    code += `function checkEntry(data) {\n`;
    code += `  const signals = [];\n`;
    for (const entry of entries) {
      code += `  // ${entry.name}\n`;
      code += `  signals.push(${this.generateConditionCode(entry)});\n`;
    }
    code += `  return signals.some(s => s); // OR logic\n`;
    code += `}\n\n`;
    
    // Exit conditions
    code += `function checkExit(data, position) {\n`;
    code += `  const signals = [];\n`;
    for (const exit of exits) {
      code += `  // ${exit.name}\n`;
      code += `  signals.push(${this.generateConditionCode(exit)});\n`;
    }
    code += `  return signals.some(s => s);\n`;
    code += `}\n\n`;
    
    // Position sizing
    code += `function calculatePositionSize(data, balance) {\n`;
    if (sizing) {
      code += `  // ${sizing.name}\n`;
      code += `  return ${this.generateSizingCode(sizing)};\n`;
    } else {
      code += `  return 0.05; // Default 5% position\n`;
    }
    code += `}\n`;
    
    return code;
  }
  
  /**
   * Generate condition code for a gene
   */
  private generateConditionCode(gene: StrategyGene): string {
    // Simplified code generation - would be more sophisticated in production
    switch (gene.name) {
      case 'rsi_oversold':
        return `data.rsi < ${gene.parameters.threshold}`;
      case 'rsi_overbought':
        return `data.rsi > ${gene.parameters.threshold}`;
      case 'macd_cross':
        return `data.macd > data.macdSignal && data.prevMacd <= data.prevMacdSignal`;
      default:
        return 'true';
    }
  }
  
  /**
   * Generate sizing code
   */
  private generateSizingCode(gene: StrategyGene): string {
    switch (gene.name) {
      case 'fixed_size':
        return `${gene.parameters.size}`;
      case 'volatility_sizing':
        return `Math.min(0.2, ${gene.parameters.targetVol} / data.volatility)`;
      default:
        return '0.05';
    }
  }
  
  /**
   * Clone the genome
   */
  clone(): StrategyGenome {
    return new StrategyGenome({
      id: uuidv4(),
      genes: this.genes.map(g => this.cloneGene(g)),
      generation: this.generation,
      parents: [this.id],
      mutations: []
    });
  }
  
  /**
   * Get genome summary
   */
  getSummary(): string {
    const geneCount = this.genes.length;
    const activeCount = this.genes.filter(g => g.active).length;
    const types = this.genes.reduce((acc, g) => {
      acc[g.type] = (acc[g.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return `Genome ${this.id.slice(0, 8)} - Gen ${this.generation} - ${activeCount}/${geneCount} active - ${JSON.stringify(types)}`;
  }
} 