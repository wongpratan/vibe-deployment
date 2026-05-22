import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export type Message = typeof schema.messages.$inferSelect;
export type NewMessage = typeof schema.messages.$inferInsert;

export interface MessageRepository {
  listByChatAndAgent(chatId: string, agentId: string): Promise<Message[]>;
  insert(input: NewMessage): Promise<void>;
  deleteByChatId(chatId: string): Promise<void>;
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly database: typeof db = db) {}

  listByChatAndAgent(chatId: string, agentId: string): Promise<Message[]> {
    return this.database
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.agentId, agentId)))
      .orderBy(asc(schema.messages.createdAt));
  }

  async insert(input: NewMessage): Promise<void> {
    await this.database.insert(schema.messages).values(input);
  }

  async deleteByChatId(chatId: string): Promise<void> {
    await this.database.delete(schema.messages).where(eq(schema.messages.chatId, chatId));
  }
}

export const messageRepository: MessageRepository = new DrizzleMessageRepository();
