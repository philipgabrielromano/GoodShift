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
  private apiKey: string;
  private cachedLocations: UKGLocation[] | null = null;

  constructor() {
    this.baseUrl = process.env.UKG_API_URL || "";
    this.username = process.env.UKG_USERNAME || "";
    this.password = process.env.UKG_PASSWORD || "";
    this.apiKey = process.env.UKG_API_KEY || "";
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.username && this.password && this.apiKey);
  }

  private getAuthHeaders(): Record<string, string> {
    const basicAuth = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return {
      "Authorization": `Basic ${basicAuth}`,
      "US-Customer-Api-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(endpoint: string, method = "GET", body?: object): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`UKG API Request: ${method} ${url}`);
    
    const response = await fetch(url, {
      method,
      headers: this.getAuthHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`UKG API error: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`UKG API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
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
    try {
      const data = await this.request<UKGProEmployee[] | { employees?: UKGProEmployee[] }>(
        "/personnel/v1/employees"
      );
      
      if (Array.isArray(data)) {
        return data;
      }
      return data.employees || [];
    } catch (error) {
      console.error("Failed to fetch employees from UKG:", error);
      return [];
    }
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
