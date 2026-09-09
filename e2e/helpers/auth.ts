import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Page } from "@playwright/test";

export async function signInAs(page: Page, handle: string) {
  const user = await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    create: { email: `${handle}@example.test`, handle, name: handle },
    update: {},
  });

  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  return user;
}

export { prisma };
