import { InsertEmployee } from "@shared/schema";

interface UKGODataEmployee {
  Id: number;
  EmpId: string;
  FirstName: string;
  LastName: string;
  Active: string;
  Email?: string;
  JobId: number;
  LocationId: number;
  PayCate: string;
  PaygroupId?: number;
  OrgLevel1Id?: number;
}

interface UKGJob {
  Id: number;
  Name?: string;
  Description?: string;
  Code?: string;
}

interface UKGLocation {
  Id: number;
  Name?: string;
  Description?: string;
  Code?: string;
}

interface UKGProEmployee {
  employeeId: string;
  ukgId: number;
  firstName: string;
  lastName: string;
  email?: string;
  jobTitle: string;
  location: string;
  employmentType: string;
  isActive: boolean;
  scheduledHours: number;
}

interface UKGLocationInfo {
  id: string;
  name: string;
  code: string;
}

class UKGClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private cachedLocations: UKGLocationInfo[] | null = null;
  private lastError: string | null = null;
  private jobCache: Map<number, string> = new Map();
  private locationCache: Map<number, string> = new Map();

  constructor() {
    let url = process.env.UKG_API_URL || "";
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.username = process.env.UKG_USERNAME || "";
    this.password = process.env.UKG_PASSWORD || "";
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.username && this.password);
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private getAuthHeaders(): Record<string, string> {
    const preEncodedAuth = process.env.UKG_AUTH_HEADER;
    let authHeader: string;
    
    if (preEncodedAuth) {
      console.log("UKG: Using pre-encoded auth header from UKG_AUTH_HEADER");
      authHeader = preEncodedAuth.startsWith("Basic ") ? preEncodedAuth : `Basic ${preEncodedAuth}`;
    } else {
      console.log("UKG: Using username/password for auth (UKG_AUTH_HEADER not set)");
      const basicAuth = Buffer.from(`${this.username}:${this.password}`).toString("base64");
      authHeader = `Basic ${basicAuth}`;
    }
    
    return {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
  }

  private async apiRequest<T>(endpoint: string, method = "GET", timeoutMs = 30000): Promise<T | null> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`UKG: ${method} ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getAuthHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      console.log("UKG: API response status:", response.status);

      if (!response.ok) {
        this.lastError = `API error (${response.status}): ${responseText.slice(0, 300)}`;
        return null;
      }

      if (!responseText.trim()) {
        return { value: [] } as unknown as T;
      }

      try {
        return JSON.parse(responseText) as T;
      } catch {
        this.lastError = `Invalid JSON: ${responseText.slice(0, 200)}`;
        return null;
      }
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        this.lastError = `API timeout after ${timeoutMs}ms`;
        console.error(`UKG API timeout: ${url}`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = `API exception: ${message}`;
        console.error("UKG API error:", message);
      }
      return null;
    }
  }

  private async fetchAllPaginated<T>(endpoint: string): Promise<T[]> {
    const allItems: T[] = [];
    const pageSize = 500;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      interface ODataResponse {
        value?: T[];
        "@odata.nextLink"?: string;
      }

      const result = await this.apiRequest<ODataResponse>(`/${endpoint}?$top=${pageSize}&$skip=${skip}`);
      
      if (!result?.value || result.value.length === 0) {
        hasMore = false;
      } else {
        allItems.push(...result.value);
        console.log(`UKG: Fetched ${result.value.length} items from ${endpoint} (total: ${allItems.length})`);
        
        if (result.value.length < pageSize) {
          hasMore = false;
        } else {
          skip += pageSize;
        }
      }
    }

    return allItems;
  }

  private async loadJobsAndLocations(): Promise<void> {
    if (this.jobCache.size > 0 && this.locationCache.size > 0) {
      return;
    }

    console.log("UKG: Loading jobs and locations lookup tables...");

    const [jobs, locations] = await Promise.all([
      this.fetchAllPaginated<UKGJob>("Job"),
      this.fetchAllPaginated<UKGLocation>("Location"),
    ]);

    for (const job of jobs) {
      const name = job.Name || job.Description || job.Code || `Job ${job.Id}`;
      this.jobCache.set(job.Id, name);
    }
    console.log(`UKG: Loaded ${this.jobCache.size} jobs`);

    for (const location of locations) {
      const name = location.Name || location.Description || location.Code || `Location ${location.Id}`;
      this.locationCache.set(location.Id, name);
    }
    console.log(`UKG: Loaded ${this.locationCache.size} locations`);
  }

  async getLocations(): Promise<UKGLocationInfo[]> {
    if (this.cachedLocations) {
      return this.cachedLocations;
    }

    await this.loadJobsAndLocations();
    
    this.cachedLocations = Array.from(this.locationCache.entries()).map(([id, name]) => ({
      id: String(id),
      code: String(id),
      name,
    }));

    return this.cachedLocations;
  }

  async getEmployeesByLocation(locationCode: string): Promise<UKGProEmployee[]> {
    const allEmployees = await this.getAllEmployees();
    const locationId = parseInt(locationCode);
    return allEmployees.filter(emp => emp.location === this.locationCache.get(locationId));
  }

  async getAllEmployees(): Promise<UKGProEmployee[]> {
    console.log("UKG: Fetching all employees with pagination...");
    
    await this.loadJobsAndLocations();
    this.lastError = null;
    
    const rawEmployees = await this.fetchAllPaginated<UKGODataEmployee>("Employee");
    console.log(`UKG: Total employees fetched: ${rawEmployees.length}`);
    
    // Debug: Log first 3 raw employee records to see available fields
    if (rawEmployees.length > 0) {
      console.log("UKG DEBUG: Sample raw employee records:");
      rawEmployees.slice(0, 3).forEach((emp, i) => {
        console.log(`UKG DEBUG Employee ${i + 1}:`, JSON.stringify(emp, null, 2));
      });
    }

    const employees: UKGProEmployee[] = rawEmployees.map(emp => {
      const jobTitle = this.jobCache.get(emp.JobId) || "Staff";
      const location = this.locationCache.get(emp.LocationId) || "";
      const employmentType = emp.PayCate === "1" ? "Full-Time" : "Part-Time";
      const isActive = emp.Active === "A";

      return {
        employeeId: emp.EmpId,
        ukgId: emp.Id,
        firstName: emp.FirstName || "",
        lastName: emp.LastName || "",
        email: emp.Email || undefined,
        jobTitle,
        location,
        employmentType,
        isActive,
        scheduledHours: employmentType === "Full-Time" ? 40 : 25,
      };
    });

    console.log(`UKG: Processed ${employees.length} employees`);
    console.log(`UKG: Active: ${employees.filter(e => e.isActive).length}, Terminated: ${employees.filter(e => !e.isActive).length}`);
    
    return employees;
  }

  convertToAppEmployee(ukgEmployee: UKGProEmployee): InsertEmployee {
    const firstName = ukgEmployee.firstName || "";
    const lastName = ukgEmployee.lastName || "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown";
    
    let email = ukgEmployee.email;
    if (!email || email.trim() === "") {
      email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@store.com`.replace(/\s+/g, "");
    }
    
    return {
      name: fullName,
      email,
      jobTitle: ukgEmployee.jobTitle || "Staff",
      maxWeeklyHours: ukgEmployee.scheduledHours || 40,
      isActive: ukgEmployee.isActive,
      location: ukgEmployee.location || null,
      employmentType: ukgEmployee.employmentType || null,
      ukgEmployeeId: String(ukgEmployee.ukgId),
    };
  }

  clearCache(): void {
    this.cachedLocations = null;
    this.jobCache.clear();
    this.locationCache.clear();
  }
}

export const ukgClient = new UKGClient();
export type { UKGProEmployee, UKGLocationInfo as UKGLocation };
