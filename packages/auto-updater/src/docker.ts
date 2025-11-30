/**
 * Docker Operations
 * 
 * Manages Docker container operations for updates
 * 
 * @module docker
 */

import Docker from 'dockerode';
import { AutoUpdaterConfig } from './config';
import { logger } from './logger';

/**
 * Docker client wrapper
 */
export class DockerClient {
  private docker: Docker;
  private config: AutoUpdaterConfig;
  
  constructor(config: AutoUpdaterConfig) {
    this.config = config;
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    
    logger.info('Docker client initialized');
  }
  
  /**
   * Get full image name with tag
   */
  private getImageName(imageTag: string): string {
    return `${this.config.dockerRegistry}/${this.config.dockerImagePrefix}:${imageTag}`;
  }
  
  /**
   * Pull Docker image
   * 
   * @param imageTag - Image tag to pull
   * @returns True if successful
   */
  async pullImage(imageTag: string): Promise<boolean> {
    const imageName = this.getImageName(imageTag);
    
    logger.info('Pulling Docker image', { imageName });
    
    try {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(imageName, (err: any, stream: any) => {
          if (err) {
            reject(err);
            return;
          }
          
          this.docker.modem.followProgress(stream, (err: any) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }, (event: any) => {
            logger.debug('Pull progress', event);
          });
        });
      });
      
      logger.info('Docker image pulled successfully', { imageName });
      return true;
    } catch (error) {
      logger.error('Failed to pull Docker image', {
        imageName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  
  /**
   * Get current running container
   * 
   * @returns Container object or null
   */
  async getCurrentContainer(): Promise<Docker.Container | null> {
    try {
      const containers = await this.docker.listContainers({
        filters: {
          label: ['noderr.node-os=true'],
          status: ['running'],
        },
      });
      
      if (containers.length === 0) {
        logger.warn('No running noderr container found');
        return null;
      }
      
      if (containers.length > 1) {
        logger.warn('Multiple noderr containers running', {
          count: containers.length,
        });
      }
      
      const container = this.docker.getContainer(containers[0].Id);
      logger.info('Found current container', {
        id: containers[0].Id,
        image: containers[0].Image,
      });
      
      return container;
    } catch (error) {
      logger.error('Failed to get current container', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  
  /**
   * Stop container gracefully
   * 
   * @param container - Container to stop
   * @param timeout - Timeout in seconds (default 30)
   * @returns True if successful
   */
  async stopContainer(container: Docker.Container, timeout: number = 30): Promise<boolean> {
    try {
      logger.info('Stopping container', { timeout });
      await container.stop({ t: timeout });
      logger.info('Container stopped successfully');
      return true;
    } catch (error) {
      logger.error('Failed to stop container', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  
  /**
   * Start new container with updated image
   * 
   * @param imageTag - Image tag to use
   * @param oldContainer - Old container to copy config from
   * @returns New container or null
   */
  async startNewContainer(
    imageTag: string,
    oldContainer: Docker.Container
  ): Promise<Docker.Container | null> {
    const imageName = this.getImageName(imageTag);
    
    try {
      // Get old container config
      const oldInfo = await oldContainer.inspect();
      
      // Create new container with same config
      const newContainer = await this.docker.createContainer({
        Image: imageName,
        name: `noderr-node-os-${Date.now()}`,
        Env: oldInfo.Config.Env,
        ExposedPorts: oldInfo.Config.ExposedPorts,
        HostConfig: {
          ...oldInfo.HostConfig,
          Binds: oldInfo.HostConfig.Binds,
          PortBindings: oldInfo.HostConfig.PortBindings,
          RestartPolicy: oldInfo.HostConfig.RestartPolicy,
        },
        Labels: {
          ...oldInfo.Config.Labels,
          'noderr.node-os': 'true',
          'noderr.version': imageTag,
        },
      });
      
      logger.info('Created new container', {
        id: newContainer.id,
        image: imageName,
      });
      
      // Start the new container
      await newContainer.start();
      logger.info('New container started successfully');
      
      return newContainer;
    } catch (error) {
      logger.error('Failed to start new container', {
        imageName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  
  /**
   * Remove container
   * 
   * @param container - Container to remove
   * @param force - Force removal (default false)
   * @returns True if successful
   */
  async removeContainer(container: Docker.Container, force: boolean = false): Promise<boolean> {
    try {
      logger.info('Removing container', { force });
      await container.remove({ force });
      logger.info('Container removed successfully');
      return true;
    } catch (error) {
      logger.error('Failed to remove container', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  
  /**
   * Get container logs
   * 
   * @param container - Container to get logs from
   * @param tail - Number of lines to tail (default 100)
   * @returns Log string
   */
  async getContainerLogs(container: Docker.Container, tail: number = 100): Promise<string> {
    try {
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
      });
      
      return logs.toString();
    } catch (error) {
      logger.error('Failed to get container logs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }
  
  /**
   * Check if image exists locally
   * 
   * @param imageTag - Image tag to check
   * @returns True if exists
   */
  async imageExists(imageTag: string): Promise<boolean> {
    const imageName = this.getImageName(imageTag);
    
    try {
      const image = this.docker.getImage(imageName);
      await image.inspect();
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Remove old images to save space
   * 
   * @param keepTags - Tags to keep
   * @returns Number of images removed
   */
  async pruneOldImages(keepTags: string[]): Promise<number> {
    try {
      const images = await this.docker.listImages({
        filters: {
          reference: [`${this.config.dockerRegistry}/${this.config.dockerImagePrefix}`],
        },
      });
      
      let removed = 0;
      
      for (const imageInfo of images) {
        const tags = imageInfo.RepoTags || [];
        const shouldKeep = tags.some(tag => {
          const imageTag = tag.split(':')[1];
          return keepTags.includes(imageTag);
        });
        
        if (!shouldKeep && tags.length > 0) {
          try {
            const image = this.docker.getImage(tags[0]);
            await image.remove();
            removed++;
            logger.info('Removed old image', { tag: tags[0] });
          } catch (error) {
            logger.warn('Failed to remove image', {
              tag: tags[0],
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      
      logger.info('Pruned old images', { removed });
      return removed;
    } catch (error) {
      logger.error('Failed to prune old images', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
