/**
 * Audit Logging Service
 * 
 * Tracks all sensitive operations for compliance and security monitoring
 */

import { getDatabaseService } from './database.service';

export enum AuditEventType {
  // Authentication events
  AUTH_TOKEN_GENERATED = 'auth_token_generated',
  AUTH_TOKEN_VALIDATED = 'auth_token_validated',
  AUTH_TOKEN_FAILED = 'auth_token_failed',
  AUTH_LOGIN = 'auth_login',
  AUTH_LOGOUT = 'auth_logout',
  
  // Node events
  NODE_REGISTERED = 'node_registered',
  NODE_VERIFIED = 'node_verified',
  NODE_SUSPENDED = 'node_suspended',
  NODE_ACTIVATED = 'node_activated',
  
  // Permission events
  PERMISSION_GRANTED = 'permission_granted',
  PERMISSION_DENIED = 'permission_denied',
  ROLE_CHANGED = 'role_changed',
  
  // Configuration events
  CONFIG_CHANGED = 'config_changed',
  STRATEGY_UPDATED = 'strategy_updated',
  RISK_LIMIT_CHANGED = 'risk_limit_changed',
  
  // Execution events
  ORDER_EXECUTED = 'order_executed',
  POSITION_OPENED = 'position_opened',
  POSITION_CLOSED = 'position_closed',
}

export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  nodeId: string;
  userId?: string;
  action: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
}

class AuditService {
  /**
   * Log an audit event
   */
  async logEvent(
    nodeId: string,
    eventType: AuditEventType,
    action: string,
    details: Record<string, any>,
    status: 'success' | 'failure' = 'success',
    errorMessage?: string
  ): Promise<void> {
    try {
      const db = getDatabaseService();
      
      const event: AuditEvent = {
        id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        eventType,
        nodeId,
        action,
        details,
        status,
        errorMessage,
      };
      
      // Store in database (implementation depends on database schema)
      // await db.createAuditEvent(event);
      
      // Also log to console for debugging
      console.log(`[AUDIT] ${eventType} - ${nodeId} - ${action}`, {
        status,
        details,
        errorMessage,
      });
    } catch (error) {
      console.error('Failed to log audit event:', error);
      // Don't throw - audit logging failures shouldn't break the application
    }
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(
    nodeId: string,
    eventType: AuditEventType,
    status: 'success' | 'failure',
    errorMessage?: string
  ): Promise<void> {
    await this.logEvent(
      nodeId,
      eventType,
      'Authentication',
      { timestamp: new Date().toISOString() },
      status,
      errorMessage
    );
  }

  /**
   * Log permission denied event
   */
  async logPermissionDenied(
    nodeId: string,
    requiredPermission: string,
    attemptedAction: string
  ): Promise<void> {
    await this.logEvent(
      nodeId,
      AuditEventType.PERMISSION_DENIED,
      `Attempted ${attemptedAction} without ${requiredPermission}`,
      { requiredPermission, attemptedAction },
      'failure',
      'Insufficient permissions'
    );
  }

  /**
   * Log execution event
   */
  async logExecutionEvent(
    nodeId: string,
    eventType: AuditEventType,
    details: Record<string, any>,
    status: 'success' | 'failure' = 'success'
  ): Promise<void> {
    await this.logEvent(
      nodeId,
      eventType,
      'Execution',
      details,
      status
    );
  }

  /**
   * Get audit events for a node
   */
  async getNodeAuditLog(
    nodeId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<AuditEvent[]> {
    // Implementation depends on database schema
    // return await db.getAuditEvents(nodeId, limit, offset);
    return [];
  }

  /**
   * Get audit events by type
   */
  async getAuditEventsByType(
    eventType: AuditEventType,
    limit: number = 100,
    offset: number = 0
  ): Promise<AuditEvent[]> {
    // Implementation depends on database schema
    // return await db.getAuditEventsByType(eventType, limit, offset);
    return [];
  }
}

export const auditService = new AuditService();
