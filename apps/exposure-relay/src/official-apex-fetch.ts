import { Readable } from "node:stream";
import { Client, type Dispatcher } from "undici";
import type { FetchLike } from "./upstream-router.js";

type RequestClient = Pick<Client, "request">;

export function createOfficialApexFetch(
  apexOrigin: string,
  targetHostname: string,
  client?: RequestClient,
  connectOrigin = apexOrigin,
): FetchLike {
  const apexUrl = new URL(validatedApexOrigin(apexOrigin));
  const hostname = validatedHostname(targetHostname);
  const requestClient =
    client ??
    new Client(validatedApexOrigin(connectOrigin), {
      connect: {
        servername: apexUrl.hostname,
      },
    });

  return async (url, init) => {
    const response = await requestClient.request(
      officialApexRequestOptions(url, init, hostname),
    );
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) {
        for (const entry of value) headers.append(name, entry);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    return new Response(
      Readable.toWeb(response.body) as ReadableStream<Uint8Array>,
      {
        headers,
        status: response.statusCode,
      },
    );
  };
}

export function officialApexRequestOptions(
  url: URL,
  init: RequestInit,
  targetHostname: string,
): Dispatcher.RequestOptions {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  headers.host = validatedHostname(targetHostname);

  const body = init.body;
  if (
    body !== undefined &&
    body !== null &&
    typeof body !== "string" &&
    !Buffer.isBuffer(body)
  ) {
    throw new TypeError("Official apex requests require a string body.");
  }

  return {
    body: body ?? undefined,
    headers,
    method: (init.method ?? "GET") as Dispatcher.HttpMethod,
    path: `${url.pathname}${url.search}`,
    signal: init.signal ?? undefined,
  };
}

function validatedApexOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Official apex origin must use HTTPS.");
  }
  return url.origin;
}

function validatedHostname(value: string): string {
  const hostname = value.trim().toLowerCase();
  if (
    !hostname ||
    hostname.includes("/") ||
    hostname.includes(":") ||
    hostname.includes("\\")
  ) {
    throw new Error("Official target hostname is invalid.");
  }
  return hostname;
}
