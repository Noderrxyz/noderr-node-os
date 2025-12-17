/**
 * GPU Integration Module (MVS)
 * 
 * Integrates simplified GPU detection into node registration flow
 * For Oracle nodes (required) and Guardian nodes (optional bonus)
 */

import { getGPUHardwareId } from '@noderr/gpu-service-mvs';

/**
 * Get GPU hardware ID for node registration
 * 
 * This function should be called during node initialization to detect
 * the GPU that will be used by this Oracle or Guardian node.
 * 
 * @returns GPU hardware ID (SHA-256 hash) or null if no GPU detected
 */
export async function getNodeGpuId(): Promise<string | null> {
  try {
    console.log('🔍 Detecting GPU for node registration...');
    
    const gpuHardwareId = await getGPUHardwareId();
    
    if (!gpuHardwareId) {
      console.warn('⚠️  No GPU detected on this system.');
      return null;
    }
    
    console.log(`✅ GPU detected`);
    console.log(`   Hardware ID: ${gpuHardwareId}`);
    
    return gpuHardwareId;
  } catch (error) {
    console.warn('⚠️  GPU detection failed:', (error as Error).message);
    return null;
  }
}

/**
 * Check if this system has a GPU available
 * 
 * @returns True if GPU is available
 */
export async function hasGpu(): Promise<boolean> {
  const gpuId = await getNodeGpuId();
  return gpuId !== null;
}

/**
 * Get system info with GPU hardware ID included
 * 
 * This function extends the existing system info collection
 * to include GPU hardware ID when available.
 * 
 * @param baseSystemInfo - Base system info (CPU, memory, disk, etc.)
 * @returns System info with GPU hardware ID (if available)
 */
export async function getSystemInfoWithGpu(baseSystemInfo: {
  hostname: string;
  cpuCores: number;
  memoryGB: number;
  diskGB: number;
  osVersion?: string;
  kernelVersion?: string;
}): Promise<{
  hostname: string;
  cpuCores: number;
  memoryGB: number;
  diskGB: number;
  osVersion?: string;
  kernelVersion?: string;
  gpuHardwareId?: string;
}> {
  const gpuId = await getNodeGpuId();
  
  return {
    ...baseSystemInfo,
    ...(gpuId && { gpuHardwareId: gpuId }),
  };
}
