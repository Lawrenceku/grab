import {
  PRESETS,
  getPresets,
  getPreset,
  listPresetNames,
  createInstanceFromPreset,
} from '../../src/agent/presets';
import { validateConfig } from '../../src/agent/config';

describe('agent/presets', () => {
  describe('PRESETS registry', () => {
    it('contains stripe and github as v1 presets', () => {
      const names = listPresetNames();
      expect(names).toContain('stripe');
      expect(names).toContain('github');
      expect(names).toHaveLength(2);
    });

    it('enforces readOnly: true and GET-only methods for all v1 presets', () => {
      for (const preset of Object.values(PRESETS)) {
        expect(preset.readOnly).toBe(true);
        expect(preset.allow.methods).toEqual(['GET']);
        expect(preset.baseURL.startsWith('https://')).toBe(true);
      }
    });

    it('has correct baseURL and paths for stripe', () => {
      const stripe = getPreset('stripe');
      expect(stripe).toBeDefined();
      expect(stripe!.baseURL).toBe('https://api.stripe.com/v1');
      expect(stripe!.auth.type).toBe('bearer');
      expect(stripe!.auth.defaultEnv).toBe('STRIPE_SECRET_KEY');
      expect(stripe!.allow.paths).toContain('/customers');
      expect(stripe!.allow.paths).toContain('/customers/*');
    });

    it('has correct baseURL and paths for github', () => {
      const github = getPreset('github');
      expect(github).toBeDefined();
      expect(github!.baseURL).toBe('https://api.github.com');
      expect(github!.auth.type).toBe('bearer');
      expect(github!.auth.defaultEnv).toBe('GITHUB_TOKEN');
      expect(github!.allow.paths).toContain('/repos/*/*');
      expect(github!.allow.paths).toContain('/orgs/*');
      expect(github!.allow.paths).toContain('/user');
    });

    it('getPreset is case-insensitive', () => {
      expect(getPreset('Stripe')).toBeDefined();
      expect(getPreset('GITHUB')).toBeDefined();
      expect(getPreset('nonexistent')).toBeUndefined();
    });
  });

  describe('createInstanceFromPreset', () => {
    it('creates a valid instance config from a preset name', () => {
      const instance = createInstanceFromPreset('stripe');
      expect(instance.baseURL).toBe('https://api.stripe.com/v1');
      expect(instance.auth?.env).toBe('STRIPE_SECRET_KEY');
      expect(instance.readOnly).toBe(true);
      expect(instance.allow?.methods).toEqual(['GET']);

      // Validates successfully with validateConfig
      expect(() => validateConfig({ instances: { stripe: instance } })).not.toThrow();
    });

    it('creates a valid instance config from a preset object', () => {
      const preset = getPreset('github')!;
      const instance = createInstanceFromPreset(preset);
      expect(instance.baseURL).toBe('https://api.github.com');
      expect(instance.auth?.env).toBe('GITHUB_TOKEN');
      expect(() => validateConfig({ instances: { github: instance } })).not.toThrow();
    });

    it('applies custom envVar and limit overrides', () => {
      const instance = createInstanceFromPreset('stripe', {
        envVar: 'CUSTOM_STRIPE_KEY',
        rateLimitPerMin: 120,
        maxResponseBytes: 10000,
      });
      expect(instance.auth?.env).toBe('CUSTOM_STRIPE_KEY');
      expect(instance.rateLimitPerMin).toBe(120);
      expect(instance.maxResponseBytes).toBe(10000);
      expect(() => validateConfig({ instances: { stripe: instance } })).not.toThrow();
    });

    it('throws error for unknown preset', () => {
      expect(() => createInstanceFromPreset('unknown')).toThrow(/Unknown preset/);
    });
  });
});
