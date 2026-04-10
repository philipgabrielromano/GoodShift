import type { Express, Request, Response } from "express";
import { requireAuth, requireOptimizer } from "../middleware";
import { storage } from "../storage";
import { optimizationEvents, optimizationChecklistItems, optimizationSurveyResponses, OPTIMIZATION_CHECKLIST } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";

export function registerOptimizationRoutes(app: Express) {
  app.get("/api/optimization/events", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const events = await db.select().from(optimizationEvents).orderBy(optimizationEvents.createdAt);
      res.json(events);
    } catch (error) {
      console.error("Error fetching optimization events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.get("/api/optimization/events/:id", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const [event] = await db.select().from(optimizationEvents).where(eq(optimizationEvents.id, Number(req.params.id)));
      if (!event) return res.status(404).json({ message: "Event not found" });

      const checklist = await db.select().from(optimizationChecklistItems).where(eq(optimizationChecklistItems.eventId, event.id));
      const surveys = await db.select().from(optimizationSurveyResponses).where(eq(optimizationSurveyResponses.eventId, event.id));

      res.json({ event, checklist, surveys });
    } catch (error) {
      console.error("Error fetching optimization event:", error);
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });

  app.post("/api/optimization/events", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      const { locationId, locationName, startDate, endDate, notes } = req.body;

      const [event] = await db.insert(optimizationEvents).values({
        locationId,
        locationName,
        startDate,
        endDate,
        status: "planning",
        createdBy: user.id,
        createdByName: user.name,
        notes: notes || null,
      }).returning();

      const allItems: { eventId: number; phase: string; itemKey: string; completed: boolean }[] = [];
      for (const [phase, items] of Object.entries(OPTIMIZATION_CHECKLIST)) {
        for (const item of items) {
          allItems.push({
            eventId: event.id,
            phase,
            itemKey: item.key,
            completed: false,
          });
        }
      }

      if (allItems.length > 0) {
        await db.insert(optimizationChecklistItems).values(allItems);
      }

      res.json(event);
    } catch (error) {
      console.error("Error creating optimization event:", error);
      res.status(500).json({ message: "Failed to create event" });
    }
  });

  app.patch("/api/optimization/events/:id", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const { status, notes } = req.body;
      const updateData: any = { updatedAt: new Date() };
      if (status !== undefined) updateData.status = status;
      if (notes !== undefined) updateData.notes = notes;

      const [event] = await db.update(optimizationEvents)
        .set(updateData)
        .where(eq(optimizationEvents.id, Number(req.params.id)))
        .returning();

      if (!event) return res.status(404).json({ message: "Event not found" });
      res.json(event);
    } catch (error) {
      console.error("Error updating optimization event:", error);
      res.status(500).json({ message: "Failed to update event" });
    }
  });

  app.delete("/api/optimization/events/:id", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.id);
      await db.delete(optimizationSurveyResponses).where(eq(optimizationSurveyResponses.eventId, eventId));
      await db.delete(optimizationChecklistItems).where(eq(optimizationChecklistItems.eventId, eventId));
      await db.delete(optimizationEvents).where(eq(optimizationEvents.id, eventId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting optimization event:", error);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  app.patch("/api/optimization/checklist/:id", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      const { completed, notes } = req.body;

      const updateData: any = {};
      if (completed !== undefined) {
        updateData.completed = completed;
        updateData.completedBy = completed ? user.name : null;
        updateData.completedAt = completed ? new Date() : null;
      }
      if (notes !== undefined) updateData.notes = notes;

      const [item] = await db.update(optimizationChecklistItems)
        .set(updateData)
        .where(eq(optimizationChecklistItems.id, Number(req.params.id)))
        .returning();

      if (!item) return res.status(404).json({ message: "Checklist item not found" });

      if (completed) {
        const [event] = await db.select().from(optimizationEvents).where(eq(optimizationEvents.id, item.eventId));
        if (event && event.status === "planning") {
          await db.update(optimizationEvents)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(optimizationEvents.id, event.id));
        }
      }

      res.json(item);
    } catch (error) {
      console.error("Error updating checklist item:", error);
      res.status(500).json({ message: "Failed to update checklist item" });
    }
  });

  app.post("/api/optimization/events/:id/survey", requireOptimizer, async (req: Request, res: Response) => {
    try {
      const { respondentName, responses } = req.body;

      const [survey] = await db.insert(optimizationSurveyResponses).values({
        eventId: Number(req.params.id),
        respondentName: respondentName || null,
        responses: JSON.stringify(responses),
      }).returning();

      res.json(survey);
    } catch (error) {
      console.error("Error creating survey response:", error);
      res.status(500).json({ message: "Failed to submit survey" });
    }
  });

  app.delete("/api/optimization/survey/:id", requireOptimizer, async (req: Request, res: Response) => {
    try {
      await db.delete(optimizationSurveyResponses).where(eq(optimizationSurveyResponses.id, Number(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting survey response:", error);
      res.status(500).json({ message: "Failed to delete survey" });
    }
  });
}
