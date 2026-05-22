import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export type Chat = typeof schema.chats.$inferSelect;

export interface ChatListItem {
  id: string;
  title: string;
  createdAt: Date;
  appName: string | null;
}

export interface ChatRepository {
  listForUser(userId: string): Promise<ChatListItem[]>;
  findByIdForUser(id: string, userId: string): Promise<Chat | null>;
  create(userId: string, title: string): Promise<Chat>;
  deleteById(id: string): Promise<void>;
}

export class DrizzleChatRepository implements ChatRepository {
  constructor(private readonly database: typeof db = db) {}

  listForUser(userId: string): Promise<ChatListItem[]> {
    return this.database
      .select({
        id: schema.chats.id,
        title: schema.chats.title,
        createdAt: schema.chats.createdAt,
        appName: sql<string | null>`${schema.deploymentRequirements.requirements}->>'appName'`.as("appName"),
      })
      .from(schema.chats)
      .leftJoin(
        schema.deploymentRequirements,
        eq(schema.deploymentRequirements.chatId, schema.chats.id),
      )
      .where(eq(schema.chats.userId, userId))
      .orderBy(asc(schema.chats.createdAt));
  }

  async findByIdForUser(id: string, userId: string): Promise<Chat | null> {
    const [chat] = await this.database
      .select()
      .from(schema.chats)
      .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)));
    return chat ?? null;
  }

  async create(userId: string, title: string): Promise<Chat> {
    const [chat] = await this.database
      .insert(schema.chats)
      .values({ userId, title })
      .returning();
    return chat;
  }

  async deleteById(id: string): Promise<void> {
    await this.database.delete(schema.chats).where(eq(schema.chats.id, id));
  }
}

export const chatRepository: ChatRepository = new DrizzleChatRepository();
