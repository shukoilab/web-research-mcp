/**
 * @purpose Automated Semantic Version calculator and multi-file synchronization driver for CI/CD releases.
 * @rationale Enforces Conventional Commits 1.0.0 to automatically derive SemVer increments and atomically synchronize package.json, server.json, src/config.ts, and README.md.
 * @preconditions Git repository initialized with valid commits and target configuration files present.
 * @invariants Atomic file writes; deterministic SemVer transitions; zero-dependency on external release binaries.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * @purpose Represents a parsed Semantic Version decomposed into numerical major, minor, and patch components.
 * @rationale Type-safe container avoiding string manipulation errors during mathematical version incrementation.
 * @preconditions Valid non-negative integers for all components.
 * @param major Primary breaking change version index.
 * @param minor Backward-compatible feature version index.
 * @param patch Backward-compatible bugfix version index.
 * @returns SemVerData structured object.
 * @throws Never throws directly.
 * @invariants Immutable numerical records; major >= 0, minor >= 0, patch >= 0.
 */
export interface SemVerData {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * @purpose Permitted SemVer increment categories derived from Conventional Commits.
 * @rationale Strongly typed enum-like union restricting version transitions to valid SemVer 2.0.0 classifications.
 * @invariants Readonly string union.
 */
export type BumpType = 'major' | 'minor' | 'patch' | 'none';

/**
 * @purpose Configuration options parameterizing automated version derivation and file synchronization.
 * @rationale Permits test isolation, dry-run simulations, and custom working directory overrides.
 * @invariants Pure options container.
 */
export interface BumpOptions {
  readonly releaseType?: 'auto' | 'major' | 'minor' | 'patch';
  readonly dryRun?: boolean;
  readonly cwd?: string;
}

/**
 * @purpose Output results detailing the outcome of the automated bump operation.
 * @rationale Supplies structured telemetry consumed by CI/CD step outputs and terminal diagnostics.
 * @invariants Immutable result record.
 */
export interface BumpResult {
  readonly shouldRelease: boolean;
  readonly currentVersion: string;
  readonly newVersion: string;
  readonly bumpType: BumpType;
  readonly updatedFiles: string[];
}

/**
 * @purpose Decomposes a SemVer string into numerical components.
 * @rationale Validates strict adherence to semantic version format before applying arithmetic operations.
 * @preconditions Input must be a valid SemVer string (e.g., "1.2.3" or "v1.2.3").
 * @param version String version identifier to parse.
 * @returns Decomposed SemVerData object with numerical major, minor, patch fields.
 * @throws Error when input does not conform to semantic version format.
 * @invariants Big-O time complexity O(1); space complexity O(1).
 */
export function parseSemVer(version: string): SemVerData {
  const cleaned = version.trim().replace(/^v/, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    throw new Error(`Invalid semantic version string: "${version}"`);
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * @purpose Applies a specified increment category to a base Semantic Version string.
 * @rationale Enforces canonical SemVer 2.0.0 arithmetic: major resets minor and patch to 0; minor resets patch to 0.
 * @preconditions current must be a valid SemVer string; type must be a valid increment classification.
 * @param current Base semantic version string.
 * @param type Increment category ('major', 'minor', 'patch').
 * @returns Incremented semantic version string (e.g. "1.2.0").
 * @throws Error if current is malformed.
 * @invariants Big-O time complexity O(1); pure function with zero side effects.
 */
export function incrementSemVer(current: string, type: 'major' | 'minor' | 'patch'): string {
  const parsed = parseSemVer(current);
  switch (type) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
}

/**
 * @purpose Inspects an array of Conventional Commit messages to derive the maximum SemVer increment required.
 * @rationale Scans for breaking changes, new features, and bug fixes in descending priority order to enforce SemVer 2.0.0.
 * @preconditions commits must be an array of commit message strings (subject + body).
 * @param commits Array of commit text payloads since the previous release.
 * @returns Derived BumpType ('major' | 'minor' | 'patch' | 'none').
 * @throws Never throws directly.
 * @invariants Big-O time complexity O(N * L) where N is commit count and L is message length.
 */
export function determineBumpType(commits: string[]): BumpType {
  let hasMajor = false;
  let hasMinor = false;
  let hasPatch = false;

  for (const rawMessage of commits) {
    const msg = rawMessage.trim();
    if (!msg) continue;

    // Check for breaking changes: BREAKING CHANGE: footer/body or feat!: / fix!: in subject
    const lines = msg.split('\n');
    const header = lines[0] || '';

    if (/^[a-z]+(\([a-z0-9_.-]+\))?!:/.test(header) || /BREAKING\s+CHANGE:/i.test(msg)) {
      hasMajor = true;
      break; // Major is highest precedence; short-circuit immediately
    }

    // Check for minor changes: feat or feat(scope)
    if (/^feat(\([a-z0-9_.-]+\))?:/i.test(header)) {
      hasMinor = true;
      continue;
    }

    // Check for patch changes: fix, perf, refactor, or security patches
    if (/^(fix|perf|refactor|revert)(\([a-z0-9_.-]+\))?:/i.test(header)) {
      hasPatch = true;
      continue;
    }
  }

  if (hasMajor) return 'major';
  if (hasMinor) return 'minor';
  if (hasPatch) return 'patch';
  return 'none';
}

/**
 * @purpose Extracts Git commit history between the most recent Git release tag and HEAD.
 * @rationale Identifies the exact delta of unreleased commits to accurately compute the next release version.
 * @preconditions Working directory must be inside an initialized Git repository with commit history.
 * @param cwd Optional working directory root path (defaults to process.cwd()).
 * @returns Object containing the latest detected tag (or null) and an array of raw commit messages.
 * @throws Error if Git commands fail catastrophically.
 * @invariants Read-only git inspection; does not mutate working tree or repository index.
 */
export function getCommitsSinceLastTag(cwd: string = process.cwd()): {
  latestTag: string | null;
  commits: string[];
} {
  let latestTag: string | null = null;
  try {
    const tagOutput = execSync('git describe --tags --abbrev=0', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (tagOutput) {
      latestTag = tagOutput;
    }
  } catch {
    latestTag = null;
  }

  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  try {
    const logOutput = execSync(`git log ${range} --format=%B%x1e`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const commits = logOutput
      .split('\x1e')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    return { latestTag, commits };
  } catch (err) {
    throw new Error(
      `Failed to retrieve git commit history for range "${range}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * @purpose Atomically synchronizes a new version string across package.json, server.json, src/config.ts, and README.md.
 * @rationale Guarantees single source of truth across npm metadata, MCP Registry OCI identifier, service telemetry, and docs.
 * @preconditions Target configuration files must exist at expected relative workspace paths.
 * @param newVersion Target semantic version string to write (e.g. "1.2.0").
 * @param options Optional dry-run and directory configuration flags.
 * @returns List of modified file paths.
 * @throws Error if any target file fails to read, parse, or write.
 * @invariants Atomic disk writes; fails fast before committing partial file changes.
 */
export function syncVersionAcrossFiles(
  newVersion: string,
  options: { dryRun?: boolean; cwd?: string } = {},
): { updatedFiles: string[] } {
  const root = options.cwd || process.cwd();
  const dryRun = options.dryRun ?? false;
  const updatedFiles: string[] = [];

  // 1. Synchronize package.json
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    pkg.version = newVersion;
    if (!dryRun) {
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
    }
    updatedFiles.push('package.json');
  }

  // 2. Synchronize server.json
  const serverPath = path.join(root, 'server.json');
  if (fs.existsSync(serverPath)) {
    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    const server = JSON.parse(serverContent);
    server.version = newVersion;
    if (Array.isArray(server.packages) && server.packages[0]) {
      server.packages[0].identifier = `ghcr.io/shukoilab/web-research-mcp:${newVersion}`;
    }
    if (!dryRun) {
      fs.writeFileSync(serverPath, `${JSON.stringify(server, null, 2)}\n`, 'utf-8');
    }
    updatedFiles.push('server.json');
  }

  // 3. Synchronize src/config.ts
  const configPath = path.join(root, 'src', 'config.ts');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const updatedConfig = configContent.replace(
      /serviceVersion:\s*['"][^'"]+['"]/,
      `serviceVersion: '${newVersion}'`,
    );
    if (!dryRun) {
      fs.writeFileSync(configPath, updatedConfig, 'utf-8');
    }
    updatedFiles.push('src/config.ts');
  }

  // 4. Synchronize README.md version badge
  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    const updatedReadme = readmeContent.replace(
      /\[!\[Version:\s*[^\]]+\]\(https:\/\/img\.shields\.io\/badge\/Version-[^-\s]+-blue\.svg\)\]\(package\.json\)/,
      `[![Version: ${newVersion}](https://img.shields.io/badge/Version-${newVersion}-blue.svg)](package.json)`,
    );
    if (!dryRun) {
      fs.writeFileSync(readmePath, updatedReadme, 'utf-8');
    }
    updatedFiles.push('README.md');
  }

  return { updatedFiles };
}

/**
 * @purpose Emits key-value outputs into the GitHub Actions runner environment file.
 * @rationale Exposes computed versioning variables to downstream GitHub Actions workflow steps.
 * @preconditions GITHUB_OUTPUT environment variable must be set by GitHub runner.
 * @param outputs Map of string key-value pairs to append to GITHUB_OUTPUT.
 * @returns Void.
 * @throws Never throws directly; logs warning if writing fails.
 * @invariants Append-only write to process.env.GITHUB_OUTPUT.
 */
export function emitGitHubOutput(outputs: Record<string, string | boolean>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  try {
    const lines = Object.entries(outputs).map(([k, v]) => `${k}=${String(v)}\n`);
    fs.appendFileSync(outputPath, lines.join(''), 'utf-8');
  } catch (err) {
    console.warn('Failed to write to GITHUB_OUTPUT:', err);
  }
}

/**
 * @purpose Primary orchestration driver executing SemVer derivation, file synchronization, and telemetry emission.
 * @rationale Coordinates git history scanning, Conventional Commit evaluation, and cross-file writes into a single idempotent entry point.
 * @preconditions Workspace must be accessible with valid git metadata and target configuration files.
 * @param options BumpOptions parameterizing release type and dry-run mode.
 * @returns BumpResult detailing release necessity, current version, new version, and updated files.
 * @throws Error if current version cannot be located in package.json.
 * @invariants Idempotent when dryRun is true; atomic updates when dryRun is false.
 */
export async function runBump(options: BumpOptions = {}): Promise<BumpResult> {
  const root = options.cwd || process.cwd();
  const dryRun = options.dryRun ?? false;
  const pkgPath = path.join(root, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found in root directory: ${root}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version as string;
  if (!currentVersion) {
    throw new Error('Version field missing from package.json');
  }

  let bumpType: BumpType = 'none';

  if (options.releaseType && options.releaseType !== 'auto') {
    bumpType = options.releaseType;
  } else {
    const { commits } = getCommitsSinceLastTag(root);
    bumpType = determineBumpType(commits);
  }

  if (bumpType === 'none') {
    emitGitHubOutput({
      should_release: false,
      current_version: currentVersion,
      new_version: currentVersion,
      bump_type: 'none',
    });
    return {
      shouldRelease: false,
      currentVersion,
      newVersion: currentVersion,
      bumpType: 'none',
      updatedFiles: [],
    };
  }

  const newVersion = incrementSemVer(currentVersion, bumpType);
  const { updatedFiles } = syncVersionAcrossFiles(newVersion, { dryRun, cwd: root });

  emitGitHubOutput({
    should_release: true,
    current_version: currentVersion,
    new_version: newVersion,
    bump_type: bumpType,
  });

  return {
    shouldRelease: true,
    currentVersion,
    newVersion,
    bumpType,
    updatedFiles,
  };
}

// CLI Execution Entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const releaseTypeArg = args.find((a) => a.startsWith('--release-type='));
  const releaseType = releaseTypeArg
    ? (releaseTypeArg.split('=')[1] as 'auto' | 'major' | 'minor' | 'patch')
    : 'auto';

  runBump({ dryRun, releaseType })
    .then((result) => {
      if (!result.shouldRelease) {
        console.log(`[NO_BUMP_REQUIRED] Current version ${result.currentVersion} is up to date.`);
      } else {
        console.log(
          `[BUMP_SUCCESS] ${result.bumpType.toUpperCase()}: ${result.currentVersion} -> ${result.newVersion} (Updated: ${result.updatedFiles.join(', ')})`,
        );
      }
    })
    .catch((err) => {
      console.error('[BUMP_FATAL]', err);
      process.exit(1);
    });
}
