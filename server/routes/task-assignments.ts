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
    let assignments = await storage.getTaskAssignments(date);

    const location = req.query.location as string;
    if (location && location !== "all") {
      const employees = await storage.getEmployees();
      const locationEmpIds = new Set(
        employees.filter(e => e.location === location).map(e => e.id)
      );
      assignments = assignments.filter(a => locationEmpIds.has(a.employeeId));
    }

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
      if (!updated) {
        return res.status(404).json({ message: "Task assignment not found" });
      }
      res.json(updated);
    } catch {
      res.status(404).json({ message: "Task assignment not found" });
    }
  });

  app.post("/api/task-assignments/copy-day", requireManager, async (req, res) => {
    const { sourceDate, targetDate, location } = req.body;
    if (!sourceDate || !targetDate) {
      return res.status(400).json({ message: "sourceDate and targetDate are required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ message: "Dates must be YYYY-MM-DD format" });
    }

    let sourceAssignments = await storage.getTaskAssignments(sourceDate);
    let locationEmpIds: Set<number> | null = null;
    if (location && location !== "all") {
      const employees = await storage.getEmployees();
      locationEmpIds = new Set(
        employees.filter(e => e.location === location).map(e => e.id)
      );
      sourceAssignments = sourceAssignments.filter(a => locationEmpIds!.has(a.employeeId));
    }

    if (sourceAssignments.length === 0) {
      return res.status(400).json({ message: "No task assignments to copy from source date" });
    }

    if (locationEmpIds) {
      const existingTarget = await storage.getTaskAssignments(targetDate);
      for (const a of existingTarget) {
        if (locationEmpIds.has(a.employeeId)) {
          await storage.deleteTaskAssignment(a.id);
        }
      }
    } else {
      await storage.deleteTaskAssignmentsByDate(targetDate);
    }

    const results = [];
    for (const a of sourceAssignments) {
      const created = await storage.createTaskAssignment({
        employeeId: a.employeeId,
        taskName: a.taskName,
        date: targetDate,
        startMinute: a.startMinute,
        durationMinutes: a.durationMinutes,
        createdBy: a.createdBy,
      });
      results.push(created);
    }

    res.status(201).json({ message: `Copied ${results.length} task assignments`, count: results.length });
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
