/**
 * One Claude Haiku call through `anthropic/chat-completion`, returning the
 * parsed JSON object. Throws a short, user-presentable error on failure.
 */

import { extractJsonObject } from '../../lib/json'
import type { PipelineClient } from './client'
import { MODEL } from './prompts'

interface AnthropicMessage {
  content?: { type: string; text?: string }[]
  stop_reason?: string
}

/** The proxy may hand back the message itself or wrap it; find the message. */
export function findMessage(v: unknown, depth = 0): AnthropicMessage | null {
  if (!v || typeof v !== 'object' || depth > 3) return null
  const o = v as Record<string, unknown>
  if (Array.isArray(o.content)) return o as AnthropicMessage
  for (const k of ['data', 'response', 'message', 'result']) {
    const found = findMessage(o[k], depth + 1)
    if (found) return found
  }
  return null
}

export async function callModelJson(
  client: PipelineClient,
  args: { system: string; user: string; maxTokens: number; hint: string },
): Promise<Record<string, unknown>> {
  const text = await callModelText(client, args)
  const json = extractJsonObject(text)
  if (!json) throw new Error('The model returned output that was not valid JSON.')
  return json
}

export async function callModelText(
  client: PipelineClient,
  args: { system: string; user: string; maxTokens: number; hint: string },
): Promise<string> {
  const raw = await client.call(
    'anthropic/chat-completion',
    {
      model: MODEL,
      max_tokens: args.maxTokens,
      temperature: 0,
      system: args.system,
      messages: [{ role: 'user', content: args.user }],
    },
    args.hint,
  )
  const msg = findMessage(raw)
  if (!msg) throw new Error('The model returned an empty response.')
  const text = (msg.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (msg.stop_reason === 'max_tokens') {
    throw new Error('The model ran out of output space before finishing.')
  }
  if (!text.trim()) throw new Error('The model returned an empty response.')
  return text
}
