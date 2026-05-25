import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chats = pgTable("chats", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const deploymentRequirements = pgTable("deployment_requirements", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
  requirements: jsonb("requirements").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reviewResults = pgTable("review_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
  repoUrl: text("repo_url").notNull(),
  gitBranch: text("git_branch"),
  buildPack: text("build_pack"),
  ready: boolean("ready").notNull().default(false),
  issues: jsonb("issues"),
  notes: text("notes"),
  summary: text("summary"),
  nameGuess: text("name_guess"),
  envVarsDetected: jsonb("env_vars_detected"),
  dockerComposeLocation: text("docker_compose_location"),
  dockerfileLocation: text("dockerfile_location"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coordinatorRequirements = pgTable("coordinator_requirements", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
  appName: text("app_name").notNull(),
  envVars: jsonb("env_vars").notNull(),
  collected: boolean("collected").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().default("reviewer"),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolCalls: jsonb("tool_calls"),
  toolCallId: text("tool_call_id"),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
