import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { ApiError } from "../http/api-error.js";
import { sendFailure } from "../http/responses.js";

export const notFoundHandler: RequestHandler = (_request, response) => {
  sendFailure(response, 404, "NOT_FOUND", "The requested resource was not found.");
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;

  if (error instanceof ApiError) {
    sendFailure(response, error.statusCode, error.code, error.message);
    return;
  }

  if (error instanceof ZodError) {
    sendFailure(response, 400, "INVALID_REQUEST", "The request is not valid.");
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    sendFailure(response, 400, "INVALID_JSON", "The request body is not valid JSON.");
    return;
  }

  sendFailure(response, 500, "INTERNAL_ERROR", "The service could not complete the request.");
};
