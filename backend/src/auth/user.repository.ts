import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  create(input: { email: string; passwordHash: string }): Promise<User>;
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly database: typeof db = db) {}

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.database
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user ?? null;
  }

  async create(input: { email: string; passwordHash: string }): Promise<User> {
    const [user] = await this.database
      .insert(schema.users)
      .values(input)
      .returning();
    return user;
  }
}

export const userRepository: UserRepository = new DrizzleUserRepository();
