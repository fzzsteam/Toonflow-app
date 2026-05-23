import path from "node:path";
import getPath from "@/utils/getPath";

export function getOssRootDir(): string {
  return path.resolve(process.env.OSS_MOUNT_DIR ?? getPath("oss"));
}
