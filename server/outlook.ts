// Outlook integration using Microsoft Graph API
// Uses Azure AD App Registration with client credentials flow for shared mailbox support

import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

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
      ]
    };

    // Use the shared mailbox to send email (requires Mail.Send application permission)
    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    
    console.log(`[Outlook] Sent occurrence alert email for ${data.employeeName} to ${toEmail} from ${senderEmail}`);
    return true;
  } catch (error) {
    console.error('[Outlook] Failed to send occurrence alert email:', error);
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
  try {
    const client = getGraphClient();
    const senderEmail = process.env.HR_SENDER_EMAIL;
    if (!senderEmail) {
      console.error('[Outlook] HR_SENDER_EMAIL not configured for trade notification');
      return false;
    }

    const details = getTradeActionDetails(data.action);

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
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent trade notification (${data.action}) to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Outlook] Failed to send trade notification:', error);
    return false;
  }
}

export interface SchedulePublishEmailData {
  recipientName: string;
  weekStartDate: string;
  locationName: string;
  appUrl: string;
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

    const emailBody = `
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

    const message = {
      subject: `GoodShift: New Schedule Posted - Week of ${data.weekStartDate}`,
      body: { contentType: 'HTML', content: emailBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    console.log(`[Outlook] Sent schedule publish notification to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Outlook] Failed to send schedule publish email:', error);
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
      ]
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
    
    console.log(`[Outlook] Sent test email to ${toEmail} from ${senderEmail}`);
    return { success: true };
  } catch (error: any) {
    console.error('[Outlook] Failed to send test email:', error);
    return { success: false, error: error.message };
  }
}
