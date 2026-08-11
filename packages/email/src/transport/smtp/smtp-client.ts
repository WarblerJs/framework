import type { EmailEnvelope } from "../../email.types";
import { EmailTransportError, SmtpAuthenticationError, SmtpConnectionError, SmtpProtocolError, SmtpTimeoutError, SmtpTlsError } from "../../errors";
import type { SmtpConfig } from "../../config";
import { formatPath } from "../../address";
import { authLoginPayload, authPlainPayload } from "./smtp-auth";
import { parseSmtpCapabilities, parseSmtpResponse, type SmtpResponse } from "./smtp-parser";

interface SmtpSocket {
  readonly readyState?: number;
  write(data: string): number;
  end(): unknown;
  close(): unknown;
  terminate?: () => unknown;
  upgradeTLS?: (options: unknown) => readonly [SmtpSocket, SmtpSocket];
}

interface SocketState {
  onData?: (chunk: Uint8Array) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

interface BunConnectOptions {
  readonly hostname: string;
  readonly port: number;
  readonly tls?: { readonly serverName: string; readonly rejectUnauthorized: boolean };
  readonly data: SocketState;
  readonly socket: {
    readonly open: (socket: SmtpSocket) => void;
    readonly data: (socket: SmtpSocket, data: Uint8Array) => void;
    readonly error: (socket: SmtpSocket, error: Error) => void;
    readonly close: (socket: SmtpSocket) => void;
  };
}

function classifyConnection(error: unknown): SmtpConnectionError["code"] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("dns") || message.includes("enotfound")) return "dns";
  if (message.includes("refused") || message.includes("econnrefused")) return "refused";
  if (message.includes("reset") || message.includes("econnreset")) return "reset";
  return "socket";
}

function dotStuff(raw: string): string {
  return raw.replace(/\r?\n/gu, "\r\n").split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}

/** Stateful SMTP client using one connection per message send. */
export class SmtpClient {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private socket: SmtpSocket | undefined;
  private socketError: Error | undefined;
  private capabilities: ReadonlyMap<string, string> = new Map();

  public constructor(private readonly config: SmtpConfig) {}

  public async send(envelope: EmailEnvelope, raw: string, size: number): Promise<{ readonly accepted: readonly string[]; readonly rejected: readonly string[] }> {
    const deadline = Date.now() + this.config.timeoutMs;
    await this.connect(deadline);
    try {
      await this.expect(220, deadline);
      await this.ehlo(deadline);
      if (this.config.tls === "starttls") await this.startTls(deadline);
      if (this.config.auth !== undefined) await this.authenticate(deadline);
      const serverSize = this.capabilities.get("SIZE");
      if (serverSize !== undefined && Number(serverSize) > 0 && size > Number(serverSize)) throw new EmailTransportError("Email exceeds server-advertised SMTP SIZE limit.");
      await this.command(`MAIL FROM:${formatPath(envelope.from)}${serverSize === undefined ? "" : ` SIZE=${size}`}`, 250, deadline);
      const accepted: string[] = [];
      const rejected: string[] = [];
      for (const recipient of envelope.recipients) {
        const response = await this.commandResponse(`RCPT TO:${formatPath(recipient)}`, deadline);
        if (response.code >= 200 && response.code < 300) accepted.push(recipient.email);
        else rejected.push(recipient.email);
      }
      if (accepted.length === 0) return Object.freeze({ accepted: Object.freeze([]), rejected: Object.freeze(rejected) });
      await this.command("DATA", 354, deadline);
      this.write(`${dotStuff(raw)}\r\n.\r\n`);
      await this.expect(250, deadline);
      return Object.freeze({ accepted: Object.freeze(accepted), rejected: Object.freeze(rejected) });
    } finally {
      try {
        if (this.socket !== undefined) {
          this.write("QUIT\r\n");
          this.socket.end();
        }
      } catch {
        this.socket?.terminate?.();
      }
    }
  }

  private async connect(deadline: number): Promise<void> {
    const state: SocketState = {};
    try {
      const connect = Bun.connect as unknown as (options: BunConnectOptions) => Promise<SmtpSocket>;
      this.socket = await Promise.race([
        connect({
          hostname: this.config.host,
          port: this.config.port,
          ...(this.config.tls === "implicit" ? { tls: { serverName: this.config.host, rejectUnauthorized: this.config.rejectUnauthorized } } : {}),
          data: state,
          socket: {
            open: () => {},
            data: (_socket, data) => state.onData?.(data),
            error: (_socket, error) => state.onError?.(error),
            close: () => state.onClose?.(),
          },
        }),
        this.timeout(deadline, "SMTP connection timed out."),
      ]);
      state.onData = (chunk) => { this.buffer += this.decoder.decode(chunk, { stream: true }); };
      state.onError = (error) => { this.socketError = error; };
    } catch (error) {
      throw error instanceof SmtpTimeoutError ? error : new SmtpConnectionError("SMTP connection failed.", classifyConnection(error), { cause: error });
    }
  }

  private async ehlo(deadline: number): Promise<void> {
    const response = await this.commandResponse(`EHLO ${this.config.heloName}`, deadline);
    if (response.code >= 500) await this.command(`HELO ${this.config.heloName}`, 250, deadline);
    else if (response.code !== 250) throw new SmtpProtocolError("SMTP EHLO was rejected.");
    else this.capabilities = parseSmtpCapabilities(response);
  }

  private async startTls(deadline: number): Promise<void> {
    if (!this.capabilities.has("STARTTLS")) throw new SmtpTlsError("SMTP server does not advertise STARTTLS.");
    await this.command("STARTTLS", 220, deadline);
    if (this.socket?.upgradeTLS === undefined) throw new SmtpTlsError("Bun socket does not support STARTTLS upgrade.");
    try {
      const [, tls] = this.socket.upgradeTLS({ serverName: this.config.host, rejectUnauthorized: this.config.rejectUnauthorized });
      this.socket = tls;
    } catch (error) {
      this.socket?.terminate?.();
      throw new SmtpTlsError("SMTP STARTTLS handshake failed.", { cause: error });
    }
    await this.ehlo(deadline);
  }

  private async authenticate(deadline: number): Promise<void> {
    const auth = this.config.auth;
    if (auth === undefined) return;
    if (this.config.tls === "plain" && this.config.allowPlain !== true) throw new SmtpAuthenticationError("SMTP AUTH over plaintext is disabled.");
    const supported = this.capabilities.get("AUTH")?.toUpperCase() ?? "";
    const mechanism = auth.mechanism ?? (supported.includes("PLAIN") ? "plain" : "login");
    if (mechanism === "plain") {
      if (!supported.includes("PLAIN")) throw new SmtpAuthenticationError("SMTP AUTH PLAIN is not advertised.");
      await this.command(`AUTH PLAIN ${authPlainPayload(auth)}`, 235, deadline, true);
      return;
    }
    if (!supported.includes("LOGIN")) throw new SmtpAuthenticationError("SMTP AUTH LOGIN is not advertised.");
    await this.command("AUTH LOGIN", 334, deadline, true);
    await this.command(authLoginPayload(auth.username), 334, deadline, true);
    await this.command(authLoginPayload(auth.password), 235, deadline, true);
  }

  private async command(command: string, expected: number, deadline: number, sensitive = false): Promise<void> {
    const response = await this.commandResponse(command, deadline, sensitive);
    if (response.code !== expected) throw new SmtpProtocolError(`SMTP command failed with ${response.code}.`);
  }

  private async commandResponse(command: string, deadline: number, sensitive = false): Promise<SmtpResponse> {
    if (/[\r\n\0]/u.test(command)) throw new SmtpProtocolError("SMTP command contains forbidden control characters.");
    this.write(`${command}\r\n`);
    try {
      return await this.readResponse(deadline);
    } catch (error) {
      throw sensitive ? new SmtpAuthenticationError("SMTP authentication failed.", { cause: error }) : error;
    }
  }

  private async expect(code: number, deadline: number): Promise<SmtpResponse> {
    const response = await this.readResponse(deadline);
    if (response.code !== code) throw new SmtpProtocolError(`SMTP expected ${code} but received ${response.code}.`);
    return response;
  }

  private async readResponse(deadline: number): Promise<SmtpResponse> {
    for (;;) {
      if (this.socketError !== undefined) throw new SmtpConnectionError("SMTP socket failed.", classifyConnection(this.socketError), { cause: this.socketError });
      const parsed = parseSmtpResponse(this.buffer, this.config.responseLineBytes, this.config.responseBytes);
      this.buffer = parsed.rest;
      if (parsed.response !== undefined) return parsed.response;
      await Promise.race([Bun.sleep(1), this.timeout(deadline, "SMTP response timed out.")]);
    }
  }

  private write(data: string): void {
    if (this.socket === undefined) throw new SmtpConnectionError("SMTP socket is not connected.", "socket");
    const written = this.socket.write(data);
    if (written < 0) throw new SmtpConnectionError("SMTP socket write failed.", "reset");
  }

  private async timeout(deadline: number, message: string): Promise<never> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SmtpTimeoutError(message);
    await Bun.sleep(remaining);
    throw new SmtpTimeoutError(message);
  }
}
