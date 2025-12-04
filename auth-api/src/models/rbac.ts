/**
 * Role-Based Access Control (RBAC) for Noderr Node Types
 * 
 * Defines roles and permissions for Validator, Guardian, and Oracle nodes
 */

export enum NodeRole {
  VALIDATOR = 'validator',
  GUARDIAN = 'guardian',
  ORACLE = 'oracle',
  ADMIN = 'admin',
}

export enum Permission {
  // Execution permissions
  EXECUTE_ORDERS = 'execute_orders',
  MANAGE_POSITIONS = 'manage_positions',
  MANAGE_RISK = 'manage_risk',
  
  // Data permissions
  READ_MARKET_DATA = 'read_market_data',
  READ_ANALYTICS = 'read_analytics',
  READ_PREDICTIONS = 'read_predictions',
  
  // Configuration permissions
  CONFIGURE_STRATEGY = 'configure_strategy',
  CONFIGURE_RISK_LIMITS = 'configure_risk_limits',
  CONFIGURE_MODELS = 'configure_models',
  
  // Administrative permissions
  MANAGE_NODES = 'manage_nodes',
  MANAGE_USERS = 'manage_users',
  VIEW_AUDIT_LOGS = 'view_audit_logs',
}

/**
 * Role-to-Permission mapping
 */
export const rolePermissions: Record<NodeRole, Permission[]> = {
  [NodeRole.VALIDATOR]: [
    Permission.EXECUTE_ORDERS,
    Permission.MANAGE_POSITIONS,
    Permission.READ_MARKET_DATA,
    Permission.READ_ANALYTICS,
  ],
  [NodeRole.GUARDIAN]: [
    Permission.EXECUTE_ORDERS,
    Permission.MANAGE_POSITIONS,
    Permission.MANAGE_RISK,
    Permission.READ_MARKET_DATA,
    Permission.READ_ANALYTICS,
    Permission.READ_PREDICTIONS,
    Permission.CONFIGURE_STRATEGY,
    Permission.CONFIGURE_RISK_LIMITS,
  ],
  [NodeRole.ORACLE]: [
    Permission.READ_MARKET_DATA,
    Permission.READ_ANALYTICS,
    Permission.READ_PREDICTIONS,
    Permission.CONFIGURE_MODELS,
  ],
  [NodeRole.ADMIN]: [
    // Admin has all permissions
    ...Object.values(Permission),
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: NodeRole, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: NodeRole, permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(role, permission));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: NodeRole, permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: NodeRole): Permission[] {
  return rolePermissions[role] ?? [];
}
