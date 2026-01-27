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

interface UKGTimeRecord {
  Id: number;
  EmpId: string;
  WorkDate: string;
  In: string;
  Out: string;
  InOrg: string;
  OutOrg: string;
  RegHr: number;
  Overt1: number;
  Overt2: number;
  Overt3: number;
  Overt4: number;
  Overt5: number;
  PaygroupId: number;
  LocationId: number;
  JobId: number;
  Status: number;
}

export interface TimeClockEntry {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  locationId: number;
  jobId: number;
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

  private async apiRequest<T>(endpoint: string, method = "GET", timeoutMs = 60000): Promise<T | null> {
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

    // Fetch locations FIRST (sequentially, not in parallel) to avoid rate limiting
    console.log("UKG: Fetching locations first...");
    const locations = await this.fetchAllPaginated<UKGLocation>("Location");
    
    for (const location of locations) {
      const name = location.Name || location.Description || location.Code || `Location ${location.Id}`;
      this.locationCache.set(location.Id, name);
    }
    console.log(`UKG: Loaded ${this.locationCache.size} locations`);

    // Small delay before fetching jobs
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then fetch jobs
    console.log("UKG: Fetching jobs...");
    const jobs = await this.fetchAllPaginated<UKGJob>("Job");

    for (const job of jobs) {
      const name = job.Name || job.Description || job.Code || `Job ${job.Id}`;
      this.jobCache.set(job.Id, name);
    }
    console.log(`UKG: Loaded ${this.jobCache.size} jobs`);
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
      // Use location name from cache, or fall back to LocationId number if lookup fails
      const location = this.locationCache.get(emp.LocationId) || (emp.LocationId ? `Location ${emp.LocationId}` : "");
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
        scheduledHours: employmentType === "Full-Time" ? 40 : 29,
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
      ukgEmployeeId: ukgEmployee.employeeId, // Use EmpId (string) for time clock matching
    };
  }

  clearCache(): void {
    this.cachedLocations = null;
    this.jobCache.clear();
    this.locationCache.clear();
  }

  // Fetch time clock data for a date range
  async getTimeClockData(startDate: string, endDate: string, locationId?: number): Promise<TimeClockEntry[]> {
    if (!this.isConfigured()) {
      this.lastError = "UKG API not configured";
      return [];
    }

    console.log(`UKG: Fetching time clock data from ${startDate} to ${endDate}`);

    try {
      // Build OData filter for date range
      // OData requires date format without quotes for Edm.Date type
      let filter = `WorkDate ge ${startDate} and WorkDate le ${endDate}`;
      if (locationId) {
        filter += ` and LocationId eq ${locationId}`;
      }

      const allRecords: UKGTimeRecord[] = [];
      const pageSize = 500;
      let skip = 0;
      let hasMore = true;

      while (hasMore) {
        interface ODataResponse {
          value?: UKGTimeRecord[];
        }

        const endpoint = `/Time?$filter=${encodeURIComponent(filter)}&$top=${pageSize}&$skip=${skip}`;
        const result = await this.apiRequest<ODataResponse>(endpoint);

        if (!result?.value || result.value.length === 0) {
          hasMore = false;
        } else {
          allRecords.push(...result.value);
          console.log(`UKG: Fetched ${result.value.length} time records (total: ${allRecords.length})`);
          
          if (result.value.length < pageSize) {
            hasMore = false;
          } else {
            skip += pageSize;
          }
        }
      }

      // Convert to TimeClockEntry format
      const entries: TimeClockEntry[] = allRecords.map(record => {
        const overtimeTotal = (record.Overt1 || 0) + (record.Overt2 || 0) + 
                              (record.Overt3 || 0) + (record.Overt4 || 0) + (record.Overt5 || 0);
        return {
          employeeId: record.EmpId,
          date: record.WorkDate,
          clockIn: record.In || record.InOrg || "",
          clockOut: record.Out || record.OutOrg || "",
          regularHours: record.RegHr || 0,
          overtimeHours: overtimeTotal,
          totalHours: (record.RegHr || 0) + overtimeTotal,
          locationId: record.LocationId,
          jobId: record.JobId,
        };
      });

      console.log(`UKG: Processed ${entries.length} time clock entries`);
      return entries;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Time clock fetch error: ${message}`;
      console.error("UKG Time clock error:", message);
      return [];
    }
  }

  // Get time clock data grouped by employee for easy lookup
  async getTimeClockByEmployee(startDate: string, endDate: string): Promise<Map<string, TimeClockEntry[]>> {
    const entries = await this.getTimeClockData(startDate, endDate);
    const byEmployee = new Map<string, TimeClockEntry[]>();

    for (const entry of entries) {
      const existing = byEmployee.get(entry.employeeId) || [];
      existing.push(entry);
      byEmployee.set(entry.employeeId, existing);
    }

    return byEmployee;
  }

  // Discover available OData entities/tables
  async discoverEntities(): Promise<string[]> {
    if (!this.isConfigured()) {
      this.lastError = "UKG API not configured";
      return [];
    }

    try {
      // OData typically exposes metadata at $metadata endpoint
      // But we can also try to get the service document which lists available entity sets
      const url = `${this.baseUrl}`;
      console.log(`UKG: Discovering entities at ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: "GET",
        headers: this.getAuthHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseText = await response.text();

      if (!response.ok) {
        this.lastError = `Discovery failed (${response.status}): ${responseText.slice(0, 300)}`;
        return [];
      }

      // Try to parse as JSON (OData service document)
      try {
        const data = JSON.parse(responseText);
        // OData service document typically has a "value" array with entity sets
        if (data.value && Array.isArray(data.value)) {
          return data.value.map((item: { name?: string; url?: string }) => item.name || item.url || "Unknown");
        }
        // Or it might be a direct object with entity names as keys
        return Object.keys(data).filter(key => !key.startsWith("@"));
      } catch {
        // If not JSON, try to extract entity names from XML
        const entityMatches = responseText.match(/EntitySet\s+Name="([^"]+)"/g);
        if (entityMatches) {
          return entityMatches.map(m => {
            const match = m.match(/Name="([^"]+)"/);
            return match ? match[1] : "Unknown";
          });
        }
        this.lastError = "Could not parse OData service document";
        return [];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Discovery error: ${message}`;
      return [];
    }
  }

  // Try to fetch sample data from a specific entity/table
  async probeEntity(entityName: string): Promise<{ success: boolean; sampleFields: string[]; count: number }> {
    if (!this.isConfigured()) {
      return { success: false, sampleFields: [], count: 0 };
    }

    try {
      interface ODataResponse {
        value?: Record<string, unknown>[];
        "@odata.count"?: number;
      }

      const result = await this.apiRequest<ODataResponse>(`/${entityName}?$top=1`);
      
      if (!result || !result.value || result.value.length === 0) {
        return { success: false, sampleFields: [], count: 0 };
      }

      const sampleRecord = result.value[0];
      const fields = Object.keys(sampleRecord).filter(key => !key.startsWith("@"));
      
      return { 
        success: true, 
        sampleFields: fields,
        count: result["@odata.count"] || result.value.length
      };
    } catch {
      return { success: false, sampleFields: [], count: 0 };
    }
  }
}

export const ukgClient = new UKGClient();
export type { UKGProEmployee, UKGLocationInfo as UKGLocation };
