// Outlook integration using Microsoft Graph API
// Uses Azure AD App Registration with client credentials flow for shared mailbox support

import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { storage } from './storage';

const ALWAYS_CC_EMAIL = "promano@goodwillgoodskills.org";

let graphClient: Client | null = null;

function getGraphClient(): Client {
  if (graphClient) {
    return graphClient;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure AD credentials not configured. Please set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET.');
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
  });

  graphClient = Client.initWithMiddleware({
    authProvider
  });

  return graphClient;
}

export interface OccurrenceAlertEmailData {
  employeeId: number;
  employeeName: string;
  employeeEmail?: string;
  jobTitle: string;
  location: string;
  netTally: number;
  threshold: 5 | 7 | 8;
  appUrl: string;
}

function getThresholdLabel(threshold: 5 | 7 | 8): string {
  switch (threshold) {
    case 8: return "Termination Threshold";
    case 7: return "Final Warning Threshold";
    case 5: return "Warning Threshold";
    default: return "Threshold";
  }
}

function getThresholdAction(threshold: 5 | 7 | 8): string {
  switch (threshold) {
    case 8: return "This employee has reached 8 occurrence points and may be subject to termination per company policy.";
    case 7: return "This employee has reached 7 occurrence points and should receive a final written warning.";
    case 5: return "This employee has reached 5 occurrence points and should receive a verbal or written warning.";
    default: return "Please review this employee's attendance record.";
  }
}

export async function sendOccurrenceAlertEmail(
  toEmail: string,
  data: OccurrenceAlertEmailData
): Promise<boolean> {
  try {
    const client = getGraphClient();
    
    // Get the sender email from environment (shared mailbox address)
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      throw new Error('HR_SENDER_EMAIL not configured. Please set the shared mailbox email address.');
    }
    
    const attendanceLink = `${data.appUrl}/attendance?employeeId=${data.employeeId}`;
    const thresholdLabel = getThresholdLabel(data.threshold);
    const thresholdAction = getThresholdAction(data.threshold);
    
    const emailBody = `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: ${data.threshold >= 8 ? '#dc2626' : data.threshold >= 7 ? '#ea580c' : '#f59e0b'}; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">Attendance Alert: ${thresholdLabel}</h2>
    </div>
    
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>An employee has reached ${data.netTally.toFixed(1)} occurrence points, triggering the <strong>${thresholdLabel.toLowerCase()}</strong>.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Employee:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${data.employeeName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Position:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${data.jobTitle}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Location:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${data.location}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Current Points:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${data.netTally.toFixed(1)}</td>
        </tr>
      </table>
      
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 20px 0;">
        <strong>Recommended Action:</strong><br>
        ${thresholdAction}
      </div>
      
      <p>
        <a href="${attendanceLink}" style="display: inline-block; background-color: #00539F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          View Attendance Record
        </a>
      </p>
      
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

    const message = {
      subject: `Attendance Alert: ${data.employeeName} - ${thresholdLabel}`,
      body: {
        contentType: 'HTML',
        content: emailBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: toEmail
          }
        }
      ],
      ccRecipients: toEmail.toLowerCase() !== ALWAYS_CC_EMAIL.toLowerCase() ? [{ emailAddress: { address: ALWAYS_CC_EMAIL } }] : [],
    };

    // Use the shared mailbox to send email (requires Mail.Send application permission)
    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    
    console.log(`[Outlook] Sent occurrence alert email for ${data.employeeName} to ${toEmail} from ${senderEmail}`);
    await storage.createEmailLog({
      type: "occurrence_alert",
      recipientEmail: toEmail,
      subject: message.subject,
      status: "sent",
      employeeName: data.employeeName,
      relatedId: data.employeeId,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send occurrence alert email:', error);
    void storage.createEmailLog({
      type: "occurrence_alert",
      recipientEmail: toEmail,
      subject: `Attendance Alert: ${data.employeeName} - ${getThresholdLabel(data.threshold)}`,
      status: "failed",
      error: error?.message || String(error),
      employeeName: data.employeeName,
      relatedId: data.employeeId,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

// Order submission notification email
export interface OrderNotificationEmailData {
  orderDate: string;
  orderType: string;
  location: string;
  submittedBy: string;
  nonZeroFields: { label: string; value: string | number }[];
  notes?: string | null;
  appUrl: string;
}

export async function sendOrderNotificationEmail(
  toEmail: string,
  data: OrderNotificationEmailData
): Promise<boolean> {
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for order notification');
      return false;
    }

    const fieldsHtml = data.nonZeroFields.map(f =>
      `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${f.label}</td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${f.value}</td></tr>`
    ).join("");

    const notesHtml = data.notes
      ? `<div style="background-color: #f9fafb; border-left: 4px solid #6b7280; padding: 12px 16px; margin: 16px 0;"><strong>Notes:</strong><br>${data.notes}</div>`
      : "";

    const emailBody = `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #00539F; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">New Order Submitted</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <table style="width: 100%; border-collapse: collapse; margin: 0 0 16px 0;">
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Date:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.orderDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Type:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.orderType}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Location:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.location}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Submitted By:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.submittedBy}</td>
        </tr>
      </table>

      ${fieldsHtml ? `<h3 style="margin: 16px 0 8px; font-size: 14px; color: #374151;">Order Details</h3><table style="width: 100%; border-collapse: collapse;">${fieldsHtml}</table>` : ""}

      ${notesHtml}

      <p style="margin-top: 20px;">
        <a href="${data.appUrl}/orders" style="display: inline-block; background-color: #00539F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          View Orders
        </a>
      </p>

      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

    const message = {
      subject: `GoodShift: New ${data.orderType} Order - ${data.location}`,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
      ccRecipients: toEmail.toLowerCase() !== ALWAYS_CC_EMAIL.toLowerCase() ? [{ emailAddress: { address: ALWAYS_CC_EMAIL } }] : [],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent order notification to ${toEmail} for ${data.orderType} at ${data.location}`);
    await storage.createEmailLog({
      type: "order_submission",
      recipientEmail: toEmail,
      subject: message.subject,
      status: "sent",
      employeeName: data.submittedBy,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send order notification:', error);
    void storage.createEmailLog({
      type: "order_submission",
      recipientEmail: toEmail,
      subject: `GoodShift: New ${data.orderType} Order - ${data.location}`,
      status: "failed",
      error: error?.message || String(error),
      employeeName: data.submittedBy,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

export async function sendOrderConfirmationEmail(
  toEmail: string,
  data: OrderNotificationEmailData
): Promise<boolean> {
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for order confirmation');
      return false;
    }

    const fieldsHtml = data.nonZeroFields.map(f =>
      `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${f.label}</td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${f.value}</td></tr>`
    ).join("");

    const notesHtml = data.notes
      ? `<div style="background-color: #f9fafb; border-left: 4px solid #6b7280; padding: 12px 16px; margin: 16px 0;"><strong>Notes:</strong><br>${data.notes}</div>`
      : "";

    const emailBody = `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #22c55e; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">Order Confirmation</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>Your order has been submitted successfully. Here is a summary of what was submitted:</p>

      <table style="width: 100%; border-collapse: collapse; margin: 0 0 16px 0;">
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Date:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.orderDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Type:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.orderType}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Location:</strong></td>
          <td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.location}</td>
        </tr>
      </table>

      ${fieldsHtml ? `<h3 style="margin: 16px 0 8px; font-size: 14px; color: #374151;">Order Details</h3><table style="width: 100%; border-collapse: collapse;">${fieldsHtml}</table>` : ""}

      ${notesHtml}

      <p style="margin-top: 20px;">
        <a href="${data.appUrl}/orders" style="display: inline-block; background-color: #00539F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          View All Orders
        </a>
      </p>

      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated confirmation from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

    const message = {
      subject: `Order Confirmation: ${data.orderType} - ${data.location} (${data.orderDate})`,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent order confirmation to ${toEmail}`);
    await storage.createEmailLog({
      type: "order_confirmation",
      recipientEmail: toEmail,
      subject: message.subject,
      status: "sent",
      employeeName: data.submittedBy,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send order confirmation:', error);
    void storage.createEmailLog({
      type: "order_confirmation",
      recipientEmail: toEmail,
      subject: `Order Confirmation: ${data.orderType} - ${data.location} (${data.orderDate})`,
      status: "failed",
      error: error?.message || String(error),
      employeeName: data.submittedBy,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

// Shift trade notification email
export interface TradeNotificationEmailData {
  recipientName: string;
  requesterName: string;
  responderName?: string;
  requesterShiftDate: string;
  requesterShiftTime: string;
  responderShiftDate: string;
  responderShiftTime: string;
  action: "requested" | "pending_manager" | "approved" | "declined";
  appUrl: string;
}

function getTradeActionDetails(action: TradeNotificationEmailData["action"]): { subject: string; heading: string; body: string; color: string } {
  switch (action) {
    case "requested":
      return {
        subject: "Shift Trade Request",
        heading: "New Shift Trade Request",
        body: "Someone would like to trade shifts with you. Please review the details below and respond.",
        color: "#3b82f6",
      };
    case "pending_manager":
      return {
        subject: "Shift Trade Needs Your Approval",
        heading: "Shift Trade Pending Approval",
        body: "Both employees have agreed to a shift trade. Please review and approve or decline.",
        color: "#f59e0b",
      };
    case "approved":
      return {
        subject: "Shift Trade Approved",
        heading: "Shift Trade Approved",
        body: "Your shift trade has been approved by a manager. The schedule has been updated automatically.",
        color: "#22c55e",
      };
    case "declined":
      return {
        subject: "Shift Trade Declined",
        heading: "Shift Trade Declined",
        body: "Unfortunately, the shift trade was declined.",
        color: "#ef4444",
      };
  }
}

export async function sendTradeNotificationEmail(
  toEmail: string,
  data: TradeNotificationEmailData
): Promise<boolean> {
  const details = getTradeActionDetails(data.action);
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for trade notification');
      return false;
    }

    const emailBody = `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: ${details.color}; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">${details.heading}</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>Hi ${data.recipientName},</p>
      <p>${details.body}</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>${data.requesterName}'s Shift:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${data.requesterShiftDate}<br>${data.requesterShiftTime}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>${data.responderName || "Trade Partner"}'s Shift:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${data.responderShiftDate}<br>${data.responderShiftTime}</td>
        </tr>
      </table>
      
      <p>
        <a href="${data.appUrl}" style="display: inline-block; background-color: #00539F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Open GoodShift
        </a>
      </p>
      
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

    const message = {
      subject: `GoodShift: ${details.subject} - ${data.requesterName}`,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
      ccRecipients: toEmail.toLowerCase() !== ALWAYS_CC_EMAIL.toLowerCase() ? [{ emailAddress: { address: ALWAYS_CC_EMAIL } }] : [],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent trade notification (${data.action}) to ${toEmail}`);
    await storage.createEmailLog({
      type: "shift_trade",
      recipientEmail: toEmail,
      subject: message.subject,
      status: "sent",
      employeeName: data.recipientName,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send trade notification:', error);
    void storage.createEmailLog({
      type: "shift_trade",
      recipientEmail: toEmail,
      subject: `GoodShift: ${details.subject} - ${data.requesterName}`,
      status: "failed",
      error: error?.message || String(error),
      employeeName: data.recipientName,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

export interface SchedulePublishEmailData {
  recipientName: string;
  weekStartDate: string;
  locationName: string;
  appUrl: string;
}

export function generateSchedulePublishEmailHtml(data: SchedulePublishEmailData): string {
  return `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #00539F; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">New Schedule Posted</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>Hi ${data.recipientName},</p>
      <p>A new schedule has been posted for the week of <strong>${data.weekStartDate}</strong> at <strong>${data.locationName}</strong>.</p>
      <p>Please log in to GoodShift to view your upcoming shifts.</p>
      
      <p style="margin-top: 24px;">
        <a href="${data.appUrl}" style="display: inline-block; background-color: #00539F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          View My Schedule
        </a>
      </p>
      
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendSchedulePublishEmail(
  toEmail: string,
  data: SchedulePublishEmailData
): Promise<boolean> {
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for schedule publish notification');
      return false;
    }

    const emailBody = generateSchedulePublishEmailHtml(data);

    const message = {
      subject: `GoodShift: New Schedule Posted - Week of ${data.weekStartDate}`,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
      ccRecipients: toEmail.toLowerCase() !== ALWAYS_CC_EMAIL.toLowerCase() ? [{ emailAddress: { address: ALWAYS_CC_EMAIL } }] : [],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent schedule publish notification to ${toEmail}`);
    await storage.createEmailLog({
      type: "schedule_publish",
      recipientEmail: toEmail,
      subject: message.subject,
      status: "sent",
      employeeName: data.recipientName,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send schedule publish email:', error);
    void storage.createEmailLog({
      type: "schedule_publish",
      recipientEmail: toEmail,
      subject: `GoodShift: New Schedule Posted - Week of ${data.weekStartDate}`,
      status: "failed",
      error: error?.message || String(error),
      employeeName: data.recipientName,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

// Trailer manifest in-transit notification (sent to destination store)
export interface TrailerInTransitEmailData {
  manifestId: number;
  fromLocation: string;
  toLocation: string;
  routeNumber: string | null;
  trailerNumber: string | null;
  sealNumber: string | null;
  driverName: string | null;
  itemSummary: { itemName: string; qty: number }[];
  notes: string | null;
  departedAt: string;
  appUrl: string;
}

export async function sendTrailerInTransitEmail(
  toEmail: string,
  data: TrailerInTransitEmailData
): Promise<boolean> {
  const subject = `GoodShift: Trailer In Transit to ${data.toLocation}${data.routeNumber ? ` (Route ${data.routeNumber})` : ""}`;
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for trailer in-transit notification');
      return false;
    }

    const itemsHtml = data.itemSummary.length
      ? `<h3 style="margin: 16px 0 8px; font-size: 14px; color: #374151;">Manifest Contents</h3>
         <table style="width: 100%; border-collapse: collapse;">
           ${data.itemSummary.map(i =>
             `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${i.itemName}</td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb; font-weight: 500; text-align: right;">${i.qty}</td></tr>`
           ).join("")}
         </table>`
      : `<p style="color:#6b7280;">No items recorded on this manifest.</p>`;

    const notesHtml = data.notes
      ? `<div style="background-color: #f9fafb; border-left: 4px solid #6b7280; padding: 12px 16px; margin: 16px 0;"><strong>Notes:</strong><br>${data.notes}</div>`
      : "";

    const detailRow = (label: string, value: string | null) =>
      value ? `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>${label}:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${value}</td></tr>` : "";

    const emailBody = `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #B45309; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">Trailer In Transit to ${data.toLocation}</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>A trailer manifest has been marked <strong>In Transit</strong> bound for your store.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 0 0 16px 0;">
        ${detailRow("From", data.fromLocation)}
        ${detailRow("To", data.toLocation)}
        ${detailRow("Departed", data.departedAt)}
        ${detailRow("Route #", data.routeNumber)}
        ${detailRow("Trailer #", data.trailerNumber)}
        ${detailRow("Seal #", data.sealNumber)}
        ${detailRow("Driver", data.driverName)}
      </table>

      ${itemsHtml}
      ${notesHtml}

      <p style="margin-top: 20px;">
        <a href="${data.appUrl}/trailer-manifests/${data.manifestId}" style="display: inline-block; background-color: #B45309; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          View Manifest
        </a>
      </p>

      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

    const message = {
      subject,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
      ccRecipients: toEmail.toLowerCase() !== ALWAYS_CC_EMAIL.toLowerCase() ? [{ emailAddress: { address: ALWAYS_CC_EMAIL } }] : [],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent trailer in-transit notification to ${toEmail} for manifest #${data.manifestId} (${data.fromLocation} -> ${data.toLocation})`);
    await storage.createEmailLog({
      type: "trailer_in_transit",
      recipientEmail: toEmail,
      subject,
      status: "sent",
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send trailer in-transit notification:', error);
    void storage.createEmailLog({
      type: "trailer_in_transit",
      recipientEmail: toEmail,
      subject,
      status: "failed",
      error: error?.message || String(error),
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

// Driver inspection repair alert
export interface DriverInspectionAlertEmailData {
  inspectionId: number;
  inspectionType: "tractor" | "trailer";
  driverName: string;
  routeNumber: string | null;
  tractorNumber: string | null;
  trailerNumber: string | null;
  startingMileage: number | null;
  submittedAt: string;
  repairItems: { label: string; section: "engine_off" | "engine_on" }[];
  notes: string | null;
  appUrl: string;
}

export async function sendDriverInspectionAlertEmail(
  toEmails: string[],
  data: DriverInspectionAlertEmailData
): Promise<boolean> {
  if (toEmails.length === 0) return false;
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for driver inspection alert');
      return false;
    }

    const repairRows = data.repairItems.map(r =>
      `<tr><td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb;">${r.section === "engine_off" ? "Engine Off" : "Engine On"}</td><td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${r.label}</td></tr>`
    ).join("");

    const notesHtml = data.notes
      ? `<div style="background-color: #f9fafb; border-left: 4px solid #6b7280; padding: 12px 16px; margin: 16px 0;"><strong>Driver's Notes:</strong><br>${data.notes.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`
      : "";

    const typeLabel = data.inspectionType === "tractor" ? "Tractor / Box Truck" : "Trailer";
    const vehicleLabel = data.inspectionType === "tractor"
      ? (data.tractorNumber || "—")
      : (data.trailerNumber || "—");

    const emailBody = `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 640px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #dc2626; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">Driver Inspection: Repair Needed</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>A driver has flagged repair items during a pre-trip inspection.</p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Submitted:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.submittedAt}</td></tr>
        <tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Driver:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.driverName}</td></tr>
        <tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Inspection Type:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${typeLabel}</td></tr>
        <tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>${data.inspectionType === "tractor" ? "Tractor/Truck #" : "Trailer #"}:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${vehicleLabel}</td></tr>
        ${data.inspectionType === "tractor" && data.trailerNumber ? `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Trailer #:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.trailerNumber}</td></tr>` : ""}
        <tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Route:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.routeNumber || "—"}</td></tr>
        ${data.startingMileage != null ? `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;"><strong>Starting Mileage:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${data.startingMileage.toLocaleString()}</td></tr>` : ""}
      </table>

      <h3 style="margin: 20px 0 8px; font-size: 15px; color: #111;">Items Flagged for Repair</h3>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb;">
        <thead><tr style="background-color: #f3f4f6;"><th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">Section</th><th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">Item</th></tr></thead>
        <tbody>${repairRows}</tbody>
      </table>

      ${notesHtml}

      <p style="margin-top: 24px;">
        <a href="${data.appUrl}/driver-inspections/${data.inspectionId}" style="display: inline-block; background-color: #00539F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          View Inspection
        </a>
      </p>

      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

    const [primary, ...rest] = toEmails;
    const message: any = {
      subject: `Driver Inspection Alert: ${data.repairItems.length} repair item${data.repairItems.length === 1 ? "" : "s"} - ${vehicleLabel}`,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: primary } }],
      ccRecipients: [
        ...rest.map(e => ({ emailAddress: { address: e } })),
        ...(toEmails.map(e => e.toLowerCase()).includes(ALWAYS_CC_EMAIL.toLowerCase()) ? [] : [{ emailAddress: { address: ALWAYS_CC_EMAIL } }]),
      ],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent driver inspection alert to ${toEmails.join(", ")}`);
    await storage.createEmailLog({
      type: "driver_inspection_alert",
      recipientEmail: toEmails.join(", "),
      subject: message.subject,
      status: "sent",
      employeeName: data.driverName,
      relatedId: data.inspectionId,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return true;
  } catch (error: any) {
    console.error('[Outlook] Failed to send driver inspection alert:', error);
    void storage.createEmailLog({
      type: "driver_inspection_alert",
      recipientEmail: toEmails.join(", "),
      subject: `Driver Inspection Alert - ${data.driverName}`,
      status: "failed",
      error: error?.message || String(error),
      employeeName: data.driverName,
      relatedId: data.inspectionId,
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return false;
  }
}

export async function testOutlookConnection(): Promise<{ success: boolean; error?: string; senderEmail?: string }> {
  try {
    const client = getGraphClient();
    
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      return { success: false, error: 'HR_SENDER_EMAIL not configured. Please set the shared mailbox email address.' };
    }
    
    // Test by getting the mailbox info for the sender
    const mailboxSettings = await client.api(`/users/${senderEmail}`).select('displayName,mail').get();
    
    return { 
      success: true, 
      senderEmail: mailboxSettings.mail || senderEmail 
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function sendTestEmail(toEmail: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getGraphClient();
    
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      return { success: false, error: 'HR_SENDER_EMAIL not configured.' };
    }
    
    const message = {
      subject: 'GoodShift HR Notifications - Test Email',
      body: {
        contentType: 'HTML',
        content: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #00539F; color: white; padding: 15px 20px; border-radius: 4px 4px 0 0;">
      <h2 style="margin: 0;">GoodShift HR Notifications</h2>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; background-color: #ffffff;">
      <p>This is a test email to confirm that HR notifications are working correctly.</p>
      <p>If you received this email, the email configuration is set up properly and you will receive automatic notifications when employees reach occurrence thresholds.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
        This is an automated notification from GoodShift.
      </p>
    </div>
  </div>
</body>
</html>`
      },
      toRecipients: [
        {
          emailAddress: {
            address: toEmail
          }
        }
      ],
      ccRecipients: toEmail.toLowerCase() !== ALWAYS_CC_EMAIL.toLowerCase() ? [{ emailAddress: { address: ALWAYS_CC_EMAIL } }] : [],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    
    console.log(`[Outlook] Sent test email to ${toEmail} from ${senderEmail}`);
    await storage.createEmailLog({
      type: "test",
      recipientEmail: toEmail,
      subject: message.subject,
      status: "sent",
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return { success: true };
  } catch (error: any) {
    console.error('[Outlook] Failed to send test email:', error);
    void storage.createEmailLog({
      type: "test",
      recipientEmail: toEmail,
      subject: "GoodShift HR Notifications - Test Email",
      status: "failed",
      error: error?.message || String(error),
    }).catch(e => console.error("[Outlook] Failed to log email:", e));
    return { success: false, error: error.message };
  }
}
