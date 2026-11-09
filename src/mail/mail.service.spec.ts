import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service.js';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'id' }),
  })),
}));

type MockTransport = { sendMail: ReturnType<typeof vi.fn> };

describe('MailService', () => {
  const originalEnvironment = { ...process.env };
  const createTransport = vi.mocked(nodemailer.createTransport);
  let service: MailService;

  // The transport created by the n-th createTransport call.
  const transport = (index: number) =>
    createTransport.mock.results[index].value as MockTransport;

  beforeEach(() => {
    createTransport.mockClear();
    process.env.SMTP_HOST = 'smtp.global.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_FROM = 'Website Contact <no-reply@global.test>';
    service = new MailService(); // creates the global transport
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  const send = (sender?: Parameters<MailService['send']>[5]) =>
    service.send(
      'inbox@acme.test',
      'Subject',
      '<p>html</p>',
      'text',
      'jane@example.com',
      sender,
    );

  it('uses the global transport and SMTP_FROM without a sender', async () => {
    await send();

    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.global.test', port: 587 }),
    );
    expect(transport(0).sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Website Contact <no-reply@global.test>',
        to: 'inbox@acme.test',
        replyTo: 'jane@example.com',
      }),
    );
  });

  it('uses the global transport for a site without its own SMTP', async () => {
    await send({ smtp: null, from: null });

    expect(createTransport).toHaveBeenCalledOnce();
    expect(transport(0).sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Website Contact <no-reply@global.test>',
      }),
    );
  });

  it("sends through the site's own SMTP server and From address", async () => {
    await send({
      smtp: {
        host: 'smtp.acme.test',
        port: 465,
        secure: true,
        user: 'mailer',
        pass: 'acme-smtp-pass',
      },
      from: 'Acme <no-reply@acme.test>',
    });

    expect(createTransport).toHaveBeenLastCalledWith({
      host: 'smtp.acme.test',
      port: 465,
      secure: true,
      auth: { user: 'mailer', pass: 'acme-smtp-pass' },
    });
    expect(transport(0).sendMail).not.toHaveBeenCalled();
    expect(transport(1).sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Acme <no-reply@acme.test>' }),
    );
  });

  it('skips authentication for a site server without a user', async () => {
    await send({
      smtp: {
        host: 'relay.acme.test',
        port: 25,
        secure: false,
        user: null,
        pass: null,
      },
      from: 'no-reply@acme.test',
    });

    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'relay.acme.test', auth: undefined }),
    );
  });

  it('lets a site override only the From address on the global server', async () => {
    await send({ smtp: null, from: 'Acme <no-reply@acme.test>' });

    expect(createTransport).toHaveBeenCalledOnce();
    expect(transport(0).sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Acme <no-reply@acme.test>' }),
    );
  });
});
