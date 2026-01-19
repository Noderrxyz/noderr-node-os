


# The Noderr Operator's Handbook

**Version 1.0.0**

**Last Updated:** January 19, 2026

---

## Introduction

Welcome to the Noderr Operator's Handbook. This document provides a comprehensive guide for node operators participating in the Noderr decentralized trading network. Our mission is to build an institutional-grade, community-driven ecosystem for algorithmic trading, and operators are the backbone of this system.

This handbook serves as the definitive resource for understanding the network architecture, fulfilling your responsibilities as an operator, and maximizing your performance-based rewards. We have designed the Noderr network to be as autonomous and resilient as possible, but its success ultimately depends on the skill and dedication of our operators.

> The Noderr network is engineered for perfection. We expect our operators to uphold the same standard of excellence. This handbook is your guide to achieving that standard.

### Who is this Handbook For?

This handbook is intended for technically proficient individuals and organizations who wish to contribute to the Noderr network by running an Oracle, Guardian, or Validator node. It assumes a strong understanding of blockchain principles, server management, and network security.

### What You Will Learn

- The three-tier architecture of the Noderr network (Oracle, Guardian, Validator).
- The end-to-end process of becoming a node operator, from setup to reward claiming.
- How to install, configure, and maintain your node for optimal performance.
- The mechanics of the NODR token, staking, and the on-chain reputation system (TrustFingerprint).
- Best practices for security, monitoring, and troubleshooting.

---

## Chapter 1: The Noderr Network Architecture

The Noderr network is built on a unique three-tier architecture designed for security, performance, and institutional-grade reliability. Each tier consists of specialized nodes with distinct responsibilities, working in concert to execute trading strategies efficiently and securely.

### The Three Tiers of Consensus

| Node Type | Role | Key Responsibilities | Minimum Stake | Trust Score | 
| :--- | :--- | :--- | :--- | :--- | 
| **Oracle** | The Intelligence Layer | - Scans for market opportunities (arbitrage, alpha) <br>- Generates trading signals <br>- Performs complex off-chain computation | 500,000 NODR | 0.90+ | 
| **Guardian** | The Risk Validation Layer | - Validates signals from Oracles <br>- Reaches P2P consensus on signal validity <br>- Protects the network from faulty or malicious signals | 100,000 NODR | 0.75+ | 
| **Validator** | The Execution Layer | - Executes approved trades on-chain <br>- Manages transaction lifecycle <br>- Ensures efficient and reliable trade settlement | 50,000 NODR | 0.60+ | 

### How the Tiers Interact

The workflow is designed to be a sequential, fault-tolerant process:

1.  **Signal Generation:** An **Oracle** node identifies a potential trading opportunity and constructs a detailed signal, including the proposed strategy, expected profit, and risk analysis.

2.  **Signal Propagation:** The Oracle broadcasts this signal to the **Guardian** nodes on the P2P network.

3.  **Guardian Consensus:** The Guardian nodes independently verify the signal against a set of risk parameters. They then engage in a P2P consensus protocol to vote on whether to approve or reject the signal. A signal is only approved if it reaches a 66% consensus threshold.

4.  **Execution Request:** Once consensus is reached, the approved signal is forwarded to the **Validator** nodes.

5.  **Trade Execution:** A Validator node picks up the execution request and submits the transaction to the Base blockchain. The first Validator to successfully execute the trade receives the execution reward.

This separation of concerns ensures that no single node type can unilaterally control the trading process, creating a robust system of checks and balances.

### The Role of Bootstrap Nodes

Bootstrap nodes are the initial discovery mechanism for the P2P network. They do not participate in consensus or trading but serve as stable, well-known entry points for new nodes to join and discover peers. A minimum of three bootstrap nodes are required for network redundancy.

---

## Chapter 2: Becoming a Node Operator

Becoming a Noderr node operator is a multi-step process that requires technical expertise and a commitment to maintaining a high-performance, secure server. This chapter will guide you through the entire journey, from server provisioning to running your node.

### Step 1: Server Provisioning

Your first step is to provision a server that meets the minimum requirements for your chosen node type. While bootstrap nodes are lightweight, operational nodes (Validators, Guardians, and Oracles) require more resources.

**Recommended Specifications per Node:**

| Resource | Validator | Guardian | Oracle |
| :--- | :--- | :--- | :--- |
| **CPU** | 2 vCPUs | 4 vCPUs | 8 vCPUs |
| **RAM** | 4 GB | 8 GB | 16 GB |
| **Storage** | 40 GB SSD | 80 GB SSD | 160 GB SSD |
| **Network** | Public IP | Public IP | Public IP |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

> **Cloud Provider Recommendations:** We recommend using a reputable cloud provider such as AWS (EC2), Google Cloud (Compute Engine), Digital Ocean, or Hetzner. For Oracles, a bare-metal server may provide a performance advantage.

### Step 2: Install Dependencies

Once your server is provisioned, SSH into it and install the necessary dependencies.

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js v22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm for package management
sudo npm install -g pnpm

# Install PM2 for process management
sudo npm install -g pm2

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### Step 3: Clone and Build the Node Software

Next, you will clone the `noderr-node-os` repository and build the necessary packages.

```bash
# Clone the repository
git clone https://github.com/Noderrxyz/noderr-node-os.git
cd noderr-node-os

# Install all dependencies
pnpm install

# Build all packages
pnpm build
```

### Step 4: Configure Your Node

Configuration is handled through a `.env` file in the root of the `noderr-node-os` directory. You will need to create this file and populate it with the correct values for your node type and environment.

**Create a `.env` file:**

```bash
cat > .env << EOF
# General Configuration
NODE_ENV=production
NODE_TYPE=<validator|guardian|oracle>
NODE_ID=<your-unique-node-id>

# Wallet Configuration
PRIVATE_KEY=<your-node-operator-private-key>
WALLET_ADDRESS=<your-node-operator-wallet-address>

# RPC Endpoints (use your own)
BASE_SEPOLIA_RPC=https://sepolia.base.org

# P2P Configuration
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002
BOOTSTRAP_NODES=<comma-separated-list-of-bootstrap-multiaddrs>

# Telemetry
METRICS_PORT=8080
EOF
```

**Key Configuration Fields:**

-   `NODE_TYPE`: Must be one of `validator`, `guardian`, or `oracle`.
-   `NODE_ID`: A unique identifier for your node (e.g., `my-validator-1`).
-   `PRIVATE_KEY`: The private key of the wallet you will use for staking and rewards. **This is highly sensitive and must be kept secure.**
-   `BOOTSTRAP_NODES`: A comma-separated list of the official bootstrap node multiaddrs. This list will be provided in the Noderr Discord and on the official website.

### Step 5: Start Your Node

We use PM2 to manage the node processes. The repository includes ecosystem configuration files for each node type.

```bash
# Start the node using the appropriate ecosystem file
pm2 start ecosystem.<node-type>.config.js

# Save the PM2 process list to resurrect on reboot
pm2 save

# Set up PM2 to start on system boot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER
```

### Step 6: Verify Node Operation

After starting your node, you should verify that it is running correctly.

```bash
# Check the status of your node processes
pm2 status

# View the logs for your node
pm2 logs <node-name>

# Check the health endpoint
curl http://localhost:8080/health

# Check the metrics endpoint
curl http://localhost:8080/metrics
```

If all steps are successful, your node is now part of the Noderr network. The next chapter will cover the crucial topics of staking and on-chain reputation.

---

## Chapter 3: Staking and Reputation

Staking and reputation are the two core pillars that secure the Noderr network and align operator incentives with the long-term health of the ecosystem. Your stake acts as a security deposit, while your reputation, tracked by the **TrustFingerprint** system, determines your influence and earning potential.

### Staking NODR Tokens

To activate your node and participate in the network, you must stake the required amount of NODR tokens. The staking requirements are tiered based on the node's role and responsibilities.

| Node Type | Minimum Stake (NODR) | Rationale |
| :--- | :--- | :--- |
| **Oracle** | 500,000 | Highest stake due to the critical role in generating intelligence and the potential impact of faulty signals. |
| **Guardian** | 100,000 | Significant stake required to ensure diligent validation of signals and secure the consensus process. |
| **Validator** | 50,000 | Entry-level stake for executing trades, providing a baseline security guarantee. |

Staking is managed through the `StakingManager` smart contract. You can stake your NODR tokens using the official Noderr Operator Dashboard, which provides a user-friendly interface for all staking and reward-related operations.

### The TrustFingerprint System

TrustFingerprint is our proprietary on-chain reputation system. It assigns a dynamic score to each node, ranging from **0.30 to 1.0**. This score is a direct reflection of your node's performance, reliability, and contribution to the network.

**How is Your Trust Score Calculated?**

Your Trust Score is influenced by several factors:

-   **Uptime:** The percentage of time your node is online and responsive.
-   **Performance:** For Validators, this includes execution speed and success rate. For Guardians, it's the accuracy of your votes. For Oracles, it's the profitability of your generated signals.
-   **Longevity:** The length of time your node has been an active and reliable participant in the network.
-   **Governance Participation:** Active participation in governance proposals and voting.

**Why Your Trust Score Matters:**

-   **Tier Eligibility:** You must meet a minimum Trust Score to qualify for a specific node tier.
-   **Reward Multiplier:** Your Trust Score directly impacts your performance-based rewards. A higher score results in a higher multiplier.
-   **Slashing Risk:** Nodes that fall below a certain Trust Score threshold may be subject to slashing, where a portion of their stake is forfeited.

> Your TrustFingerprint is your on-chain resume. A high score demonstrates your commitment to the network and unlocks greater earning potential. A low score puts your stake at risk.

### The Interplay of Stake and Reputation

Staking and reputation are intrinsically linked. While your initial stake grants you entry to a specific tier, it is your reputation that sustains your position and profitability. A high-reputation node with a sufficient stake is the ideal, contributing positively to the network's security and earning maximum rewards.

Conversely, a node with a high stake but a poor reputation will see its earning potential diminish and will eventually face penalties. This system ensures that capital alone is not enough to control the network; performance and reliability are paramount.

---

## Chapter 4: Rewards and Slashing

The economic model of the Noderr network is designed to reward high-performing operators while penalizing those who act maliciously or fail to meet the required standards. This chapter details the performance-based reward system and the conditions under which an operator's stake may be slashed.

### Performance-Based Rewards

Node operators are compensated for their contributions to the network through performance-based rewards distributed in NODR tokens. These rewards are not fixed; they are directly tied to your node's performance, uptime, and TrustFingerprint score.

**Reward Distribution:**

Rewards are distributed from the `RewardDistributor` smart contract. The amount of rewards you earn is a function of:

-   **Base Reward Rate:** Each node tier has a base reward rate, which is determined by the governance process.
-   **Performance Multiplier:** This is where your Trust Score comes into play. A higher Trust Score results in a higher reward multiplier. The multiplier can range from 0.5x for low-reputation nodes to 1.5x for top-performing nodes.
-   **Uptime:** Your node must maintain a high level of uptime to be eligible for full rewards. Rewards are reduced proportionally for any downtime.

**Vesting Schedule:**

To encourage long-term commitment to the network, all earned rewards are subject to a **90-day linear vesting period**. This means that your rewards are not immediately available to be withdrawn. They unlock gradually over 90 days, aligning your incentives with the long-term success of the network.

### Slashing: The Cost of Failure

Slashing is the mechanism by which a portion of an operator's stake is forfeited as a penalty for malicious behavior or gross negligence. It is a critical component of the network's security model, designed to deter attacks and ensure that operators have a strong financial incentive to act honestly and maintain their infrastructure.

**Conditions for Slashing:**

Slashing is reserved for serious offenses. The following actions can result in your stake being slashed:

-   **Double-Signing (Validators):** A Validator signing two different blocks at the same height.
-   **Malicious Voting (Guardians):** A Guardian colluding to approve a known malicious signal or reject a valid one.
-   **Providing False Information (Oracles):** An Oracle intentionally broadcasting false or misleading market data.
-   **Extended Downtime:** Prolonged periods of downtime that negatively impact the network's performance.
-   **Falling Below Minimum Trust Score:** If a node's Trust Score falls below the minimum threshold for its tier and is not rectified within a specified grace period.

> Slashing is a measure of last resort. It is designed to protect the network from bad actors and ensure that only dedicated, high-performing operators remain. By following the best practices outlined in this handbook, you can minimize your risk of being slashed.

### The Operator Dashboard: Your Command Center

All aspects of staking, rewards, and reputation can be managed through the Noderr Operator Dashboard. This web-based interface provides a real-time overview of your node's performance, your current stake, your pending and vested rewards, and your TrustFingerprint score. It is your primary tool for interacting with the Noderr network's on-chain components.

---

## Chapter 5: Security and Best Practices

As a node operator, you are a steward of the Noderr network. Maintaining the security and integrity of your node is not only crucial for your own profitability but also for the health of the entire ecosystem. This chapter outlines the essential security measures and best practices that all operators are expected to follow.

### Securing Your Server

Your server is the foundation of your node's security. A compromised server can lead to a compromised node, resulting in slashing and loss of funds.

-   **Firewall Configuration:** Implement a strict firewall policy. Only allow traffic on necessary ports (SSH, P2P, and telemetry). Restrict SSH and telemetry access to known IP addresses.
-   **SSH Security:**
    -   Use SSH keys for authentication instead of passwords.
    -   Disable root login.
    -   Change the default SSH port.
-   **Regular Updates:** Keep your server's operating system and all software packages up to date with the latest security patches.
-   **Intrusion Detection:** Implement an intrusion detection system like `fail2ban` to protect against brute-force attacks.

### Protecting Your Private Keys

Your node's private key is the most critical piece of information to protect. If this key is compromised, an attacker can steal your staked NODR and any accrued rewards.

-   **Do Not Store Private Keys in Plain Text:** Never store your private key in plain text in your `.env` file or any other unencrypted file. Use a hardware security module (HSM) or a secure key management service (e.g., HashiCorp Vault) to store and manage your private keys.
-   **Hardware Wallets:** For the highest level of security, use a hardware wallet (e.g., Ledger, Trezor) to store your operator private key. The Noderr node software is designed to be compatible with hardware wallet signing.
-   **Limited Permissions:** The user account that runs the node software should have the minimum necessary permissions. It should not have root access.

### Monitoring and Alerting

Proactive monitoring is essential for maintaining high uptime and quickly responding to any issues.

-   **System Monitoring:** Monitor your server's key metrics, including CPU usage, memory consumption, disk space, and network I/O. Use tools like Prometheus and Grafana to visualize these metrics.
-   **Node Health Checks:** Regularly check your node's health endpoint (`/health`) and metrics endpoint (`/metrics`). Set up alerts to notify you immediately if your node becomes unhealthy or stops responding.
-   **Log Analysis:** Regularly review your node's logs for any errors or unusual activity. Centralize your logs using a service like Logstash or Graylog for easier analysis.

### Best Practices for Optimal Performance

-   **Redundant Infrastructure:** For critical nodes (especially Oracles and Guardians), consider running a redundant setup with a hot-standby failover.
-   **Geographic Distribution:** If you are running multiple nodes, distribute them across different geographic regions and cloud providers to minimize the impact of a regional outage.
-   **Network Performance:** Ensure your server has a stable, low-latency internet connection. Network performance is critical for timely signal propagation and consensus.
-   **Stay Informed:** Actively participate in the Noderr community on Discord and the official forums. Stay informed about network upgrades, security advisories, and governance proposals.

> Your commitment to security and best practices is a direct investment in your success as a Noderr operator. A secure and well-maintained node is a profitable node.

---

## Conclusion

This handbook has provided you with the foundational knowledge to become a successful Noderr node operator. You are now equipped to contribute to the security, performance, and growth of our institutional-grade decentralized trading network.

Remember, the Noderr network is a living ecosystem. It will continue to evolve through community governance and technological innovation. We encourage you to be an active participant in this evolution, to share your feedback, and to help us build the future of decentralized finance.

Welcome to Noderr. We are excited to have you on board.

---

## References

[1] Noderrxyz. (2026). *Noderr Node OS Repository*. GitHub. [https://github.com/Noderrxyz/noderr-node-os](https://github.com/Noderrxyz/noderr-node-os)

[2] Noderrxyz. (2026). *Noderr Protocol Repository*. GitHub. [https://github.com/Noderrxyz/noderr-protocol](https://github.com/Noderrxyz/noderr-protocol)

[3] Noderrxyz. (2026). *Noderr DApp Repository*. GitHub. [https://github.com/Noderrxyz/noderr-dapp](https://github.com/Noderrxyz/noderr-dapp)
