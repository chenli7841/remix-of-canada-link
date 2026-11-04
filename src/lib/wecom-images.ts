import { z } from 'zod';
export const wecomImageSchema = z.object({
  path: z.string().regex(/^wecom-notify\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i),
  name: z.string().min(1).max(180),
});
export const wecomImagesSchema = z.array(wecomImageSchema).max(9);
export type WecomImage = z.infer<typeof wecomImageSchema>;
