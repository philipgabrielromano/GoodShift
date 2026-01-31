// Outlook integration using Microsoft Graph API
// Uses Replit's Outlook connector for authentication

import { Client } from '@microsoft/microsoft-graph-client';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=outlook',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Outlook not connected');
  }
  return accessToken;
}

async function getOutlookClient() {
  const accessToken = await getAccessToken();

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken
    }
  });
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
    const client = await getOutlookClient();
    
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

    await client.api('/me/sendMail').post({ message });
    
    console.log(`[Outlook] Sent occurrence alert email for ${data.employeeName} to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Outlook] Failed to send occurrence alert email:', error);
    return false;
  }
}

export async function testOutlookConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await getOutlookClient();
    const user = await client.api('/me').get();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
