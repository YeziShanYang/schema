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
