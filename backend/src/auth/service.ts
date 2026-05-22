import bcrypt from "bcrypt";
import { sign } from "./jwt.js";
import { userRepository, type UserRepository } from "./user.repository.js";

export class EmailTakenError extends Error {
  constructor() {
    super("email taken");
    this.name = "EmailTakenError";
  }
}

export class BadCredentialsError extends Error {
  constructor() {
    super("bad credentials");
    this.name = "BadCredentialsError";
  }
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
}

export interface AuthService {
  register(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
}

export function makeAuthService(deps: { users: UserRepository }): AuthService {
  const { users } = deps;
  return {
    async register(email, password) {
      const existing = await users.findByEmail(email);
      if (existing) throw new EmailTakenError();
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await users.create({ email, passwordHash });
      const token = sign({ sub: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email } };
    },
    async login(email, password) {
      const user = await users.findByEmail(email);
      if (!user) throw new BadCredentialsError();
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw new BadCredentialsError();
      const token = sign({ sub: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email } };
    },
  };
}

export const authService = makeAuthService({ users: userRepository });
