import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuthService } from "../auth/auth-service.js";
import type { AppRole } from "../auth/types.js";
import { ApiError } from "../http/api-error.js";

function readBearerToken(request: Request) {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  return token;
}

export function requireAuthentication(authService: AuthService): RequestHandler {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      request.authUser = await authService.authenticateAccessToken(readBearerToken(request));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles: AppRole[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.authUser) {
      next(new ApiError(401, "AUTH_REQUIRED", "Authentication is required."));
      return;
    }

    if (!roles.includes(request.authUser.role)) {
      next(new ApiError(403, "FORBIDDEN", "This account cannot access that resource."));
      return;
    }

    next();
  };
}
