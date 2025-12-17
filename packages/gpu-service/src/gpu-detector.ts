/**
 * GPU Detection Service
 * 
 * Detects and identifies GPUs on the system using platform-native tools.
 * Supports Linux (nvidia-smi, lspci) and Windows (wmic).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const execAsync = promisify(exec);

/**
 * GPU information
 */
export interface GpuInfo {
  id: string; // Unique identifier (UUID for NVIDIA, PCI address for others)
  name: string; // GPU model name
  vendor: string; // Manufacturer (NVIDIA, AMD, Intel)
  busId?: string; // PCI bus ID
  uuid?: string; // GPU UUID (NVIDIA only)
  index: number; // Device index
}

/**
 * GPU hardware ID (hash of unique identifier)
 */
export interface GpuHardwareId {
  gpuId: string; // Original GPU identifier
  hardwareId: string; // SHA-256 hash of GPU identifier (for on-chain storage)
  gpuInfo: GpuInfo;
}

/**
 * Detect NVIDIA GPUs using nvidia-smi
 */
async function detectNvidiaGpus(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=index,name,uuid,pci.bus_id --format=csv,noheader');
    
    const gpus: GpuInfo[] = [];
    const lines = stdout.trim().split('\n');
    
    for (const line of lines) {
      const [indexStr, name, uuid, busId] = line.split(',').map(s => s.trim());
      const index = parseInt(indexStr, 10);
      
      gpus.push({
        id: uuid, // NVIDIA UUID is the most stable identifier
        name,
        vendor: 'NVIDIA',
        busId,
        uuid,
        index,
      });
    }
    
    return gpus;
  } catch (error) {
    // nvidia-smi not found or no NVIDIA GPUs
    return [];
  }
}

/**
 * Detect GPUs using lspci (Linux fallback for non-NVIDIA)
 */
async function detectGpusViaLspci(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await execAsync('lspci | grep -i vga');
    
    const gpus: GpuInfo[] = [];
    const lines = stdout.trim().split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^([0-9a-f:\.]+)\s+VGA.*?:\s+(.+?):\s+(.+)$/i);
      
      if (match) {
        const [, busId, vendor, name] = match;
        gpus.push({
          id: busId, // Use PCI bus ID as identifier
          name: name.trim(),
          vendor: vendor.trim(),
          busId,
          index: i,
        });
      }
    }
    
    return gpus;
  } catch (error) {
    return [];
  }
}

/**
 * Detect GPUs on Windows using wmic
 */
async function detectWindowsGpus(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await execAsync('wmic path win32_VideoController get Name,PNPDeviceID /format:csv');
    
    const gpus: GpuInfo[] = [];
    const lines = stdout.trim().split('\n').slice(1); // Skip header
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const [, name, pnpId] = line.split(',').map(s => s.trim());
      
      // Determine vendor from name
      let vendor = 'Unknown';
      if (name.toLowerCase().includes('nvidia')) vendor = 'NVIDIA';
      else if (name.toLowerCase().includes('amd') || name.toLowerCase().includes('radeon')) vendor = 'AMD';
      else if (name.toLowerCase().includes('intel')) vendor = 'Intel';
      
      gpus.push({
        id: pnpId, // Use PNP Device ID as identifier
        name,
        vendor,
        index: i,
      });
    }
    
    return gpus;
  } catch (error) {
    return [];
  }
}

/**
 * Detect all GPUs on the system
 * 
 * @returns Array of detected GPUs
 */
export async function detectGpus(): Promise<GpuInfo[]> {
  const platform = process.platform;
  
  if (platform === 'linux') {
    // Try NVIDIA first, then fallback to lspci
    const nvidiaGpus = await detectNvidiaGpus();
    if (nvidiaGpus.length > 0) {
      return nvidiaGpus;
    }
    return await detectGpusViaLspci();
  } else if (platform === 'win32') {
    return await detectWindowsGpus();
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Select a single GPU from the detected list
 * 
 * Uses deterministic selection (lowest index) to ensure consistency.
 * 
 * @param gpus - Array of detected GPUs
 * @returns Selected GPU
 */
export function selectGpu(gpus: GpuInfo[]): GpuInfo {
  if (gpus.length === 0) {
    throw new Error('No GPUs detected on this system');
  }
  
  // Sort by index to ensure deterministic selection
  const sortedGpus = [...gpus].sort((a, b) => a.index - b.index);
  
  // Select the first GPU (lowest index)
  return sortedGpus[0];
}

/**
 * Generate a hardware ID for a GPU
 * 
 * Creates a SHA-256 hash of the GPU's unique identifier.
 * This hash is used as the on-chain identifier to enforce uniqueness.
 * 
 * @param gpu - GPU information
 * @returns GPU hardware ID
 */
export function generateGpuHardwareId(gpu: GpuInfo): GpuHardwareId {
  // Create a stable identifier string
  const identifierString = `${gpu.vendor}:${gpu.id}`;
  
  // Generate SHA-256 hash
  const hash = createHash('sha256');
  hash.update(identifierString);
  const hardwareId = '0x' + hash.digest('hex');
  
  return {
    gpuId: gpu.id,
    hardwareId,
    gpuInfo: gpu,
  };
}

/**
 * Detect, select, and generate hardware ID for the primary GPU
 * 
 * This is the main entry point for the GPU service.
 * 
 * @returns GPU hardware ID for the selected GPU
 * @throws Error if no GPUs are detected
 */
export async function getGpuHardwareId(): Promise<GpuHardwareId> {
  const gpus = await detectGpus();
  const selectedGpu = selectGpu(gpus);
  return generateGpuHardwareId(selectedGpu);
}
