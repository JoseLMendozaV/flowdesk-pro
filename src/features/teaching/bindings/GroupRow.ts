// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { GroupMember } from "./GroupMember";

export type GroupRow = { id: number, name: string, description: string, leaderName: string | null, memberCount: number, members: Array<GroupMember>, };
