import { renderEmailLayout, dv, type ResolvedBranding } from "./emailBranding";
import type { EmailTypeId } from "@shared/schema";

/**
 * Returns rendered HTML for any of the 9 email types using believable sample
 * data. Used by the Settings preview pane so admins can see exactly how each
 * template will look with the current branding.
 */
export function renderSampleEmail(type: EmailTypeId, branding: ResolvedBranding, appUrl: string): string {
  switch (type) {
    case "occurrence_alert": {
      const bodyHtml = `
        <p>An employee has reached ${dv("5.0", branding)} occurrence points, triggering the <strong>warning threshold</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><strong>Employee:</strong></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${dv("Jordan Patel", branding)}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><strong>Position:</strong></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">Cashier</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><strong>Location:</strong></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${dv("Wheeling Store", branding)}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><strong>Current Points:</strong></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${dv("5.0", branding)}</td></tr>
        </table>
        <div style="background-color:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:20px 0;">
          <strong>Recommended Action:</strong><br>This employee has reached 5 occurrence points and should receive a verbal or written warning.
        </div>`;
      return renderEmailLayout({ type, title: "Attendance Alert: Warning Threshold", bodyHtml, ctaLabel: "View Attendance Record", ctaHref: `${appUrl}/attendance`, branding, headerColorOverride: "#f59e0b" });
    }
    case "order_submitted": {
      const fields = [
        { label: "Tagging Guns", value: 4 },
        { label: "Receipt Paper (rolls)", value: 12 },
        { label: "Hangers (cases)", value: 6 },
      ];
      const fieldsHtml = fields.map(f => `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${f.label}</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv(f.value, branding)}</td></tr>`).join("");
      const bodyHtml = `
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Date:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 22, 2026</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Type:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Equipment", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Location:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Wheeling Store", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Submitted By:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Maria Lopez", branding)}</td></tr>
        </table>
        <h3 style="margin:16px 0 8px;font-size:14px;color:#374151;">Order Details</h3>
        <table style="width:100%;border-collapse:collapse;">${fieldsHtml}</table>`;
      return renderEmailLayout({ type, title: "New Order Submitted", bodyHtml, ctaLabel: "View Orders", ctaHref: `${appUrl}/orders`, branding });
    }
    case "order_confirmation": {
      const fieldsHtml = `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Tagging Guns</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv(4, branding)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Hangers (cases)</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv(6, branding)}</td></tr>`;
      const bodyHtml = `
        <p>Your order has been submitted successfully. Here is a summary of what was submitted:</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Date:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 22, 2026</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Type:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Equipment", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Location:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Wheeling Store", branding)}</td></tr>
        </table>
        <h3 style="margin:16px 0 8px;font-size:14px;color:#374151;">Order Details</h3>
        <table style="width:100%;border-collapse:collapse;">${fieldsHtml}</table>`;
      return renderEmailLayout({ type, title: "Order Confirmation", bodyHtml, ctaLabel: "View All Orders", ctaHref: `${appUrl}/orders`, branding, footerText: "This is an automated confirmation from GoodShift. Please do not reply to this email." });
    }
    case "order_fulfilled": {
      const itemsHtml = `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Tagging Guns</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${dv(4, branding)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Hangers (cases)</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${dv(6, branding)}</td></tr>`;
      const bodyHtml = `
        <p>The warehouse has marked your order as <strong>fulfilled</strong>. The items below are on their way or ready for pickup.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Order Date:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 22, 2026</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Type:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Equipment", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Location:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Wheeling Store", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Fulfilled By:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Marcus Chen", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Fulfilled At:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 23, 2026 9:14 AM</td></tr>
        </table>
        <h3 style="margin:16px 0 8px;font-size:14px;color:#374151;">Items Fulfilled</h3>
        <table style="width:100%;border-collapse:collapse;">${itemsHtml}</table>`;
      return renderEmailLayout({ type, title: "Order Fulfilled", bodyHtml, ctaLabel: "View Order", ctaHref: `${appUrl}/orders`, branding });
    }
    case "shift_trade": {
      const bodyHtml = `
        <p>Hi ${dv("Jordan Patel", branding)},</p>
        <p>Both employees have agreed to a shift trade. Please review and approve or decline.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><strong>Maria Lopez's Shift:</strong></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${dv("Mon Apr 27", branding)}<br>9:00 AM – 5:00 PM</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><strong>Marcus Chen's Shift:</strong></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${dv("Wed Apr 29", branding)}<br>12:00 PM – 8:00 PM</td></tr>
        </table>`;
      return renderEmailLayout({ type, title: "Shift Trade Pending Approval", bodyHtml, ctaLabel: "Open GoodShift", ctaHref: appUrl, branding });
    }
    case "schedule_published": {
      const bodyHtml = `
        <p>Hi ${dv("Jordan Patel", branding)},</p>
        <p>A new schedule has been posted for the week of ${dv("April 27, 2026", branding)} at ${dv("Wheeling Store", branding)}.</p>
        <p>Please log in to GoodShift to view your upcoming shifts.</p>`;
      return renderEmailLayout({ type, title: "New Schedule Posted", bodyHtml, ctaLabel: "View My Schedule", ctaHref: appUrl, branding });
    }
    case "trailer_in_transit": {
      const itemsHtml = `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Mixed Apparel (gaylords)</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500;">14</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Hardgoods (gaylords)</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500;">6</td></tr>`;
      const bodyHtml = `
        <p>A trailer manifest has been marked <strong>In Transit</strong> bound for your store.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>From:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Cleveland Warehouse", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>To:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Wheeling Store", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Departed:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 23, 2026 7:30 AM</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Route #:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("R-204", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Trailer #:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("TR-8821", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Driver:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Sam Reyes", branding)}</td></tr>
        </table>
        <h3 style="margin:16px 0 8px;font-size:14px;color:#374151;">Manifest Contents</h3>
        <table style="width:100%;border-collapse:collapse;">${itemsHtml}</table>`;
      return renderEmailLayout({ type, title: "Trailer In Transit to Wheeling Store", bodyHtml, ctaLabel: "View Manifest", ctaHref: `${appUrl}/trailer-manifests/123`, branding });
    }
    case "driver_inspection": {
      const repairRows = `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Engine Off</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-weight:500;">Headlights — left bulb out</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Engine On</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-weight:500;">Air pressure low</td></tr>`;
      const bodyHtml = `
        <p>A driver has flagged repair items during a pre-trip inspection.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Submitted:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 23, 2026 6:45 AM</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Driver:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Sam Reyes", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Inspection Type:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Tractor / Box Truck</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Tractor/Truck #:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("BT-4421", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Route:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("R-204", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Starting Mileage:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("128,402", branding)}</td></tr>
        </table>
        <h3 style="margin:20px 0 8px;font-size:15px;color:#111;">Items Flagged for Repair</h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
          <thead><tr style="background-color:#f3f4f6;"><th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;">Section</th><th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;">Item</th></tr></thead>
          <tbody>${repairRows}</tbody>
        </table>`;
      return renderEmailLayout({ type, title: "Driver Inspection: Repair Needed", bodyHtml, ctaLabel: "View Inspection", ctaHref: `${appUrl}/driver-inspections/42`, branding, maxWidthPx: 680 });
    }
    case "warehouse_variance": {
      const bodyHtml = `
        <p>The variance CSV for the Cleveland warehouse count on <strong>April 22, 2026</strong> is attached. Status: <strong>Finalized</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Warehouse:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Cleveland", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Count date:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">April 22, 2026</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Status:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Finalized</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Started by:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv("Marcus Chen", branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Items off:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${dv(7, branding)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Net variance:</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;color:#dc2626;font-weight:600;">-12 (abs 18)</td></tr>
        </table>`;
      return renderEmailLayout({ type, title: "Cleveland Warehouse Count Variance", bodyHtml, ctaLabel: "Open Count in GoodShift", ctaHref: `${appUrl}/warehouse-inventory/123`, branding, footerText: "Sent by Marcus Chen from GoodShift. The CSV header includes the same metadata shown above." });
    }
  }
}
