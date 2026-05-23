import isPathInside from "is-path-inside";
import getPath, { isEletron } from "@/utils/getPath";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AliOSS = require("ali-oss");

function normalizeUserPath(userPath: string): string {
  const trimmedPath = userPath.replace(/^[/\\]+/, "");
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

// 将相对路径转换为 OSS object key，例如 "abc/img.jpg" -> "oss/abc/img.jpg"
function toOssKey(relPath: string, prefix = "oss"): string {
  return `${prefix}/${normalizeUserPath(relPath).split(path.sep).join("/")}`;
}

class OSS {
  private useAliOss: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client?: any;
  private rootDir: string;
  private initPromise: Promise<void>;

  constructor() {
    this.useAliOss = !!process.env.OSS_BUCKET;
    if (this.useAliOss) {
      if (!process.env.OSS_REGION || !process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
        throw new Error(
          "OSS_BUCKET is set but OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET are missing"
        );
      }
      this.client = new AliOSS({
        region: process.env.OSS_REGION!,
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
        bucket: process.env.OSS_BUCKET!,
      });
      this.rootDir = "";
      this.initPromise = Promise.resolve();
    } else {
      this.rootDir = getPath("oss");
      this.initPromise = fs.mkdir(this.rootDir, { recursive: true }).then(() => {});
    }
  }

  private async ensureInit() {
    await this.initPromise;
  }

  /**
   * 返回文件访问 URL。
   * ali-oss 模式：返回 1 小时有效的签名 URL（Bucket 保持私有）。
   * 本地模式：与原实现相同。
   */
  async getFileUrl(userRelPath: string, prefix?: string): Promise<string> {
    if (!prefix) prefix = "oss";
    if (this.useAliOss) {
      const key = toOssKey(userRelPath, prefix);
      return this.client!.signatureUrl(key, { expires: 3600, method: "GET" }) as string;
    }
    await this.ensureInit();
    const safePath = normalizeUserPath(userRelPath);
    let url = `/${prefix}/`;
    if (process.env.ossURL && process.env.ossURL !== "") url = process.env.ossURL + `/${prefix}/`;
    if (process.env.NODE_ENV == "dev") url = `http://localhost:10588/${prefix}/`;
    if (isEletron()) url = `http://localhost:${process.env.PORT}/${prefix}/`;
    return `${url}${safePath.split(path.sep).join("/")}`;
  }

  /**
   * 读取文件内容为 Buffer。
   */
  async getFile(userRelPath: string): Promise<Buffer> {
    if (this.useAliOss) {
      const result = await this.client!.get(toOssKey(userRelPath));
      return result.content as Buffer;
    }
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
    if (this.useAliOss) {
      await this.client!.delete(toOssKey(userRelPath));
      return;
    }
    await this.ensureInit();
    await fs.unlink(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  /**
   * 删除指定路径的目录及其所有内容。
   * ali-oss 模式：列出该前缀下所有 object 并批量删除。
   */
  async deleteDirectory(userRelPath: string): Promise<void> {
    if (this.useAliOss) {
      const prefix = toOssKey(userRelPath) + "/";
      let marker: string | undefined;
      do {
        const result = await this.client!.list({ prefix, "max-keys": 1000, marker }, {});
        const objects: Array<{ name: string }> = result.objects || [];
        if (objects.length > 0) {
          await this.client!.deleteMulti(objects.map((o) => o.name));
        }
        marker = result.nextMarker;
      } while (marker);
      return;
    }
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
    if (this.useAliOss) {
      await this.client!.put(toOssKey(userRelPath), buffer);
      return;
    }
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
  }

  /**
   * 检查文件是否存在。
   */
  async fileExists(userRelPath: string): Promise<boolean> {
    if (this.useAliOss) {
      try {
        await this.client!.head(toOssKey(userRelPath));
        return true;
      } catch (e: any) {
        if (e?.status === 404 || e?.code === "NoSuchKey") return false;
        throw e;
      }
    }
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
   * ali-oss 模式：从 OSS 拉取原图，sharp 生成缩略图后上传 OSS。
   * 本地模式：与原实现相同，sharp 读写本地文件。
   */
  async getSmallImageUrl(userRelPath: string): Promise<string> {
    const smallImageRelPath = `smallImage/${userRelPath.replace(/^[/\\]+/, "")}`;

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
