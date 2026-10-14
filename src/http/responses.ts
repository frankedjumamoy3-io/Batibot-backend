import type { Response } from "express";

import type { ApiFailure, ApiSuccess } from "../contracts/api-response.js";

function getRequestId(response: Response): string {
  return String(response.locals.requestId ?? "unknown");
}

export function sendSuccess<T>(response: Response, data: T, statusCode = 200) {
  const body: ApiSuccess<T> = {
    data,
    meta: {
      requestId: getRequestId(response),
    },
  };

  return response.status(statusCode).json(body);
}

export function sendFailure(
  response: Response,
  statusCode: number,
  code: string,
  message: string
) {
  const body: ApiFailure = {
    error: {
      code,
      message,
      requestId: getRequestId(response),
    },
  };

  return response.status(statusCode).json(body);
}
