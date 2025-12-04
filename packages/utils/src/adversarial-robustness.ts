/**
 * Adversarial Robustness - ML Model Security
 * 
 * Implements adversarial example detection and robust model training
 */

export interface Prediction {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  warning?: string;
}

export class AdversarialRobustness {
  private models: any[] = [];
  private trainingData: any[] = [];

  /**
   * Detect adversarial examples using statistical analysis
   */
  detectAdversarialInput(input: number[]): boolean {
    // Calculate input statistics
    const mean = input.reduce((a, b) => a + b) / input.length;
    const variance = input.reduce((sq, n) => sq + Math.pow(n - mean, 2)) / input.length;
    const stdDev = Math.sqrt(variance);

    // Check for suspicious patterns
    const diffs = [];
    for (let i = 1; i < input.length; i++) {
      diffs.push(Math.abs(input[i] - input[i - 1]));
    }

    const avgDiff = diffs.reduce((a, b) => a + b) / diffs.length;
    const diffVariance = diffs.reduce((sq, d) => sq + Math.pow(d - avgDiff, 2)) / diffs.length;
    const diffStdDev = Math.sqrt(diffVariance);

    // Adversarial examples often have unusual statistical properties
    // Suspiciously uniform differences indicate possible adversarial input
    if (diffStdDev < 0.001 * stdDev && stdDev > 0) {
      return true;
    }

    // Check for input values outside normal range
    const zScores = input.map(val => Math.abs((val - mean) / stdDev));
    const extremeValues = zScores.filter(z => z > 5).length;

    if (extremeValues > input.length * 0.1) {
      // More than 10% extreme values
      return true;
    }

    return false;
  }

  /**
   * Predict using ensemble of models
   * Ensemble improves robustness against adversarial examples
   */
  async predictWithEnsemble(input: number[]): Promise<Prediction> {
    // Check for adversarial input
    if (this.detectAdversarialInput(input)) {
      return {
        signal: 'HOLD',
        confidence: 0,
        warning: 'Adversarial input detected',
      };
    }

    // Get predictions from multiple models
    const predictions = await Promise.all(
      this.models.map(model => model.predict(input))
    );

    // Check for disagreement (sign of adversarial input)
    const buyVotes = predictions.filter(p => p.signal === 'BUY').length;
    const sellVotes = predictions.filter(p => p.signal === 'SELL').length;

    if (Math.abs(buyVotes - sellVotes) <= 1) {
      // Models disagree - possible adversarial input
      return {
        signal: 'HOLD',
        confidence: 0.5,
        warning: 'Model disagreement detected',
      };
    }

    // Consensus prediction
    const signal = buyVotes > sellVotes ? 'BUY' : 'SELL';
    const confidence = Math.max(buyVotes, sellVotes) / predictions.length;

    return { signal, confidence };
  }

  /**
   * Generate adversarial examples using FGSM (Fast Gradient Sign Method)
   */
  async generateAdversarialExamples(data: any[]): Promise<any[]> {
    const adversarial: any[] = [];
    const epsilon = 0.01; // Perturbation magnitude

    for (const example of data) {
      // Calculate gradient of loss with respect to input
      const gradient = await this.calculateGradient(example);

      // Perturb input in direction of gradient
      const perturbedInput = example.input.map(
        (val: number, i: number) => val + epsilon * Math.sign(gradient[i])
      );

      adversarial.push({
        input: perturbedInput,
        label: example.label,
        isAdversarial: true,
      });
    }

    return adversarial;
  }

  /**
   * Train model with adversarial examples
   * Improves robustness against adversarial attacks
   */
  async trainWithAdversarialExamples(model: any): Promise<void> {
    // Generate adversarial examples
    const adversarialExamples = await this.generateAdversarialExamples(this.trainingData);

    // Combine original and adversarial examples
    const augmentedData = [...this.trainingData, ...adversarialExamples];

    // Train model on augmented dataset
    await model.train(augmentedData);

    // Test robustness
    const robustness = await this.testAdversarialRobustness(model);
    console.log(`Model robustness score: ${robustness}`);
  }

  /**
   * Test model robustness against adversarial examples
   */
  async testAdversarialRobustness(model: any): Promise<number> {
    // Generate adversarial examples
    const adversarialExamples = await this.generateAdversarialExamples(this.trainingData);

    // Test model on adversarial examples
    let correctPredictions = 0;

    for (const example of adversarialExamples) {
      const prediction = await model.predict(example.input);
      if (prediction.label === example.label) {
        correctPredictions++;
      }
    }

    const robustness = correctPredictions / adversarialExamples.length;
    return robustness;
  }

  /**
   * Calculate gradient for adversarial example generation
   */
  private async calculateGradient(example: any): Promise<number[]> {
    // In production, use automatic differentiation
    // For now, return placeholder
    return example.input.map(() => Math.random());
  }

  /**
   * Validate training data for poisoning
   */
  async validateTrainingData(data: any[]): Promise<ValidationResult> {
    const anomalies: string[] = [];

    // Check for price spikes
    for (let i = 1; i < data.length; i++) {
      const priceChange = Math.abs(
        (data[i].price - data[i - 1].price) / data[i - 1].price
      );

      // Flag unusual price changes (>5%)
      if (priceChange > 0.05) {
        anomalies.push(
          `Price spike at ${i}: ${(priceChange * 100).toFixed(2)}%`
        );
      }
    }

    // Check for volume anomalies
    const volumes = data.map(d => d.volume);
    const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;
    const stdDev = Math.sqrt(
      volumes.reduce((sq, v) => sq + Math.pow(v - avgVolume, 2)) / volumes.length
    );

    for (let i = 0; i < volumes.length; i++) {
      const zScore = Math.abs((volumes[i] - avgVolume) / stdDev);
      if (zScore > 3) {
        // 3 standard deviations
        anomalies.push(
          `Volume anomaly at ${i}: z-score=${zScore.toFixed(2)}`
        );
      }
    }

    return {
      valid: anomalies.length === 0,
      anomalies,
    };
  }

  /**
   * Detect data drift (distribution change)
   */
  async detectDataDrift(newData: any[]): Promise<boolean> {
    // Get training data distribution
    const trainingDistribution = this.getDistribution(this.trainingData);

    // Calculate new data distribution
    const newDistribution = this.getDistribution(newData);

    // Use Kolmogorov-Smirnov test
    const ksStatistic = this.calculateKSStatistic(trainingDistribution, newDistribution);

    // If KS statistic > threshold, distribution has changed
    if (ksStatistic > 0.3) {
      return true;
    }

    return false;
  }

  /**
   * Get distribution of data
   */
  private getDistribution(data: any[]): number[] {
    const prices = data.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const bins = 10;
    const binSize = (max - min) / bins;

    const distribution = Array(bins).fill(0);
    for (const price of prices) {
      const binIndex = Math.floor((price - min) / binSize);
      distribution[Math.min(binIndex, bins - 1)]++;
    }

    return distribution.map(count => count / prices.length);
  }

  /**
   * Calculate Kolmogorov-Smirnov statistic
   */
  private calculateKSStatistic(dist1: number[], dist2: number[]): number {
    let cdf1 = 0;
    let cdf2 = 0;
    let maxDiff = 0;

    for (let i = 0; i < Math.max(dist1.length, dist2.length); i++) {
      cdf1 += dist1[i] || 0;
      cdf2 += dist2[i] || 0;
      const diff = Math.abs(cdf1 - cdf2);
      maxDiff = Math.max(maxDiff, diff);
    }

    return maxDiff;
  }
}

export interface ValidationResult {
  valid: boolean;
  anomalies: string[];
}

/**
 * Model Extraction Protection
 */
export class ModelExtractionProtection {
  private queryLog = new Map<string, QueryRecord[]>();
  private readonly maxQueriesPerHour = 100;
  private readonly maxQueriesPerMinute = 10;

  /**
   * Rate limiting for API queries
   */
  checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneMinuteAgo = now - 60000;

    // Get queries from last hour
    let queries = this.queryLog.get(userId) || [];
    queries = queries.filter(q => q.timestamp > oneHourAgo);

    // Hard limit: max queries per hour
    if (queries.length >= this.maxQueriesPerHour) {
      return false;
    }

    // Soft limit: max queries per minute (detect extraction attempts)
    const recentQueries = queries.filter(q => q.timestamp > oneMinuteAgo);
    if (recentQueries.length >= this.maxQueriesPerMinute) {
      console.warn(`High query rate detected for user ${userId}`);
    }

    // Update log
    queries.push({ timestamp: now });
    this.queryLog.set(userId, queries);

    return true;
  }

  /**
   * Add noise to model outputs
   */
  obfuscateOutput(prediction: Prediction): Prediction {
    // Add small random noise to confidence
    const noise = (Math.random() - 0.5) * 0.05; // ±2.5%
    const noisyConfidence = Math.max(0, Math.min(1, prediction.confidence + noise));

    return {
      ...prediction,
      confidence: noisyConfidence,
    };
  }
}

interface QueryRecord {
  timestamp: number;
}
