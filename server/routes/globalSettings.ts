import type { Express } from "express";
import { z } from "zod";
import { api } from "@shared/routes";
import type { GlobalSettings } from "@shared/schema";
import { storage } from "../storage";
import { requireAuth, requireFeatureAccess } from "../middleware";

function withoutCredentials(settings: GlobalSettings) {
  const { ukgApiUrl, ukgUsername, ukgPassword, ...generalSettings } = settings;
  return generalSettings;
}

export function registerGlobalSettingsRoutes(app: Express) {
  app.get(api.globalSettings.get.path, requireAuth, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    if (!settings) return res.json(settings);
    const generalSettings = withoutCredentials(settings);
    if ((req.session as any)?.user?.role !== "admin") {
      const { hrNotificationEmail, orderNotificationEmails, firstAidNotificationEmails, driverInspectionEmails, warehouseVarianceEmailsCleveland, warehouseVarianceEmailsCanton, ...safeSettings } = generalSettings;
      return res.json(safeSettings);
    }
    res.json(generalSettings);
  });

  app.post(api.globalSettings.update.path, requireFeatureAccess("settings.global_config"), async (req, res) => {
    try {
      const input = api.globalSettings.update.input.parse(req.body);
      const settings = await storage.updateGlobalSettings(input);
      res.json(withoutCredentials(settings));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
}