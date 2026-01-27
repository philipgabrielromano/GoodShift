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
  private clientId: string;
  private clientSecret: string;
  private cachedLocations: UKGLocation[] | null = null;
  private lastError: string | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    let url = process.env.UKG_API_URL || "";
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    if (url.includes("service4.ultipro.com")) {
      url = url.replace("service4.ultipro.com", "ew33.ultipro.com");
    }
    this.baseUrl = url;
    this.username = process.env.UKG_USERNAME || "";
    this.password = process.env.UKG_PASSWORD || "";
    this.clientId = process.env.UKG_API_KEY || "";
    this.clientSecret = process.env.UKG_USER_API_KEY || "";
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.username && this.password && this.clientId);
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const tokenUrl = `${this.baseUrl}/api/authentication/access_token`;
      console.log(`UKG: Getting access token from ${tokenUrl}`);
      
      const params = new URLSearchParams({
        username: this.username,
        password: this.password,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "password",
        auth_chain: "OAuthLdapService",
      });

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const responseText = await response.text();
      console.log("UKG: Token response status:", response.status);
      console.log("UKG: Token response:", responseText.slice(0, 500));

      if (!response.ok) {
        this.lastError = `Token request failed (${response.status}): ${responseText.slice(0, 300)}`;
        return null;
      }

      let data: { access_token?: string; expires_in?: number };
      try {
        data = JSON.parse(responseText);
      } catch {
        this.lastError = `Invalid token response JSON: ${responseText.slice(0, 200)}`;
        return null;
      }

      if (!data.access_token) {
        this.lastError = `No access_token in response: ${responseText.slice(0, 200)}`;
        return null;
      }

      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
      this.lastError = null;
      console.log("UKG: Access token obtained successfully");
      return this.accessToken;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Token request exception: ${message}`;
      console.error("UKG token error:", message);
      return null;
    }
  }

  private async apiRequest<T>(endpoint: string, method = "GET", body?: object): Promise<T | null> {
    const token = await this.getAccessToken();
    if (!token) {
      return null;
    }

    const url = `${this.baseUrl}/api${endpoint}`;
    console.log(`UKG: ${method} ${url}`);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": token,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const responseText = await response.text();
      console.log("UKG: API response status:", response.status);
      console.log("UKG: API response:", responseText.slice(0, 1000));

      if (!response.ok) {
        this.lastError = `API request failed (${response.status}): ${responseText.slice(0, 300)}`;
        return null;
      }

      try {
        return JSON.parse(responseText) as T;
      } catch {
        this.lastError = `Invalid JSON response: ${responseText.slice(0, 200)}`;
        return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `API request exception: ${message}`;
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
    console.log("UKG: Fetching employees via REST API");
    
    interface PersonResponse {
      personIdentity?: { personKey?: number };
      personInformation?: {
        personData?: {
          person?: {
            firstName?: string;
            lastName?: string;
          };
        };
        employmentStatusList?: Array<{
          employmentStatusName?: string;
        }>;
        expectedHoursList?: Array<{
          quantity?: number;
          timePeriodTypeName?: string;
        }>;
        jobAssignment?: {
          primaryLaborAccounts?: Array<{
            organizationPath?: string;
            laborCategoryName?: string;
          }>;
          baseWageRate?: { hourlyRate?: number };
        };
      };
    }

    interface MultiReadResponse {
      data?: {
        children?: Array<{
          key?: { PEOPLE?: string };
          coreEntityKey?: { EMP?: { id?: string } };
          attributes?: Array<{
            key?: string;
            value?: string;
          }>;
        }>;
      };
    }

    const multiReadBody = {
      select: [
        { key: "EMP_COMMON_FULL_NAME" },
        { key: "EMP_COMMON_PRIMARY_JOB" },
        { key: "EMP_COMMON_PRIMARY_ORG" },
        { key: "PEOPLE_HIRE_DATE" },
        { key: "EMP_COMMON_EMP_STATUS" },
      ],
      from: {
        view: "EMP",
        employeeSet: {
          hyperfind: { id: "1" },
          dateRange: {
            symbolicPeriod: { id: 5 }
          }
        }
      }
    };

    const result = await this.apiRequest<MultiReadResponse>("/v1/commons/data/multi_read", "POST", multiReadBody);
    
    if (!result) {
      console.log("UKG: multi_read failed, trying /v1/commons/persons endpoint...");
      
      const personsResult = await this.apiRequest<PersonResponse[]>("/v1/commons/persons");
      
      if (!personsResult) {
        return [];
      }

      return personsResult.map((person, index) => ({
        employeeId: String(person.personIdentity?.personKey || index),
        firstName: person.personInformation?.personData?.person?.firstName || "",
        lastName: person.personInformation?.personData?.person?.lastName || "",
        jobTitle: "Staff",
        employmentStatus: person.personInformation?.employmentStatusList?.[0]?.employmentStatusName || "Active",
        scheduledHours: person.personInformation?.expectedHoursList?.find(h => h.timePeriodTypeName === "Weekly")?.quantity || 40,
      }));
    }

    const employees: UKGProEmployee[] = [];
    
    if (result.data?.children) {
      for (const child of result.data.children) {
        const attrs = child.attributes || [];
        const getAttr = (key: string) => attrs.find(a => a.key === key)?.value;
        
        const fullName = getAttr("EMP_COMMON_FULL_NAME") || "";
        const nameParts = fullName.split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        
        if (firstName || lastName) {
          employees.push({
            employeeId: child.coreEntityKey?.EMP?.id || child.key?.PEOPLE || "",
            firstName,
            lastName,
            jobTitle: getAttr("EMP_COMMON_PRIMARY_JOB") || "Staff",
            orgLevel1Description: getAttr("EMP_COMMON_PRIMARY_ORG"),
            employmentStatus: getAttr("EMP_COMMON_EMP_STATUS") || "Active",
            scheduledHours: 40,
          });
        }
      }
    }

    this.lastError = null;
    console.log(`UKG: Fetched ${employees.length} employees`);
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
    this.accessToken = null;
    this.tokenExpiry = 0;
  }
}

export const ukgClient = new UKGClient();
export type { UKGProEmployee, UKGLocation };
