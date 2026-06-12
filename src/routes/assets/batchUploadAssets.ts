import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 批量上传本地图片作为资产
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    type: z.enum(["role", "scene", "tool"]),
    items: z.array(
      z.object({
        name: z.string(),
        base64: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, type, items } = req.body;

    for (const item of items) {
      const matches = item.base64.match(/^data:image\/\w+;base64,(.+)$/);
      const realBase64 = matches ? matches[1] : item.base64;
      const savePath = `/${projectId}/${type}/${uuidv4()}.png`;

      await u.oss.writeFile(savePath, Buffer.from(realBase64, "base64"));

      const [assetsId] = await u.db("o_assets").insert({
        name: item.name,
        describe: "",
        type,
        projectId,
        prompt: "",
        startTime: Date.now(),
      });

      const [imageId] = await u.db("o_image").insert({
        assetsId,
        filePath: savePath,
        type,
        state: "已完成",
      });

      await u.db("o_assets").where("id", assetsId).update({ imageId });
    }

    res.status(200).send(success({ message: "批量上传成功" }));
  },
);
