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
    const basicAuth = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
  }

  private getODataBaseUrl(): string {
    if (this.baseUrl.includes("ulticlock.com")) {
      return this.baseUrl;
    }
    const match = this.baseUrl.match(/https?:\/\/([^.]+)/);
    if (match) {
      const prefix = match[1].replace("service", "k");
      return `https://${prefix}.ulticlock.com/UtmOdataServices/api`;
    }
    return this.baseUrl.replace("ultipro.com", "ulticlock.com") + "/UtmOdataServices/api";
  }

  private async apiRequest<T>(endpoint: string, method = "GET"): Promise<T | null> {
    const baseUrl = this.getODataBaseUrl();
    const url = `${baseUrl}${endpoint}`;
    console.log(`UKG: ${method} ${url}`);
    console.log(`UKG: Headers (masked): Authorization: Basic ***`);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getAuthHeaders(),
      });

      const responseText = await response.text();
      console.log("UKG: API response status:", response.status);
      console.log("UKG: API response:", responseText.slice(0, 1500));

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
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `API exception: ${message}`;
      console.error("UKG API error:", message);
      return null;
    }
  }

  async discoverEndpoints(): Promise<string[]> {
    console.log("UKG: Discovering available OData endpoints...");
    
    interface ODataMetadata {
      value?: Array<{ name?: string; url?: string }>;
    }
    
    const result = await this.apiRequest<ODataMetadata>("");
    
    if (result?.value) {
      const endpoints = result.value.map(e => e.name || e.url || "").filter(Boolean);
      console.log("UKG: Available endpoints:", endpoints);
      return endpoints;
    }
    
    return [];
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
    console.log("UKG: Fetching employees via OData API");
    
    const endpoints = await this.discoverEndpoints();
    console.log("UKG: Discovered endpoints:", endpoints);
    
    const employeeEndpoints = ["Employee", "Employees", "Person", "Persons", "Worker", "Workers"];
    const matchingEndpoint = endpoints.find(e => 
      employeeEndpoints.some(ep => e.toLowerCase().includes(ep.toLowerCase()))
    );
    
    interface ODataResponse {
      value?: Array<Record<string, unknown>>;
    }

    if (matchingEndpoint) {
      console.log(`UKG: Found employee endpoint: ${matchingEndpoint}`);
      const result = await this.apiRequest<ODataResponse>(`/${matchingEndpoint}?$top=100`);
      
      if (result?.value) {
        return this.parseODataEmployees(result.value);
      }
    }

    console.log("UKG: No dedicated employee endpoint, trying Time data to extract employees...");
    const timeResult = await this.apiRequest<ODataResponse>("/Time?$top=100");
    
    if (timeResult?.value) {
      return this.extractEmployeesFromTimeData(timeResult.value);
    }

    const otherEndpoints = endpoints.filter(e => !e.toLowerCase().includes("time"));
    for (const endpoint of otherEndpoints.slice(0, 3)) {
      console.log(`UKG: Trying endpoint: ${endpoint}`);
      const result = await this.apiRequest<ODataResponse>(`/${endpoint}?$top=10`);
      if (result?.value && result.value.length > 0) {
        console.log(`UKG: Sample data from ${endpoint}:`, JSON.stringify(result.value[0]).slice(0, 500));
      }
    }

    return [];
  }

  private parseODataEmployees(data: Record<string, unknown>[]): UKGProEmployee[] {
    const employees: UKGProEmployee[] = [];
    
    for (const item of data) {
      const firstName = String(item.FirstName || item.firstName || item.first_name || "");
      const lastName = String(item.LastName || item.lastName || item.last_name || "");
      
      if (firstName || lastName) {
        employees.push({
          employeeId: String(item.EmployeeId || item.employeeId || item.employee_id || item.Id || item.id || ""),
          firstName,
          lastName,
          jobTitle: String(item.JobTitle || item.jobTitle || item.Position || item.position || "Staff"),
          workLocationCode: String(item.LocationCode || item.locationCode || item.Location || ""),
          workLocationDescription: String(item.LocationName || item.locationName || ""),
          employmentStatus: String(item.Status || item.status || item.EmploymentStatus || "Active"),
          scheduledHours: Number(item.ScheduledHours || item.scheduledHours || 40),
        });
      }
    }
    
    console.log(`UKG: Parsed ${employees.length} employees from OData`);
    return employees;
  }

  private extractEmployeesFromTimeData(timeData: Record<string, unknown>[]): UKGProEmployee[] {
    const employeeMap = new Map<string, UKGProEmployee>();
    
    for (const item of timeData) {
      const employeeId = String(item.EmployeeId || item.employeeId || item.employee_id || item.EmpId || "");
      const employeeName = String(item.EmployeeName || item.employeeName || item.employee_name || item.EmpName || "");
      
      if (employeeId && !employeeMap.has(employeeId)) {
        const nameParts = employeeName.split(/[,\s]+/).filter(Boolean);
        let firstName = "";
        let lastName = "";
        
        if (nameParts.length >= 2) {
          if (employeeName.includes(",")) {
            lastName = nameParts[0];
            firstName = nameParts.slice(1).join(" ");
          } else {
            firstName = nameParts[0];
            lastName = nameParts.slice(1).join(" ");
          }
        } else if (nameParts.length === 1) {
          firstName = nameParts[0];
        }
        
        employeeMap.set(employeeId, {
          employeeId,
          firstName,
          lastName,
          jobTitle: String(item.JobTitle || item.jobTitle || item.Position || "Staff"),
          workLocationCode: String(item.LocationCode || item.locationCode || item.Location || ""),
          workLocationDescription: String(item.LocationName || item.locationName || ""),
          employmentStatus: "Active",
          scheduledHours: 40,
        });
      }
    }
    
    const employees = Array.from(employeeMap.values());
    console.log(`UKG: Extracted ${employees.length} unique employees from time data`);
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
