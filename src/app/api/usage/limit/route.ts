import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireAdmin } from "@/auth/service";
import { usdToNanos } from "@/billing/pricing";
import { getDatabase, schema } from "@/db/client";
import { NotFoundError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";

const setLimitSchema = z.object({
  userId: z.uuid(),
  /** Null clears the override, putting the user back on the default. */
  limitUsd: z.number().min(0).max(100_000).nullable(),
});

/** Sets one user's monthly cap. Admins only. */
export async function PATCH(request: Request) {
  try {
    const { userId, limitUsd } = setLimitSchema.parse(await request.json());
    const admin = await requireAdmin();

    const updated = await getDatabase()
      .update(schema.users)
      .set({
        monthlyLimitNanos: limitUsd === null ? null : usdToNanos(limitUsd),
      })
      .where(eq(schema.users.id, userId))
      .returning({ id: schema.users.id, email: schema.users.email });

    if (updated.length === 0) throw new NotFoundError("User");

    logger.info("Monthly limit changed", {
      by: admin.email,
      user: updated[0].email,
      limitUsd,
    });

    return Response.json({ userId, limitUsd });
  } catch (error) {
    return toErrorResponse(error);
  }
}
