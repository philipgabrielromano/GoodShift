import type { Express, Request, Response } from "express";
import { openai } from "./client";

const ALLOWED_SIZES = ["256x256", "512x512", "1024x1024"] as const;
type ImageSize = (typeof ALLOWED_SIZES)[number];

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      if (!ALLOWED_SIZES.includes(size)) {
        return res.status(400).json({ error: "Invalid size. Allowed values: 256x256, 512x512, 1024x1024" });
      }

      const validatedSize: ImageSize = size;

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt.slice(0, 4000),
        n: 1,
        size: validatedSize,
      });

      const imageData = response.data[0];
      res.json({
        url: imageData.url,
        b64_json: imageData.b64_json,
      });
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}

