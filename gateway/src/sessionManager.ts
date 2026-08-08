import { Session } from "./session.js";
import type { UserSummary } from "./clientProtocol.js";

export class SessionManager {
  private byId = new Map<string, Session>();

  add(session: Session): void {
    this.byId.set(session.id, session);
  }

  remove(sessionId: string): void {
    this.byId.delete(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.byId.get(sessionId);
  }

  /** Nickname lookup is O(n) over currently-online sessions; the
   * expected session count for this project (a chat demo, not a
   * production-scale service) makes this fine, and it avoids keeping
   * a second index in sync through every nickname change. */
  findByNickname(nickname: string): Session | undefined {
    for (const session of this.byId.values()) {
      if (session.welcomed && session.nickname === nickname) return session;
    }
    return undefined;
  }

  all(): Session[] {
    return [...this.byId.values()];
  }

  welcomedUsers(): UserSummary[] {
    return this.all()
      .filter((s) => s.welcomed)
      .map((s) => ({ id: s.id, username: s.nickname, presence: s.presence }));
  }
}
