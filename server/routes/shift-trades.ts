import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireManager, requireFeatureAccess, getNotificationEmails, TIMEZONE } from "../middleware";
import { sendTradeNotificationEmail } from "../outlook";
import type { Employee, Shift } from "@shared/schema";
import { ShiftTradeConflictError } from "../storage";
import { canManageEmployee } from "../access-control";

// An approver may act on a trade only when both parties are employees they
// manage (store scope plus the job-title hierarchy).
async function canManageTrade(user: any, requesterId: number, responderId: number | null): Promise<boolean> {
  const requester = await storage.getEmployee(requesterId);
  const responder = responderId ? await storage.getEmployee(responderId) : undefined;
  return !!requester && !!responder &&
    await canManageEmployee(user, requester) &&
    await canManageEmployee(user, responder);
}

// Rules a trade must satisfy both when it's requested and again when a
// manager approves it (time, staffing and assignments change in between).
// Returns a user-facing reason, or null if the trade is allowed.
async function checkTradeEligibility(
  requesterShift: Shift,
  responderShift: Shift,
  requester: Employee,
  responder: Employee,
): Promise<string | null> {
  if (!requester.isActive || !responder.isActive) {
    return "Both employees must be active to trade shifts";
  }
  if (!requester.location || requester.location !== responder.location) {
    return "Shifts can only be traded between employees at the same store";
  }
  const now = new Date();
  if (new Date(requesterShift.startTime) <= now || new Date(responderShift.startTime) <= now) {
    return "Shifts that have already started can't be traded";
  }
  // After the swap each employee works the other's shift; it must not
  // overlap anything else they're already scheduled for.
  const overlaps = async (employeeId: number, ownShiftId: number, incoming: Shift) => {
    const dayBefore = new Date(new Date(incoming.startTime).getTime() - 24 * 60 * 60 * 1000);
    const dayAfter = new Date(new Date(incoming.endTime).getTime() + 24 * 60 * 60 * 1000);
    const theirs = await storage.getShifts(dayBefore, dayAfter, employeeId);
    return theirs.some(s =>
      s.id !== ownShiftId &&
      new Date(s.startTime) < new Date(incoming.endTime) &&
      new Date(s.endTime) > new Date(incoming.startTime)
    );
  };
  if (await overlaps(requester.id, requesterShift.id, responderShift)) {
    return `${requester.name} is already scheduled during the shift they would take`;
  }
  if (await overlaps(responder.id, responderShift.id, requesterShift)) {
    return `${responder.name} is already scheduled during the shift they would take`;
  }
  return null;
}

export function registerShiftTradeRoutes(app: Express) {
  // ========== SHIFT TRADING ==========

  // GET /api/shift-trades - List shift trades (filter by employeeId, status)
  app.get("/api/shift-trades", requireFeatureAccess("shift_trades.view"), async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      const { userHasFeature } = await import("../middleware");
      const isManagerOrAdmin = await userHasFeature(sessionUser, "shift_trades.approve");

      const status = req.query.status as string | undefined;
      let employeeId: number | undefined;

      if (isManagerOrAdmin) {
        // Managers can filter by any employeeId or see all
        employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
      } else {
        // Regular employees: scope to their own employee record
        const allEmployees = await storage.getEmployees();
        const callerEmployee = allEmployees.find(e =>
          e.email && sessionUser?.email && e.email.toLowerCase() === sessionUser.email.toLowerCase()
        );
        if (!callerEmployee) {
          return res.json([]);
        }
        employeeId = callerEmployee.id;
      }

      const trades = await storage.getShiftTrades({ employeeId, status });
      if (isManagerOrAdmin && sessionUser.role !== "admin") {
        // Approvers see only trades between employees they manage.
        const scoped = [];
        for (const trade of trades) {
          if (await canManageTrade(sessionUser, trade.requesterId, trade.responderId)) scoped.push(trade);
        }
        return res.json(scoped);
      }
      res.json(trades);
    } catch (error) {
      console.error("Error fetching shift trades:", error);
      res.status(500).json({ message: "Failed to fetch shift trades" });
    }
  });

  // GET /api/shift-trades/:id - Get single trade
  app.get("/api/shift-trades/:id", requireFeatureAccess("shift_trades.view"), async (req: Request, res: Response) => {
    try {
      const trade = await storage.getShiftTrade(Number(req.params.id));
      if (!trade) return res.status(404).json({ message: "Trade not found" });

      const sessionUser = (req.session as any)?.user;
      const { userHasFeature } = await import("../middleware");
      const isManagerOrAdmin = await userHasFeature(sessionUser, "shift_trades.approve");

      if (isManagerOrAdmin && !(await canManageTrade(sessionUser, trade.requesterId, trade.responderId))) {
        return res.status(403).json({ message: "You do not have access to this trade" });
      }
      if (!isManagerOrAdmin) {
        const allEmployees = await storage.getEmployees();
        const callerEmployee = allEmployees.find(e =>
          e.email && sessionUser?.email && e.email.toLowerCase() === sessionUser.email.toLowerCase()
        );
        if (!callerEmployee || (trade.requesterId !== callerEmployee.id && trade.responderId !== callerEmployee.id)) {
          return res.status(403).json({ message: "You do not have access to this trade" });
        }
      }

      res.json(trade);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trade" });
    }
  });

  // POST /api/shift-trades - Create a new trade request
  app.post("/api/shift-trades", requireFeatureAccess("shift_trades.view"), async (req: Request, res: Response) => {
    try {
      const { requesterShiftId, responderShiftId, requesterNote } = req.body;

      // Get both shifts
      const allShifts = await storage.getShifts();
      const requesterShift = allShifts.find(s => s.id === requesterShiftId);
      const responderShift = allShifts.find(s => s.id === responderShiftId);

      if (!requesterShift || !responderShift) {
        return res.status(400).json({ message: "One or both shifts not found" });
      }

      // Validate that the session user owns the requester shift
      const sessionUser = (req.session as any)?.user;
      const allEmployees = await storage.getEmployees();
      const callerEmployee = allEmployees.find(e =>
        e.email && sessionUser?.email && e.email.toLowerCase() === sessionUser.email.toLowerCase()
      );
      if (!callerEmployee || requesterShift.employeeId !== callerEmployee.id) {
        return res.status(403).json({ message: "You can only create trade requests for your own shifts" });
      }

      // Get both employees
      const requester = await storage.getEmployee(requesterShift.employeeId);
      const responder = await storage.getEmployee(responderShift.employeeId);

      if (!requester || !responder) {
        return res.status(400).json({ message: "One or both employees not found" });
      }

      // Validate same job title
      if (requester.jobTitle !== responder.jobTitle) {
        return res.status(400).json({ message: "Shifts can only be traded between employees with the same job title" });
      }

      // Validate not trading with yourself
      if (requester.id === responder.id) {
        return res.status(400).json({ message: "Cannot trade a shift with yourself" });
      }

      const ineligible = await checkTradeEligibility(requesterShift, responderShift, requester, responder);
      if (ineligible) {
        return res.status(400).json({ message: ineligible });
      }

      // Check for existing pending trades on these shifts
      const existingTrades = await storage.getShiftTrades();
      const conflicting = existingTrades.find(t => 
        (t.status === "pending_peer" || t.status === "pending_manager") &&
        (t.requesterShiftId === requesterShiftId || t.requesterShiftId === responderShiftId ||
         t.responderShiftId === requesterShiftId || t.responderShiftId === responderShiftId)
      );
      if (conflicting) {
        return res.status(400).json({ message: "One of these shifts already has a pending trade request" });
      }

      const trade = await storage.createShiftTrade({
        requesterId: requester.id,
        responderId: responder.id,
        requesterShiftId,
        responderShiftId,
        status: "pending_peer",
        requesterNote: requesterNote || null,
        responderNote: null,
        managerNote: null,
        reviewedBy: null,
      });

      // Create notification for the responder (Employee B)
      // Find user account linked to responder's email
      const responderUser = await storage.getUserByEmail(responder.email);
      if (responderUser) {
        const rShiftDate = new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TIMEZONE });
        const oShiftDate = new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TIMEZONE });
        await storage.createNotification({
          userId: responderUser.id,
          type: "trade_requested",
          title: "Shift Trade Request",
          message: `${requester.name} wants to trade their ${rShiftDate} shift for your ${oShiftDate} shift`,
          relatedTradeId: trade.id,
          isRead: false,
        });
      }

      // Send email to responder (SSO email + alternate email)
      try {
        const responderEmails = await getNotificationEmails(responder);
        const appUrl = `${req.protocol}://${req.get("host")}`;
        for (const email of responderEmails) {
          await sendTradeNotificationEmail(email, {
            recipientName: responder.name,
            requesterName: requester.name,
            requesterShiftDate: new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIMEZONE }),
            requesterShiftTime: `${new Date(requesterShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })} - ${new Date(requesterShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })}`,
            responderShiftDate: new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIMEZONE }),
            responderShiftTime: `${new Date(responderShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })} - ${new Date(responderShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })}`,
            action: "requested",
            appUrl,
          });
        }
      } catch (emailErr) {
        console.error("[ShiftTrade] Email notification failed:", emailErr);
      }

      res.status(201).json(trade);
    } catch (error) {
      console.error("Error creating shift trade:", error);
      res.status(500).json({ message: "Failed to create shift trade" });
    }
  });

  // PATCH /api/shift-trades/:id/respond - Peer (Employee B) approves or declines
  app.patch("/api/shift-trades/:id/respond", requireAuth, async (req: Request, res: Response) => {
    try {
      const trade = await storage.getShiftTrade(Number(req.params.id));
      if (!trade) return res.status(404).json({ message: "Trade not found" });
      if (trade.status !== "pending_peer") {
        return res.status(400).json({ message: "Trade is not pending peer approval" });
      }

      const sessionUser = (req.session as any)?.user;
      const allEmployees = await storage.getEmployees();
      const callerEmployee = allEmployees.find(e =>
        e.email && sessionUser?.email && e.email.toLowerCase() === sessionUser.email.toLowerCase()
      );
      if (!callerEmployee || callerEmployee.id !== trade.responderId) {
        return res.status(403).json({ message: "Only the trade responder can approve or decline this trade" });
      }

      const { approved, responderNote } = req.body;
      const responder = await storage.getEmployee(trade.responderId);
      const requester = await storage.getEmployee(trade.requesterId);

      if (approved === true) {
        const updatedTrade = await storage.transitionShiftTrade(trade.id, ["pending_peer"], {
          status: "pending_manager",
          responderNote: responderNote || null,
        });
        if (!updatedTrade) {
          return res.status(409).json({ message: "This trade was changed or cancelled. Refresh and try again." });
        }

        // Notify requester that peer approved
        const requesterUser = requester ? await storage.getUserByEmail(requester.email) : null;
        if (requesterUser) {
          await storage.createNotification({
            userId: requesterUser.id,
            type: "trade_peer_approved",
            title: "Trade Accepted",
            message: `${responder?.name || "Your trade partner"} accepted your shift trade request. Waiting for manager approval.`,
            relatedTradeId: trade.id,
            isRead: false,
          });
        }

        // Notify store managers for approval
        if (requester?.location) {
          const allUsers = await storage.getUsers();
          // Notify everyone whose role can approve shift trades (built-in or custom).
          const { getFeaturePermissions } = await import("../middleware");
          const perms = await getFeaturePermissions();
          const approverRoles = new Set(["admin", ...(perms["shift_trades.approve"] || [])]);
          const approvers = allUsers.filter(u => approverRoles.has(u.role) && u.isActive);
          // Only approvers assigned to the requester's store; if the store
          // has none, fall back to admins so the trade isn't stranded.
          const storeLocation = (await storage.getLocations()).find(l => l.name === requester.location);
          const storeApprovers = storeLocation
            ? approvers.filter(u => u.role !== "admin" && (u.locationIds ?? []).map(String).includes(String(storeLocation.id)))
            : [];
          const storeManagers = storeApprovers.length > 0 ? storeApprovers : approvers.filter(u => u.role === "admin");
          for (const mgr of storeManagers) {
            await storage.createNotification({
              userId: mgr.id,
              type: "trade_pending_manager",
              title: "Shift Trade Needs Approval",
              message: `${requester.name} and ${responder?.name} want to swap shifts. Please review.`,
              relatedTradeId: trade.id,
              isRead: false,
            });

            // Send email to manager (use their user account email)
            try {
              const appUrl = `${req.protocol}://${req.get("host")}`;
              const requesterShift = (await storage.getShifts()).find(s => s.id === trade.requesterShiftId);
              const responderShift = (await storage.getShifts()).find(s => s.id === trade.responderShiftId);
              if (requesterShift && responderShift) {
                await sendTradeNotificationEmail(mgr.email, {
                  recipientName: mgr.name,
                  requesterName: requester.name,
                  requesterShiftDate: new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIMEZONE }),
                  requesterShiftTime: `${new Date(requesterShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })} - ${new Date(requesterShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })}`,
                  responderShiftDate: new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIMEZONE }),
                  responderShiftTime: `${new Date(responderShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })} - ${new Date(responderShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })}`,
                  responderName: responder?.name || "Employee",
                  action: "pending_manager",
                  appUrl,
                });
              }
            } catch (emailErr) {
              console.error("[ShiftTrade] Manager email notification failed:", emailErr);
            }
          }
        }

        res.json(updatedTrade);
      } else {
        const updatedTrade = await storage.transitionShiftTrade(trade.id, ["pending_peer"], {
          status: "declined_peer",
          responderNote: responderNote || null,
        });
        if (!updatedTrade) {
          return res.status(409).json({ message: "This trade was changed or cancelled. Refresh and try again." });
        }

        // Notify requester of decline
        const requesterUser = requester ? await storage.getUserByEmail(requester.email) : null;
        if (requesterUser) {
          await storage.createNotification({
            userId: requesterUser.id,
            type: "trade_declined",
            title: "Trade Declined",
            message: `${responder?.name || "Your trade partner"} declined your shift trade request.`,
            relatedTradeId: trade.id,
            isRead: false,
          });
        }

        res.json(updatedTrade);
      }
    } catch (error) {
      console.error("Error responding to shift trade:", error);
      res.status(500).json({ message: "Failed to respond to shift trade" });
    }
  });

  // PATCH /api/shift-trades/:id/manager-respond - Manager approves or declines
  app.patch("/api/shift-trades/:id/manager-respond", requireFeatureAccess("shift_trades.approve"), async (req: Request, res: Response) => {
    try {
      const trade = await storage.getShiftTrade(Number(req.params.id));
      if (!trade) return res.status(404).json({ message: "Trade not found" });
      if (trade.status !== "pending_manager") {
        return res.status(400).json({ message: "Trade is not pending manager approval" });
      }

      const { approved, managerNote } = req.body;
      const sessionUser = (req.session as any)?.user;

      if (!(await canManageTrade(sessionUser, trade.requesterId, trade.responderId))) {
        return res.status(403).json({ message: "Access denied: trade outside your assigned scope" });
      }
      // An approver can't sign off on a trade they're part of.
      const reviewerEmployee = sessionUser?.email
        ? (await storage.getEmployees()).find(e => e.email && e.email.toLowerCase() === sessionUser.email.toLowerCase())
        : undefined;
      if (reviewerEmployee && (reviewerEmployee.id === trade.requesterId || reviewerEmployee.id === trade.responderId)) {
        return res.status(403).json({ message: "You can't review a trade you're part of" });
      }

      if (approved === true) {
        const requesterShift = await storage.getShift(trade.requesterShiftId);
        const responderShift = await storage.getShift(trade.responderShiftId);
        const requester = await storage.getEmployee(trade.requesterId);
        const responder = await storage.getEmployee(trade.responderId);

        if (!requesterShift || !responderShift || !requester || !responder) {
          return res.status(400).json({ message: "One or both shifts no longer exist" });
        }

        // Re-check now: employees may have been terminated or rescheduled
        // since the trade was requested.
        const ineligible = await checkTradeEligibility(requesterShift, responderShift, requester, responder);
        if (ineligible) {
          return res.status(400).json({ message: ineligible });
        }

        // Swap the shifts and mark the trade approved in one transaction; it
        // fails if either shift changed hands or the trade was resolved.
        let updatedTrade;
        try {
          updatedTrade = await storage.approveShiftTrade({
            tradeId: trade.id,
            requesterShiftId: trade.requesterShiftId,
            responderShiftId: trade.responderShiftId,
            requesterId: trade.requesterId,
            responderId: trade.responderId!,
            managerNote: managerNote || null,
            reviewedBy: sessionUser.id,
          });
        } catch (err) {
          if (err instanceof ShiftTradeConflictError) {
            return res.status(409).json({ message: "Trade shifts have changed; cancel this trade and create a new one" });
          }
          throw err;
        }
        await storage.clearTradeApprovalNotifications(updatedTrade.id);

        // Notify both employees

        for (const emp of [requester, responder]) {
          if (!emp) continue;
          const empUser = await storage.getUserByEmail(emp.email);
          if (empUser) {
            await storage.createNotification({
              userId: empUser.id,
              type: "trade_approved",
              title: "Trade Approved",
              message: `Your shift trade has been approved by ${sessionUser?.name || "a manager"}. The schedule has been updated.`,
              relatedTradeId: trade.id,
              isRead: false,
            });
          }
          // Email notification (SSO email + alternate email)
          try {
            const appUrl = `${req.protocol}://${req.get("host")}`;
            const empEmails = await getNotificationEmails(emp);
            for (const email of empEmails) {
              await sendTradeNotificationEmail(email, {
                recipientName: emp.name,
                requesterName: requester?.name || "Employee",
                responderName: responder?.name || "Employee",
                requesterShiftDate: new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIMEZONE }),
                requesterShiftTime: `${new Date(requesterShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })} - ${new Date(requesterShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })}`,
                responderShiftDate: new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIMEZONE }),
                responderShiftTime: `${new Date(responderShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })} - ${new Date(responderShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE })}`,
                action: "approved",
                appUrl,
              });
            }
          } catch (emailErr) {
            console.error("[ShiftTrade] Approval email failed:", emailErr);
          }
        }

        res.json(updatedTrade);
      } else {
        const updatedTrade = await storage.transitionShiftTrade(trade.id, ["pending_manager"], {
          status: "declined_manager",
          managerNote: managerNote || null,
          reviewedBy: sessionUser?.id || null,
        });
        if (!updatedTrade) {
          return res.status(409).json({ message: "This trade was changed or cancelled. Refresh and try again." });
        }

        // Notify both employees of decline
        const requester = await storage.getEmployee(trade.requesterId);
        const responder = await storage.getEmployee(trade.responderId);

        for (const emp of [requester, responder]) {
          if (!emp) continue;
          const empUser = await storage.getUserByEmail(emp.email);
          if (empUser) {
            await storage.createNotification({
              userId: empUser.id,
              type: "trade_declined",
              title: "Trade Declined",
              message: `Your shift trade was declined by ${sessionUser?.name || "a manager"}.${managerNote ? ` Reason: ${managerNote}` : ""}`,
              relatedTradeId: trade.id,
              isRead: false,
            });
          }
        }

        res.json(updatedTrade);
      }
    } catch (error) {
      console.error("Error manager-responding to shift trade:", error);
      res.status(500).json({ message: "Failed to process manager response" });
    }
  });

  // DELETE /api/shift-trades/:id - Cancel a pending trade (only requester or manager)
  app.delete("/api/shift-trades/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const trade = await storage.getShiftTrade(Number(req.params.id));
      if (!trade) return res.status(404).json({ message: "Trade not found" });
      
      if (trade.status !== "pending_peer" && trade.status !== "pending_manager") {
        return res.status(400).json({ message: "Can only cancel pending trades" });
      }

      const sessionUser = (req.session as any)?.user;
      const { userHasFeature } = await import("../middleware");
      const isManagerOrAdmin = await userHasFeature(sessionUser, "shift_trades.approve")
        && await canManageTrade(sessionUser, trade.requesterId, trade.responderId);
      if (!isManagerOrAdmin) {
        const allEmployees = await storage.getEmployees();
        const callerEmployee = allEmployees.find(e =>
          e.email && sessionUser?.email && e.email.toLowerCase() === sessionUser.email.toLowerCase()
        );
        if (!callerEmployee || callerEmployee.id !== trade.requesterId) {
          return res.status(403).json({ message: "Only the trade requester or a manager can cancel this trade" });
        }
      }

      const cancelled = await storage.transitionShiftTrade(trade.id, ["pending_peer", "pending_manager"], { status: "cancelled" });
      if (!cancelled) {
        return res.status(409).json({ message: "This trade was already approved, declined or cancelled." });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to cancel trade" });
    }
  });

  // ========== NOTIFICATIONS ==========

  // GET /api/notifications - Get notifications for current user
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      if (!sessionUser) return res.status(401).json({ message: "Not authenticated" });
      const notifs = await storage.getNotifications(sessionUser.id);
      res.json(notifs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // GET /api/notifications/unread-count - Get unread count for current user
  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      if (!sessionUser) return res.status(401).json({ message: "Not authenticated" });
      const count = await storage.getUnreadNotificationCount(sessionUser.id);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // PATCH /api/notifications/:id/read - Mark a notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      if (!sessionUser) return res.status(401).json({ message: "Not authenticated" });
      const allNotifs = await storage.getNotifications(sessionUser.id);
      const notifId = Number(req.params.id);
      const ownsNotif = allNotifs.some(n => n.id === notifId);
      if (!ownsNotif) {
        return res.status(403).json({ message: "You can only mark your own notifications as read" });
      }
      const notif = await storage.markNotificationRead(notifId);
      res.json(notif);
    } catch (error) {
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // PATCH /api/notifications/read-all - Mark all notifications as read
  app.patch("/api/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      if (!sessionUser) return res.status(401).json({ message: "Not authenticated" });
      await storage.markAllNotificationsRead(sessionUser.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark all as read" });
    }
  });
}
