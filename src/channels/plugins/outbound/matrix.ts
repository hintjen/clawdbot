import { sendMessageMatrix } from "../../../matrix/send.js";
import type { ChannelOutboundAdapter } from "../types.js";

export const matrixOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,
  textChunkLimit: 4000,
  resolveTarget: ({ to }) => {
    const trimmed = to?.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: new Error(
          "Delivering to Matrix requires --to <roomId|#roomAlias|room:ID>",
        ),
      };
    }
    return { ok: true, to: trimmed };
  },
  sendText: async ({ to, text, accountId, replyToId }) => {
    const result = await sendMessageMatrix(to, text, {
      replyTo: replyToId ?? undefined,
      accountId: accountId ?? undefined,
    });
    return { channel: "matrix", messageId: result.eventId, meta: { roomId: result.roomId } };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
    const result = await sendMessageMatrix(to, text, {
      mediaUrl,
      replyTo: replyToId ?? undefined,
      accountId: accountId ?? undefined,
    });
    return { channel: "matrix", messageId: result.eventId, meta: { roomId: result.roomId } };
  },
};
