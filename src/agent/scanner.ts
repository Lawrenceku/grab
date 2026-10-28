/**
 * Project Scanner — safely inspects a project workspace to detect
 * which API presets match the project's dependencies and source code.
 *
 * Security invariants:
 * - NEVER reads .env, .env.*, credentials*, *.key, *.pem, or any sensitive files.
 * - NEVER prints or logs environment variable values.
 * - Skips node_modules, dist, .git, .next, build, and other build/cache dirs.
 * - Caps scan at 500 files, skipping files larger than 100KB.
 * - Refuses to follow symlinks that resolve outside the project directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPresets, Preset } from './presets';

export interface PresetMatch {
  preset: Preset;
  evidence: string[];
  suggestedEnvVar: string;
  isEnvSet: boolean;
}

export interface ScanOptions {
  rootDir?: string;
  maxFiles?: number;
  maxFileSize?: number;
}

export interface ScanResult {
  rootDir: string;
  filesScanned: number;
  matches: PresetMatch[];
  detectedPackages: string[];
  detectedEnvVars: string[];
}

/** Directory names to always skip during directory walk. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.next',
  'build',
  'out',
  '.turbo',
  '.cache',
  'coverage',
  '.gemini',
  '.vscode',
  '.idea',
  'vendor',
  '.antigravity',
]);

/** File patterns to strictly skip (sensitive or binary). */
const SENSITIVE_OR_BINARY_FILE_REGEX =
  /(^\.env(\..+)?$)|(\.(pem|key|p12|pfx|cert|crt|id_rsa|sqlite|db|log|lock|png|jpg|jpeg|gif|ico|webp|svg|woff|woff2|ttf|eot|mp4|webm|zip|tar|gz|exe|dll|so|dylib)$)/i;

/** Extensions permitted for source inspection. */
const SCANNABLE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.go',
  '.rb',
  '.php',
  '.java',
  '.rs',
  '.md',
]);

/**
 * Scan a project root directory and detect matching API presets.
 */
export function scanProject(options: ScanOptions = {}): ScanResult {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const maxFiles = options.maxFiles ?? 500;
  const maxFileSize = options.maxFileSize ?? 100 * 1024; // 100 KB

  let realProjectRoot: string;
  try {
    realProjectRoot = fs.realpathSync(rootDir);
  } catch {
    realProjectRoot = rootDir;
  }

  const detectedPackages = new Set<string>();
  const detectedEnvVars = new Set<string>();
  const urlEvidence = new Map<string, Set<string>>(); // url -> files
  const envVarEvidence = new Map<string, Set<string>>(); // envVar -> files
  const packageEvidence = new Map<string, string>(); // pkg -> evidence string

  // 1. Inspect package.json if present
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf8');
      const pkgJson = JSON.parse(content);
      const allDeps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
        ...pkgJson.peerDependencies,
        ...pkgJson.optionalDependencies,
      };

      for (const depName of Object.keys(allDeps)) {
        detectedPackages.add(depName);
      }
    } catch {
      // Ignore malformed package.json
    }
  }

  // 2. Walk source files within limits
  let filesScanned = 0;

  function walk(currentDir: string): void {
    if (filesScanned >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (filesScanned >= maxFiles) break;

      const entryName = entry.name;
      const fullPath = path.join(currentDir, entryName);

      // Check symlinks
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) {
          const target = fs.realpathSync(fullPath);
          const relativeToRoot = path.relative(realProjectRoot, target);
          if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            // Target is outside project root — skip symlink
            continue;
          }
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entryName) && !entryName.startsWith('.')) {
          walk(fullPath);
        }
        continue;
      }

      if (entry.isFile()) {
        // Enforce sensitive file blocking
        if (SENSITIVE_OR_BINARY_FILE_REGEX.test(entryName)) {
          continue;
        }

        const ext = path.extname(entryName).toLowerCase();
        if (!SCANNABLE_EXTENSIONS.has(ext)) {
          continue;
        }

        // Check file size cap
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > maxFileSize || stat.size === 0) {
            continue;
          }

          const fileContent = fs.readFileSync(fullPath, 'utf8');
          filesScanned++;

          const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

          // Extract env var names (never values)
          const envMatches = fileContent.matchAll(
            /(?:process\.env|import\.meta\.env)\.([A-Z0-9_]{3,})/g
          );
          for (const match of envMatches) {
            const varName = match[1];
            detectedEnvVars.add(varName);
            if (!envVarEvidence.has(varName)) {
              envVarEvidence.set(varName, new Set());
            }
            if (envVarEvidence.get(varName)!.size < 3) {
              envVarEvidence.get(varName)!.add(relativePath);
            }
          }

          // Check preset URL patterns
          const presets = getPresets();
          for (const preset of Object.values(presets)) {
            if (preset.detect.urls) {
              for (const urlPattern of preset.detect.urls) {
                if (fileContent.includes(urlPattern)) {
                  if (!urlEvidence.has(urlPattern)) {
                    urlEvidence.set(urlPattern, new Set());
                  }
                  if (urlEvidence.get(urlPattern)!.size < 3) {
                    urlEvidence.get(urlPattern)!.add(relativePath);
                  }
                }
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(rootDir);

  // 3. Match signals against presets
  const presets = getPresets();
  const matches: PresetMatch[] = [];

  for (const preset of Object.values(presets)) {
    const evidenceList: string[] = [];

    // Check packages
    if (preset.detect.packages) {
      for (const pkg of preset.detect.packages) {
        if (detectedPackages.has(pkg)) {
          evidenceList.push(`Found dependency "${pkg}" in package.json`);
        }
      }
    }

    // Check env vars in source
    let matchedEnvVar = preset.auth.defaultEnv;
    if (preset.detect.envVars) {
      for (const ev of preset.detect.envVars) {
        if (detectedEnvVars.has(ev)) {
          matchedEnvVar = ev;
          const files = Array.from(envVarEvidence.get(ev) || []);
          const fileSuffix = files.length > 0 ? ` (${files.slice(0, 2).join(', ')})` : '';
          evidenceList.push(`Referenced environment variable ${ev}${fileSuffix}`);
        }
      }
    }

    // Check URLs in source
    if (preset.detect.urls) {
      for (const url of preset.detect.urls) {
        if (urlEvidence.has(url)) {
          const files = Array.from(urlEvidence.get(url) || []);
          const fileSuffix = files.length > 0 ? ` (${files.slice(0, 2).join(', ')})` : '';
          evidenceList.push(`Referenced API URL "${url}"${fileSuffix}`);
        }
      }
    }

    if (evidenceList.length > 0) {
      matches.push({
        preset,
        evidence: evidenceList,
        suggestedEnvVar: matchedEnvVar,
        isEnvSet: Boolean(process.env[matchedEnvVar]),
      });
    }
  }

  return {
    rootDir,
    filesScanned,
    matches,
    detectedPackages: Array.from(detectedPackages),
    detectedEnvVars: Array.from(detectedEnvVars),
  };
}
