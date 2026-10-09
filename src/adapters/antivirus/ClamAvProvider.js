const net = require('net');
const AntivirusProviderInterface = require('./AntivirusProvider.interface');
const env = require('../../config/portal');

/**
 * Real ClamAV-backed implementation of the AntivirusProvider contract,
 * speaking ClamAV's INSTREAM protocol directly over a raw TCP socket (no
 * clamd/clamscan binary on this machine, no `clamscan`/`clamdjs` npm
 * dependency needed - the protocol is a small, well-documented binary
 * framing: a command, length-prefixed chunks of the file, a zero-length
 * terminator chunk, then a single text response line).
 *
 * Config (adapters/antivirus/index.js wires this in when
 * ANTIVIRUS_PROVIDER=clamav): CLAMAV_HOST/CLAMAV_PORT (default
 * 127.0.0.1:3310, clamd's standard TCP listener) and CLAMAV_TIMEOUT_MS
 * (default 5000) bound the ENTIRE scan operation (connect + transfer +
 * response), so a hung daemon can never block an upload indefinitely.
 *
 * Contract: resolves { clean: true, threat: null } on "stream: OK", resolves
 * { clean: false, threat: <name> } on "stream: <name> FOUND" (a genuine
 * detection - callers must always reject this, no strict/non-strict
 * override), and REJECTS with an Error whose `.code === 'SCANNER_UNAVAILABLE'`
 * for anything else that prevented getting a real verdict: TCP connection
 * refused, DNS failure, timeout, a premature close, or an unparseable/ERROR
 * response from the daemon. That single error code is what
 * kyc.service.js's uploadDocument() branches on for its STRICT_UPLOAD_SCAN
 * policy - this provider itself never decides whether an unscannable
 * upload is allowed through, it only ever reports "could not get a
 * verdict" vs "got a verdict".
 */

// Conservative per-chunk size for the INSTREAM protocol - comfortably under
// clamd's default StreamMaxLength and small enough to keep memory bounded
// while streaming even a MAX_KYC_FILE_SIZE_MB-sized buffer.
const CHUNK_SIZE = 8192;

function scannerUnavailableError(message, cause) {
  const err = new Error(message);
  err.code = 'SCANNER_UNAVAILABLE';
  if (cause) err.cause = cause;
  return err;
}

class ClamAvProvider extends AntivirusProviderInterface {
  constructor({ host, port, timeoutMs } = {}) {
    super();
    this.host = host || env.CLAMAV_HOST;
    this.port = port || env.CLAMAV_PORT;
    this.timeoutMs = timeoutMs || env.CLAMAV_TIMEOUT_MS;
  }

  async scan(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new TypeError('ClamAvProvider.scan() requires a non-empty Buffer.');
    }
    const raw = await this._instreamScan(buffer);
    return this._parseResponse(raw);
  }

  /** Speaks INSTREAM over a fresh TCP connection and resolves with the daemon's raw text reply. */
  _instreamScan(buffer) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const responseChunks = [];
      let settled = false;

      const settle = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        fn(arg);
      };

      // Bounds the WHOLE operation (connect, write, and waiting for a
      // reply) - a daemon that accepts the connection but never replies is
      // just as "unavailable" as one that refuses the connection outright.
      const timer = setTimeout(() => {
        settle(reject, scannerUnavailableError(`ClamAV scan timed out after ${this.timeoutMs}ms (${this.host}:${this.port}).`));
      }, this.timeoutMs);

      socket.on('error', (err) => {
        settle(reject, scannerUnavailableError(`ClamAV connection failed (${this.host}:${this.port}): ${err.message}`, err));
      });

      socket.on('connect', () => {
        try {
          socket.write('zINSTREAM\0');
          let offset = 0;
          while (offset < buffer.length) {
            const end = Math.min(offset + CHUNK_SIZE, buffer.length);
            const chunk = buffer.subarray(offset, end);
            const sizeHeader = Buffer.alloc(4);
            sizeHeader.writeUInt32BE(chunk.length, 0);
            socket.write(sizeHeader);
            socket.write(chunk);
            offset = end;
          }
          // Zero-length chunk terminates the stream per the INSTREAM spec.
          socket.write(Buffer.alloc(4));
        } catch (err) {
          settle(reject, scannerUnavailableError(`ClamAV write failed (${this.host}:${this.port}): ${err.message}`, err));
        }
      });

      socket.on('data', (data) => {
        responseChunks.push(data);
      });

      // Either 'end' (daemon sent FIN after its reply) or 'close' (abrupt)
      // resolves with whatever text was received - _parseResponse decides
      // whether that text is a real verdict or an "unavailable" condition.
      socket.on('end', () => {
        settle(resolve, Buffer.concat(responseChunks).toString('utf8'));
      });
      socket.on('close', () => {
        settle(resolve, Buffer.concat(responseChunks).toString('utf8'));
      });

      socket.connect(this.port, this.host);
    });
  }

  /** Parses ClamAV's reply text. Exposed as its own method so the parsing logic can be unit-tested without a real socket. */
  _parseResponse(raw) {
    const text = String(raw || '').replace(/\0/g, '').trim();
    if (!text) {
      throw scannerUnavailableError('ClamAV returned an empty response (connection closed before any reply).');
    }

    // "stream: OK"
    if (/\bOK$/.test(text)) {
      return { clean: true, threat: null };
    }

    // "stream: <threat name> FOUND"
    const foundMatch = text.match(/^stream:\s*(.+?)\s+FOUND$/);
    if (foundMatch) {
      return { clean: false, threat: foundMatch[1] };
    }

    // Anything else ("stream: ... ERROR", a size-limit message, a malformed
    // or unrecognized reply) means we never got a trustworthy verdict -
    // treated identically to an unreachable scanner so callers apply the
    // same strict/non-strict policy rather than silently treating an
    // ambiguous reply as "clean".
    throw scannerUnavailableError(`ClamAV returned an unrecognized response: "${text}"`);
  }
}

module.exports = ClamAvProvider;
