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
  private userApiKey: string;
  private cachedLocations: UKGLocation[] | null = null;
  private lastError: string | null = null;
  private authToken: string | null = null;

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
    this.customerApiKey = process.env.UKG_API_KEY || "";
    this.userApiKey = process.env.UKG_USER_API_KEY || "";
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.username && this.password && this.customerApiKey);
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private safeStringify(obj: unknown): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    }, 2);
  }

  private buildLoginSoapRequest(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://www.ultipro.com/services/loginservice/ILoginService/Authenticate</a:Action>
    <h:ClientAccessKey xmlns:h="http://www.ultipro.com/services/loginservice">${this.customerApiKey}</h:ClientAccessKey>
    <h:Password xmlns:h="http://www.ultipro.com/services/loginservice">${this.password}</h:Password>
    <h:UserAccessKey xmlns:h="http://www.ultipro.com/services/loginservice">${this.userApiKey}</h:UserAccessKey>
    <h:UserName xmlns:h="http://www.ultipro.com/services/loginservice">${this.username}</h:UserName>
  </s:Header>
  <s:Body>
    <TokenRequest xmlns="http://www.ultipro.com/contracts" />
  </s:Body>
</s:Envelope>`;
  }

  private buildFindPeopleSoapRequest(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://www.ultipro.com/services/employeeperson/IEmployeePerson/FindPeople</a:Action>
    <UltiProToken xmlns="http://www.ultimatesoftware.com/foundation/authentication/ultiprotoken">${this.authToken}</UltiProToken>
    <ClientAccessKey xmlns="http://www.ultimatesoftware.com/foundation/authentication/clientaccesskey">${this.customerApiKey}</ClientAccessKey>
  </s:Header>
  <s:Body>
    <FindPeople xmlns="http://www.ultipro.com/services/employeeperson">
      <query xmlns:b="http://www.ultipro.com/contracts" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <b:PageNumber>1</b:PageNumber>
        <b:PageSize>100</b:PageSize>
      </query>
    </FindPeople>
  </s:Body>
</s:Envelope>`;
  }

  async authenticate(): Promise<boolean> {
    try {
      const loginUrl = `${this.baseUrl}/services/LoginService`;
      console.log(`UKG: Authenticating via ${loginUrl}`);
      
      const soapRequest = this.buildLoginSoapRequest();
      console.log("UKG: Login request (masked):", soapRequest.replace(this.password, "***").replace(this.userApiKey, "***"));
      
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
        },
        body: soapRequest,
      });

      const responseText = await response.text();
      console.log("UKG: Login response status:", response.status);
      console.log("UKG: Login response:", responseText.slice(0, 1000));

      if (!response.ok) {
        this.lastError = `Login failed with status ${response.status}: ${responseText.slice(0, 500)}`;
        return false;
      }

      const tokenMatch = responseText.match(/<a:Token[^>]*>([^<]+)<\/a:Token>/i) ||
                         responseText.match(/<Token[^>]*>([^<]+)<\/Token>/i) ||
                         responseText.match(/>([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})</i);
      
      if (tokenMatch && tokenMatch[1]) {
        this.authToken = tokenMatch[1];
        this.lastError = null;
        console.log("UKG: Authentication successful, token obtained");
        return true;
      } else {
        const errorMatch = responseText.match(/<[^>]*Message[^>]*>([^<]+)<\/[^>]*Message>/i) ||
                          responseText.match(/<[^>]*Fault[^>]*>([^<]+)<\/[^>]*Fault>/i);
        this.lastError = `Login failed: ${errorMatch ? errorMatch[1] : "No token in response"}. Response: ${responseText.slice(0, 300)}`;
        return false;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Login exception: ${message}`;
      console.error("UKG Authentication error:", message);
      return false;
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
    try {
      console.log("UKG: Fetching employees");
      
      if (!this.authToken) {
        console.log("UKG: No auth token, authenticating first...");
        const authenticated = await this.authenticate();
        if (!authenticated) {
          return [];
        }
      }

      const personUrl = `${this.baseUrl}/services/EmployeePerson`;
      console.log(`UKG: Calling FindPeople at ${personUrl}`);
      
      const soapRequest = this.buildFindPeopleSoapRequest();
      console.log("UKG: FindPeople request:", soapRequest.slice(0, 500));
      
      const response = await fetch(personUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
        },
        body: soapRequest,
      });

      const responseText = await response.text();
      console.log("UKG: FindPeople response status:", response.status);
      console.log("UKG: FindPeople response:", responseText.slice(0, 1500));

      if (!response.ok) {
        if (response.status === 401 || responseText.includes("Authentication") || responseText.includes("Token")) {
          console.log("UKG: Token may have expired, re-authenticating...");
          this.authToken = null;
          const authenticated = await this.authenticate();
          if (authenticated) {
            return this.getAllEmployees();
          }
        }
        this.lastError = `FindPeople failed with status ${response.status}: ${responseText.slice(0, 500)}`;
        return [];
      }

      const employees = this.parseEmployeesFromXml(responseText);
      this.lastError = null;
      console.log(`UKG: Fetched ${employees.length} employees`);
      return employees;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Failed to fetch employees: ${message}`;
      console.error("Failed to fetch employees from UKG:", message);
      return [];
    }
  }

  private parseEmployeesFromXml(xml: string): UKGProEmployee[] {
    const employees: UKGProEmployee[] = [];
    
    const personMatches = xml.matchAll(/<[^>]*Person[^>]*>([\s\S]*?)<\/[^>]*Person>/gi);
    
    for (const match of personMatches) {
      const personXml = match[1];
      
      const getValue = (tagName: string): string | undefined => {
        const regex = new RegExp(`<[^>]*${tagName}[^>]*>([^<]*)<\/[^>]*${tagName}>`, 'i');
        const m = personXml.match(regex);
        return m ? m[1].trim() : undefined;
      };

      const employeeId = getValue("EmployeeId") || getValue("EmployeeNumber") || "";
      const firstName = getValue("FirstName") || "";
      const lastName = getValue("LastName") || "";
      
      if (firstName || lastName) {
        employees.push({
          employeeId,
          firstName,
          lastName,
          jobTitle: getValue("JobTitle") || getValue("JobDescription") || "Staff",
          workLocationCode: getValue("LocationCode") || getValue("WorkLocationCode"),
          workLocationDescription: getValue("LocationDescription") || getValue("WorkLocationDescription"),
          orgLevel1Code: getValue("OrgLevel1Code"),
          orgLevel1Description: getValue("OrgLevel1Description"),
          employmentStatus: getValue("EmploymentStatus") || getValue("Status") || "Active",
          scheduledHours: parseFloat(getValue("ScheduledHours") || "40"),
        });
      }
    }

    if (employees.length === 0) {
      console.log("UKG: No Person elements found, trying alternative parsing...");
      const resultMatches = xml.matchAll(/<[^>]*Result[^>]*>([\s\S]*?)<\/[^>]*Result>/gi);
      for (const match of resultMatches) {
        const resultXml = match[1];
        const getValue = (tagName: string): string | undefined => {
          const regex = new RegExp(`<[^>]*${tagName}[^>]*>([^<]*)<\/[^>]*${tagName}>`, 'i');
          const m = resultXml.match(regex);
          return m ? m[1].trim() : undefined;
        };
        
        const firstName = getValue("FirstName") || "";
        const lastName = getValue("LastName") || "";
        
        if (firstName || lastName) {
          employees.push({
            employeeId: getValue("EmployeeId") || getValue("EmployeeNumber") || "",
            firstName,
            lastName,
            jobTitle: getValue("JobTitle") || "Staff",
            employmentStatus: "Active",
            scheduledHours: 40,
          });
        }
      }
    }

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
    this.authToken = null;
  }
}

export const ukgClient = new UKGClient();
export type { UKGProEmployee, UKGLocation };
