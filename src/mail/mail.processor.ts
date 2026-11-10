import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { MailService } from './mail.service.js';
import { ContactService } from '../contact/contact.service.js';
import { SitesService } from '../sites/sites.service.js';

interface ContactEmailJob {
  contactId: string;
  receivedAt: string;
  sourceName: string;
  from: string;
  fullName: string;
  phoneNumber: string;
  company?: string;
  subject: string;
  message: string;
  siteId: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        character
      ]!,
  );
}

function formatReceivedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

// What the dashboard shows as lastError, e.g.
// "EAUTH (535): Invalid login: 535 5.7.8 Authentication credentials invalid".
function describeFailure(details: {
  code: string;
  responseCode: string;
  message: string;
}): string {
  const code = details.code === 'unknown' ? '' : details.code;
  const response =
    details.responseCode === 'unknown' ? '' : ` (${details.responseCode})`;
  const prefix = `${code}${response}`.trim();
  return prefix ? `${prefix}: ${details.message}` : details.message;
}

@Processor('mail')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    private readonly contactService: ContactService,
    private readonly sites: SitesService,
  ) {}

  @Process('send-contact-email')
  async handleSendEmail(job: Job<ContactEmailJob>): Promise<void> {
    const {
      contactId,
      receivedAt,
      sourceName,
      from,
      fullName,
      phoneNumber,
      company,
      subject,
      message,
      siteId,
    } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    this.logger.log(
      `Contact email delivery started requestId=${contactId} jobId=${String(job.id)} siteId=${siteId} attempt=${attempt}/${maxAttempts}`,
    );
    const safe = {
      fullName: escapeHtml(fullName),
      from: escapeHtml(from),
      phoneNumber: escapeHtml(phoneNumber),
      company: company ? escapeHtml(company) : undefined,
      message: escapeHtml(message).replace(/\r?\n/g, '<br>'),
      siteId: escapeHtml(siteId),
      subject: escapeHtml(subject),
      receivedAt: escapeHtml(formatReceivedAt(receivedAt)),
      sourceName: escapeHtml(sourceName),
    };
    const companyValue = safe.company ?? '—';
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#18181b">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">New contact request from ${safe.fullName} via ${safe.sourceName}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafafa">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff">
        <tr><td style="padding:28px 32px 20px;border-top:4px solid #18181b;border-bottom:1px solid #e4e4e7;background:#ffffff;color:#18181b">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td>
                <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#71717a">Contact submission</div>
                <h1 style="margin:7px 0 0;font-size:21px;line-height:1.35;letter-spacing:-.015em">${safe.sourceName}</h1>
              </td>
              <td align="right" valign="bottom" style="color:#71717a;font-size:12px;line-height:1.5">
                ${safe.receivedAt}<br>${safe.siteId}
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #e4e4e7;background:#ffffff">
          <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#71717a">Subject</div>
          <div style="margin-top:5px;font-size:15px;font-weight:600;line-height:1.5;color:#18181b">${safe.subject}</div>
        </td></tr>

        <tr><td style="padding:20px 32px 4px">
          <div style="margin-bottom:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#71717a">Submission</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;border-collapse:collapse">
            <tr>
              <td width="50%" valign="top" style="padding:10px 16px 10px 0;border-right:1px solid #e4e4e7">
                <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#71717a">Company site</div>
                <div style="margin-top:4px;color:#18181b;font-size:14px;font-weight:600">${safe.sourceName}</div>
              </td>
              <td width="50%" valign="top" style="padding:10px 0 10px 16px">
                <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#71717a">Received</div>
                <div style="margin-top:4px;color:#18181b;font-size:13px">${safe.receivedAt}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 32px 4px">
          <div style="margin-bottom:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#71717a">Contact</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;border-collapse:collapse">
            <tr>
              <td width="50%" valign="top" style="padding:10px 16px 9px 0;border-right:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7">
                <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#71717a">Full name</div>
                <div style="margin-top:4px;color:#18181b;font-size:14px;font-weight:600">${safe.fullName}</div>
              </td>
              <td width="50%" valign="top" style="padding:10px 0 9px 16px;border-bottom:1px solid #e4e4e7">
                <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#71717a">Company</div>
                <div style="margin-top:4px;color:#18181b;font-size:14px">${companyValue}</div>
              </td>
            </tr>
            <tr>
              <td width="50%" valign="top" style="padding:10px 16px 10px 0;border-right:1px solid #e4e4e7">
                <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#71717a">Email</div>
                <div style="margin-top:4px;font-size:13px"><a href="mailto:${safe.from}" style="color:#18181b;text-decoration:underline;text-underline-offset:3px">${safe.from}</a></div>
              </td>
              <td width="50%" valign="top" style="padding:10px 0 10px 16px">
                <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#71717a">Phone</div>
                <div style="margin-top:4px;font-size:13px"><a href="tel:${safe.phoneNumber}" style="color:#18181b;text-decoration:underline;text-underline-offset:3px">${safe.phoneNumber}</a></div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 32px 4px">
          <div style="margin-bottom:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#71717a">Message</div>
          <div style="padding:0 0 16px;border-bottom:1px solid #e4e4e7;background:#ffffff;color:#27272a;font-size:14px;line-height:1.65">${safe.message}</div>
        </td></tr>

        <tr><td style="padding:14px 32px 20px;color:#52525b;font-size:13px">
          <strong style="color:#18181b">Respond:</strong>
          <a href="mailto:${safe.from}?subject=Re:%20${encodeURIComponent(subject)}" style="margin-left:8px;color:#18181b;text-decoration:underline;text-underline-offset:3px">${safe.from}</a>
          <span style="margin:0 7px;color:#a1a1aa">·</span>
          <a href="tel:${safe.phoneNumber}" style="color:#18181b;text-decoration:underline;text-underline-offset:3px">${safe.phoneNumber}</a>
        </td></tr>

        <tr><td style="padding:14px 32px;border-top:1px solid #e4e4e7;background:#fafafa;color:#71717a;font-size:11px;line-height:1.6">
          Sent from the ${safe.sourceName} website contact form. Replying responds directly to ${safe.fullName}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
    const text = [
      `New contact request from ${siteId}`,
      `Company site: ${sourceName}`,
      `Received: ${formatReceivedAt(receivedAt)}`,
      `Subject: ${subject}`,
      `Full name: ${fullName}`,
      `Email: ${from}`,
      `Phone: ${phoneNumber}`,
      ...(company ? [`Company: ${company}`] : []),
      '',
      message,
    ].join('\n');

    // Stopped from the dashboard: end the job quietly, so Bull doesn't retry.
    if (await this.contactService.isCancelled(contactId)) {
      this.logger.log(
        `Contact email skipped, delivery stopped requestId=${contactId} jobId=${String(job.id)} siteId=${siteId} attempt=${attempt}/${maxAttempts}`,
      );
      return;
    }

    try {
      // Loaded at send time, not stored in the job, so SMTP credentials never
      // sit in Redis and edited settings apply to retries too. Inside the try
      // so a missing site marks the request failed like any other error.
      const settings = await this.sites.getMailSettings(siteId);
      if (!settings) {
        throw new Error(`Site ${siteId} does not exist or is inactive`);
      }
      const result = await this.mailService.send({
        to: settings.recipient,
        cc: settings.cc,
        subject,
        html,
        text,
        replyTo: from,
        sender: { smtp: settings.smtp, from: settings.from },
      });
      await this.contactService.markSent(contactId, {
        to: settings.recipient,
        cc: settings.cc,
        attempts: attempt,
      });
      this.logger.log(
        `Contact email delivered requestId=${contactId} jobId=${String(job.id)} siteId=${siteId} attempt=${attempt}/${maxAttempts} messageId=${String(result?.messageId ?? 'unknown')} accepted=${result?.accepted?.length ?? 0} rejected=${result?.rejected?.length ?? 0}`,
      );
    } catch (error: unknown) {
      const details = this.getErrorDetails(error);
      await this.contactService.markFailed(contactId, {
        attempts: attempt,
        error: describeFailure(details),
      });
      this.logger.error(
        `Contact email delivery failed requestId=${contactId} jobId=${String(job.id)} siteId=${siteId} attempt=${attempt}/${maxAttempts} willRetry=${attempt < maxAttempts} errorName=${details.name} errorCode=${details.code} command=${details.command} responseCode=${details.responseCode} message=${details.message}`,
        details.stack,
      );
      throw error;
    }
  }
  private getErrorDetails(error: unknown) {
    if (!(error instanceof Error)) {
      return {
        name: 'UnknownError',
        code: 'unknown',
        command: 'unknown',
        responseCode: 'unknown',
        message: String(error),
        stack: undefined,
      };
    }

    const smtpError = error as Error & {
      code?: string;
      command?: string;
      responseCode?: number;
    };
    return {
      name: error.name,
      code: String(smtpError.code ?? 'unknown'),
      command: String(smtpError.command ?? 'unknown'),
      responseCode: String(smtpError.responseCode ?? 'unknown'),
      message: error.message.replace(/[\r\n]+/g, ' '),
      stack: error.stack,
    };
  }
}
