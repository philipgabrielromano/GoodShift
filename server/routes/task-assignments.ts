import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireFeatureAccess } from "../middleware";
import { getUserLocationScope, isLocationInScope } from "../locationScope";
import { insertTaskAssignmentSchema, TASK_LIST } from "@shared/schema";
import { z } from "zod";

const taskAssignmentValidation = z.object({
  employeeId: z.number().int().positive(),
  taskName: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(15).max(960),
  createdBy: z.number().int().positive().nullable().optional(),
});

// Employees whose task assignments the caller may see/change for a request,
// optionally narrowed to one store. null = every employee (admin, all stores).
async function resolveTaskScope(
  user: any,
  requestedLocation: string | undefined,
): Promise<{ employeeIds: Set<number> | null; error: string | null }> {
  const scope = await getUserLocationScope(user);
  const narrowed = requestedLocation && requestedLocation !== "all" ? requestedLocation : undefined;
  if (narrowed && !isLocationInScope(scope, narrowed)) {
    return { employeeIds: null, error: "Access denied: location outside your assigned scope" };
  }
  if (!narrowed && scope === null) return { employeeIds: null, error: null };
  const employees = await storage.getEmployees();
  return {
    employeeIds: new Set(
      employees
        .filter(e => (narrowed ? e.location === narrowed : isLocationInScope(scope, e.location)))
        .map(e => e.id),
    ),
    error: null,
  };
}

export function registerTaskAssignmentRoutes(app: Express) {
  app.get("/api/task-assignments", requireFeatureAccess("task_assignment.view"), async (req, res) => {
    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Valid date query parameter (YYYY-MM-DD) is required" });
    }
    const { employeeIds, error } = await resolveTaskScope((req.session as any)?.user, req.query.location as string | undefined);
    if (error) return res.status(403).json({ message: error });
    let assignments = await storage.getTaskAssignments(date);
    if (employeeIds) {
      assignments = assignments.filter(a => employeeIds.has(a.employeeId));
    }
    res.json(assignments);
  });

  app.post("/api/task-assignments", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const parsed = taskAssignmentValidation.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const user = (req.session as any)?.user;
    const employee = await storage.getEmployee(parsed.data.employeeId);
    if (!employee) {
      return res.status(400).json({ message: "Employee not found" });
    }
    if (!isLocationInScope(await getUserLocationScope(user), employee.location)) {
      return res.status(403).json({ message: "You can only assign tasks at your assigned store(s)" });
    }
    const assignment = await storage.createTaskAssignment({ ...parsed.data, createdBy: user?.id ?? null });
    res.status(201).json(assignment);
  });

  app.post("/api/task-assignments/batch", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const { assignments } = req.body;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ message: "assignments array is required" });
    }
    // Validate and authorize every item before writing any, so a bad item
    // can't leave the batch half-inserted.
    const user = (req.session as any)?.user;
    const { employeeIds } = await resolveTaskScope(user, undefined);
    const valid = [];
    for (const item of assignments) {
      const parsed = taskAssignmentValidation.safeParse(item);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      if (employeeIds && !employeeIds.has(parsed.data.employeeId)) {
        return res.status(403).json({ message: "You can only assign tasks at your assigned store(s)" });
      }
      valid.push({ ...parsed.data, createdBy: user?.id ?? null });
    }
    const results = [];
    for (const item of valid) {
      results.push(await storage.createTaskAssignment(item));
    }
    res.status(201).json(results);
  });

  app.put("/api/task-assignments/:id", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updateSchema = taskAssignmentValidation.omit({ createdBy: true }).partial();
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const existing = await storage.getTaskAssignment(id);
      if (!existing) {
        return res.status(404).json({ message: "Task assignment not found" });
      }
      const { employeeIds } = await resolveTaskScope((req.session as any)?.user, undefined);
      if (employeeIds && (!employeeIds.has(existing.employeeId) ||
          (parsed.data.employeeId !== undefined && !employeeIds.has(parsed.data.employeeId)))) {
        return res.status(403).json({ message: "You can only change tasks at your assigned store(s)" });
      }
      const updated = await storage.updateTaskAssignment(id, parsed.data);
      res.json(updated);
    } catch (err) {
      console.error("[TaskAssignments] Update error:", err);
      res.status(500).json({ message: "Failed to update task assignment" });
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
    const user = (req.session as any)?.user;
    const { employeeIds, error } = await resolveTaskScope(user, location);
    if (error) return res.status(403).json({ message: error });

    let sourceAssignments = await storage.getTaskAssignments(sourceDate);
    if (employeeIds) {
      sourceAssignments = sourceAssignments.filter(a => employeeIds.has(a.employeeId));
    }

    if (sourceAssignments.length === 0) {
      return res.status(400).json({ message: "No task assignments to copy from source date" });
    }

    // Only the caller's stores (or the chosen store) are replaced on the target day.
    if (employeeIds) {
      await storage.deleteTaskAssignmentsForEmployees(targetDate, Array.from(employeeIds));
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
        createdBy: user?.id ?? a.createdBy,
      });
      results.push(created);
    }

    res.status(201).json({ message: `Copied ${results.length} task assignments`, count: results.length });
  });

  app.delete("/api/task-assignments/:id", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const existing = await storage.getTaskAssignment(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Task assignment not found" });
    const { employeeIds } = await resolveTaskScope((req.session as any)?.user, undefined);
    if (employeeIds && !employeeIds.has(existing.employeeId)) {
      return res.status(403).json({ message: "You can only change tasks at your assigned store(s)" });
    }
    await storage.deleteTaskAssignment(existing.id);
    res.status(204).send();
  });

  // Clear a day — for the selected store (?location=), or every store the
  // caller covers. Only an admin with no location clears every store.
  app.delete("/api/task-assignments", requireFeatureAccess("task_assignment.edit"), async (req, res) => {
    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Valid date query parameter (YYYY-MM-DD) is required" });
    }
    const { employeeIds, error } = await resolveTaskScope((req.session as any)?.user, req.query.location as string | undefined);
    if (error) return res.status(403).json({ message: error });
    const count = employeeIds
      ? await storage.deleteTaskAssignmentsForEmployees(date, Array.from(employeeIds))
      : await storage.deleteTaskAssignmentsByDate(date);
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
