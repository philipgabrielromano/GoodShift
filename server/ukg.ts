import { InsertEmployee } from "@shared/schema";

interface UKGEmployee {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  maxHoursPerWeek?: number;
  storeId?: string;
  status: "active" | "inactive";
}

interface UKGStore {
  id: string;
  name: string;
  code: string;
}

class UKGClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private apiKey: string;

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
      "Api-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(endpoint: string, method = "GET", body?: object): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: this.getAuthHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`UKG API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getStores(): Promise<UKGStore[]> {
    try {
      const data = await this.request<{ stores: UKGStore[] }>("/personnel/v1/org-levels");
      return data.stores || [];
    } catch (error) {
      console.error("Failed to fetch stores from UKG:", error);
      return [];
    }
  }

  async getEmployeesByStore(storeId: string): Promise<UKGEmployee[]> {
    try {
      const data = await this.request<{ employees: UKGEmployee[] }>(
        `/personnel/v1/employees?storeId=${storeId}&status=active`
      );
      return data.employees || [];
    } catch (error) {
      console.error("Failed to fetch employees from UKG:", error);
      return [];
    }
  }

  async getAllEmployees(): Promise<UKGEmployee[]> {
    try {
      const data = await this.request<{ employees: UKGEmployee[] }>(
        "/personnel/v1/employees?status=active"
      );
      return data.employees || [];
    } catch (error) {
      console.error("Failed to fetch employees from UKG:", error);
      return [];
    }
  }

  convertToAppEmployee(ukgEmployee: UKGEmployee): InsertEmployee {
    return {
      name: `${ukgEmployee.firstName} ${ukgEmployee.lastName}`,
      email: `${ukgEmployee.firstName.toLowerCase()}.${ukgEmployee.lastName.toLowerCase()}@store.com`,
      jobTitle: ukgEmployee.jobTitle || "Staff",
      maxWeeklyHours: ukgEmployee.maxHoursPerWeek || 40,
      isActive: ukgEmployee.status === "active",
    };
  }
}

export const ukgClient = new UKGClient();
export type { UKGEmployee, UKGStore };
