/**
 * Shared paper analysis: papers, topics, concepts and sections.
 *
 * These are written only by server code (the analyze job and server actions,
 * which run with RBAC off). Every role, including signed-out visitors, can
 * read them, so a paper's page is shareable. No client role may create,
 * update or delete. Admins (the app owner) may update and delete for
 * moderation, and may create topics so maintenance scripts such as
 * scripts/split-shared-topics.mjs can add a topic.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const readOnlyForEveryone: Record<string, RolePermissions> = {
  '*': { read: true, create: false, update: false, delete: false },
  viewer: { read: true, create: false, update: false, delete: false },
  member: { read: true, create: false, update: false, delete: false },
  admin: { read: true, create: false, update: true, delete: true },
}

const topicPermissions: Record<string, RolePermissions> = {
  ...readOnlyForEveryone,
  admin: { read: true, create: true, update: true, delete: true },
}

export const papersSchema: CollectionSchema = {
  name: 'papers',
  columns: [
    { name: 'arxivId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'version', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'authors', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'abstract', storage: 'text', interpretation: 'plain' },
    { name: 'primaryCategory', storage: 'text', interpretation: 'plain' },
    { name: 'publishedAt', storage: 'text', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['queued', 'processing', 'ready', 'failed'] },
    },
    {
      name: 'stage',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['queued', 'text', 'concepts', 'overview', 'resources', 'explain', 'verify', 'ready', 'failed'],
      },
    },
    { name: 'progress', storage: 'number', interpretation: 'plain' },
    { name: 'progressMessage', storage: 'text', interpretation: 'plain' },
    { name: 'error', storage: 'text', interpretation: 'plain' },
    { name: 'mainContribution', storage: 'text', interpretation: 'plain' },
    { name: 'textChars', storage: 'number', interpretation: 'plain' },
    { name: 'textKey', storage: 'text', interpretation: 'plain' },
    { name: 'conceptCount', storage: 'number', interpretation: 'plain' },
    { name: 'branches', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'topicKeys', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'overview', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'overviewLoadingAt', storage: 'number', interpretation: 'plain' },
    { name: 'timings', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'retries', storage: 'number', interpretation: 'plain' },
    { name: 'textSource', storage: 'text', interpretation: { kind: 'select', options: ['html', 'pdf'] } },
    { name: 'pipelineVersion', storage: 'number', interpretation: 'plain' },
    { name: 'overviewDropped', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['arxivId'],
  permissions: readOnlyForEveryone,
}

export const topicsSchema: CollectionSchema = {
  name: 'topics',
  columns: [
    { name: 'key', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'level',
      storage: 'text',
      interpretation: { kind: 'select', options: ['foundation', 'core', 'specialized'] },
    },
    { name: 'description', storage: 'text', interpretation: 'plain' },
    { name: 'searchQuery', storage: 'text', interpretation: 'plain' },
    { name: 'resources', storage: 'text', interpretation: { kind: 'json' } },
    {
      name: 'resourcesStatus',
      storage: 'text',
      interpretation: { kind: 'select', options: ['none', 'loading', 'ready', 'failed', 'skipped'] },
    },
    { name: 'resourcesLoadingAt', storage: 'number', interpretation: 'plain' },
    {
      name: 'origin',
      storage: 'text',
      interpretation: { kind: 'select', options: ['starter', 'paper'] },
    },
  ],
  uniqueOn: ['key'],
  permissions: topicPermissions,
}

export const conceptsSchema: CollectionSchema = {
  name: 'concepts',
  columns: [
    { name: 'paperId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'arxivId', storage: 'text', interpretation: 'plain' },
    { name: 'key', storage: 'text', interpretation: 'plain' },
    { name: 'topicKey', storage: 'text', interpretation: 'plain' },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'whyNeeded', storage: 'text', interpretation: 'plain' },
    { name: 'section', storage: 'text', interpretation: 'plain' },
    { name: 'quote', storage: 'text', interpretation: 'plain' },
    { name: 'quoteVerified', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'dependsOn', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'tier', storage: 'number', interpretation: 'plain' },
    {
      name: 'depth',
      storage: 'text',
      interpretation: { kind: 'select', options: ['skim', 'working', 'deep'] },
    },
    { name: 'order', storage: 'number', interpretation: 'plain' },
    { name: 'check', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'branchKey', storage: 'text', interpretation: 'plain' },
    { name: 'explanation', storage: 'text', interpretation: 'plain' },
    { name: 'explanationAt', storage: 'number', interpretation: 'plain' },
    { name: 'explanationPendingAt', storage: 'number', interpretation: 'plain' },
    { name: 'plainRole', storage: 'text', interpretation: 'plain' },
    { name: 'quoteDisplay', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['paperId', 'key'],
  permissions: readOnlyForEveryone,
}

export const sectionsSchema: CollectionSchema = {
  name: 'sections',
  columns: [
    { name: 'paperId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'arxivId', storage: 'text', interpretation: 'plain' },
    { name: 'order', storage: 'number', interpretation: 'plain' },
    { name: 'heading', storage: 'text', interpretation: 'plain' },
    { name: 'summary', storage: 'text', interpretation: 'plain' },
    { name: 'conceptKeys', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['paperId', 'order'],
  permissions: readOnlyForEveryone,
}
