export type AppRole = "admin" | "tester" | "learner";
export type AppUserStatus = "active" | "disabled";

export interface AppUser {
  createdAt: Date;
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
  role: AppRole;
  status: AppUserStatus;
  updatedAt: Date;
}

export type PublicAppUser = Omit<AppUser, "passwordHash">;

export interface AuthSession {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: "Bearer";
  user: PublicAppUser;
}
