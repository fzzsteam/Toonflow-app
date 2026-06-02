import isPathInside from "is-path-inside";
import { isEletron } from "@/utils/getPath";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getOssRootDir } from "@/utils/ossPath";

/**
 * 规范化用户传入的相对路径：
 * 1. 去除前导斜杠
 * 2. 剥离可能混入的 URL 前缀（oss/、smallImage/），防止路径累积污染
 * 3. 统一转为本机路径分隔符
 */
function normalizeUserPath(userPath: string): string {
  let trimmedPath = userPath.replace(/^[/\\]+/, "");
  // 循环剥离 oss/ 和 smallImage/ 前缀，防止已污染路径（如 "oss/oss/oss/..."）继续叠加
  let prev: string;
  do {
    prev = trimmedPath;
    trimmedPath = trimmedPath.replace(/^(oss\/|smallImage\/)+/i, "");
  } while (trimmedPath !== prev);
  return trimmedPath.split("/").join(path.sep);
}

function resolveSafeLocalPath(userPath: string, rootDir: string): string {
  const safePath = normalizeUserPath(userPath);
  const absPath = path.join(rootDir, safePath);
  if (!isPathInside(absPath, rootDir)) {
    throw new Error(`${userPath} 不在 OSS 根目录内`);
  }
  return absPath;
}

class OSS {
  private rootDir: string;
  private initPromise: Promise<void>;

  constructor() {
    this.rootDir = getOssRootDir();
    this.initPromise = fs.mkdir(this.rootDir, { recursive: true }).then(() => {});
  }

  private async ensureInit() {
    await this.initPromise;
  }

  /**
   * 返回文件访问 URL。
   */
  async getFileUrl(userRelPath: string, prefix?: string): Promise<string> {
    if (!prefix) prefix = "oss";
    await this.ensureInit();
    const safePath = normalizeUserPath(userRelPath);
    let url = `/${prefix}/`;
    if (process.env.NODE_ENV == "dev") url = `http://localhost:10588/${prefix}/`;
    if (isEletron()) url = `http://localhost:${process.env.PORT}/${prefix}/`;
    return `${url}${safePath.split(path.sep).join("/")}`;
  }

  /**
   * 读取文件内容为 Buffer。
   */
  async getFile(userRelPath: string): Promise<Buffer> {
    await this.ensureInit();
    return fs.readFile(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  /**
   * 读取图片文件并转换为 base64 Data URL。
   */
  async getImageBase64(userRelPath: string): Promise<string> {
    const ext = path.extname(userRelPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".tiff": "image/tiff",
      ".tif": "image/tiff",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
    };
    const mimeType = mimeTypes[ext];
    if (!mimeType) {
      throw new Error(`不支持的图片格式: ${ext}。支持的格式: ${Object.keys(mimeTypes).join(", ")}`);
    }
    const data = await this.getFile(userRelPath);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  }

  /**
   * 删除指定路径的文件。
   */
  async deleteFile(userRelPath: string): Promise<void> {
    await this.ensureInit();
    await fs.unlink(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  /**
   * 删除指定路径的目录及其所有内容。
   */
  async deleteDirectory(userRelPath: string): Promise<void> {
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) {
      throw new Error(`${userRelPath} 不是文件夹`);
    }
    await fs.rm(absPath, { recursive: true, force: true });
  }

  /**
   * 将数据写入文件（已存在则覆盖）。
   * string 参数视为 base64，自动去除 Data URL 前缀。
   */
  async writeFile(userRelPath: string, data: Buffer | string): Promise<void> {
    const buffer =
      typeof data === "string"
        ? Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64")
        : data;
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
  }

  /**
   * 检查文件是否存在。
   */
  async fileExists(userRelPath: string): Promise<boolean> {
    await this.ensureInit();
    try {
      const stat = await fs.stat(resolveSafeLocalPath(userRelPath, this.rootDir));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * 获取图片缩略图 URL（最长边不超过 512px）。
   * 缩略图路径：smallImage/{relPath}。
   */
  async getSmallImageUrl(userRelPath: string): Promise<string> {
    // 先对输入路径做规范化清洗，防止已污染路径在缩略图子路径中继续累积
    const cleanedRelPath = normalizeUserPath(userRelPath);
    const smallImageRelPath = `smallImage/${cleanedRelPath}`;

    if (await this.fileExists(smallImageRelPath)) {
      return this.getFileUrl(smallImageRelPath);
    }

    const originalUrl = await this.getFileUrl(userRelPath);

    try {
      const srcBuffer = await this.getFile(userRelPath);

      const thumbBuffer = await sharp(srcBuffer)
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .toBuffer();

      await this.writeFile(smallImageRelPath, thumbBuffer);
      console.info(`[OSS] 缩略图生成成功: ${smallImageRelPath}`);
      return this.getFileUrl(smallImageRelPath);
    } catch (e) {
      console.warn("[OSS] 生成缩略图失败:", e);
      return originalUrl;
    }
  }
}

export default new OSS();
