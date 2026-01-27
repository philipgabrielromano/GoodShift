
import { z } from 'zod';
import { 
  insertEmployeeSchema, 
  insertTimeOffRequestSchema, 
  insertShiftSchema, 
  insertRoleRequirementSchema,
  insertGlobalSettingsSchema,
  employees,
  timeOffRequests,
  shifts,
  roleRequirements,
  globalSettings
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
        weekStart: z.string(), // ISO date string
      }),
      responses: {
        201: z.array(z.custom<typeof shifts.$inferSelect>()),
        400: errorSchemas.validation,
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
