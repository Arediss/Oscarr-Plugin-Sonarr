/**
 * RBAC declarations for this plugin's routes. Without them Oscarr falls back to its
 * `/api/plugins/*` prefix default: reads open to any account, writes on admin.plugins.
 * Keep in sync with src/routes/*.ts — an undeclared write still fails closed and is logged.
 */

export const PERMISSION_VIEW = 'sonarr.view';
export const PERMISSION_MANAGE = 'sonarr.manage';

const PREFIX = '/api/plugins/sonarr';

/** Read-only surface. */
const VIEW_ROUTES = [
  'GET:/analytics',
  'GET:/quotas',
  'GET:/analytics/history',
  'GET:/blocklist',
  'GET:/command/:id',
  'GET:/episodes/:id',
  'GET:/profiles',
  'GET:/quality/cutoff-unmet',
  'GET:/queue',
  'GET:/releases',
  'GET:/rootfolders',
  'GET:/series',
  'GET:/series/:id',
  'GET:/series/:id/blocklist',
  'GET:/series/:id/episodes',
  'GET:/series/:id/history',
  'GET:/series/:id/queue',
  'GET:/series/:id/seasons',
  'GET:/series/:seriesId/files',
  'GET:/tags',
];

/** Mutates the service or files on disk. */
const MANAGE_ROUTES = [
  'PUT:/quotas',
  'DELETE:/blocklist/:id',
  'DELETE:/episodefile/:fileId',
  'DELETE:/queue/:id',
  'DELETE:/series/:id',
  'POST:/episodes/search',
  'POST:/history/failed/:id',
  'POST:/quality/search-bulk',
  'POST:/quality/search/:episodeId',
  'POST:/releases/grab',
  'POST:/series/:id/refresh',
  'POST:/series/:id/rename',
  'POST:/series/:id/search',
  'POST:/series/:id/seasons/:season/search',
  'POST:/series/invalidate-cache',
  'PUT:/episodes/monitor',
  'PUT:/series/:id/monitored',
  'PUT:/series/:id/seasons/:season/monitored',
  'PUT:/series/:id/tags',
];

interface PermissionRegistrar {
  registerPluginPermission(permission: string, description?: string): void;
  registerRoutePermission(routeKey: string, rule: { permission: string; ownerScoped?: boolean }): void;
}

/** First colon only — path params carry colons too. */
function qualify(key: string): string {
  const sep = key.indexOf(':');
  return `${key.slice(0, sep)}:${PREFIX}${key.slice(sep + 1)}`;
}

export function registerPermissions(ctx: PermissionRegistrar): void {
  ctx.registerPluginPermission(PERMISSION_VIEW, 'Browse the Sonarr library, seasons, queue and analytics');
  ctx.registerPluginPermission(PERMISSION_MANAGE, 'Search, grab, rename, unmonitor and delete Sonarr series, episodes and files');

  for (const key of VIEW_ROUTES) {
    ctx.registerRoutePermission(qualify(key), { permission: PERMISSION_VIEW });
  }
  for (const key of MANAGE_ROUTES) {
    ctx.registerRoutePermission(qualify(key), { permission: PERMISSION_MANAGE });
  }
}
