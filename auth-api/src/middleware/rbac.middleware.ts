/**
 * RBAC Middleware for Fastify
 * 
 * Provides decorators and hooks for role-based access control
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { NodeRole, Permission, hasPermission, hasAnyPermission, hasAllPermissions } from '../models/rbac';

/**
 * Extended FastifyRequest with user context
 */
export interface UserContext {
  nodeId: string;
  role: NodeRole;
  tier: string;
}

export interface AuthenticatedRequest {
  user?: UserContext;
  [key: string]: any;
}

/**
 * Require a specific role
 */
export function requireRole(role: NodeRole) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    
    if (request.user.role !== role) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient role' });
    }
  };
}

/**
 * Require any of the specified roles
 */
export function requireAnyRole(roles: NodeRole[]) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient role' });
    }
  };
}

/**
 * Require a specific permission
 */
export function requirePermission(permission: Permission) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    
    if (!hasPermission(request.user.role, permission)) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient permissions' });
    }
  };
}

/**
 * Require any of the specified permissions
 */
export function requireAnyPermission(permissions: Permission[]) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    
    if (!hasAnyPermission(request.user.role, permissions)) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient permissions' });
    }
  };
}

/**
 * Require all of the specified permissions
 */
export function requireAllPermissions(permissions: Permission[]) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    
    if (!hasAllPermissions(request.user.role, permissions)) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient permissions' });
    }
  };
}
