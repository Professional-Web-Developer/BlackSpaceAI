import { isDatabaseEnabled } from "@/config/env";
import { logger } from "@/lib/logger";

import { MemoryChatRepository } from "./memory-chat-repository";
import { PostgresChatRepository } from "./postgres-chat-repository";
import type { ChatRepository } from "./types";

/**
 * Adapter selection happens here and nowhere else. Cached on `globalThis` so
 * the in-memory store survives hot reloads in development.
 */
const globalForRepository = globalThis as unknown as {
  __chatRepository?: ChatRepository;
};

export function getChatRepository(): ChatRepository {
  if (!globalForRepository.__chatRepository) {
    globalForRepository.__chatRepository = isDatabaseEnabled
      ? new PostgresChatRepository()
      : new MemoryChatRepository();

    logger.info("Chat repository initialised", {
      kind: globalForRepository.__chatRepository.kind,
    });
  }

  return globalForRepository.__chatRepository;
}

export type { ChatRepository } from "./types";
export * from "./types";
