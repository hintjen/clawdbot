// Account management
export {
  listEnabledMatrixAccounts,
  listMatrixAccountIds,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
  type ResolvedMatrixAccount,
} from "./accounts.js";

// Actions (Slack pattern)
export {
  deleteMatrixMessage,
  editMatrixMessage,
  getMatrixRoomInfo,
  getMatrixRoomMembers,
  getMatrixUserProfile,
  inviteToMatrixRoom,
  joinMatrixRoom,
  leaveMatrixRoom,
  listMatrixReactions,
  reactMatrixMessage,
  readMatrixMessages,
  removeMatrixReaction,
  removeOwnMatrixReactions,
  sendMatrixMessage,
  sendMatrixReadReceipt,
} from "./actions.js";

// Client lifecycle
export {
  createMatrixClient,
  getMatrixSyncState,
  isMatrixClientSyncing,
  loginMatrix,
  startMatrixSync,
  stopMatrixClient,
  waitForMatrixClientStop,
  type CreateMatrixClientOpts,
  type LoginMatrixOpts,
  type MatrixClientHandle,
  type MatrixGatewayHandle,
  type MatrixSyncState,
} from "./client.js";

// Message formatting
export {
  containsMatrixMention,
  extractMatrixMentions,
  formatMatrixReply,
  markdownToMatrixHtml,
  matrixHtmlToPlaintext,
} from "./format.js";

// Monitor provider
export { monitorMatrixProvider } from "./monitor/provider.js";

// Probe/health check
export { probeMatrix, type MatrixProbe, type ProbeMatrixOpts } from "./probe.js";

// Send messages
export {
  MatrixSendError,
  sendMessageMatrix,
  type MatrixSendOpts,
  type MatrixSendResult,
} from "./send.js";

// Token/credentials
export {
  normalizeMatrixAccessToken,
  normalizeMatrixCredential,
  normalizeMatrixPassword,
  resolveMatrixCredentials,
  type MatrixCredentials,
  type MatrixCredentialSource,
} from "./token.js";

// Types
export type {
  MatrixActionOpts,
  MatrixFile,
  MatrixMessageEvent,
  MatrixMessageSummary,
  MatrixRoomInfo,
  MatrixUserProfile,
} from "./types.js";

// Typing indicators
export {
  sendMatrixTyping,
  stopMatrixTyping,
  type SendMatrixTypingParams,
} from "./typing.js";
