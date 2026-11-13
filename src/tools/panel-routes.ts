/** Django routes that exist today. Panel list/status views are deeptrue-admin only. */

const PANEL_ROUTES: Record<string, Record<string, string>> = {
  cint: {
    status: 'cint/status/',
    demands: 'cint/demands/',
    audit: 'cint/audit/',
    'target-groups': 'cint/target-groups/',
  },
  bilendi: {
    projects: 'bilendi/projects/',
    audit: 'bilendi/audit/',
  },
  dynata: {
    status: 'dynata/status/',
    projects: 'dynata/projects/',
    audit: 'dynata/audit/',
  },
};

export function resolvePanelPath(provider: string, resource: string): string {
  const routes = PANEL_ROUTES[provider];
  const path = routes?.[resource];
  if (!path) {
    const allowed = routes ? Object.keys(routes).join(', ') : 'none';
    throw new Error(
      `No ${provider} route for '${resource}'. Allowed resources: ${allowed}. Panel routes that exist are limited to deeptrue admins.`,
    );
  }
  return path;
}

export function adminRouteError(error: unknown, route: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b403\b/.test(message)) {
    return new Error(
      `DeepTrue refused ${route} with 403. This route is limited to deeptrue admin users, so the call did not succeed.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}
