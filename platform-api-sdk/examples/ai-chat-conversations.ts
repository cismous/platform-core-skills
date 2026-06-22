/**
 * AI chat conversations — Pattern 1 storage (single record per conversation).
 *
 * One platform dataset (`conversations`), one record per conversation, all
 * messages in a `json` field. Flat metadata fields drive the sidebar list.
 *
 * See guides/storage-patterns.md §"Pattern 1" for the rationale and when to
 * outgrow this shape.
 *
 * ── Bootstrap (run once, see guides/schema.md) ─────────────────────────────
 * 1. createApp({ code: "ai-chat" })
 * 2. createDataset(appId, { code: "conversations" })
 * 3. createSchemaVersion + createField for each entry in `SCHEMA` below
 * 4. submitSchemaVersion + publish
 * 5. Stash the resulting datasetId + published schemaVersionId in env
 *
 * ── Required env ────────────────────────────────────────────────────────────
 *   CONVERSATIONS_DATASET_ID        UUID of the conversations dataset
 *   CONVERSATIONS_SCHEMA_VERSION_ID UUID of its currently published schema version
 *
 * For server-to-server, swap the `platform` import for createPlatformWithApiKey().
 */
import { platform, PlatformApiError } from "@platform/api-sdk";

const DATASET_ID = requireEnv("CONVERSATIONS_DATASET_ID");
const SCHEMA_VERSION_ID = requireEnv("CONVERSATIONS_SCHEMA_VERSION_ID");

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

const now = () => new Date().toISOString();

// ── Schema (mirror this when you build the dataset; see bootstrap above) ──
/**
 * fields:
 *   title          text       text_single        required
 *   model          text       text_single        required
 *   messages       json       json_editor        required
 *   messageCount   int        number_input       required  default 0
 *   lastMessageAt  datetime   datetime_picker
 *   preview        long_text  textarea
 *   archived       boolean    switch             default false
 */

export type Role = "user" | "assistant" | "system" | "tool";

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  // Extend freely — `json` field doesn't enforce shape:
  toolCalls?: Array<{ name: string; arguments: unknown }>;
  usage?: { input: number; output: number };
};

export type ConversationData = {
  title: string;
  model: string;
  messages: Message[];
  messageCount: number;
  lastMessageAt: string;
  preview: string;
  archived: boolean;
};

export type Conversation = ConversationData & { id: string };

const PREVIEW_MAX = 200;
const TITLE_MAX = 40;

function previewOf(content: string): string {
  return content.slice(0, PREVIEW_MAX);
}

function titleOf(content: string): string {
  return content.slice(0, TITLE_MAX);
}

/** Create a new conversation seeded with one user message. */
export async function createConversation(model: string, firstUserMessage: string): Promise<string> {
  const m: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: firstUserMessage,
    createdAt: now(),
  };
  const { record } = await platform.datasets.createRecord(DATASET_ID, {
    schemaVersionId: SCHEMA_VERSION_ID,
    data: {
      title: titleOf(firstUserMessage),
      model,
      messages: [m],
      messageCount: 1,
      lastMessageAt: m.createdAt,
      preview: previewOf(firstUserMessage),
      archived: false,
    } satisfies ConversationData,
  });
  return record.id;
}

/**
 * Append messages to an existing conversation. Last message's content drives
 * `preview` / `lastMessageAt`. Performs a read → mutate → patch — accept the
 * race for normal single-user chat; if you have concurrent appends, serialize
 * at the app level (queue per conversationId).
 */
export async function appendMessages(
  conversationId: string,
  newMessages: Message[],
): Promise<void> {
  if (newMessages.length === 0) return;
  const { record } = await platform.datasets.getRecord(DATASET_ID, conversationId);
  const cur = record.data as ConversationData;
  const messages = [...cur.messages, ...newMessages];
  const last = newMessages[newMessages.length - 1]!;
  await platform.datasets.patchRecord(DATASET_ID, conversationId, {
    data: {
      messages,
      messageCount: messages.length,
      lastMessageAt: last.createdAt,
      preview: previewOf(last.content),
    },
  });
}

/** Rename a conversation (e.g. after the model auto-summarizes). */
export async function renameConversation(conversationId: string, title: string): Promise<void> {
  await platform.datasets.patchRecord(DATASET_ID, conversationId, {
    data: { title: titleOf(title) },
  });
}

/** Soft-archive — stays in the dataset but is filtered out of the sidebar. */
export async function archiveConversation(conversationId: string): Promise<void> {
  await platform.datasets.patchRecord(DATASET_ID, conversationId, { data: { archived: true } });
}

export async function unarchiveConversation(conversationId: string): Promise<void> {
  await platform.datasets.patchRecord(DATASET_ID, conversationId, { data: { archived: false } });
}

/** Hard delete — irrecoverable (server-side soft delete is invisible to the SDK). */
export async function deleteConversation(conversationId: string): Promise<void> {
  await platform.datasets.deleteRecord(DATASET_ID, conversationId);
}

/**
 * List for the sidebar — sorted by `lastMessageAt` desc, archived filtered out.
 * Downloads `messages` too (platform has no field projection); UI should render
 * from flat metadata only. Acceptable up to a few hundred conversations.
 */
export async function listConversations(): Promise<Conversation[]> {
  const { records } = await platform.datasets.listRecords(DATASET_ID);
  return records
    .map((r) => ({ id: r.id, ...(r.data as ConversationData) }))
    .filter((c) => !c.archived)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/** Read one conversation in full (used when the user opens it). */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  try {
    const { record } = await platform.datasets.getRecord(DATASET_ID, conversationId);
    return { id: record.id, ...(record.data as ConversationData) };
  } catch (e) {
    if (e instanceof PlatformApiError && e.status === 404) return null;
    throw e;
  }
}
