/**
 * Shared types for Matrix event handlers.
 */

/**
 * Handler function type for processing Matrix room messages.
 */
export type MatrixMessageHandler = (
  params: {
    eventId: string;
    roomId: string;
    sender: string;
    body: string;
    formattedBody?: string;
    msgtype: string;
    replyTo?: string;
    timestamp: number;
  },
  meta: { source: "timeline" | "app_mention"; wasMentioned?: boolean },
) => Promise<void>;
