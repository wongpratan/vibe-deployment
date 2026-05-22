import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export type ReviewResult = typeof schema.reviewResults.$inferSelect;

export interface ReviewRepository {
  findLatestReady(chatId: string): Promise<ReviewResult | null>;
  findLatestReadyForUser(chatId: string, userId: string): Promise<ReviewResult | null>;
  deleteForChatAndUser(chatId: string, userId: string): Promise<void>;
}

export class DrizzleReviewRepository implements ReviewRepository {
  constructor(private readonly database: typeof db = db) {}

  async findLatestReady(chatId: string): Promise<ReviewResult | null> {
    const [r] = await this.database
      .select()
      .from(schema.reviewResults)
      .where(and(eq(schema.reviewResults.chatId, chatId), eq(schema.reviewResults.ready, true)))
      .orderBy(desc(schema.reviewResults.createdAt))
      .limit(1);
    return r ?? null;
  }

  async findLatestReadyForUser(chatId: string, userId: string): Promise<ReviewResult | null> {
    const [r] = await this.database
      .select()
      .from(schema.reviewResults)
      .where(
        and(
          eq(schema.reviewResults.chatId, chatId),
          eq(schema.reviewResults.userId, userId),
          eq(schema.reviewResults.ready, true),
        ),
      )
      .orderBy(desc(schema.reviewResults.createdAt))
      .limit(1);
    return r ?? null;
  }

  async deleteForChatAndUser(chatId: string, userId: string): Promise<void> {
    await this.database
      .delete(schema.reviewResults)
      .where(and(eq(schema.reviewResults.chatId, chatId), eq(schema.reviewResults.userId, userId)));
  }
}

export const reviewRepository: ReviewRepository = new DrizzleReviewRepository();
