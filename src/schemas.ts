/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { conceptsSchema, papersSchema, sectionsSchema, topicsSchema } from './schemas/paper-schemas'
import { knowledgeSchema, roadmapsSchema, usageEventsSchema, workspacesSchema } from './schemas/reader-schemas'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  papersSchema,
  topicsSchema,
  conceptsSchema,
  sectionsSchema,
  knowledgeSchema,
  roadmapsSchema,
  workspacesSchema,
  usageEventsSchema,
]
