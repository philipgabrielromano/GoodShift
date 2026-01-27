import { InsertEmployee } from "@shared/schema";

interface UKGProEmployee {
  employeeId: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  workLocationCode?: string;
  workLocationDescription?: string;
  orgLevel1Code?: string;
  orgLevel1Description?: string;
  orgLevel2Code?: string;
  orgLevel2Description?: string;
  employmentStatus?: string;
  scheduledHours?: number;
}

interface UKGLocation {
  id: string;
  name: string;
  code: string;
}

class UKGClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private customerApiKey: string;
  private cachedLocations: UKGLocation[] | null = null;
  private lastError: string | null = null;

  constructor() {
    let url = process.env.UKG_API_URL || "";
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    if (url.includes("/services")) {
      url = url.split("/services")[0];
    }
    this.baseUrl = url;
    this.username = process.env.UKG_USERNAME || "";
    this.password = process.env.UKG_PASSWORD || "";
    this.customerApiKey = process.env.UKG_API_KEY || "";
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.username && this.password && this.customerApiKey);
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private getAuthHeaders(): Record<string, string> {
    const basicAuth = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return {
      "Authorization": `Basic ${basicAuth}`,
      "Us-Customer-Api-Key": this.customerApiKey,
      "Content-Type": "application/json",
    };
  }

  private async apiRequest<T>(endpoint: string, method = "GET", body?: object): Promise<T | null> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`UKG: ${method} ${url}`);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      const responseText = await response.text();
      console.log("UKG: API response status:", response.status);
      console.log("UKG: API response:", responseText.slice(0, 1000));

      if (!response.ok) {
        this.lastError = `API error (${response.status}): ${responseText.slice(0, 300)}`;
        return null;
      }

      if (!responseText.trim()) {
        return [] as unknown as T;
      }

      try {
        return JSON.parse(responseText) as T;
      } catch {
        this.lastError = `Invalid JSON: ${responseText.slice(0, 200)}`;
        return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `API exception: ${message}`;
      console.error("UKG API error:", message);
      return null;
    }
  }

  async getLocations(): Promise<UKGLocation[]> {
    if (this.cachedLocations) {
      return this.cachedLocations;
    }

    try {
      const employees = await this.getAllEmployees();
      
      const locationMap = new Map<string, UKGLocation>();
      
      for (const emp of employees) {
        if (emp.workLocationCode && emp.workLocationDescription) {
          locationMap.set(emp.workLocationCode, {
            id: emp.workLocationCode,
            code: emp.workLocationCode,
            name: emp.workLocationDescription,
          });
        }
        if (emp.orgLevel1Code && emp.orgLevel1Description && !locationMap.has(emp.orgLevel1Code)) {
          locationMap.set(emp.orgLevel1Code, {
            id: emp.orgLevel1Code,
            code: emp.orgLevel1Code,
            name: emp.orgLevel1Description,
          });
        }
      }

      this.cachedLocations = Array.from(locationMap.values());
      return this.cachedLocations;
    } catch (error) {
      console.error("Failed to fetch locations from UKG:", error);
      return [];
    }
  }

  async getEmployeesByLocation(locationCode: string): Promise<UKGProEmployee[]> {
    try {
      const allEmployees = await this.getAllEmployees();
      return allEmployees.filter(emp => 
        emp.workLocationCode === locationCode || 
        emp.orgLevel1Code === locationCode
      );
    } catch (error) {
      console.error("Failed to fetch employees by location from UKG:", error);
      return [];
    }
  }

  async getAllEmployees(): Promise<UKGProEmployee[]> {
    console.log("UKG: Fetching employees via REST API with Basic Auth");
    
    interface EmployeeLookupResult {
      employeeId?: string;
      employeeNumber?: string;
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      primaryWorkLocation?: string;
      employmentStatus?: string;
      scheduledHours?: number;
    }

    interface PersonnelResult {
      content?: EmployeeLookupResult[];
      results?: EmployeeLookupResult[];
    }

    const result = await this.apiRequest<PersonnelResult | EmployeeLookupResult[]>("/personnel/v1/employees");
    
    if (!result) {
      console.log("UKG: /personnel/v1/employees failed, trying alternative endpoints...");
      
      const altResult = await this.apiRequest<PersonnelResult | EmployeeLookupResult[]>("/personnel/v1/employee-employment-details");
      
      if (!altResult) {
        const lookupResult = await this.apiRequest<EmployeeLookupResult[]>("/personnel/v1/employee-lookup", "POST", {
          employeeIdentifiers: []
        });
        
        if (!lookupResult) {
          return [];
        }
        
        return this.parseEmployeeResults(lookupResult);
      }
      
      return this.parseEmployeeResults(altResult);
    }

    return this.parseEmployeeResults(result);
  }

  private parseEmployeeResults(result: unknown): UKGProEmployee[] {
    const employees: UKGProEmployee[] = [];
    
    let items: unknown[] = [];
    if (Array.isArray(result)) {
      items = result;
    } else if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (Array.isArray(r.content)) {
        items = r.content;
      } else if (Array.isArray(r.results)) {
        items = r.results;
      }
    }
    
    for (const item of items) {
      if (item && typeof item === 'object') {
        const emp = item as Record<string, unknown>;
        const firstName = String(emp.firstName || emp.FirstName || "");
        const lastName = String(emp.lastName || emp.LastName || "");
        
        if (firstName || lastName) {
          employees.push({
            employeeId: String(emp.employeeId || emp.employeeNumber || emp.EmployeeId || ""),
            firstName,
            lastName,
            jobTitle: String(emp.jobTitle || emp.JobTitle || "Staff"),
            workLocationCode: String(emp.primaryWorkLocation || emp.workLocationCode || ""),
            workLocationDescription: String(emp.workLocationDescription || ""),
            employmentStatus: String(emp.employmentStatus || emp.EmploymentStatus || "Active"),
            scheduledHours: Number(emp.scheduledHours || emp.ScheduledHours || 40),
          });
        }
      }
    }

    this.lastError = null;
    console.log(`UKG: Parsed ${employees.length} employees`);
    return employees;
  }

  convertToAppEmployee(ukgEmployee: UKGProEmployee): InsertEmployee {
    const firstName = ukgEmployee.firstName || "";
    const lastName = ukgEmployee.lastName || "";
    
    return {
      name: `${firstName} ${lastName}`.trim() || "Unknown",
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@store.com`.replace(/\s+/g, ""),
      jobTitle: ukgEmployee.jobTitle || "Staff",
      maxWeeklyHours: ukgEmployee.scheduledHours || 40,
      isActive: ukgEmployee.employmentStatus?.toLowerCase() === "active" || 
                ukgEmployee.employmentStatus?.toLowerCase() === "a" ||
                !ukgEmployee.employmentStatus,
    };
  }

  clearCache(): void {
    this.cachedLocations = null;
  }
}

export const ukgClient = new UKGClient();
export type { UKGProEmployee, UKGLocation };
