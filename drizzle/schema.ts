import {
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const positions = ["QB", "RB", "WR", "TE", "K_ST", "DEF"] as const;
export type Position = (typeof positions)[number];

export const scoringEventTypes = [
  "TOUCHDOWN",
  "TWO_POINT_CONVERSION",
  "INTERCEPTION_THROWN",
  "FUMBLE_LOST",
  "EXTRA_POINT",
  "FIELD_GOAL",
  "BLOCKED_FIELD_GOAL",
  "BLOCKED_PUNT",
  "SPECIAL_TEAMS_SAFETY",
  "KICK_RETURN_TOUCHDOWN",
  "PUNT_RETURN_TOUCHDOWN",
  "BLOCKED_KICK_RETURN_TOUCHDOWN",
  "OTHER_SPECIAL_TEAMS_TOUCHDOWN",
  "SACK",
  "DEFENSIVE_TURNOVER",
  "DEFENSIVE_SAFETY",
  "SHUTOUT",
  "DEFENSIVE_TOUCHDOWN",
] as const;
export type ScoringEventType = (typeof scoringEventTypes)[number];

export const divisions = mysqlTable("divisions", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  sortOrder: int("sortOrder").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("division_sort_order_unique").on(table.sortOrder)]);

export const leagueOwners = mysqlTable("league_owners", {
  id: int("id").autoincrement().primaryKey(),
  displayName: varchar("displayName", { length: 120 }).notNull(),
  teamName: varchar("teamName", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }),
  divisionId: int("divisionId").references(() => divisions.id, { onDelete: "set null" }),
  linkedUserId: int("linkedUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("owner_division_index").on(table.divisionId),
  uniqueIndex("owner_email_unique").on(table.email),
]);

export const scoringWeeks = mysqlTable("scoring_weeks", {
  id: int("id").autoincrement().primaryKey(),
  weekNumber: int("weekNumber").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["UPCOMING", "OPEN", "FINAL"]).default("UPCOMING").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("scoring_week_number_unique").on(table.weekNumber)]);

export const draftAssignments = mysqlTable("draft_assignments", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().references(() => leagueOwners.id, { onDelete: "cascade" }),
  position: mysqlEnum("position", positions).notNull(),
  draftPosition: int("draftPosition").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("owner_position_assignment_unique").on(table.ownerId, table.position),
  uniqueIndex("position_draft_order_unique").on(table.position, table.draftPosition),
]);

export const draftPicks = mysqlTable("draft_picks", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().references(() => leagueOwners.id, { onDelete: "cascade" }),
  position: mysqlEnum("position", positions).notNull(),
  schoolName: varchar("schoolName", { length: 120 }).notNull(),
  selectedByUserId: int("selectedByUserId").references(() => users.id, { onDelete: "set null" }),
  selectedAt: timestamp("selectedAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("owner_position_pick_unique").on(table.ownerId, table.position),
  uniqueIndex("school_position_lock_unique").on(table.schoolName, table.position),
  index("pick_owner_index").on(table.ownerId),
]);

export const scoringRules = mysqlTable("scoring_rules", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  eventType: mysqlEnum("eventType", scoringEventTypes).notNull(),
  positionScope: mysqlEnum("positionScope", ["ALL", ...positions]).default("ALL").notNull(),
  minYards: int("minYards"),
  maxYards: int("maxYards"),
  flatPoints: decimal("flatPoints", { precision: 10, scale: 2 }),
  pointsPerUnit: decimal("pointsPerUnit", { precision: 10, scale: 4 }),
  isActive: mysqlEnum("isActive", ["true", "false"]).default("true").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("rule_lookup_index").on(table.eventType, table.positionScope, table.isActive)]);

export const scoringEvents = mysqlTable("scoring_events", {
  id: int("id").autoincrement().primaryKey(),
  weekId: int("weekId").notNull().references(() => scoringWeeks.id, { onDelete: "cascade" }),
  schoolName: varchar("schoolName", { length: 120 }).notNull(),
  position: mysqlEnum("position", positions).notNull(),
  eventType: mysqlEnum("eventType", scoringEventTypes).notNull(),
  statValue: decimal("statValue", { precision: 12, scale: 2 }).notNull(),
  yardDistance: int("yardDistance"),
  scoringRuleId: int("scoringRuleId").references(() => scoringRules.id, { onDelete: "set null" }),
  computedPoints: decimal("computedPoints", { precision: 12, scale: 2 }).notNull(),
  auditAction: mysqlEnum("auditAction", ["ENTRY", "REVERSAL", "CORRECTION"]).default("ENTRY").notNull(),
  correctionOfEventId: int("correctionOfEventId"),
  note: text("note"),
  recordedByUserId: int("recordedByUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("score_event_week_index").on(table.weekId),
  index("score_event_school_position_index").on(table.schoolName, table.position),
  index("score_event_correction_index").on(table.correctionOfEventId),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LeagueOwner = typeof leagueOwners.$inferSelect;
export type DraftAssignment = typeof draftAssignments.$inferSelect;
export type DraftPick = typeof draftPicks.$inferSelect;
export type ScoringRule = typeof scoringRules.$inferSelect;
export type ScoringEvent = typeof scoringEvents.$inferSelect;
