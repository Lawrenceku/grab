import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('mcp CLI binary', () => {
  let tmpDir: string;
  let configPath: string;
  const mcpBin = path.resolve(__dirname, '../../mcp/index.js');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-cli-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore transient Windows file locking during test teardown
    }
  });

  function runGrabMcp(args: string[]) {
    return spawnSync(process.execPath, [mcpBin, ...args], {
      encoding: 'utf8',
      cwd: tmpDir,
      env: { ...process.env, GRAB_MCP_CONFIG: configPath },
    });
  }

  describe('help and usage', () => {
    it('displays help when invoked with --help', () => {
      const res = runGrabMcp(['--help']);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('grab-mcp — Model Context Protocol');
      expect(res.stdout).toContain('init');
      expect(res.stdout).toContain('doctor');
      expect(res.stdout).toContain('add <preset>');
    });

    it('displays help when invoked with -h', () => {
      const res = runGrabMcp(['-h']);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('grab-mcp — Model Context Protocol');
    });

    it('starts MCP stdio server when invoked with no arguments (backward compatibility)', (done) => {
      const { spawn } = require('node:child_process');
      const proc = spawn(process.execPath, [mcpBin], {
        cwd: tmpDir,
        env: { ...process.env, GRAB_MCP_CONFIG: configPath },
      });

      let stderrOutput = '';
      proc.stderr.on('data', (data: any) => {
        stderrOutput += data.toString();
        if (stderrOutput.includes('[grab-mcp] Server running on stdio')) {
          proc.on('close', () => done());
          proc.kill();
        }
      });

      proc.on('error', done);
      proc.on('exit', () => {
        if (!stderrOutput.includes('[grab-mcp] Server running on stdio')) {
          done(new Error(`Server did not start on stdio. Stderr: ${stderrOutput}`));
        }
      });
    });
  });

  describe('add command', () => {
    it('adds a built-in preset to the config file with 0o600 permissions', () => {
      const res = runGrabMcp(['add', 'stripe', '--config', configPath]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Added "Stripe" instance');

      expect(fs.existsSync(configPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(content.instances.stripe).toBeDefined();
      expect(content.instances.stripe.baseURL).toBe('https://api.stripe.com/v1');
      expect(content.instances.stripe.auth.env).toBe('STRIPE_SECRET_KEY');
      expect(content.instances.stripe.readOnly).toBe(true);
      expect(content.instances.stripe.allow.methods).toEqual(['GET']);

      // File-mode bits are only meaningful on POSIX; Windows always reports 0o666
      if (process.platform !== 'win32') {
        const mode = fs.statSync(configPath).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });

    it('supports custom env var via --env flag', () => {
      const res = runGrabMcp(['add', 'github', '--env', 'MY_GH_PAT', '--config', configPath]);
      expect(res.status).toBe(0);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(content.instances.github).toBeDefined();
      expect(content.instances.github.auth.env).toBe('MY_GH_PAT');
    });

    it('rejects unknown preset names with non-zero exit code', () => {
      const res = runGrabMcp(['add', 'unknown_preset', '--config', configPath]);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Unknown preset "unknown_preset"');
    });
  });

  describe('list command', () => {
    it('reports when config file does not exist', () => {
      const missingPath = path.join(tmpDir, 'nonexistent.json');
      const res = runGrabMcp(['list', '--config', missingPath]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('No configuration file found');
    });

    it('lists configured instances and safe policy details', () => {
      runGrabMcp(['add', 'stripe', '--config', configPath]);
      runGrabMcp(['add', 'github', '--config', configPath]);

      const res = runGrabMcp(['list', '--config', configPath]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('stripe');
      expect(res.stdout).toContain('https://api.stripe.com/v1');
      expect(res.stdout).toContain('github');
      expect(res.stdout).toContain('https://api.github.com');
      expect(res.stdout).toContain('Read-Only: true');
    });
  });

  describe('remove command', () => {
    it('removes an existing instance from config', () => {
      runGrabMcp(['add', 'stripe', '--config', configPath]);
      runGrabMcp(['add', 'github', '--config', configPath]);

      const res = runGrabMcp(['remove', 'stripe', '--config', configPath]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Removed instance "stripe"');

      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(content.instances.stripe).toBeUndefined();
      expect(content.instances.github).toBeDefined();
    });

    it('reports error when removing non-existent instance', () => {
      runGrabMcp(['add', 'stripe', '--config', configPath]);
      const res = runGrabMcp(['remove', 'nonexistent', '--config', configPath]);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Instance "nonexistent" not found in config.');
    });
  });

  describe('doctor command', () => {
    it('reports FAIL when config file is missing', () => {
      const missingPath = path.join(tmpDir, 'missing.json');
      const res = runGrabMcp(['doctor', '--config', missingPath]);
      expect(res.status).not.toBe(0);
      expect(res.stdout).toContain('[FAIL] Config file not found');
    });

    it('reports PASS when config file is valid and notes env status informatively', () => {
      runGrabMcp(['add', 'stripe', '--config', configPath]);

      const res = runGrabMcp(['doctor', '--config', configPath]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('[PASS] Config file found');
      expect(res.stdout).toContain('[PASS] Config schema validation succeeded');
      expect(res.stdout).toContain('doctor can only check the current environment');
    });
  });

  describe('init command', () => {
    it('runs non-interactively with --yes and sets up configuration', () => {
      const res = runGrabMcp(['init', '--yes', '--config', configPath]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Successfully configured grab-mcp!');
      expect(res.stdout).toContain('mcpServers');

      expect(fs.existsSync(configPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(Object.keys(content.instances).length).toBeGreaterThan(0);
    });

    it('supports specific preset via --preset flag', () => {
      const res = runGrabMcp([
        'init',
        '--preset',
        'github',
        '--env',
        'CUSTOM_GH_TOKEN',
        '--config',
        configPath,
      ]);
      expect(res.status).toBe(0);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(content.instances.github).toBeDefined();
      expect(content.instances.github.auth.env).toBe('CUSTOM_GH_TOKEN');
    });
  });
});
