/**
 * Built-in presets for grab agent HTTP instances.
 *
 * Presets provide safe-by-default configurations for popular APIs.
 * In v1, only read-only GET-compatible APIs (Stripe, GitHub) are included.
 */

import { InstanceConfig } from './types';
import { HttpMethods } from '../types';

export interface PresetAuth {
  type: 'bearer' | 'basic' | 'header';
  defaultEnv: string;
  headerName?: string;
}

export interface PresetDetect {
  packages?: string[];
  envVars?: string[];
  urls?: string[];
}

export interface Preset {
  name: string;
  displayName: string;
  description: string;
  baseURL: string;
  auth: PresetAuth;
  allow: {
    methods: HttpMethods[];
    paths: string[];
  };
  readOnly: boolean;
  detect: PresetDetect;
}

export interface PresetInstanceOptions {
  envVar?: string;
  allowMethods?: HttpMethods[];
  allowPaths?: string[];
  readOnly?: boolean;
  rateLimitPerMin?: number;
  maxResponseBytes?: number;
}

/** Built-in v1 presets. */
export const PRESETS: Record<string, Preset> = {
  stripe: {
    name: 'stripe',
    displayName: 'Stripe',
    description: 'Stripe API (read-only customers, charges, invoices, payment intents, balance)',
    baseURL: 'https://api.stripe.com/v1',
    auth: {
      type: 'bearer',
      defaultEnv: 'STRIPE_SECRET_KEY',
    },
    allow: {
      methods: ['GET'],
      paths: [
        '/customers',
        '/customers/*',
        '/charges',
        '/charges/*',
        '/invoices',
        '/invoices/*',
        '/payment_intents',
        '/payment_intents/*',
        '/balance',
        '/balance_transactions',
        '/balance_transactions/*',
      ],
    },
    readOnly: true,
    detect: {
      packages: ['stripe', '@stripe/stripe-js'],
      envVars: ['STRIPE_SECRET_KEY', 'STRIPE_API_KEY', 'STRIPE_KEY'],
      urls: ['api.stripe.com'],
    },
  },
  github: {
    name: 'github',
    displayName: 'GitHub',
    description: 'GitHub REST API (read-only repos, orgs, user info)',
    baseURL: 'https://api.github.com',
    auth: {
      type: 'bearer',
      defaultEnv: 'GITHUB_TOKEN',
    },
    allow: {
      methods: ['GET'],
      paths: [
        '/repos/*/*',
        '/orgs/*',
        '/user',
        '/users/*',
      ],
    },
    readOnly: true,
    detect: {
      packages: ['@octokit/core', '@octokit/rest', 'octokit'],
      envVars: ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT'],
      urls: ['api.github.com'],
    },
  },
};

/** Get all available presets. */
export function getPresets(): Record<string, Preset> {
  return { ...PRESETS };
}

/** Get a preset by name. */
export function getPreset(name: string): Preset | undefined {
  return PRESETS[name.toLowerCase()];
}

/** List all preset names. */
export function listPresetNames(): string[] {
  return Object.keys(PRESETS);
}

/**
 * Create an InstanceConfig from a preset with optional overrides.
 */
export function createInstanceFromPreset(
  presetOrName: Preset | string,
  options: PresetInstanceOptions = {}
): InstanceConfig {
  const preset = typeof presetOrName === 'string' ? getPreset(presetOrName) : presetOrName;
  if (!preset) {
    throw new Error(
      `Unknown preset "${presetOrName}". Available presets: ${listPresetNames().join(', ')}`
    );
  }

  const authConfig: InstanceConfig['auth'] = {
    type: preset.auth.type,
    env: options.envVar || preset.auth.defaultEnv,
    ...(preset.auth.headerName ? { headerName: preset.auth.headerName } : {}),
  };

  const instance: InstanceConfig = {
    baseURL: preset.baseURL,
    auth: authConfig,
    allow: {
      methods: options.allowMethods ? [...options.allowMethods] : [...preset.allow.methods],
      paths: options.allowPaths ? [...options.allowPaths] : [...preset.allow.paths],
    },
    readOnly: options.readOnly !== undefined ? options.readOnly : preset.readOnly,
  };

  if (options.rateLimitPerMin !== undefined) {
    instance.rateLimitPerMin = options.rateLimitPerMin;
  }
  if (options.maxResponseBytes !== undefined) {
    instance.maxResponseBytes = options.maxResponseBytes;
  }

  return instance;
}
