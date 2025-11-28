# Sprint 6 End-to-End Testing Guide

## Overview

This document provides comprehensive end-to-end testing procedures for Sprint 6: Governance & Economic Integration.

**Test Coverage:**
- Multi-sig proposal workflow
- Token staking operations
- Reward distribution
- Slashing mechanism
- Governance dashboard UI

**Testing Environment:**
- Network: Base Sepolia Testnet
- Contracts: NodeStaking, RewardDistributor, VersionBeacon
- Services: Proposal Service, Slashing Service
- UI: Admin Dashboard Governance Tab

---

## Test Suite 1: Multi-Sig Proposal Workflow

### Test Case 1.1: Create Version Deployment Proposal

**Objective:** Verify proposal creation for version deployment

**Prerequisites:**
- Multi-sig wallet configured
- Proposal service running
- Admin access to dashboard

**Steps:**
1. Navigate to Admin Dashboard → Governance → Proposals
2. Click "Create Proposal"
3. Fill in proposal details:
   - Title: "Deploy Version 1.0.0"
   - Description: "Deploy new version with bug fixes"
   - Type: "publishVersion"
   - Parameters: version="1.0.0", tier="ALL"
4. Click "Submit Proposal"

**Expected Results:**
- ✅ Proposal created successfully
- ✅ Proposal appears in list with status "pending"
- ✅ Required signatures shows 0/3
- ✅ Proposal ID generated and displayed

**Pass/Fail:** ⬜

---

### Test Case 1.2: Sign Proposal (Signer 1)

**Objective:** First signer approves the proposal

**Prerequisites:**
- Proposal created in Test 1.1
- Signer 1 wallet connected

**Steps:**
1. View proposal details
2. Click "Sign Proposal"
3. Confirm transaction in wallet
4. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Signature count increases to 1/3
- ✅ Signer 1 address shown in signatures list
- ✅ Proposal status remains "pending"

**Pass/Fail:** ⬜

---

### Test Case 1.3: Sign Proposal (Signer 2)

**Objective:** Second signer approves the proposal

**Prerequisites:**
- Test 1.2 completed
- Signer 2 wallet connected

**Steps:**
1. Switch to Signer 2 wallet
2. View proposal details
3. Click "Sign Proposal"
4. Confirm transaction in wallet
5. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Signature count increases to 2/3
- ✅ Signer 2 address shown in signatures list
- ✅ Proposal status remains "pending"

**Pass/Fail:** ⬜

---

### Test Case 1.4: Sign and Execute Proposal (Signer 3)

**Objective:** Third signer approves and executes the proposal

**Prerequisites:**
- Test 1.3 completed
- Signer 3 wallet connected

**Steps:**
1. Switch to Signer 3 wallet
2. View proposal details
3. Click "Sign & Execute Proposal"
4. Confirm transaction in wallet
5. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Signature count shows 3/3
- ✅ Proposal status changes to "executed"
- ✅ VersionBeacon contract updated with new version
- ✅ Execution timestamp recorded

**Pass/Fail:** ⬜

---

### Test Case 1.5: Verify Version Published

**Objective:** Confirm version was published to VersionBeacon

**Prerequisites:**
- Test 1.4 completed

**Steps:**
1. Query VersionBeacon contract for latest version
2. Check version details match proposal

**Expected Results:**
- ✅ Version "1.0.0" exists in contract
- ✅ Tier is set to "ALL"
- ✅ Version is active
- ✅ Publish timestamp matches execution time

**Pass/Fail:** ⬜

---

## Test Suite 2: Token Staking Operations

### Test Case 2.1: Stake Tokens for Node

**Objective:** Stake tokens to register a node

**Prerequisites:**
- NODERR tokens in wallet (at least 1000)
- NodeStaking contract deployed
- Node ID generated

**Steps:**
1. Approve NodeStaking contract to spend tokens
2. Call `stake(nodeId, 2000 tokens)`
3. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Tokens transferred from wallet to contract
- ✅ Node registered as active
- ✅ Stake amount shows 2000 tokens
- ✅ Operator address recorded correctly

**Pass/Fail:** ⬜

---

### Test Case 2.2: Increase Stake

**Objective:** Add more tokens to existing stake

**Prerequisites:**
- Test 2.1 completed
- Additional NODERR tokens available

**Steps:**
1. Call `increaseStake(nodeId, 1000 tokens)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Additional 1000 tokens transferred
- ✅ Total stake shows 3000 tokens
- ✅ Node remains active

**Pass/Fail:** ⬜

---

### Test Case 2.3: Request Withdrawal

**Objective:** Initiate withdrawal process

**Prerequisites:**
- Test 2.2 completed

**Steps:**
1. Call `requestWithdrawal(nodeId)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Withdrawal requested timestamp set
- ✅ Node remains active during cooldown
- ✅ Cannot withdraw immediately (cooldown enforced)

**Pass/Fail:** ⬜

---

### Test Case 2.4: Cancel Withdrawal

**Objective:** Cancel withdrawal request

**Prerequisites:**
- Test 2.3 completed

**Steps:**
1. Call `cancelWithdrawal(nodeId)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Withdrawal requested timestamp cleared
- ✅ Node remains active
- ✅ Stake unchanged

**Pass/Fail:** ⬜

---

### Test Case 2.5: Complete Withdrawal (After Cooldown)

**Objective:** Withdraw stake after cooldown period

**Prerequisites:**
- New withdrawal request initiated
- 7-day cooldown period elapsed (or fast-forwarded in testnet)

**Steps:**
1. Call `withdraw(nodeId)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Tokens returned to operator wallet
- ✅ Node deactivated
- ✅ Stake amount set to 0

**Pass/Fail:** ⬜

---

## Test Suite 3: Reward Distribution

### Test Case 3.1: Register Node for Rewards

**Objective:** Register node in RewardDistributor

**Prerequisites:**
- Node staked in NodeStaking contract
- RewardDistributor contract deployed

**Steps:**
1. Call `registerNode(nodeId, tier, operator)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Node registered in reward system
- ✅ Tier recorded correctly
- ✅ Operator address set

**Pass/Fail:** ⬜

---

### Test Case 3.2: Update Node Metrics

**Objective:** Oracle updates node performance metrics

**Prerequisites:**
- Test 3.1 completed
- Oracle role granted

**Steps:**
1. Call `updateNodeMetrics(nodeId, uptime=95, errors=2, successfulTrades=100)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Metrics recorded for current epoch
- ✅ Performance multiplier calculated
- ✅ Rewards adjusted based on performance

**Pass/Fail:** ⬜

---

### Test Case 3.3: Distribute Epoch Rewards

**Objective:** Admin distributes rewards for completed epoch

**Prerequisites:**
- Test 3.2 completed
- Epoch completed
- Reward tokens available in contract

**Steps:**
1. Call `distributeRewards(epochId, totalRewards)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Rewards calculated for all active nodes
- ✅ Tier-based distribution applied
- ✅ Performance multipliers applied
- ✅ Pending rewards updated

**Pass/Fail:** ⬜

---

### Test Case 3.4: Claim Rewards

**Objective:** Node operator claims pending rewards

**Prerequisites:**
- Test 3.3 completed
- Pending rewards > 0

**Steps:**
1. Call `claimRewards(nodeId)`
2. Wait for transaction confirmation

**Expected Results:**
- ✅ Transaction succeeds
- ✅ Reward tokens transferred to operator
- ✅ Pending rewards reset to 0
- ✅ Claim recorded in history

**Pass/Fail:** ⬜

---

## Test Suite 4: Slashing Mechanism

### Test Case 4.1: Low Uptime Slash (Minor)

**Objective:** Node slashed for uptime below 95%

**Prerequisites:**
- Node staked and active
- Slashing service running
- Node uptime drops to 90%

**Steps:**
1. Wait for slashing service check interval
2. Verify slashing event triggered

**Expected Results:**
- ✅ Slashing event created
- ✅ Rule "low_uptime_minor" triggered
- ✅ Slash amount = 1% of stake
- ✅ Transaction executed on-chain
- ✅ Event recorded in database

**Pass/Fail:** ⬜

---

### Test Case 4.2: High Error Rate Slash (Moderate)

**Objective:** Node slashed for excessive errors

**Prerequisites:**
- Node staked and active
- Error rate exceeds 10 per hour

**Steps:**
1. Simulate high error rate
2. Wait for slashing service check

**Expected Results:**
- ✅ Slashing event created
- ✅ Rule "high_error_rate" triggered
- ✅ Slash amount = 5% of stake
- ✅ Transaction executed
- ✅ Stake reduced accordingly

**Pass/Fail:** ⬜

---

### Test Case 4.3: Offline Node Slash (Critical)

**Objective:** Node slashed for being offline

**Prerequisites:**
- Node staked and active
- Node offline for extended period

**Steps:**
1. Stop node heartbeats
2. Wait for multiple missed heartbeats
3. Wait for slashing service check

**Expected Results:**
- ✅ Slashing event created
- ✅ Rule "node_offline" triggered
- ✅ Slash amount = 50% of stake
- ✅ Transaction executed
- ✅ Node potentially deactivated

**Pass/Fail:** ⬜

---

### Test Case 4.4: Slashing Cooldown

**Objective:** Verify cooldown prevents repeated slashing

**Prerequisites:**
- Node slashed in Test 4.1
- Less than 1 hour elapsed

**Steps:**
1. Trigger same slashing condition
2. Wait for slashing service check

**Expected Results:**
- ✅ No new slashing event created
- ✅ Cooldown period respected
- ✅ Log shows "Node in cooldown period"

**Pass/Fail:** ⬜

---

### Test Case 4.5: Maximum Slash Per Day

**Objective:** Verify daily slash limit enforced

**Prerequisites:**
- Node has been slashed multiple times
- Total slashes approaching daily limit

**Steps:**
1. Trigger additional slashing conditions
2. Verify total slash capped

**Expected Results:**
- ✅ Total slash does not exceed daily limit
- ✅ Excess slash amount not applied
- ✅ Warning logged about daily limit

**Pass/Fail:** ⬜

---

## Test Suite 5: Governance Dashboard UI

### Test Case 5.1: View Proposals

**Objective:** Display all proposals in dashboard

**Prerequisites:**
- Admin logged in
- Proposals exist in database

**Steps:**
1. Navigate to Governance tab
2. Click "Multi-Sig Proposals" section

**Expected Results:**
- ✅ All proposals displayed
- ✅ Status badges show correct colors
- ✅ Signature counts accurate
- ✅ Timestamps formatted correctly

**Pass/Fail:** ⬜

---

### Test Case 5.2: View Staking Stats

**Objective:** Display staking statistics

**Prerequisites:**
- Nodes staked
- Admin logged in

**Steps:**
1. Navigate to Governance tab
2. Click "Staking & Rewards" section

**Expected Results:**
- ✅ Total staked amount correct
- ✅ Active nodes count accurate
- ✅ Average stake calculated correctly
- ✅ Stats cards update in real-time

**Pass/Fail:** ⬜

---

### Test Case 5.3: View Slashing Events

**Objective:** Display slashing event history

**Prerequisites:**
- Slashing events exist
- Admin logged in

**Steps:**
1. Navigate to Governance tab
2. Click "Slashing Events" section

**Expected Results:**
- ✅ All events displayed chronologically
- ✅ Amounts shown correctly
- ✅ Reasons displayed
- ✅ Transaction links work
- ✅ Empty state shown if no events

**Pass/Fail:** ⬜

---

### Test Case 5.4: Create Proposal UI

**Objective:** Create proposal through dashboard

**Prerequisites:**
- Admin logged in
- Multi-sig wallet connected

**Steps:**
1. Click "Create Proposal" button
2. Fill in form
3. Submit proposal

**Expected Results:**
- ✅ Modal opens correctly
- ✅ Form validation works
- ✅ Proposal created successfully
- ✅ List updates with new proposal
- ✅ Success notification shown

**Pass/Fail:** ⬜

---

### Test Case 5.5: Real-time Updates

**Objective:** Verify dashboard updates automatically

**Prerequisites:**
- Dashboard open
- Background activity occurring

**Steps:**
1. Keep dashboard open
2. Trigger external events (slashing, staking, etc.)
3. Observe dashboard

**Expected Results:**
- ✅ Stats update automatically
- ✅ New events appear without refresh
- ✅ Polling interval appropriate (5-10s)
- ✅ No performance degradation

**Pass/Fail:** ⬜

---

## Test Summary

### Overall Statistics

**Total Test Cases:** 25
**Passed:** ___
**Failed:** ___
**Skipped:** ___
**Pass Rate:** ___%

### Test Suite Results

| Suite | Test Cases | Passed | Failed | Pass Rate |
|-------|------------|--------|--------|-----------|
| Multi-Sig Proposals | 5 | ___ | ___ | ___% |
| Token Staking | 5 | ___ | ___ | ___% |
| Reward Distribution | 4 | ___ | ___ | ___% |
| Slashing Mechanism | 5 | ___ | ___ | ___% |
| Governance Dashboard | 5 | ___ | ___ | ___% |

### Critical Issues Found

1. ___
2. ___
3. ___

### Recommendations

1. ___
2. ___
3. ___

---

## Sign-off

**Tester:** _______________
**Date:** _______________
**Status:** ⬜ Approved ⬜ Rejected ⬜ Conditional

**Notes:**
_______________________________________________
_______________________________________________
_______________________________________________
