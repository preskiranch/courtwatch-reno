export type PayloadDirection = "request" | "response";

export class PayloadLimitError extends Error {
  readonly direction: PayloadDirection;
  readonly maxBytes: number;

  constructor(direction: PayloadDirection, maxBytes: number) {
    super(`${direction} body exceeded the ${maxBytes} byte relay limit`);
    this.name = "PayloadLimitError";
    this.direction = direction;
    this.maxBytes = maxBytes;
  }
}

export function assertContentLengthWithinLimit(
  contentLength: string | null | undefined,
  maxBytes: number,
  direction: PayloadDirection,
): void {
  if (!contentLength) return;
  const parsed = Number(contentLength);
  if (Number.isFinite(parsed) && parsed > maxBytes) {
    throw new PayloadLimitError(direction, maxBytes);
  }
}

export async function readAsyncBodyWithLimit(
  body: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
  direction: PayloadDirection,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new PayloadLimitError(direction, maxBytes);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function readWebBodyWithLimit(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      size += buffer.length;
      if (size > maxBytes) {
        await reader.cancel("Court Watch relay response limit exceeded");
        throw new PayloadLimitError("response", maxBytes);
      }
      chunks.push(buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
