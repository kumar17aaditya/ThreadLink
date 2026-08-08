/**
 * Length-prefixed framing for the ThreadLink C++ server's TCP protocol.
 * Mirrors include/Protocol.h / src/Protocol.cpp exactly — see
 * docs/PROTOCOL.md for the authoritative contract. This module only
 * knows about *framing* (bytes in, bytes out); message semantics live
 * in backendMessages.ts.
 */
import { Socket } from "node:net";

export const FRAME_HEADER_SIZE = 4;

/**
 * Incrementally reassembles length-prefixed frames from a stream of
 * `data` events on a raw TCP socket. TCP gives no message boundaries,
 * so this buffers partial frames and can emit zero, one, or several
 * frames per underlying `data` event — exactly the fragmentation /
 * coalescing behavior the C++ server's own recv_frame() has to handle,
 * mirrored here on the gateway's read side.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxPayloadSize: number) {}

  /** Feeds newly-received bytes; returns any complete frames now available. */
  push(chunk: Buffer): { frames: Buffer[]; error?: "too_large" } {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const frames: Buffer[] = [];
    for (;;) {
      if (this.buffer.length < FRAME_HEADER_SIZE) break;
      const length = this.buffer.readUInt32BE(0);
      if (length > this.maxPayloadSize) {
        return { frames, error: "too_large" };
      }
      if (this.buffer.length < FRAME_HEADER_SIZE + length) break;

      const payload = this.buffer.subarray(
        FRAME_HEADER_SIZE,
        FRAME_HEADER_SIZE + length,
      );
      frames.push(Buffer.from(payload));
      this.buffer = this.buffer.subarray(FRAME_HEADER_SIZE + length);
    }
    return { frames };
  }
}

/** Encodes one frame: [4-byte big-endian length][payload]. */
export function encodeFrame(payload: string | Buffer): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Writes one frame to a live socket. Resolves once the OS accepted the write. */
export function writeFrame(socket: Socket, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(encodeFrame(payload), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
