import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireManager } from "../middleware";
import { insertTaskAssignmentSchema, TASK_LIST } from "@shared/schema";
import { z } from "zod";

const taskAssignmentValidation = z.object({
  employeeId: z.number().int().positive(),
  taskName: z.enum(TASK_LIST as unknown as [string, ...string[]]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(15).max(960),
  createdBy: z.number().int().positive().nullable().optional(),
});

export function registerTaskAssignmentRoutes(app: Express) {
  app.get("/api/task-assignments", requireManager, async (req, res) => {
    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Valid date query parameter (YYYY-MM-DD) is required" });
    }
    const assignments = await storage.getTaskAssignments(date);
    res.json(assignments);
  });

  app.post("/api/task-assignments", requireManager, async (req, res) => {
    const parsed = taskAssignmentValidation.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const employee = await storage.getEmployee(parsed.data.employeeId);
    if (!employee) {
      return res.status(400).json({ message: "Employee not found" });
    }
    const assignment = await storage.createTaskAssignment(parsed.data);
    res.status(201).json(assignment);
  });

  app.post("/api/task-assignments/batch", requireManager, async (req, res) => {
    const { assignments } = req.body;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ message: "assignments array is required" });
    }
    const results = [];
    for (const item of assignments) {
      const parsed = taskAssignmentValidation.safeParse(item);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const created = await storage.createTaskAssignment(parsed.data);
      results.push(created);
    }
    res.status(201).json(results);
  });

  app.put("/api/task-assignments/:id", requireManager, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updateSchema = taskAssignmentValidation.partial();
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const updated = await storage.updateTaskAssignment(id, parsed.data);
      res.json(updated);
    } catch {
      res.status(404).json({ message: "Task assignment not found" });
    }
  });

  app.delete("/api/task-assignments/:id", requireManager, async (req, res) => {
    await storage.deleteTaskAssignment(Number(req.params.id));
    res.status(204).send();
  });

  app.delete("/api/task-assignments", requireManager, async (req, res) => {
    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Valid date query parameter (YYYY-MM-DD) is required" });
    }
    const count = await storage.deleteTaskAssignmentsByDate(date);
    res.json({ deleted: count });
  });
}
