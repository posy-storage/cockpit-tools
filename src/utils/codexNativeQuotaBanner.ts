import { CODEX_API_SERVICE_BIND_ID, type InstanceLaunchMode } from '../types/instance';

/** A saved user choice wins; otherwise only API Service desktop launches opt in. */
export function resolveNativeQuotaBannerPreference(
  preference: boolean | null | undefined,
  bindAccountId: string | null | undefined,
  launchMode: InstanceLaunchMode = 'app',
): boolean {
  return preference ?? (launchMode === 'app' && bindAccountId === CODEX_API_SERVICE_BIND_ID);
}
