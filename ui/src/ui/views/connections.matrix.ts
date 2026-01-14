import { html, nothing } from "lit";

import { formatAgo } from "../format";
import type { ChannelAccountSnapshot, MatrixStatus } from "../types";
import type { ConnectionsProps } from "./connections.types";

export function renderMatrixCard(params: {
  props: ConnectionsProps;
  matrix?: MatrixStatus | null;
  matrixAccounts: ChannelAccountSnapshot[];
  accountCountLabel: unknown;
}) {
  const { props, matrix, matrixAccounts, accountCountLabel } = params;
  const hasMultipleAccounts = matrixAccounts.length > 1;

  const renderAccountCard = (account: ChannelAccountSnapshot) => {
    const label = account.name || account.accountId;
    return html`
      <div class="account-card">
        <div class="account-card-header">
          <div class="account-card-title">${label}</div>
          <div class="account-card-id">${account.accountId}</div>
        </div>
        <div class="status-list account-card-status">
          <div>
            <span class="label">Running</span>
            <span>${account.running ? "Yes" : "No"}</span>
          </div>
          <div>
            <span class="label">Connected</span>
            <span>${account.connected ? "Yes" : "No"}</span>
          </div>
          <div>
            <span class="label">Last inbound</span>
            <span>${account.lastInboundAt ? formatAgo(account.lastInboundAt) : "n/a"}</span>
          </div>
          ${account.lastError
            ? html`
                <div class="account-card-error">
                  ${account.lastError}
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  };

  return html`
    <div class="card">
      <div class="card-title">Matrix</div>
      <div class="card-sub">Matrix homeserver connection via matrix-js-sdk.</div>
      ${accountCountLabel}

      ${hasMultipleAccounts
        ? html`
            <div class="account-card-list">
              ${matrixAccounts.map((account) => renderAccountCard(account))}
            </div>
          `
        : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">Configured</span>
                <span>${matrix?.configured ? "Yes" : "No"}</span>
              </div>
              <div>
                <span class="label">Running</span>
                <span>${matrix?.running ? "Yes" : "No"}</span>
              </div>
              <div>
                <span class="label">Connected</span>
                <span>${matrix?.connected ? "Yes" : "No"}</span>
              </div>
              <div>
                <span class="label">User ID</span>
                <span>${matrix?.userId ?? "n/a"}</span>
              </div>
              <div>
                <span class="label">Homeserver</span>
                <span>${matrix?.homeserver ?? "n/a"}</span>
              </div>
              <div>
                <span class="label">Last connected</span>
                <span>${matrix?.lastConnectedAt ? formatAgo(matrix.lastConnectedAt) : "n/a"}</span>
              </div>
              <div>
                <span class="label">Last probe</span>
                <span>${matrix?.lastProbeAt ? formatAgo(matrix.lastProbeAt) : "n/a"}</span>
              </div>
            </div>
          `}

      ${matrix?.lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">
            ${matrix.lastError}
          </div>`
        : nothing}

      ${matrix?.probe
        ? html`<div class="callout" style="margin-top: 12px;">
            Probe ${matrix.probe.ok ? "ok" : "failed"}
            ${matrix.probe.displayName ? ` · ${matrix.probe.displayName}` : ""}
            ${matrix.probe.error ? ` · ${matrix.probe.error}` : ""}
          </div>`
        : nothing}

      <div class="form-grid" style="margin-top: 16px;">
        <label class="field">
          <span>Homeserver URL</span>
          <input
            type="text"
            .value=${props.matrixForm.homeserver}
            @input=${(e: Event) =>
              props.onMatrixChange({
                homeserver: (e.target as HTMLInputElement).value,
              })}
            placeholder="https://matrix.example.org"
          />
        </label>
        <label class="field">
          <span>User ID</span>
          <input
            type="text"
            .value=${props.matrixForm.userId}
            @input=${(e: Event) =>
              props.onMatrixChange({
                userId: (e.target as HTMLInputElement).value,
              })}
            placeholder="@bot:example.org"
          />
        </label>
        <label class="field">
          <span>Access token</span>
          <input
            type="password"
            .value=${props.matrixForm.accessToken}
            ?disabled=${props.matrixTokenLocked}
            @input=${(e: Event) =>
              props.onMatrixChange({
                accessToken: (e.target as HTMLInputElement).value,
              })}
          />
        </label>
        <label class="field">
          <span>DM enabled</span>
          <select
            .value=${props.matrixForm.dmEnabled ? "yes" : "no"}
            @change=${(e: Event) =>
              props.onMatrixChange({
                dmEnabled: (e.target as HTMLSelectElement).value === "yes",
              })}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label class="field">
          <span>Allow from</span>
          <input
            .value=${props.matrixForm.allowFrom}
            @input=${(e: Event) =>
              props.onMatrixChange({
                allowFrom: (e.target as HTMLInputElement).value,
              })}
            placeholder="@alice:example.org, *"
          />
        </label>
        <label class="field">
          <span>Media max MB</span>
          <input
            type="number"
            .value=${props.matrixForm.mediaMaxMb}
            @input=${(e: Event) =>
              props.onMatrixChange({
                mediaMaxMb: (e.target as HTMLInputElement).value,
              })}
            placeholder="50"
          />
        </label>
      </div>

      <div class="callout" style="margin-top: 12px;">
        Get an access token from Element: Settings → Help & About → Access Token.
        Or use password login via MATRIX_PASSWORD env var.
      </div>

      ${props.matrixTokenLocked
        ? html`<div class="callout" style="margin-top: 12px;">
            MATRIX_ACCESS_TOKEN is set in the environment. Config edits will not override it.
          </div>`
        : nothing}

      ${props.matrixStatus
        ? html`<div class="callout" style="margin-top: 12px;">
            ${props.matrixStatus}
          </div>`
        : nothing}

      <div class="row" style="margin-top: 14px;">
        <button
          class="btn primary"
          ?disabled=${props.matrixSaving}
          @click=${() => props.onMatrixSave()}
        >
          ${props.matrixSaving ? "Saving…" : "Save"}
        </button>
        <button class="btn" @click=${() => props.onRefresh(true)}>
          Probe
        </button>
      </div>
    </div>
  `;
}
