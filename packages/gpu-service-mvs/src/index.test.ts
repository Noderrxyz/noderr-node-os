import { getGPUHardwareId, getGPUInfo, hasGPU } from './index';
import { execSync } from 'child_process';

jest.mock('child_process');

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('GPU Service MVS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getGPUHardwareId', () => {
    it('should return SHA-256 hash of GPU UUID when GPU is present', async () => {
      const mockUUID = 'GPU-12345678-1234-1234-1234-123456789012';
      mockedExecSync.mockReturnValue(Buffer.from(mockUUID));

      const result = await getGPUHardwareId();

      expect(result).toBeTruthy();
      expect(result).toHaveLength(64); // SHA-256 produces 64 hex characters
      expect(mockedExecSync).toHaveBeenCalledWith(
        'nvidia-smi --query-gpu=uuid --format=csv,noheader',
        expect.objectContaining({
          encoding: 'utf-8',
          timeout: 5000,
        })
      );
    });

    it('should return null when no GPU is detected', async () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      const result = await getGPUHardwareId();

      expect(result).toBeNull();
    });

    it('should return null when nvidia-smi fails', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('nvidia-smi not found');
      });

      const result = await getGPUHardwareId();

      expect(result).toBeNull();
    });

    it('should return null when nvidia-smi times out', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command timed out');
      });

      const result = await getGPUHardwareId();

      expect(result).toBeNull();
    });

    it('should generate consistent hash for same UUID', async () => {
      const mockUUID = 'GPU-12345678-1234-1234-1234-123456789012';
      mockedExecSync.mockReturnValue(Buffer.from(mockUUID));

      const result1 = await getGPUHardwareId();
      const result2 = await getGPUHardwareId();

      expect(result1).toBe(result2);
    });

    it('should generate different hashes for different UUIDs', async () => {
      const mockUUID1 = 'GPU-11111111-1111-1111-1111-111111111111';
      const mockUUID2 = 'GPU-22222222-2222-2222-2222-222222222222';

      mockedExecSync.mockReturnValueOnce(Buffer.from(mockUUID1));
      const result1 = await getGPUHardwareId();

      mockedExecSync.mockReturnValueOnce(Buffer.from(mockUUID2));
      const result2 = await getGPUHardwareId();

      expect(result1).not.toBe(result2);
    });
  });

  describe('getGPUInfo', () => {
    it('should return GPU info when GPU is present', async () => {
      const mockOutput = 'GPU-12345678-1234-1234-1234-123456789012, NVIDIA GeForce RTX 3080';
      mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

      const result = await getGPUInfo();

      expect(result).toBeTruthy();
      expect(result?.uuid).toBe('GPU-12345678-1234-1234-1234-123456789012');
      expect(result?.model).toBe('NVIDIA GeForce RTX 3080');
      expect(result?.hardwareId).toHaveLength(64);
    });

    it('should return null when no GPU is detected', async () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      const result = await getGPUInfo();

      expect(result).toBeNull();
    });

    it('should handle missing model name', async () => {
      const mockOutput = 'GPU-12345678-1234-1234-1234-123456789012,';
      mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

      const result = await getGPUInfo();

      expect(result).toBeTruthy();
      expect(result?.model).toBe('Unknown');
    });

    it('should return null when nvidia-smi fails', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('nvidia-smi not found');
      });

      const result = await getGPUInfo();

      expect(result).toBeNull();
    });
  });

  describe('hasGPU', () => {
    it('should return true when GPU is present', async () => {
      const mockUUID = 'GPU-12345678-1234-1234-1234-123456789012';
      mockedExecSync.mockReturnValue(Buffer.from(mockUUID));

      const result = await hasGPU();

      expect(result).toBe(true);
    });

    it('should return false when no GPU is detected', async () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      const result = await hasGPU();

      expect(result).toBe(false);
    });

    it('should return false when nvidia-smi fails', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('nvidia-smi not found');
      });

      const result = await hasGPU();

      expect(result).toBe(false);
    });
  });
});
