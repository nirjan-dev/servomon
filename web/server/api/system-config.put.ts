import { z } from "zod";

const systemConfigEditSchema = z.object({
  enableAlerts: z.boolean().optional(),
  system: z.string(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, systemConfigEditSchema.safeParse);

  if (body.error) {
    throw createError({
      statusCode: 400,
      data: body.error,
      message: "Invalid system config edit options",
    });
  }

  const storage = useStorage("systemConfigs");

  const { system, ...updatedConfig } = body.data;

  let systemConfig = (await storage.getItem<{ enableAlerts: boolean }>(
    system
  )) ?? {
    enableAlerts: false,
  };

  systemConfig = {
    ...systemConfig,
    ...updatedConfig,
  };

  try {
    await storage.setItem(system, systemConfig);
    return {
      statusCode: 200,
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: "Error updating system config",
      data: error,
    });
  }
});
