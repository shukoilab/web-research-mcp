/**
 * @purpose Unit test suite validating automated SemVer derivation, Conventional Commit parsing, and multi-file synchronization.
 * @rationale Guarantees zero regression in release arithmetic, fork isolation, and multi-file synchronization contracts.
 * @preconditions Temporary directory access for mocked workspace synchronization tests.
 * @invariants Mutation-proof assertions asserting exact state transitions without mocking business logic.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  determineBumpType,
  incrementSemVer,
  parseSemVer,
  runBump,
  syncVersionAcrossFiles,
} from '../scripts/bump-version.js';

describe('Automated SemVer Calculation & Release Synchronization', () => {
  describe('parseSemVer', () => {
    it('decomposes canonical SemVer strings into numerical records', () => {
      expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(parseSemVer('v2.0.1')).toEqual({ major: 2, minor: 0, patch: 1 });
      expect(parseSemVer('0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 });
      expect(parseSemVer('10.25.99')).toEqual({ major: 10, minor: 25, patch: 99 });
    });

    it('throws typed error on malformed or non-SemVer strings', () => {
      expect(() => parseSemVer('1.2')).toThrow('Invalid semantic version');
      expect(() => parseSemVer('invalid')).toThrow('Invalid semantic version');
      expect(() => parseSemVer('1.2.3.4')).toThrow('Invalid semantic version');
      expect(() => parseSemVer('')).toThrow('Invalid semantic version');
    });
  });

  describe('incrementSemVer', () => {
    it('correctly calculates major increments and resets minor/patch', () => {
      expect(incrementSemVer('1.2.3', 'major')).toBe('2.0.0');
      expect(incrementSemVer('0.5.9', 'major')).toBe('1.0.0');
    });

    it('correctly calculates minor increments and resets patch', () => {
      expect(incrementSemVer('1.2.3', 'minor')).toBe('1.3.0');
      expect(incrementSemVer('2.0.5', 'minor')).toBe('2.1.0');
    });

    it('correctly calculates patch increments preserving major/minor', () => {
      expect(incrementSemVer('1.2.3', 'patch')).toBe('1.2.4');
      expect(incrementSemVer('2.0.0', 'patch')).toBe('2.0.1');
    });
  });

  describe('determineBumpType Conventional Commits Evaluation', () => {
    it('returns major on breaking change marker in header or body', () => {
      expect(determineBumpType(['feat!: breaking change to browser config'])).toBe('major');
      expect(determineBumpType(['fix(core)!: change public action signature'])).toBe('major');
      expect(
        determineBumpType([
          'refactor: overhaul architecture\n\nBREAKING CHANGE: dropped node 18 support',
        ]),
      ).toBe('major');
    });

    it('returns minor on new feature commits without breaking changes', () => {
      expect(determineBumpType(['feat: add google dorking support'])).toBe('minor');
      expect(determineBumpType(['feat(actions): add new search filter (#15)'])).toBe('minor');
    });

    it('returns patch on bugfix, performance, and refactoring commits', () => {
      expect(determineBumpType(['fix: prevent memory leak on tab recycling'])).toBe('patch');
      expect(determineBumpType(['perf: accelerate selector hydration'])).toBe('patch');
      expect(determineBumpType(['refactor: streamline entrypoint handlers'])).toBe('patch');
      expect(determineBumpType(['revert: undo previous commit'])).toBe('patch');
    });

    it('returns none when commits only contain chores, docs, or tests', () => {
      expect(determineBumpType(['docs: update readme with docker examples'])).toBe('none');
      expect(determineBumpType(['chore: update dev dependencies'])).toBe('none');
      expect(determineBumpType(['test: expand integration coverage'])).toBe('none');
      expect(determineBumpType(['ci: improve cache configuration'])).toBe('none');
      expect(determineBumpType([''])).toBe('none');
      expect(determineBumpType([])).toBe('none');
    });

    it('respects precedence hierarchy: major > minor > patch', () => {
      expect(
        determineBumpType([
          'docs: update guide',
          'fix: resolve typo',
          'feat: add new capability',
          'feat!: breaking overhaul',
        ]),
      ).toBe('major');

      expect(
        determineBumpType(['docs: update guide', 'fix: resolve typo', 'feat: add new capability']),
      ).toBe('minor');

      expect(
        determineBumpType(['docs: update guide', 'chore: format code', 'fix: resolve typo']),
      ).toBe('patch');
    });
  });

  describe('syncVersionAcrossFiles Multi-File Atomic Synchronization', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bump-test-'));
      // Setup mock files
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-pkg', version: '1.1.0' }, null, 2),
      );
      fs.writeFileSync(
        path.join(tempDir, 'server.json'),
        JSON.stringify(
          {
            version: '1.1.0',
            packages: [
              {
                registryType: 'oci',
                identifier: 'ghcr.io/shukoilab/web-research-mcp:1.1.0',
              },
            ],
          },
          null,
          2,
        ),
      );
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'src', 'config.ts'),
        `export const config = { serviceVersion: '1.1.0', port: 3000 };\n`,
      );
      fs.writeFileSync(
        path.join(tempDir, 'README.md'),
        `# MCP\n[![Version: 1.1.0](https://img.shields.io/badge/Version-1.1.0-blue.svg)](package.json)\nDocs\n`,
      );
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('atomically updates package.json, server.json, src/config.ts, and README.md', () => {
      const { updatedFiles } = syncVersionAcrossFiles('2.0.0', { cwd: tempDir, dryRun: false });
      expect(updatedFiles).toEqual(['package.json', 'server.json', 'src/config.ts', 'README.md']);

      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
      expect(pkg.version).toBe('2.0.0');

      const server = JSON.parse(fs.readFileSync(path.join(tempDir, 'server.json'), 'utf-8'));
      expect(server.version).toBe('2.0.0');
      expect(server.packages[0].identifier).toBe('ghcr.io/shukoilab/web-research-mcp:2.0.0');

      const configSrc = fs.readFileSync(path.join(tempDir, 'src', 'config.ts'), 'utf-8');
      expect(configSrc).toContain(`serviceVersion: '2.0.0'`);

      const readme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf-8');
      expect(readme).toContain(
        `[![Version: 2.0.0](https://img.shields.io/badge/Version-2.0.0-blue.svg)](package.json)`,
      );
    });

    it('respects dryRun flag and leaves disk files completely untouched', () => {
      const { updatedFiles } = syncVersionAcrossFiles('2.0.0', { cwd: tempDir, dryRun: true });
      expect(updatedFiles).toEqual(['package.json', 'server.json', 'src/config.ts', 'README.md']);

      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
      expect(pkg.version).toBe('1.1.0');

      const server = JSON.parse(fs.readFileSync(path.join(tempDir, 'server.json'), 'utf-8'));
      expect(server.version).toBe('1.1.0');
      expect(server.packages[0].identifier).toBe('ghcr.io/shukoilab/web-research-mcp:1.1.0');

      const configSrc = fs.readFileSync(path.join(tempDir, 'src', 'config.ts'), 'utf-8');
      expect(configSrc).toContain(`serviceVersion: '1.1.0'`);

      const readme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf-8');
      expect(readme).toContain(
        `[![Version: 1.1.0](https://img.shields.io/badge/Version-1.1.0-blue.svg)](package.json)`,
      );
    });

    it('executes runBump with explicit releaseType in dry-run mode', async () => {
      const result = await runBump({ cwd: tempDir, releaseType: 'minor', dryRun: true });
      expect(result.shouldRelease).toBe(true);
      expect(result.currentVersion).toBe('1.1.0');
      expect(result.newVersion).toBe('1.2.0');
      expect(result.bumpType).toBe('minor');
    });
  });
});
