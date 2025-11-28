/**
 * Update Orchestrator
 * 
 * Main logic for coordinating updates
 * 
 * @module updater
 */

import { AutoUpdaterConfig } from './config';
import { VersionBeaconClient, VersionInfo } from './version-beacon';
import { shouldUpdateNow, getTimeUntilEligible } from './cohort';
import { DockerClient } from './docker';
import { HealthValidator } from './health';
import { RollbackHandler, BackupMetadata } from './rollback';
import { logger } from './logger';

/**
 * Update status
 */
export enum UpdateStatus {
  IDLE = 'idle',
  CHECKING = 'checking',
  DOWNLOADING = 'downloading',
  UPDATING = 'updating',
  VALIDATING = 'validating',
  SUCCESS = 'success',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
}

/**
 * Update result
 */
export interface UpdateResult {
  /**
   * Final status
   */
  status: UpdateStatus;
  
  /**
   * Old version
   */
  oldVersion?: string;
  
  /**
   * New version
   */
  newVersion?: string;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Backup metadata
   */
  backup?: BackupMetadata;
  
  /**
   * Duration in milliseconds
   */
  duration?: number;
}

/**
 * Update orchestrator class
 */
export class UpdateOrchestrator {
  private config: AutoUpdaterConfig;
  private versionBeacon: VersionBeaconClient;
  private dockerClient: DockerClient;
  private healthValidator: HealthValidator;
  private rollbackHandler: RollbackHandler;
  private currentVersion: string;
  private status: UpdateStatus;
  
  constructor(config: AutoUpdaterConfig, currentVersion: string) {
    this.config = config;
    this.currentVersion = currentVersion;
    this.status = UpdateStatus.IDLE;
    
    this.versionBeacon = new VersionBeaconClient(config);
    this.dockerClient = new DockerClient(config);
    this.healthValidator = new HealthValidator(config);
    this.rollbackHandler = new RollbackHandler(config, this.dockerClient);
    
    logger.info('Update orchestrator initialized', {
      currentVersion,
      nodeTier: config.nodeTier,
      nodeId: config.nodeId,
    });
  }
  
  /**
   * Check for updates and apply if available
   * 
   * @returns Update result
   */
  async checkAndUpdate(): Promise<UpdateResult> {
    const startTime = Date.now();
    
    try {
      this.status = UpdateStatus.CHECKING;
      logger.info('Checking for updates', {
        currentVersion: this.currentVersion,
      });
      
      // Get latest version from VersionBeacon
      const versionInfo = await this.versionBeacon.getCurrentVersion();
      
      if (!versionInfo) {
        logger.info('No version available for tier', {
          tier: this.config.nodeTier,
        });
        return {
          status: UpdateStatus.IDLE,
          oldVersion: this.currentVersion,
        };
      }
      
      // Check if new version available
      if (versionInfo.version === this.currentVersion) {
        logger.info('Already on latest version', {
          version: this.currentVersion,
        });
        return {
          status: UpdateStatus.IDLE,
          oldVersion: this.currentVersion,
        };
      }
      
      // Check if node is in eligible cohort
      if (!shouldUpdateNow(this.config.nodeId, versionInfo)) {
        const timeUntil = getTimeUntilEligible(this.config.nodeId, versionInfo);
        logger.info('Not yet eligible for update', {
          currentVersion: this.currentVersion,
          newVersion: versionInfo.version,
          timeUntilEligible: timeUntil,
        });
        return {
          status: UpdateStatus.IDLE,
          oldVersion: this.currentVersion,
          newVersion: versionInfo.version,
        };
      }
      
      // Auto-update disabled, just report
      if (!this.config.autoUpdateEnabled) {
        logger.info('Auto-update disabled, skipping update', {
          currentVersion: this.currentVersion,
          newVersion: versionInfo.version,
        });
        return {
          status: UpdateStatus.IDLE,
          oldVersion: this.currentVersion,
          newVersion: versionInfo.version,
        };
      }
      
      // Perform the update
      logger.info('Starting update', {
        from: this.currentVersion,
        to: versionInfo.version,
      });
      
      const result = await this.performUpdate(versionInfo);
      
      const duration = Date.now() - startTime;
      return {
        ...result,
        duration,
      };
    } catch (error) {
      logger.error('Update check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        status: UpdateStatus.FAILED,
        oldVersion: this.currentVersion,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Perform the actual update
   * 
   * @param versionInfo - New version information
   * @returns Update result
   */
  private async performUpdate(versionInfo: VersionInfo): Promise<UpdateResult> {
    let backup: BackupMetadata | undefined;
    
    try {
      // Step 1: Download new image
      this.status = UpdateStatus.DOWNLOADING;
      logger.info('Downloading new image', {
        imageTag: versionInfo.imageTag,
      });
      
      const downloaded = await this.dockerClient.pullImage(versionInfo.imageTag);
      if (!downloaded) {
        throw new Error('Failed to download new image');
      }
      
      // Step 2: Get current container
      const currentContainer = await this.dockerClient.getCurrentContainer();
      if (!currentContainer) {
        throw new Error('No current container found');
      }
      
      // Step 3: Create backup
      logger.info('Creating backup');
      backup = await this.rollbackHandler.createBackup(
        currentContainer,
        this.currentVersion,
        versionInfo.imageTag
      );
      
      // Step 4: Stop current container
      this.status = UpdateStatus.UPDATING;
      logger.info('Stopping current container');
      
      const stopped = await this.dockerClient.stopContainer(currentContainer);
      if (!stopped) {
        throw new Error('Failed to stop current container');
      }
      
      // Step 5: Start new container
      logger.info('Starting new container');
      const newContainer = await this.dockerClient.startNewContainer(
        versionInfo.imageTag,
        currentContainer
      );
      
      if (!newContainer) {
        throw new Error('Failed to start new container');
      }
      
      // Step 6: Validate health
      this.status = UpdateStatus.VALIDATING;
      logger.info('Validating new container health');
      
      const healthy = await this.healthValidator.waitForHealthy(10, 5000);
      
      if (!healthy) {
        logger.error('New container failed health check, rolling back');
        
        // Rollback
        await this.dockerClient.stopContainer(newContainer);
        await this.dockerClient.removeContainer(newContainer, true);
        await this.rollbackHandler.restoreBackup(backup);
        
        return {
          status: UpdateStatus.ROLLED_BACK,
          oldVersion: this.currentVersion,
          newVersion: versionInfo.version,
          error: 'Health check failed',
          backup,
        };
      }
      
      // Step 7: Validate stability
      logger.info('Validating container stability');
      const stable = await this.healthValidator.validateStability(3, 10000);
      
      if (!stable) {
        logger.error('New container unstable, rolling back');
        
        // Rollback
        await this.dockerClient.stopContainer(newContainer);
        await this.dockerClient.removeContainer(newContainer, true);
        await this.rollbackHandler.restoreBackup(backup);
        
        return {
          status: UpdateStatus.ROLLED_BACK,
          oldVersion: this.currentVersion,
          newVersion: versionInfo.version,
          error: 'Stability check failed',
          backup,
        };
      }
      
      // Step 8: Remove old container
      logger.info('Removing old container');
      await this.dockerClient.removeContainer(currentContainer);
      
      // Step 9: Clean up old backups
      await this.rollbackHandler.cleanupOldBackups();
      
      // Step 10: Prune old images
      await this.dockerClient.pruneOldImages([versionInfo.imageTag]);
      
      // Update current version
      this.currentVersion = versionInfo.version;
      this.status = UpdateStatus.SUCCESS;
      
      logger.info('Update completed successfully', {
        oldVersion: this.currentVersion,
        newVersion: versionInfo.version,
      });
      
      return {
        status: UpdateStatus.SUCCESS,
        oldVersion: this.currentVersion,
        newVersion: versionInfo.version,
        backup,
      };
    } catch (error) {
      logger.error('Update failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Attempt rollback if we have a backup
      if (backup) {
        logger.info('Attempting rollback');
        const rolled = await this.rollbackHandler.restoreBackup(backup);
        
        if (rolled) {
          this.status = UpdateStatus.ROLLED_BACK;
          return {
            status: UpdateStatus.ROLLED_BACK,
            oldVersion: this.currentVersion,
            newVersion: versionInfo.version,
            error: error instanceof Error ? error.message : String(error),
            backup,
          };
        }
      }
      
      this.status = UpdateStatus.FAILED;
      return {
        status: UpdateStatus.FAILED,
        oldVersion: this.currentVersion,
        newVersion: versionInfo.version,
        error: error instanceof Error ? error.message : String(error),
        backup,
      };
    }
  }
  
  /**
   * Get current status
   */
  getStatus(): UpdateStatus {
    return this.status;
  }
  
  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }
}
