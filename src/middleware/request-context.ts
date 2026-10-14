import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

const MAX_REQUEST_ID_LENGTH = 128;

function getSafeRequestId(request: Request) {
  const incoming = request.header("x-request-id")?.trim();

  if (incoming && incoming.length <= MAX_REQUEST_ID_LENGTH) {
    return incoming;
  }

  return randomUUID();
}

export function requestContext(request: Request, response: Response, next: NextFunction) {
  const requestId = getSafeRequestId(request);
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  next();
}
