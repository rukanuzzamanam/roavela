import "server-only";
import { env } from "@/server/env";

/**
 * Transactional email abstraction.
 *
 * - RESEND_API_KEY set  → Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * - Not set             → console adapter. In development it prints the message (including links)
 *                         so flows like password reset can be tested locally; in production it logs
 *                         only the subject and recipient domain and never the body.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send(message: EmailMessage) {
    const domain = message.to.split("@")[1] ?? "unknown";
    // Bodies may contain one-time links, so only print them in development.
    const body = process.env.NODE_ENV === "development" ? `\n${message.text}` : "";
    console.info(`[email:dev] to=*@${domain} subject="${message.subject}"${body}`);
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Never include the API key or message body in errors.
      throw new Error(`Email provider responded ${res.status}`);
    }
  }
}

export function getEmailProvider(): EmailProvider {
  const { RESEND_API_KEY, EMAIL_FROM } = env();
  return RESEND_API_KEY ? new ResendEmailProvider(RESEND_API_KEY, EMAIL_FROM) : new ConsoleEmailProvider();
}
