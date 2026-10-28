import fs from 'node:fs';
import path from 'node:path';

export type EnvName = 'SIT' | 'UAT';

export interface EnvConfig {
  name: EnvName;
  baseURL: string;
  /** Host of the OAM single sign-on server; landing here means the session is not authenticated. */
  ssoHost: string;
  /** Saved browser session for this environment (never committed). */
  storageStatePath: string;
}

const ROOT = path.resolve(__dirname, '..');

const ENVIRONMENTS: Record<EnvName, Omit<EnvConfig, 'storageStatePath'>> = {
  SIT: { name: 'SIT', baseURL: 'http://ngepsit.eperolehan.com.my', ssoHost: 'ngepsso.eperolehan.com.my' },
  UAT: { name: 'UAT', baseURL: 'http://ngepuat.eperolehan.com.my', ssoHost: 'ngepsso.eperolehan.com.my' },
};

/**
 * Resolve the target environment from TEST_ENV. There is deliberately no default:
 * an unset or unknown value stops the run so we never navigate to the wrong system.
 */
export function getEnv(): EnvConfig {
  const raw = (process.env.TEST_ENV ?? '').trim().toUpperCase();
  if (raw !== 'SIT' && raw !== 'UAT') {
    throw new Error(
      `TEST_ENV must be SIT or UAT (got "${raw || '<unset>'}"). ` +
        'Use "npm run test:sit" / "npm run test:uat". Production is not configured on purpose.',
    );
  }
  return { ...ENVIRONMENTS[raw], storageStatePath: path.join(ROOT, '.auth', `${raw.toLowerCase()}.json`) };
}

export function hasSavedSession(env: EnvConfig): boolean {
  return fs.existsSync(env.storageStatePath);
}
