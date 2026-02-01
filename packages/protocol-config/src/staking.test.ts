/**
 * Protocol Config Test Suite
 * 
 * Tests staking configuration and utility functions
 */

import { ethers } from 'ethers';
import {
  NodeTier,
  STAKING_REQUIREMENTS,
  getStakingRequirement,
  formatStakingRequirement,
  hasSufficientStake,
} from './staking';

describe('Protocol Config - Staking', () => {
  describe('STAKING_REQUIREMENTS', () => {
    it('should have correct values matching smart contracts', () => {
      expect(STAKING_REQUIREMENTS[NodeTier.MICRO]).toBe(ethers.parseUnits('0', 18));
      expect(STAKING_REQUIREMENTS[NodeTier.VALIDATOR]).toBe(ethers.parseUnits('25000', 18));
      expect(STAKING_REQUIREMENTS[NodeTier.GUARDIAN]).toBe(ethers.parseUnits('50000', 18));
      expect(STAKING_REQUIREMENTS[NodeTier.ORACLE]).toBe(ethers.parseUnits('150000', 18));
    });

    it('should have progressive requirements', () => {
      expect(STAKING_REQUIREMENTS[NodeTier.MICRO]).toBeLessThan(STAKING_REQUIREMENTS[NodeTier.VALIDATOR]);
      expect(STAKING_REQUIREMENTS[NodeTier.VALIDATOR]).toBeLessThan(STAKING_REQUIREMENTS[NodeTier.GUARDIAN]);
      expect(STAKING_REQUIREMENTS[NodeTier.GUARDIAN]).toBeLessThan(STAKING_REQUIREMENTS[NodeTier.ORACLE]);
    });
  });

  describe('getStakingRequirement', () => {
    it('should return correct requirement for enum value', () => {
      expect(getStakingRequirement(NodeTier.ORACLE)).toBe(ethers.parseUnits('150000', 18));
      expect(getStakingRequirement(NodeTier.GUARDIAN)).toBe(ethers.parseUnits('50000', 18));
      expect(getStakingRequirement(NodeTier.VALIDATOR)).toBe(ethers.parseUnits('25000', 18));
      expect(getStakingRequirement(NodeTier.MICRO)).toBe(ethers.parseUnits('0', 18));
    });

    it('should return correct requirement for string name', () => {
      expect(getStakingRequirement('oracle')).toBe(ethers.parseUnits('150000', 18));
      expect(getStakingRequirement('guardian')).toBe(ethers.parseUnits('50000', 18));
      expect(getStakingRequirement('validator')).toBe(ethers.parseUnits('25000', 18));
      expect(getStakingRequirement('micro')).toBe(ethers.parseUnits('0', 18));
    });
  });

  describe('formatStakingRequirement', () => {
    it('should format requirements as human-readable strings', () => {
      expect(formatStakingRequirement(NodeTier.ORACLE)).toBe('150000.0 NODR');
      expect(formatStakingRequirement(NodeTier.GUARDIAN)).toBe('50000.0 NODR');
      expect(formatStakingRequirement(NodeTier.VALIDATOR)).toBe('25000.0 NODR');
      expect(formatStakingRequirement(NodeTier.MICRO)).toBe('0.0 NODR');
    });

    it('should format requirements from string names', () => {
      expect(formatStakingRequirement('oracle')).toBe('150000.0 NODR');
      expect(formatStakingRequirement('guardian')).toBe('50000.0 NODR');
    });
  });

  describe('hasSufficientStake', () => {
    it('should return true when balance meets requirement', () => {
      const balance = ethers.parseUnits('150000', 18);
      expect(hasSufficientStake(balance, NodeTier.ORACLE)).toBe(true);
      expect(hasSufficientStake(balance, NodeTier.GUARDIAN)).toBe(true);
      expect(hasSufficientStake(balance, NodeTier.VALIDATOR)).toBe(true);
      expect(hasSufficientStake(balance, NodeTier.MICRO)).toBe(true);
    });

    it('should return false when balance is insufficient', () => {
      const balance = ethers.parseUnits('24999', 18);
      expect(hasSufficientStake(balance, NodeTier.VALIDATOR)).toBe(false);
      expect(hasSufficientStake(balance, NodeTier.GUARDIAN)).toBe(false);
      expect(hasSufficientStake(balance, NodeTier.ORACLE)).toBe(false);
    });

    it('should handle exact balance match', () => {
      const balance = ethers.parseUnits('50000', 18);
      expect(hasSufficientStake(balance, NodeTier.GUARDIAN)).toBe(true);
      expect(hasSufficientStake(balance, NodeTier.ORACLE)).toBe(false);
    });

    it('should work with string tier names', () => {
      const balance = ethers.parseUnits('150000', 18);
      expect(hasSufficientStake(balance, 'oracle')).toBe(true);
      expect(hasSufficientStake(balance, 'guardian')).toBe(true);
    });
  });
});
