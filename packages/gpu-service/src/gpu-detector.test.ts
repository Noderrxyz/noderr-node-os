/**
 * GPU Detector Test Suite
 * 
 * Tests GPU detection, selection, and hardware ID generation
 */

import { detectGpus, selectGpu, generateGpuHardwareId, getGpuHardwareId, GpuInfo } from './gpu-detector';

describe('GPU Detector', () => {
  describe('selectGpu', () => {
    it('should select the GPU with the lowest index', () => {
      const gpus: GpuInfo[] = [
        { id: 'gpu-2', name: 'GPU 2', vendor: 'NVIDIA', index: 2 },
        { id: 'gpu-0', name: 'GPU 0', vendor: 'NVIDIA', index: 0 },
        { id: 'gpu-1', name: 'GPU 1', vendor: 'NVIDIA', index: 1 },
      ];

      const selected = selectGpu(gpus);
      expect(selected.index).toBe(0);
      expect(selected.id).toBe('gpu-0');
    });

    it('should throw error if no GPUs are provided', () => {
      expect(() => selectGpu([])).toThrow('No GPUs detected on this system');
    });

    it('should handle single GPU', () => {
      const gpus: GpuInfo[] = [
        { id: 'gpu-0', name: 'NVIDIA RTX 4090', vendor: 'NVIDIA', index: 0 },
      ];

      const selected = selectGpu(gpus);
      expect(selected.id).toBe('gpu-0');
    });
  });

  describe('generateGpuHardwareId', () => {
    it('should generate consistent hardware ID for same GPU', () => {
      const gpu: GpuInfo = {
        id: 'GPU-12345678-1234-1234-1234-123456789012',
        name: 'NVIDIA RTX 4090',
        vendor: 'NVIDIA',
        index: 0,
      };

      const result1 = generateGpuHardwareId(gpu);
      const result2 = generateGpuHardwareId(gpu);

      expect(result1.hardwareId).toBe(result2.hardwareId);
      expect(result1.hardwareId).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should generate different hardware IDs for different GPUs', () => {
      const gpu1: GpuInfo = {
        id: 'GPU-11111111-1111-1111-1111-111111111111',
        name: 'NVIDIA RTX 4090',
        vendor: 'NVIDIA',
        index: 0,
      };

      const gpu2: GpuInfo = {
        id: 'GPU-22222222-2222-2222-2222-222222222222',
        name: 'NVIDIA RTX 4080',
        vendor: 'NVIDIA',
        index: 1,
      };

      const result1 = generateGpuHardwareId(gpu1);
      const result2 = generateGpuHardwareId(gpu2);

      expect(result1.hardwareId).not.toBe(result2.hardwareId);
    });

    it('should include GPU info in result', () => {
      const gpu: GpuInfo = {
        id: 'GPU-12345678-1234-1234-1234-123456789012',
        name: 'NVIDIA RTX 4090',
        vendor: 'NVIDIA',
        index: 0,
      };

      const result = generateGpuHardwareId(gpu);

      expect(result.gpuId).toBe(gpu.id);
      expect(result.gpuInfo).toEqual(gpu);
    });
  });

  describe('detectGpus', () => {
    it('should detect GPUs on the system', async () => {
      // This test will only pass on systems with GPUs
      // On CI/CD without GPUs, it should return empty array
      const gpus = await detectGpus();
      expect(Array.isArray(gpus)).toBe(true);
    });
  });

  describe('getGpuHardwareId', () => {
    it('should return hardware ID for primary GPU', async () => {
      // This test will only pass on systems with GPUs
      try {
        const result = await getGpuHardwareId();
        expect(result.hardwareId).toMatch(/^0x[0-9a-f]{64}$/);
        expect(result.gpuId).toBeDefined();
        expect(result.gpuInfo).toBeDefined();
      } catch (error) {
        // Expected on systems without GPUs
        expect((error as Error).message).toContain('No GPUs detected');
      }
    });
  });
});
