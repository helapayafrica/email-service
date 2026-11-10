import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { SiteSmtpSettings } from '../sites/sites.service.js';

// How to send one message: a site's own SMTP server and From address, each
// falling back to the global SMTP_* settings when null.
export interface MailSender {
  smtp: SiteSmtpSettings | null;
  from: string | null;
}

export interface MailMessage {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  sender?: MailSender;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  // The global transport, used by sites without SMTP settings of their own.
  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  });

  onModuleInit(): void {
    this.logger.log(
      `Default SMTP transport configured host=${process.env.SMTP_HOST ?? 'unset'} port=${process.env.SMTP_PORT ?? '587'} secure=${process.env.SMTP_SECURE === 'true'} authConfigured=${Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)}`,
    );
  }

  async send(message: MailMessage) {
    const { sender } = message;
    // A non-pooled transport opens one connection per message anyway, so a
    // per-site transport is created per send instead of being cached; that
    // also means edited SMTP settings apply to the very next email.
    const transporter = sender?.smtp
      ? nodemailer.createTransport({
          host: sender.smtp.host,
          port: sender.smtp.port,
          secure: sender.smtp.secure,
          auth: sender.smtp.user
            ? { user: sender.smtp.user, pass: sender.smtp.pass ?? undefined }
            : undefined,
        })
      : this.transporter;

    return transporter.sendMail({
      from: sender?.from ?? process.env.SMTP_FROM,
      to: message.to,
      cc: message.cc?.length ? message.cc : undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
  }
}
