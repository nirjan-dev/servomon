import { z } from "zod";
import { deleteEnrollRequest, getEnrollRequest, setEnrollRequest } from "../../utils/ticketStore";

// S1: operator-only. Denies a pending enrollment request.
const denySchema = z.object({ code: z.string().min(1).max(32) });

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, denySchema.safeParse);
  if (body.error) {
    throw createError({ statusCode: 400, message: "Invalid denial request", data: body.error.issues });
  }
  const record = getEnrollRequest(body.data.code);
  if (!record || record.status !== "pending") {
    deleteEnrollRequest(body.data.code);
    throw createError({ statusCode: 410, statusMessage: "Enrollment request not available" });
  }
  record.status = "denied";
  setEnrollRequest(record);
  return { status: "denied" as const };
});
