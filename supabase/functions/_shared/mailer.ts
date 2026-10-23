import nodemailer from "nodemailer";

export async function notifyAdminNewAccessRequest(applicantName: string, applicantEmail: string) {
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  const gmailUser = Deno.env.get("GMAIL_USER") || "veerraju.amanchi@gmail.com";
  const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "veerraju.amanchi@gmail.com";
  const webAppUrl = Deno.env.get("WEB_APP_URL") || "https://camping-club.onrender.com";

  const emailSubject = `🏕️ New Camping Club Access Request: ${applicantName}`;
  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <h2 style="color: #0f172a; margin-top: 0;">New Access Request</h2>
      <p style="color: #334155; font-size: 1rem;">A new applicant has requested access to the <strong>Private Camping Club</strong>:</p>
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 18px; border-radius: 6px; margin: 18px 0;">
        <p style="margin: 6px 0; font-size: 0.95rem;"><strong>Applicant Name:</strong> ${applicantName}</p>
        <p style="margin: 6px 0; font-size: 0.95rem;"><strong>Email:</strong> ${applicantEmail}</p>
        <p style="margin: 6px 0; font-size: 0.95rem;"><strong>Received:</strong> ${new Date().toUTCString()}</p>
      </div>
      <p style="margin-top: 24px;">
        <a href="${webAppUrl.replace(/\/$/, "")}/admin/members" style="background-color: #16a34a; color: #ffffff; padding: 11px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
          Review & Approve in Admin Panel →
        </a>
      </p>
    </div>
  `;

  // Option 1: Send via Gmail SMTP with App Password
  if (gmailPass && gmailUser) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true, // SSL
        auth: {
          user: gmailUser.trim(),
          pass: gmailPass.replace(/\s+/g, ""),
        },
      });

      await transporter.sendMail({
        from: `"Camping Club Alerts" <${gmailUser.trim()}>`,
        to: adminEmail,
        subject: emailSubject,
        html: emailHtml,
      });
      return { success: true, provider: "gmail" };
    } catch (gmailErr) {
      console.warn("Gmail SMTP dispatch error:", gmailErr);
    }
  }

  // Option 2: Fallback to Resend HTTPS API if configured
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (resendApiKey) {
    try {
      const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Camping Club <onboarding@resend.dev>";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [adminEmail],
          subject: emailSubject,
          html: emailHtml,
        }),
      });
      if (resp.ok) {
        return { success: true, provider: "resend" };
      }
      console.warn("Resend API error:", await resp.text());
    } catch (resendErr) {
      console.warn("Resend API dispatch error:", resendErr);
    }
  }

  return { success: false, reason: "no_provider_succeeded" };
}
