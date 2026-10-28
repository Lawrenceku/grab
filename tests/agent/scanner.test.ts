import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanProject } from '../../src/agent/scanner';

describe('agent/scanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-scanner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects presets via package.json dependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          stripe: '^14.0.0',
        },
      })
    );

    const result = scanProject({ rootDir: tmpDir });
    expect(result.matches.some((m) => m.preset.name === 'stripe')).toBe(true);
    const stripeMatch = result.matches.find((m) => m.preset.name === 'stripe')!;
    expect(stripeMatch.evidence.some((e) => e.includes('Found dependency "stripe"'))).toBe(true);
  });

  it('detects presets via env vars in source files', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'client.ts'),
      'const token = process.env.GITHUB_TOKEN;\nexport { token };\n'
    );

    const result = scanProject({ rootDir: tmpDir });
    expect(result.matches.some((m) => m.preset.name === 'github')).toBe(true);
    const githubMatch = result.matches.find((m) => m.preset.name === 'github')!;
    expect(
      githubMatch.evidence.some((e) => e.includes('Referenced environment variable GITHUB_TOKEN'))
    ).toBe(true);
    expect(result.detectedEnvVars).toContain('GITHUB_TOKEN');
  });

  it('detects presets via API URL patterns in source files', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'api.js'),
      'const url = "https://api.stripe.com/v1/customers";\n'
    );

    const result = scanProject({ rootDir: tmpDir });
    expect(result.matches.some((m) => m.preset.name === 'stripe')).toBe(true);
  });

  it('SECURITY INVARIANT: never reads .env files or leaks .env content', () => {
    const canarySecret = 'CANARY_DO_NOT_READ_MY_SECRET_987654';
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      `STRIPE_SECRET_KEY=${canarySecret}\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      `GITHUB_TOKEN=${canarySecret}\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.env.production'),
      `SECRET=${canarySecret}\n`
    );

    const result = scanProject({ rootDir: tmpDir });

    // The files scanned should NOT include .env files
    const resultString = JSON.stringify(result);
    expect(resultString).not.toContain(canarySecret);
    expect(result.detectedEnvVars).not.toContain('SECRET');
  });

  it('skips node_modules, dist, .git, and .next directories', () => {
    const nodeModulesDir = path.join(tmpDir, 'node_modules', 'some-pkg');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(nodeModulesDir, 'index.js'),
      'const key = process.env.STRIPE_SECRET_KEY;\n'
    );

    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'bundle.js'),
      'const key = process.env.GITHUB_TOKEN;\n'
    );

    const result = scanProject({ rootDir: tmpDir });
    expect(result.filesScanned).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it('skips files larger than maxFileSize', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    // Write 150KB file
    const largeContent = 'const x = process.env.GITHUB_TOKEN;\n' + ' '.repeat(150 * 1024);
    fs.writeFileSync(path.join(srcDir, 'large.ts'), largeContent);

    const result = scanProject({ rootDir: tmpDir, maxFileSize: 100 * 1024 });
    expect(result.filesScanned).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it('respects maxFiles limit', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(srcDir, `file${i}.ts`), `// file ${i}\n`);
    }

    const result = scanProject({ rootDir: tmpDir, maxFiles: 5 });
    expect(result.filesScanned).toBe(5);
  });

  it('skips symlinks that point outside the project directory', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-outside-test-'));
    try {
      fs.writeFileSync(
        path.join(outsideDir, 'secret.ts'),
        'const key = process.env.STRIPE_SECRET_KEY;\n'
      );

      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir);
      try {
        fs.symlinkSync(outsideDir, path.join(srcDir, 'outside-link'), 'dir');
      } catch {
        // Symlinks might require elevated privileges on some Windows setups
        return;
      }

      const result = scanProject({ rootDir: tmpDir });
      expect(result.detectedEnvVars).not.toContain('STRIPE_SECRET_KEY');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
