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

interface UKGAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

class UKGClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private apiKey: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.baseUrl = process.env.UKG_API_URL || "";
    this.clientId = process.env.UKG_CLIENT_ID || "";
    this.clientSecret = process.env.UKG_CLIENT_SECRET || "";
    this.apiKey = process.env.UKG_API_KEY || "";
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.clientId && this.clientSecret && this.apiKey);
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/authentication/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Api-Key": this.apiKey,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`UKG authentication failed: ${response.statusText}`);
    }

    const data: UKGAuthResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);
    return this.accessToken;
  }

  private async request<T>(endpoint: string, method = "GET", body?: object): Promise<T> {
    const token = await this.authenticate();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
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
