import fs from "node:fs";
import path from "node:path";
import isPathInside from "is-path-inside";

const DEFAULT_SEED_ENTRIES = ["skills", "assets", "models", "modelPrompt", "vendor", "version.txt"];

export interface SeedDataDirOptions {
  sourceDir?: string;
  targetDir?: string;
  entries?: string[];
}

export interface SeedDataDirResult {
  copiedFiles: number;
}

function isSamePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function ensureInside(baseDir: string, targetPath: string) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !isPathInside(resolvedTarget, resolvedBase)) {
    throw new Error(`Seed target path escapes data directory: ${targetPath}`);
  }
}

function copyMissingRecursive(sourcePath: string, targetPath: string, targetRoot: string): number {
  if (!fs.existsSync(sourcePath)) return 0;
  ensureInside(targetRoot, targetPath);

  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    return fs.readdirSync(sourcePath).reduce((count, name) => {
      return count + copyMissingRecursive(path.join(sourcePath, name), path.join(targetPath, name), targetRoot);
    }, 0);
  }

  if (!stat.isFile() || fs.existsSync(targetPath)) return 0;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return 1;
}

export function seedDataDir(options: SeedDataDirOptions = {}): SeedDataDirResult {
  const sourceDir = path.resolve(options.sourceDir ?? path.join(process.cwd(), "data"));
  const targetDir = path.resolve(options.targetDir ?? process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
  const entries = options.entries ?? DEFAULT_SEED_ENTRIES;

  if (!fs.existsSync(sourceDir) || isSamePath(sourceDir, targetDir)) {
    return { copiedFiles: 0 };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const copiedFiles = entries.reduce((count, entry) => {
    return count + copyMissingRecursive(path.join(sourceDir, entry), path.join(targetDir, entry), targetDir);
  }, 0);

  if (copiedFiles > 0) {
    console.log(`[数据初始化] 已复制默认数据文件: ${copiedFiles}`);
  }

  return { copiedFiles };
}
