import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { seedDataDir } from "../src/utils/seedDataDir";

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("seedDataDir copies default data without overwriting user files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-seed-"));
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");

  writeFile(path.join(sourceDir, "skills", "default.md"), "default skill");
  writeFile(path.join(sourceDir, "skills", "custom.md"), "source custom");
  writeFile(path.join(sourceDir, "models", "all-MiniLM-L6-v2", "onnx", "model_fp16.onnx"), "model");
  writeFile(path.join(sourceDir, "vendor", "default.ts"), "vendor");
  writeFile(path.join(sourceDir, "modelPrompt", "video", "default.md"), "prompt");
  writeFile(path.join(sourceDir, "assets", "ending.mp4"), "asset");
  writeFile(path.join(sourceDir, "db2.sqlite"), "db");
  writeFile(path.join(sourceDir, "oss", "file.txt"), "oss");
  writeFile(path.join(sourceDir, "web", "index.html"), "web");
  writeFile(path.join(sourceDir, "serve", "app.js"), "serve");

  writeFile(path.join(targetDir, "skills", "custom.md"), "user custom");

  const result = seedDataDir({ sourceDir, targetDir });

  assert.equal(fs.readFileSync(path.join(targetDir, "skills", "default.md"), "utf8"), "default skill");
  assert.equal(fs.readFileSync(path.join(targetDir, "skills", "custom.md"), "utf8"), "user custom");
  assert.equal(fs.readFileSync(path.join(targetDir, "models", "all-MiniLM-L6-v2", "onnx", "model_fp16.onnx"), "utf8"), "model");
  assert.equal(fs.readFileSync(path.join(targetDir, "vendor", "default.ts"), "utf8"), "vendor");
  assert.equal(fs.readFileSync(path.join(targetDir, "modelPrompt", "video", "default.md"), "utf8"), "prompt");
  assert.equal(fs.readFileSync(path.join(targetDir, "assets", "ending.mp4"), "utf8"), "asset");
  assert.equal(fs.existsSync(path.join(targetDir, "db2.sqlite")), false);
  assert.equal(fs.existsSync(path.join(targetDir, "oss", "file.txt")), false);
  assert.equal(fs.existsSync(path.join(targetDir, "web", "index.html")), false);
  assert.equal(fs.existsSync(path.join(targetDir, "serve", "app.js")), false);
  assert.equal(result.copiedFiles, 5);
});
