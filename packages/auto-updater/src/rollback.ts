/**
 * Rollback Handler
 * 
 * Handles automatic rollback on failed updates
 * 
 * @module rollback
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import Docker from 'dockerode';
import { AutoUpdaterConfig } from './config';
import { DockerClient } from './docker';
import { logger } from './logger';

/**
 * Backup metadata
 */
export interface BackupMetadata {
  /**
   * Backup timestamp
   */
  timestamp: number;
  
  /**
   * Version being backed up
   */
  version: string;
  
  /**
   * Image tag
   */
  imageTag: string;
  
  /**
   * Container ID
   */
  containerId: string;
  
  /**
   * Backup directory path
   */
  backupPath: string;
}

/**
 * Rollback handler class
 */
export class RollbackHandler {
  private config: AutoUpdaterConfig;
  private dockerClient: DockerClient;
  
  constructor(config: AutoUpdaterConfig, dockerClient: DockerClient) {
    this.config = config;
    this.dockerClient = dockerClient;
  }
  
  /**
   * Create backup before update
   * 
   * @param container - Container to backup
   * @param version - Current version
   * @param imageTag - Current image tag
   * @returns Backup metadata
   */
  async createBackup(
    container: Docker.Container,
    version: string,
    imageTag: string
  ): Promise<BackupMetadata> {
    const timestamp = Date.now();
    const backupDir = path.join(
      this.config.backupDirectory,
      `backup-${timestamp}`
    );
    
    logger.info('Creating backup', {
      version,
      imageTag,
      backupDir,
    });
    
    try {
      // Create backup directory
      await fs.mkdir(backupDir, { recursive: true });
      
      // Get container info
      const containerInfo = await container.inspect();
      
      // Save container config
      const configPath = path.join(backupDir, 'container-config.json');
      await fs.writeFile(
        configPath,
        JSON.stringify(containerInfo, null, 2)
      );
      
      // Save environment variables
      const envPath = path.join(backupDir, 'environment.json');
      await fs.writeFile(
        envPath,
        JSON.stringify(containerInfo.Config.Env, null, 2)
      );
      
      // Export container filesystem (optional, can be large)
      // This is commented out by default to save space
      // Uncomment if you need full filesystem backup
      /*
      const tarPath = path.join(backupDir, 'filesystem.tar');
      const tarStream = await container.export();
      const writeStream = fs.createWriteStream(tarPath);
      await new Promise((resolve, reject) => {
        tarStream.pipe(writeStream);
        tarStream.on('end', resolve);
        tarStream.on('error', reject);
      });
      */
      
      // Create metadata file
      const metadata: BackupMetadata = {
        timestamp,
        version,
        imageTag,
        containerId: containerInfo.Id,
        backupPath: backupDir,
      };
      
      const metadataPath = path.join(backupDir, 'metadata.json');
      await fs.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2)
      );
      
      logger.info('Backup created successfully', metadata);
      
      return metadata;
    } catch (error) {
      logger.error('Failed to create backup', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  
  /**
   * Restore from backup
   * 
   * @param metadata - Backup metadata
   * @returns True if successful
   */
  async restoreBackup(metadata: BackupMetadata): Promise<boolean> {
    logger.info('Restoring from backup', metadata);
    
    try {
      // Read container config
      const configPath = path.join(metadata.backupPath, 'container-config.json');
      const configData = await fs.readFile(configPath, 'utf-8');
      const containerConfig = JSON.parse(configData);
      
      // Pull the old image if not available
      const imageExists = await this.dockerClient.imageExists(metadata.imageTag);
      if (!imageExists) {
        logger.info('Old image not available, pulling', { imageTag: metadata.imageTag });
        const pulled = await this.dockerClient.pullImage(metadata.imageTag);
        if (!pulled) {
          throw new Error('Failed to pull old image');
        }
      }
      
      // Get current container and stop it
      const currentContainer = await this.dockerClient.getCurrentContainer();
      if (currentContainer) {
        await this.dockerClient.stopContainer(currentContainer);
        await this.dockerClient.removeContainer(currentContainer);
      }
      
      // Create new container from backup config
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const imageName = `${this.config.dockerRegistry}/${this.config.dockerImagePrefix}:${metadata.imageTag}`;
      
      const restoredContainer = await docker.createContainer({
        Image: imageName,
        name: `noderr-node-os-restored-${Date.now()}`,
        Env: containerConfig.Config.Env,
        ExposedPorts: containerConfig.Config.ExposedPorts,
        HostConfig: {
          ...containerConfig.HostConfig,
          Binds: containerConfig.HostConfig.Binds,
          PortBindings: containerConfig.HostConfig.PortBindings,
          RestartPolicy: containerConfig.HostConfig.RestartPolicy,
        },
        Labels: {
          ...containerConfig.Config.Labels,
          'noderr.node-os': 'true',
          'noderr.version': metadata.imageTag,
          'noderr.restored': 'true',
        },
      });
      
      // Start restored container
      await restoredContainer.start();
      
      logger.info('Backup restored successfully', {
        version: metadata.version,
        imageTag: metadata.imageTag,
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to restore backup', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  
  /**
   * List available backups
   * 
   * @returns Array of backup metadata
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      const entries = await fs.readdir(this.config.backupDirectory);
      const backups: BackupMetadata[] = [];
      
      for (const entry of entries) {
        if (!entry.startsWith('backup-')) continue;
        
        const backupPath = path.join(this.config.backupDirectory, entry);
        const metadataPath = path.join(backupPath, 'metadata.json');
        
        try {
          const metadataData = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataData);
          backups.push(metadata);
        } catch (error) {
          logger.warn('Failed to read backup metadata', {
            backupPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp - a.timestamp);
      
      logger.info('Listed backups', { count: backups.length });
      
      return backups;
    } catch (error) {
      logger.error('Failed to list backups', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
  
  /**
   * Clean up old backups
   * 
   * Keeps only the most recent N backups
   * 
   * @returns Number of backups removed
   */
  async cleanupOldBackups(): Promise<number> {
    logger.info('Cleaning up old backups', {
      maxBackups: this.config.maxBackups,
    });
    
    try {
      const backups = await this.listBackups();
      
      if (backups.length <= this.config.maxBackups) {
        logger.info('No backups to clean up', {
          current: backups.length,
          max: this.config.maxBackups,
        });
        return 0;
      }
      
      const toRemove = backups.slice(this.config.maxBackups);
      let removed = 0;
      
      for (const backup of toRemove) {
        try {
          await fs.rm(backup.backupPath, { recursive: true, force: true });
          removed++;
          logger.info('Removed old backup', {
            version: backup.version,
            timestamp: backup.timestamp,
          });
        } catch (error) {
          logger.warn('Failed to remove backup', {
            backupPath: backup.backupPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      logger.info('Backup cleanup complete', { removed });
      
      return removed;
    } catch (error) {
      logger.error('Failed to cleanup backups', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
  
  /**
   * Get most recent backup
   * 
   * @returns Backup metadata or null
   */
  async getMostRecentBackup(): Promise<BackupMetadata | null> {
    const backups = await this.listBackups();
    return backups.length > 0 ? backups[0] : null;
  }
}
