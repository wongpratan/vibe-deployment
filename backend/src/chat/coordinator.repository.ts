import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export type CoordinatorRequirements = typeof schema.coordinatorRequirements.$inferSelect;

export interface CoordinatorRepository {
  findLatestCollected(chatId: string, userId: string): Promise<CoordinatorRequirements | null>;
  deleteCoordinatorForChatAndUser(chatId: string, userId: string): Promise<void>;
  deleteDeploymentForChatAndUser(chatId: string, userId: string): Promise<void>;
}

export class DrizzleCoordinatorRepository implements CoordinatorRepository {
  constructor(private readonly database: typeof db = db) {}

  async findLatestCollected(chatId: string, userId: string): Promise<CoordinatorRequirements | null> {
    const [c] = await this.database
      .select()
      .from(schema.coordinatorRequirements)
      .where(
        and(
          eq(schema.coordinatorRequirements.chatId, chatId),
          eq(schema.coordinatorRequirements.userId, userId),
          eq(schema.coordinatorRequirements.collected, true),
        ),
      )
      .orderBy(desc(schema.coordinatorRequirements.createdAt))
      .limit(1);
    return c ?? null;
  }

  async deleteCoordinatorForChatAndUser(chatId: string, userId: string): Promise<void> {
    await this.database
      .delete(schema.coordinatorRequirements)
      .where(
        and(
          eq(schema.coordinatorRequirements.chatId, chatId),
          eq(schema.coordinatorRequirements.userId, userId),
        ),
      );
  }

  async deleteDeploymentForChatAndUser(chatId: string, userId: string): Promise<void> {
    await this.database
      .delete(schema.deploymentRequirements)
      .where(
        and(
          eq(schema.deploymentRequirements.chatId, chatId),
          eq(schema.deploymentRequirements.userId, userId),
        ),
      );
  }
}

export const coordinatorRepository: CoordinatorRepository = new DrizzleCoordinatorRepository();
