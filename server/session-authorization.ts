import type { NextFunction, Request, Response } from "express";
import { storage } from "./storage";

export async function revalidateSessionUser(req: Request, res: Response, next: NextFunction) {
  const sess = req.session;
  if (!sess?.user) return next();
  try {
    const principal = sess.realUser ?? sess.user;
    const currentPrincipal = await storage.getUser(principal.id);
    if (!currentPrincipal?.isActive) {
      return sess.destroy(() => res.status(401).json({ message: "Account is disabled or no longer exists" }));
    }

    const toSessionUser = (user: typeof currentPrincipal) => ({
      id: user.id,
      microsoftId: user.microsoftId || "",
      name: user.name,
      email: user.email,
      role: user.role,
      locationIds: user.locationIds,
    });

    if (sess.realUser) {
      sess.realUser = toSessionUser(currentPrincipal);
      if (currentPrincipal.role !== "admin") {
        sess.user = sess.realUser;
        delete sess.realUser;
        sess.isAuthenticated = true;
        return next();
      }
      const viewedUser = await storage.getUser(sess.user.id);
      if (!viewedUser?.isActive) {
        sess.user = sess.realUser;
        delete sess.realUser;
      } else {
        sess.user = toSessionUser(viewedUser);
      }
    } else {
      sess.user = toSessionUser(currentPrincipal);
    }
    sess.isAuthenticated = true;
    next();
  } catch (error) {
    next(error);
  }
}