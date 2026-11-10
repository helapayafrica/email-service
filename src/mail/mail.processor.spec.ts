import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import type { ContactService } from '../contact/contact.service.js';
import { MailProcessor } from './mail.processor.js';
import type { MailService } from './mail.service.js';
import type { SiteMailSettings, SitesService } from '../sites/sites.service.js';

describe('MailProcessor', () => {
  const job = {
    id: 'job-1',
    attemptsMade: 0,
    opts: { attempts: 5 },
    data: {
      contactId: 'contact-1',
      receivedAt: '2026-09-24T10:30:00.000Z',
      sourceName: 'Deliva Fasta',
      from: 'sender@example.com',
      fullName: '<script>Jane</script>',
      phoneNumber: '+254700000000',
      company: 'Acme & Sons',
      subject: 'Website enquiry',
      message: 'Hello <b>team</b>\nSecond line',
      siteId: 'deliva',
    },
  } as Job;

  let mailService: { send: ReturnType<typeof vi.fn> };
  let contactService: {
    markSent: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  let sites: { getMailSettings: ReturnType<typeof vi.fn> };
  let processor: MailProcessor;

  const ownSmtp: SiteMailSettings = {
    siteId: 'deliva',
    name: 'Deliva Fasta',
    recipient: 'recipient@example.com',
    smtp: {
      host: 'smtp.deliva.example',
      port: 465,
      secure: true,
      user: 'mailer',
      pass: 'decrypted-password',
    },
    from: 'Deliva <no-reply@deliva.example>',
  };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mailService = { send: vi.fn().mockResolvedValue(undefined) };
    contactService = {
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    sites = { getMailSettings: vi.fn().mockResolvedValue(ownSmtp) };
    processor = new MailProcessor(
      mailService as unknown as MailService,
      contactService as unknown as ContactService,
      sites as unknown as SitesService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends safe HTML, includes plain text, and marks the request as sent', async () => {
    await processor.handleSendEmail(job);

    expect(mailService.send).toHaveBeenCalledOnce();
    const [to, , html, text, replyTo, sender] = mailService.send.mock.calls[0];
    expect(sites.getMailSettings).toHaveBeenCalledWith('deliva');
    expect(to).toBe('recipient@example.com');
    expect(sender).toEqual({ smtp: ownSmtp.smtp, from: ownSmtp.from });
    expect(html).toContain('&lt;script&gt;Jane&lt;/script&gt;');
    expect(html).not.toContain('contact-1');
    expect(html).toContain('Deliva Fasta');
    expect(html).toContain('24 Sept 2026, 10:30 UTC');
    expect(html).toContain('Website enquiry');
    expect(html).toContain('Acme &amp; Sons');
    expect(html).toContain('Hello &lt;b&gt;team&lt;/b&gt;<br>Second line');
    expect(html).not.toContain('<script>');
    expect(text).toContain('Full name: <script>Jane</script>');
    expect(text).toContain('Company site: Deliva Fasta');
    expect(text).not.toContain('Reference: contact-1');
    expect(replyTo).toBe('sender@example.com');
    expect(contactService.markSent).toHaveBeenCalledWith('contact-1', {
      to: 'recipient@example.com',
      cc: [],
      attempts: 1,
    });
    expect(contactService.markFailed).not.toHaveBeenCalled();
  });

  it('records which attempt succeeded', async () => {
    await processor.handleSendEmail({ ...job, attemptsMade: 3 } as Job);

    expect(contactService.markSent).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({ attempts: 4 }),
    );
  });

  it('marks the request failed and rethrows when SMTP delivery fails', async () => {
    const deliveryError = new Error('SMTP unavailable');
    mailService.send.mockRejectedValue(deliveryError);

    await expect(processor.handleSendEmail(job)).rejects.toBe(deliveryError);
    expect(contactService.markFailed).toHaveBeenCalledWith('contact-1', {
      attempts: 1,
      error: 'SMTP unavailable',
    });
    expect(contactService.markSent).not.toHaveBeenCalled();
  });

  it('records the SMTP error code and response in lastError', async () => {
    mailService.send.mockRejectedValue(
      Object.assign(new Error('Invalid login: 535 5.7.8 bad\r\ncredentials'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    );

    await expect(
      processor.handleSendEmail({ ...job, attemptsMade: 2 } as Job),
    ).rejects.toThrow();
    expect(contactService.markFailed).toHaveBeenCalledWith('contact-1', {
      attempts: 3,
      error: 'EAUTH (535): Invalid login: 535 5.7.8 bad credentials',
    });
  });

  it('passes no SMTP override for a site that uses the global settings', async () => {
    sites.getMailSettings.mockResolvedValue({
      ...ownSmtp,
      smtp: null,
      from: null,
    });

    await processor.handleSendEmail(job);

    const sender = mailService.send.mock.calls[0][5];
    expect(sender).toEqual({ smtp: null, from: null });
  });

  it('marks the request failed and rethrows when the site is missing or inactive', async () => {
    sites.getMailSettings.mockResolvedValue(null);

    await expect(processor.handleSendEmail(job)).rejects.toThrow(
      'Site deliva does not exist or is inactive',
    );
    expect(mailService.send).not.toHaveBeenCalled();
    expect(contactService.markFailed).toHaveBeenCalledWith('contact-1', {
      attempts: 1,
      error: 'Site deliva does not exist or is inactive',
    });
  });
});
