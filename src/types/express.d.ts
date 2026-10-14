import type { PublicAppUser } from "../auth/types.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicAppUser;
    }
  }
}

export {};
