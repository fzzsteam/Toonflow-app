import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { getOssRootDir } from "../src/utils/ossPath";

const originalDataDir = process.env.DATA_DIR;
const originalOssMountDir = process.env.OSS_MOUNT_DIR;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;

  if (originalOssMountDir === undefined) delete process.env.OSS_MOUNT_DIR;
  else process.env.OSS_MOUNT_DIR = originalOssMountDir;
});

test("getOssRootDir uses OSS_MOUNT_DIR when configured", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-oss-root-"));
  const mountDir = path.join(root, "mounted-oss");
  process.env.DATA_DIR = path.join(root, "data");
  process.env.OSS_MOUNT_DIR = mountDir;

  assert.equal(getOssRootDir(), path.resolve(mountDir));
});

test("getOssRootDir falls back to DATA_DIR oss directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-data-root-"));
  const dataDir = path.join(root, "data");
  process.env.DATA_DIR = dataDir;
  delete process.env.OSS_MOUNT_DIR;

  assert.equal(getOssRootDir(), path.join(path.resolve(dataDir), "oss"));
});
