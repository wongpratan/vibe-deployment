import { describe, it, expect } from "vitest";
import bcrypt from "bcrypt";
import {
  makeAuthService,
  EmailTakenError,
  BadCredentialsError,
} from "./service.js";
import { verify } from "./jwt.js";
import type { User, UserRepository } from "./user.repository.js";

function fakeUsers(initial: User[] = []): UserRepository & { all: () => User[] } {
  const store: User[] = [...initial];
  return {
    all: () => store,
    async findByEmail(email) {
      return store.find((u) => u.email === email) ?? null;
    },
    async create({ email, passwordHash }) {
      const user: User = {
        id: `user-${store.length + 1}`,
        email,
        passwordHash,
        createdAt: new Date(),
      } as User;
      store.push(user);
      return user;
    },
  };
}

describe("authService.register", () => {
  it("creates a user and returns a verifiable token", async () => {
    const users = fakeUsers();
    const svc = makeAuthService({ users });

    const { token, user } = await svc.register("a@example.com", "hunter2hunter2");

    expect(user.email).toBe("a@example.com");
    expect(user.id).toBe("user-1");
    const decoded = verify(token);
    expect(decoded.sub).toBe(user.id);
    expect(decoded.email).toBe("a@example.com");
  });

  it("stores the password as a bcrypt hash, not plaintext", async () => {
    const users = fakeUsers();
    const svc = makeAuthService({ users });

    await svc.register("a@example.com", "hunter2hunter2");

    const stored = users.all()[0];
    expect(stored.passwordHash).not.toBe("hunter2hunter2");
    expect(await bcrypt.compare("hunter2hunter2", stored.passwordHash)).toBe(true);
  });

  it("throws EmailTakenError when the email is already registered", async () => {
    const users = fakeUsers();
    const svc = makeAuthService({ users });
    await svc.register("a@example.com", "hunter2hunter2");

    await expect(svc.register("a@example.com", "another-pass")).rejects.toBeInstanceOf(
      EmailTakenError,
    );
  });
});

describe("authService.login", () => {
  it("returns a token for valid credentials", async () => {
    const users = fakeUsers();
    const svc = makeAuthService({ users });
    await svc.register("a@example.com", "hunter2hunter2");

    const { token, user } = await svc.login("a@example.com", "hunter2hunter2");

    expect(user.email).toBe("a@example.com");
    expect(verify(token).email).toBe("a@example.com");
  });

  it("throws BadCredentialsError when the user does not exist", async () => {
    const svc = makeAuthService({ users: fakeUsers() });
    await expect(svc.login("ghost@example.com", "whatever")).rejects.toBeInstanceOf(
      BadCredentialsError,
    );
  });

  it("throws BadCredentialsError when the password does not match", async () => {
    const users = fakeUsers();
    const svc = makeAuthService({ users });
    await svc.register("a@example.com", "hunter2hunter2");

    await expect(svc.login("a@example.com", "wrong-pass")).rejects.toBeInstanceOf(
      BadCredentialsError,
    );
  });
});
