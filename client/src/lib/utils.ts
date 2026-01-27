import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const JOB_CODE_TITLES: Record<string, string> = {
  APPROC: "Apparel Processor",
  DONDOOR: "Donor Greeter",
  CASHSLS: "Cashier",
  DONPRI: "Donation Pricing",
  STSUPER: "Store Manager",
  STRSUPER: "Store Manager",
  STASSTSP: "Assistant Manager",
  STLDWKR: "Team Lead",
  PART: "Part-Time Staff",
  CUST: "Custodian",
};

export function getJobTitle(code: string): string {
  if (!code) return "";
  const upperCode = code.toUpperCase();
  return JOB_CODE_TITLES[upperCode] || code;
}
