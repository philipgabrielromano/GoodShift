
import { z } from 'zod';
import { 
  insertEmployeeSchema, 
  insertTimeOffRequestSchema, 
  insertShiftSchema, 
  insertRoleRequirementSchema,
  insertGlobalSettingsSchema,
  insertUserSchema,
  insertLocationSchema,
  insertShiftPresetSchema,
  employees,
  timeOffRequests,
  shifts,
  roleRequirements,
  globalSettings,
  users,
  locations,
  shiftPresets
} from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  employees: {
    list: {
      method: 'GET' as const,
      path: '/api/employees',
      responses: {
        200: z.array(z.custom<typeof employees.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/employees/:id',
      responses: {
        200: z.custom<typeof employees.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/employees',
      input: insertEmployeeSchema,
      responses: {
        201: z.custom<typeof employees.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/employees/:id',
      input: insertEmployeeSchema.partial(),
      responses: {
        200: z.custom<typeof employees.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/employees/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  
  shifts: {
    list: {
      method: 'GET' as const,
      path: '/api/shifts',
      input: z.object({
        start: z.string().optional(), // ISO date string
        end: z.string().optional(),   // ISO date string
        employeeId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof shifts.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/shifts',
      input: insertShiftSchema,
      responses: {
        201: z.custom<typeof shifts.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/shifts/:id',
      input: insertShiftSchema.partial(),
      responses: {
        200: z.custom<typeof shifts.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/shifts/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },

  timeOffRequests: {
    list: {
      method: 'GET' as const,
      path: '/api/time-off-requests',
      responses: {
        200: z.array(z.custom<typeof timeOffRequests.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/time-off-requests',
      input: insertTimeOffRequestSchema,
      responses: {
        201: z.custom<typeof timeOffRequests.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/time-off-requests/:id',
      input: insertTimeOffRequestSchema.partial(),
      responses: {
        200: z.custom<typeof timeOffRequests.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
  },

  roleRequirements: {
    list: {
      method: 'GET' as const,
      path: '/api/role-requirements',
      responses: {
        200: z.array(z.custom<typeof roleRequirements.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/role-requirements',
      input: insertRoleRequirementSchema,
      responses: {
        201: z.custom<typeof roleRequirements.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/role-requirements/:id',
      input: insertRoleRequirementSchema.partial(),
      responses: {
        200: z.custom<typeof roleRequirements.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/role-requirements/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },

  globalSettings: {
    get: {
      method: 'GET' as const,
      path: '/api/global-settings',
      responses: {
        200: z.custom<typeof globalSettings.$inferSelect>(),
      },
    },
    update: {
      method: 'POST' as const,
      path: '/api/global-settings',
      input: insertGlobalSettingsSchema,
      responses: {
        200: z.custom<typeof globalSettings.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },

  schedule: {
    generate: {
      method: 'POST' as const,
      path: '/api/schedule/generate',
      input: z.object({
        weekStart: z.string(),
        location: z.string().optional(),
      }),
      responses: {
        201: z.array(z.custom<typeof shifts.$inferSelect>()),
        400: errorSchemas.validation,
      },
    },
  },

  auth: {
    status: {
      method: 'GET' as const,
      path: '/api/auth/status',
      responses: {
        200: z.object({
          isAuthenticated: z.boolean(),
          user: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
          }).nullable(),
          ssoConfigured: z.boolean(),
        }),
      },
    },
    login: {
      method: 'GET' as const,
      path: '/api/auth/login',
      responses: {
        302: z.any(),
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout',
      responses: {
        200: z.object({ success: z.boolean() }),
      },
    },
  },

  ukg: {
    status: {
      method: 'GET' as const,
      path: '/api/ukg/status',
      responses: {
        200: z.object({
          configured: z.boolean(),
          connected: z.boolean(),
        }),
      },
    },
    stores: {
      method: 'GET' as const,
      path: '/api/ukg/stores',
      responses: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          code: z.string(),
        })),
      },
    },
    employees: {
      method: 'GET' as const,
      path: '/api/ukg/employees',
      responses: {
        200: z.array(z.object({
          id: z.string(),
          firstName: z.string(),
          lastName: z.string(),
          jobTitle: z.string(),
          maxHoursPerWeek: z.number().optional(),
          storeId: z.string().optional(),
          status: z.enum(["active", "inactive"]),
        })),
      },
    },
    sync: {
      method: 'POST' as const,
      path: '/api/ukg/sync',
      input: z.object({
        storeId: z.string().optional(),
      }),
      responses: {
        200: z.object({
          imported: z.number(),
          updated: z.number(),
          errors: z.number(),
        }),
        400: errorSchemas.validation,
      },
    },
    discover: {
      method: 'GET' as const,
      path: '/api/ukg/discover',
      responses: {
        200: z.object({
          entities: z.array(z.object({
            name: z.string(),
            accessible: z.boolean(),
            fields: z.array(z.string()),
          })),
          error: z.string().nullable(),
        }),
      },
    },
    timeclock: {
      method: 'GET' as const,
      path: '/api/ukg/timeclock',
      responses: {
        200: z.object({
          entries: z.array(z.object({
            employeeId: z.string(),
            date: z.string(),
            clockIn: z.string(),
            clockOut: z.string(),
            regularHours: z.number(),
            overtimeHours: z.number(),
            totalHours: z.number(),
            locationId: z.number(),
            jobId: z.number(),
          })),
          error: z.string().nullable(),
        }),
      },
    },
  },
  users: {
    list: {
      method: 'GET' as const,
      path: '/api/users',
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/users/:id',
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/users',
      input: insertUserSchema,
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/users/:id',
      input: insertUserSchema.partial(),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/users/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  locations: {
    list: {
      method: 'GET' as const,
      path: '/api/locations',
      responses: {
        200: z.array(z.custom<typeof locations.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/locations/:id',
      responses: {
        200: z.custom<typeof locations.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/locations',
      input: insertLocationSchema,
      responses: {
        201: z.custom<typeof locations.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/locations/:id',
      input: insertLocationSchema.partial(),
      responses: {
        200: z.custom<typeof locations.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/locations/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },

  shiftPresets: {
    list: {
      method: 'GET' as const,
      path: '/api/shift-presets',
      responses: {
        200: z.array(z.custom<typeof shiftPresets.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/shift-presets/:id',
      responses: {
        200: z.custom<typeof shiftPresets.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/shift-presets',
      input: insertShiftPresetSchema,
      responses: {
        201: z.custom<typeof shiftPresets.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/shift-presets/:id',
      input: insertShiftPresetSchema.partial(),
      responses: {
        200: z.custom<typeof shiftPresets.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/shift-presets/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
