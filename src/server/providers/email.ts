import "server-only";

/**
 * Transactional email abstraction. Without a provider key, messages are logged (subject and
 * recipient domain only) so development works offline. A Resend implementation is added when
 * password-reset / booking emails are built.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const domain = message.to.split("@")[1] ?? "unknown";
    // Bodies may contain one-time links, so only print them in development.
    const body = process.env.NODE_ENV === "development" ? `\n${message.text}` : "";
    console.info(`[email] to=*@${domain} subject="${message.subject}"${body}`);
  }
}

export function getEmailProvider(): EmailProvider {
  return new ConsoleEmailProvider();
}
