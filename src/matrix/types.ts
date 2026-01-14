import type { MatrixClient } from "matrix-js-sdk";

/**
 * Matrix message event from Room.timeline
 */
export type MatrixMessageEvent = {
  eventId: string;
  roomId: string;
  sender: string;
  body: string;
  formattedBody?: string;
  msgtype: string;
  replyTo?: string;
  timestamp: number;
};

/**
 * Options for Matrix action functions
 */
export type MatrixActionOpts = {
  accountId?: string;
  accessToken?: string;
  client?: MatrixClient;
};

/**
 * Room information
 */
export type MatrixRoomInfo = {
  roomId: string;
  name?: string;
  topic?: string;
  memberCount: number;
  isEncrypted: boolean;
  isDirect: boolean;
};

/**
 * User profile information
 */
export type MatrixUserProfile = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
};

/**
 * Matrix file attachment
 */
export type MatrixFile = {
  mxcUrl: string;
  name?: string;
  mimetype?: string;
  size?: number;
};

/**
 * Matrix message summary (for history/actions)
 */
export type MatrixMessageSummary = {
  eventId: string;
  sender: string;
  body?: string;
  formattedBody?: string;
  timestamp: number;
  threadRoot?: string;
  reactions?: Array<{
    key: string;
    count: number;
    senders: string[];
  }>;
};
