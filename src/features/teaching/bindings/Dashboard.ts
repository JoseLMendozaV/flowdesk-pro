// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { AttentionStudent } from "./AttentionStudent";
import type { CourseSummary } from "./CourseSummary";
import type { DashboardStats } from "./DashboardStats";
import type { UpcomingEvent } from "./UpcomingEvent";

export type Dashboard = { course: CourseSummary, stats: DashboardStats, attention: Array<AttentionStudent>, upcomingEvents: Array<UpcomingEvent>, };
