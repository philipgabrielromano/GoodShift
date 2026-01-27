import { InsertEmployee } from "@shared/schema";
import * as soap from "soap";

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

  private getSoapSecurityHeader(): string {
    return `
      <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
        <wsse:UsernameToken>
          <wsse:Username>${this.username}</wsse:Username>
          <wsse:Password>${this.password}</wsse:Password>
        </wsse:UsernameToken>
      </wsse:Security>
    `;
  }

  private getServiceEndpoint(serviceName: string): string {
    return `${this.baseUrl}/services/${serviceName}`;
  }

  private getWsdlUrl(serviceName: string): string {
    return `${this.getServiceEndpoint(serviceName)}?wsdl`;
  }

  async authenticate(): Promise<boolean> {
    try {
      const wsdlUrl = this.getWsdlUrl("LoginService");
      console.log(`UKG: Authenticating via ${wsdlUrl}`);
      
      const client = await soap.createClientAsync(wsdlUrl);
      
      client.addSoapHeader(this.getSoapSecurityHeader());
      client.addHttpHeader("Us-Customer-Api-Key", this.customerApiKey);
      if (this.userApiKey) {
        client.addHttpHeader("Api-Key", this.userApiKey);
      }

      const [result] = await client.AuthenticateAsync({
        UserName: this.username,
        Password: this.password,
        ClientAccessKey: this.customerApiKey,
        UserAccessKey: this.userApiKey,
      });

      if (result?.Token) {
        this.authToken = result.Token;
        this.lastError = null;
        console.log("UKG: Authentication successful");
        return true;
      } else {
        this.lastError = "Authentication returned no token";
        return false;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Login failed: ${message}`;
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
      console.log("UKG: Fetching employees via SOAP");
      
      const wsdlUrl = this.getWsdlUrl("EmployeePerson");
      console.log(`UKG: WSDL URL: ${wsdlUrl}`);
      
      const client = await soap.createClientAsync(wsdlUrl);
      
      client.addSoapHeader(this.getSoapSecurityHeader());
      client.addHttpHeader("Us-Customer-Api-Key", this.customerApiKey);
      if (this.userApiKey) {
        client.addHttpHeader("Api-Key", this.userApiKey);
      }

      const operations = Object.keys(client).filter(k => 
        !k.startsWith("_") && 
        typeof (client as Record<string, unknown>)[k] === "function" &&
        k.endsWith("Async")
      );
      console.log("UKG: Available SOAP operations:", operations);
      
      const methods = client.describe();
      const safeDescribe = this.safeStringify(methods);
      console.log("UKG: Service description:", safeDescribe.slice(0, 2000));

      let result: unknown;
      const methodName = operations.find(op => 
        op.toLowerCase().includes("find") || 
        op.toLowerCase().includes("get") ||
        op.toLowerCase().includes("query")
      );

      if (!methodName) {
        this.lastError = `No suitable query method found. Available: ${operations.join(", ")}`;
        return [];
      }

      console.log(`UKG: Calling ${methodName}`);
      try {
        const method = (client as Record<string, Function>)[methodName];
        [result] = await method({});
      } catch (soapError: unknown) {
        const errMsg = soapError instanceof Error ? soapError.message : String(soapError);
        this.lastError = `SOAP ${methodName} error: ${errMsg}. Available operations: ${operations.join(", ")}`;
        throw soapError;
      }

      console.log("UKG: Raw result:", this.safeStringify(result).slice(0, 1000));
      
      const employees: UKGProEmployee[] = [];
      if (Array.isArray(result)) {
        for (const person of result) {
          employees.push({
            employeeId: person.EmployeeId || person.employeeId || "",
            firstName: person.FirstName || person.firstName || "",
            lastName: person.LastName || person.lastName || "",
            jobTitle: person.JobTitle || person.jobTitle || "Staff",
            employmentStatus: person.EmploymentStatus || person.employmentStatus || "Active",
          });
        }
      }

      this.lastError = null;
      console.log(`UKG: Fetched ${employees.length} employees`);
      return employees;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.lastError) {
        this.lastError = `Failed to fetch employees: ${message}`;
      }
      console.error("Failed to fetch employees from UKG:", message);
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
    this.authToken = null;
  }
}

export const ukgClient = new UKGClient();
export type { UKGProEmployee, UKGLocation };
