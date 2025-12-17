import { execSync } from 'child_process';
import { createHash } from 'crypto';

/**
 * GPU Hardware Information
 */
export interface GPUInfo {
  hardwareId: string;
  uuid: string;
  model: string;
}

/**
 * Detects NVIDIA GPU and returns hardware ID for node registration.
 * Linux only - uses nvidia-smi.
 * 
 * @returns GPU hardware ID (SHA-256 hash) or null if no GPU detected
 */
export async function getGPUHardwareId(): Promise<string | null> {
  try {
    const uuid = execSync('nvidia-smi --query-gpu=uuid --format=csv,noheader', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
    }).trim();
    
    if (!uuid || uuid.length === 0) {
      return null;
    }
    
    // Generate SHA-256 hash for privacy
    return createHash('sha256').update(uuid).digest('hex');
  } catch (error) {
    // No GPU or nvidia-smi not available
    return null;
  }
}

/**
 * Gets detailed GPU information including hardware ID, UUID, and model.
 * Linux only - uses nvidia-smi.
 * 
 * @returns GPU information or null if no GPU detected
 */
export async function getGPUInfo(): Promise<GPUInfo | null> {
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=uuid,name --format=csv,noheader',
      {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    ).trim();
    
    if (!output || output.length === 0) {
      return null;
    }
    
    const [uuid, model] = output.split(',').map(s => s.trim());
    
    if (!uuid) {
      return null;
    }
    
    const hardwareId = createHash('sha256').update(uuid).digest('hex');
    
    return {
      hardwareId,
      uuid,
      model: model || 'Unknown',
    };
  } catch (error) {
    return null;
  }
}

/**
 * Checks if a GPU is available on the system.
 * 
 * @returns true if GPU detected, false otherwise
 */
export async function hasGPU(): Promise<boolean> {
  const hardwareId = await getGPUHardwareId();
  return hardwareId !== null;
}
