import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireManager, getNotificationEmails } from "../middleware";
import { sendTradeNotificationEmail } from "../outlook";

export function registerShiftTradeRoutes(app: Express) {
  // ========== SHIFT TRADING ==========

  // GET /api/shift-trades - List shift trades (filter by employeeId, status)
  app.get("/api/shift-trades", requireAuth, async (req: Request, res: Response) => {
    try {
      const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
      const status = req.query.status as string | undefined;
      const trades = await storage.getShiftTrades({ employeeId, status });
      res.json(trades);
    } catch (error) {
      console.error("Error fetching shift trades:", error);
      res.status(500).json({ message: "Failed to fetch shift trades" });
    }
  });

  // GET /api/shift-trades/:id - Get single trade
  app.get("/api/shift-trades/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const trade = await storage.getShiftTrade(Number(req.params.id));
      if (!trade) return res.status(404).json({ message: "Trade not found" });
      res.json(trade);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trade" });
    }
  });

  // POST /api/shift-trades - Create a new trade request
  app.post("/api/shift-trades", requireAuth, async (req: Request, res: Response) => {
    try {
      const { requesterShiftId, responderShiftId, requesterNote } = req.body;

      // Get both shifts
      const allShifts = await storage.getShifts();
      const requesterShift = allShifts.find(s => s.id === requesterShiftId);
      const responderShift = allShifts.find(s => s.id === responderShiftId);

      if (!requesterShift || !responderShift) {
        return res.status(400).json({ message: "One or both shifts not found" });
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
        const rShiftDate = new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const oShiftDate = new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
            requesterShiftDate: new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
            requesterShiftTime: `${new Date(requesterShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${new Date(requesterShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
            responderShiftDate: new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
            responderShiftTime: `${new Date(responderShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${new Date(responderShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
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

      const { approved, responderNote } = req.body;
      const responder = await storage.getEmployee(trade.responderId);
      const requester = await storage.getEmployee(trade.requesterId);

      if (approved) {
        const updatedTrade = await storage.updateShiftTrade(trade.id, {
          status: "pending_manager",
          responderNote: responderNote || null,
        });

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
          const storeManagers = allUsers.filter(u => 
            (u.role === "manager" || u.role === "admin") && u.isActive
          );
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
                  requesterShiftDate: new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
                  requesterShiftTime: `${new Date(requesterShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${new Date(requesterShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
                  responderShiftDate: new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
                  responderShiftTime: `${new Date(responderShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${new Date(responderShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
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
        const updatedTrade = await storage.updateShiftTrade(trade.id, {
          status: "declined_peer",
          responderNote: responderNote || null,
        });

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
  app.patch("/api/shift-trades/:id/manager-respond", requireManager, async (req: Request, res: Response) => {
    try {
      const trade = await storage.getShiftTrade(Number(req.params.id));
      if (!trade) return res.status(404).json({ message: "Trade not found" });
      if (trade.status !== "pending_manager") {
        return res.status(400).json({ message: "Trade is not pending manager approval" });
      }

      const { approved, managerNote } = req.body;
      const sessionUser = (req.session as any)?.user;

      if (approved) {
        // Swap the shifts: update employeeId on each shift
        const requesterShift = (await storage.getShifts()).find(s => s.id === trade.requesterShiftId);
        const responderShift = (await storage.getShifts()).find(s => s.id === trade.responderShiftId);

        if (!requesterShift || !responderShift) {
          return res.status(400).json({ message: "One or both shifts no longer exist" });
        }

        // Swap employee IDs
        await storage.updateShift(trade.requesterShiftId, { employeeId: trade.responderId });
        await storage.updateShift(trade.responderShiftId, { employeeId: trade.requesterId });

        const updatedTrade = await storage.updateShiftTrade(trade.id, {
          status: "approved",
          managerNote: managerNote || null,
          reviewedBy: sessionUser?.id || null,
        });

        // Notify both employees
        const requester = await storage.getEmployee(trade.requesterId);
        const responder = await storage.getEmployee(trade.responderId);

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
                requesterShiftDate: new Date(requesterShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
                requesterShiftTime: `${new Date(requesterShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${new Date(requesterShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
                responderShiftDate: new Date(responderShift.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
                responderShiftTime: `${new Date(responderShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${new Date(responderShift.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
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
        const updatedTrade = await storage.updateShiftTrade(trade.id, {
          status: "declined_manager",
          managerNote: managerNote || null,
          reviewedBy: sessionUser?.id || null,
        });

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

      await storage.updateShiftTrade(trade.id, { status: "cancelled" });
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
      const notif = await storage.markNotificationRead(Number(req.params.id));
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
