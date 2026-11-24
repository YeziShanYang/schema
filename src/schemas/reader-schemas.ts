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
 * Audit trail for metered AI actions (recommendations, explanations), used
 * for per-user daily caps. Written only by server actions; no client role can
 * read or write it except admins reading for audit.
 */
export const usageEventsSchema: CollectionSchema = {
  name: 'usage_events',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'kind',
      storage: 'text',
      interpretation: { kind: 'select', options: ['recommend', 'explain'] },
    },
    { name: 'ref', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
