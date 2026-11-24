/**
 * Per-reader state: the knowledge profile and the papers each reader has
 * opened. Private to the owner. `userId` is userBound so a client cannot
 * write a row for someone else, and uniqueOn keeps one row per topic (or
 * paper) per reader.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const ownOnly: Record<string, RolePermissions> = {
  '*': { read: false, create: false, update: false, delete: false },
  viewer: { read: false, create: false, update: false, delete: false },
  member: { read: 'own', create: true, update: 'own', delete: 'own' },
  admin: { read: 'own', create: true, update: 'own', delete: 'own' },
}

export const knowledgeSchema: CollectionSchema = {
  name: 'knowledge',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
    { name: 'topicKey', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['known', 'learning'] },
    },
    {
      name: 'source',
      storage: 'text',
      interpretation: { kind: 'select', options: ['self', 'paper', 'check', 'finished'] },
    },
    { name: 'paperId', storage: 'text', interpretation: 'plain' },
    { name: 'arxivId', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'userId',
  uniqueOn: ['userId', 'topicKey'],
  permissions: ownOnly,
}

/**
 * Per-concept checkmarks: one row per (reader, concept). Checking a concept
 * never checks anything in another paper. The concept's name and topic are
 * copied in for hints and for the knowledge page, and so a re-analysis can
 * move the row to the new concept with the same name (see
 * src/lib/knowledge-remap.ts). The `knowledge` collection above now holds the
 * reader's self-declared profile topics.
 */
export const conceptKnowledgeSchema: CollectionSchema = {
  name: 'concept_knowledge',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
    { name: 'conceptId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'paperId', storage: 'text', interpretation: 'plain' },
    { name: 'arxivId', storage: 'text', interpretation: 'plain' },
    { name: 'conceptName', storage: 'text', interpretation: 'plain' },
    { name: 'topicKey', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['known'] } },
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['self', 'finished'] } },
    { name: 'stale', storage: 'number', interpretation: { kind: 'boolean' } },
  ],
  ownerField: 'userId',
  uniqueOn: ['userId', 'conceptId'],
  permissions: ownOnly,
}

export const roadmapsSchema: CollectionSchema = {
  name: 'roadmaps',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
    { name: 'paperId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'arxivId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['reading', 'finished'] },
    },
    { name: 'lastOpenedAt', storage: 'number', interpretation: 'plain' },
    { name: 'finishedAt', storage: 'number', interpretation: 'plain' },
    { name: 'overviewReadAt', storage: 'number', interpretation: 'plain' },
  ],
  ownerField: 'userId',
  uniqueOn: ['userId', 'paperId'],
  permissions: ownOnly,
}

export const workspacesSchema: CollectionSchema = {
  name: 'workspaces',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'description', storage: 'text', interpretation: 'plain', maxLength: 1000 },
    { name: 'currentPaperId', storage: 'text', interpretation: 'plain' },
    { name: 'papers', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'suggestions', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'suggestionsAt', storage: 'number', interpretation: 'plain' },
    { name: 'lastOpenedAt', storage: 'number', interpretation: 'plain' },
  ],
  ownerField: 'userId',
  permissions: ownOnly,
}

/**
 * Papers in a workspace, one row per (reader, workspace, paper), so two quick
 * adds each write their own row instead of rewriting one shared list.
 */
export const workspacePapersSchema: CollectionSchema = {
  name: 'workspace_papers',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
    { name: 'workspaceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'paperId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'arxivId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['active', 'finished'] },
    },
    { name: 'addedAt', storage: 'number', interpretation: 'plain' },
  ],
  ownerField: 'userId',
  uniqueOn: ['userId', 'workspaceId', 'paperId'],
  permissions: ownOnly,
}

/**
 * Metered actions per user (paper analyses, recommendations, explanations),
 * used for the daily caps and, for analyses, as the record of who requested
 * a paper. Written only by server code; no client role can read or write it
 * except admins reading for audit. A failed analysis is marked refunded so
 * it does not use up a daily slot.
 */
export const usageEventsSchema: CollectionSchema = {
  name: 'usage_events',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'kind',
      storage: 'text',
      interpretation: { kind: 'select', options: ['analyze', 'recommend', 'explain', 'branch', 'overview'] },
    },
    { name: 'ref', storage: 'text', interpretation: 'plain' },
    {
      name: 'state',
      storage: 'text',
      interpretation: { kind: 'select', options: ['counted', 'refunded'] },
    },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
