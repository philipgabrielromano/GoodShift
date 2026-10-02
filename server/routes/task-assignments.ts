import type { Express, Request } from "express";
import { storage } from "../storage";
import { requireFeatureAccess } from "../middleware";
import { filterEmployeesByLocationScope } from "../access-control";
import { z } from "zod";

const taskAssignmentValidation = z.object({
  employeeId: z.number().int().positive(),
  taskName: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(15).max(960),
  createdBy: z.number().int().positive().nullable().optional(),
});

async function scopedEmployeeIds(req: Request, location?: string): Promise<Set<number>> {
  const employees = await filterEmployeesByLocationScope((req.session as any).user, await storage.getEmployees());
  return new Set(employees.filter(e => !location || location === "all" || e.location === location).map(e => e.id));
}

export function registerTaskAssignmentRoutes(app: Express) {
  app.get("/api/task-assignments", requireFeatureAccess("task_assignment.view"), async (req, res) => {
    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Valid date query parameter (YYYY-MM-DD) is required" });
    }
    const ids = await scopedEmployeeIds(req, req.query.location as string);
    const assignments = (await storage.getTaskAssignments(date)).filter(a => ids.has(a.employeeId));

    res.json(assignments);
  });

  app.post("/api/task-assignments", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const parsed = taskAssignmentValidation.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const employee = await storage.getEmployee(parsed.data.employeeId);
    if (!employee) {
      return res.status(400).json({ message: "Employee not found" });
    }
    if (!(await scopedEmployeeIds(req)).has(employee.id)) return res.status(403).json({ message: "Access denied" });
    const assignment = await storage.createTaskAssignment(parsed.data);
    res.status(201).json(assignment);
  });

  app.post("/api/task-assignments/batch", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const { assignments } = req.body;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ message: "assignments array is required" });
    }
    const ids = await scopedEmployeeIds(req);
    const validated = [];
    for (const item of assignments) {
      const parsed = taskAssignmentValidation.safeParse(item);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      if (!ids.has(parsed.data.employeeId)) return res.status(403).json({ message: "Access denied" });
      validated.push(parsed.data);
    }
    const results = [];
    for (const assignment of validated) results.push(await storage.createTaskAssignment(assignment));
    res.status(201).json(results);
  });

  app.put("/api/task-assignments/:id", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updateSchema = taskAssignmentValidation.partial();
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const existing = await storage.getTaskAssignment(id);
      if (!existing) return res.status(404).json({ message: "Task assignment not found" });
      const ids = await scopedEmployeeIds(req);
      if (!ids.has(existing.employeeId) || (parsed.data.employeeId !== undefined && !ids.has(parsed.data.employeeId))) {
        return res.status(403).json({ message: "Access denied" });
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

  app.post("/api/task-assignments/copy-day", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const { sourceDate, targetDate, location } = req.body;
    if (!sourceDate || !targetDate) {
      return res.status(400).json({ message: "sourceDate and targetDate are required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ message: "Dates must be YYYY-MM-DD format" });
    }

    const locationEmpIds = await scopedEmployeeIds(req, location);
    const sourceAssignments = (await storage.getTaskAssignments(sourceDate)).filter(a => locationEmpIds.has(a.employeeId));

    if (sourceAssignments.length === 0) {
      return res.status(400).json({ message: "No task assignments to copy from source date" });
    }

    await storage.deleteTaskAssignmentsByDate(targetDate, [...locationEmpIds]);

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

  app.delete("/api/task-assignments/:id", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const existing = await storage.getTaskAssignment(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Task assignment not found" });
    if (!(await scopedEmployeeIds(req)).has(existing.employeeId)) return res.status(403).json({ message: "Access denied" });
    await storage.deleteTaskAssignment(Number(req.params.id));
    res.status(204).send();
  });

  app.delete("/api/task-assignments", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Valid date query parameter (YYYY-MM-DD) is required" });
    }
    const ids = await scopedEmployeeIds(req, req.query.location as string);
    const count = await storage.deleteTaskAssignmentsByDate(date, [...ids]);
    res.json({ deleted: count });
  });

  app.get("/api/custom-tasks", requireFeatureAccess("task_assignment.view"), async (req, res) => {
    const user = (req.session as any)?.user;
    if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
    const tasks = await storage.getCustomTasks(user.id);
    res.json(tasks);
  });

  app.post("/api/custom-tasks", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const user = (req.session as any)?.user;
    if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
    const schema = z.object({
      taskName: z.string().min(1).max(100),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const task = await storage.createCustomTask({
      userId: user.id,
      taskName: parsed.data.taskName,
      color: parsed.data.color,
    });
    res.status(201).json(task);
  });

  app.delete("/api/custom-tasks/:id", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const user = (req.session as any)?.user;
    if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
    await storage.deleteCustomTask(Number(req.params.id), user.id);
    res.status(204).send();
  });
}
