import type { Request } from "express";
import { config } from "./config.js";
import { User } from "./models.js";
export interface AuthIdentity {
  kerberosId: string;
  email: string;
  displayName: string;
  studentVerified: boolean;
}
export interface AuthenticationAdapter {
  authenticate(request: Request): Promise<AuthIdentity>;
}
// No password, fake SAML assertion, or untrusted identity header is accepted here.
export class DevelopmentAuthAdapter implements AuthenticationAdapter {
  async authenticate(request: Request): Promise<AuthIdentity> {
    if (config.NODE_ENV === "production" || config.AUTH_MODE !== "development")
      throw Object.assign(
        new Error(
          "Touchstone is not configured. Production login is unavailable.",
        ),
        { status: 503 },
      );
    const user = await User.findOne({
      kerberosId: request.body.kerberosId,
      fictional: true,
    });
    if (!user)
      throw Object.assign(
        new Error("Choose a seeded fictional development account."),
        { status: 401 },
      );
    return {
      kerberosId: user.kerberosId,
      email: user.email,
      displayName: user.displayName,
      studentVerified: true,
    };
  }
}
export const authentication = new DevelopmentAuthAdapter();
