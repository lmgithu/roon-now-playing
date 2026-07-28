import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { FactsConfig } from '@roon-screen-cover/shared';
import { DEFAULT_FACTS_MAX_TOKENS } from '@roon-screen-cover/shared';
import { logger } from './logger.js';

export interface LLMProvider {
  generateFacts(artist: string, album: string, title: string): Promise<string[]>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

function buildPrompt(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

function getMaxTokens(config: FactsConfig): number {
  const n = config.maxTokens;
  if (typeof n === 'number' && Number.isFinite(n) && n >= 256) {
    return Math.min(Math.floor(n), 32_768);
  }
  return DEFAULT_FACTS_MAX_TOKENS;
}

/** Strip markdown fences and normalize typographic quotes that break JSON. */
export function normalizeFactsText(text: string): string {
  let content = text.trim();

  // Prefer fenced JSON block if present
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim();
  }

  // Smart/curly quotes → straight quotes
  content = content
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  return content.trim();
}

function tryParseJsonArray(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    // Array of objects with text/fact fields
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          (typeof (item as { fact?: unknown }).fact === 'string' ||
            typeof (item as { text?: unknown }).text === 'string')
      )
    ) {
      return parsed
        .map((item) => String((item as { fact?: string; text?: string }).fact ?? (item as { text?: string }).text ?? '').trim())
        .filter((s) => s.length > 0);
    }
  } catch {
    // not valid JSON
  }
  return null;
}

/** Soft-repair common near-JSON patterns from LLMs. */
function repairJsonArrayCandidate(candidate: string): string {
  let s = candidate.trim();

  // Close unclosed array
  if (s.startsWith('[') && !s.endsWith(']')) {
    // Drop trailing incomplete string fragment after last complete fact
    const lastComplete = Math.max(s.lastIndexOf('",'), s.lastIndexOf('"\n'));
    if (lastComplete > 0) {
      // Keep through last quote that likely ends a string, then close array
      const upTo = s.lastIndexOf('"');
      if (upTo > 0) {
        s = s.slice(0, upTo + 1);
      }
    }
    s = s.replace(/,\s*$/, '');
    if (!s.endsWith(']')) {
      s += ']';
    }
  }

  // Missing commas between string elements: "foo"\n"bar" or "foo" "bar"
  s = s.replace(/"\s*\n\s*"/g, '",\n"');
  s = s.replace(/"\s{2,}"/g, '", "');

  // Trailing commas before ]
  s = s.replace(/,\s*]/g, ']');

  // Semicolon separators sometimes used by models
  s = s.replace(/"\s*;\s*"/g, '", "');

  return s;
}

/**
 * Extract quoted string literals even when overall JSON is invalid.
 * Handles escaped quotes inside strings.
 */
function extractQuotedStrings(text: string): string[] {
  const facts: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    try {
      // Re-parse as JSON string to resolve escapes
      const value = JSON.parse(`"${match[1]}"`) as string;
      const trimmed = value.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 10) {
        facts.push(trimmed);
      }
    } catch {
      const trimmed = match[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (trimmed.length > 10) {
        facts.push(trimmed);
      }
    }
  }
  return facts;
}

/**
 * Fallback for bracketed lines without proper JSON quoting:
 * [Some fact here]
 * [Another fact]
 */
function extractBracketLines(text: string): string[] {
  const lines = text.split(/\n+/);
  const facts: string[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^\[\s*(.+?)\s*\]$/);
    if (m) {
      let body = m[1].trim();
      // Strip surrounding quotes if present
      if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
        body = body.slice(1, -1);
      }
      body = body.replace(/\s+/g, ' ').trim();
      if (body.length > 10 && !body.startsWith('{')) {
        facts.push(body);
      }
    }
  }
  return facts;
}

/**
 * Parse LLM output into a list of fact strings.
 * Tolerates markdown fences, smart quotes, truncated arrays, missing commas,
 * multi-array line formats, and non-JSON bracketed lines.
 */
export function parseFactsResponse(text: string): string[] {
  if (!text || !text.trim()) {
    logger.warn('[ParseFacts] Empty response content');
    return [];
  }

  const content = normalizeFactsText(text);

  // Strategy 1: Whole response is a JSON array
  let parsed = tryParseJsonArray(content);
  if (parsed && parsed.length > 0) {
    return parsed;
  }

  // Strategy 2: Extract first [...] slice (non-greedy via balanced-ish match)
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    parsed = tryParseJsonArray(arrayMatch[0]);
    if (parsed && parsed.length > 0) {
      return parsed;
    }

    const repaired = repairJsonArrayCandidate(arrayMatch[0]);
    parsed = tryParseJsonArray(repaired);
    if (parsed && parsed.length > 0) {
      logger.info(`[ParseFacts] Parsed ${parsed.length} facts after JSON repair`);
      return parsed;
    }
  }

  // Strategy 3: Truncated array without closing ]
  const openIdx = content.indexOf('[');
  if (openIdx !== -1) {
    const repaired = repairJsonArrayCandidate(content.slice(openIdx));
    parsed = tryParseJsonArray(repaired);
    if (parsed && parsed.length > 0) {
      logger.info(`[ParseFacts] Parsed ${parsed.length} facts from truncated array`);
      return parsed;
    }
  }

  // Strategy 4: Multiple single-element arrays on separate lines: ["Fact 1"]\n["Fact 2"]
  try {
    const lineArrays = content.match(/\[[\s\S]*?\]/g);
    if (lineArrays && lineArrays.length > 1) {
      const facts: string[] = [];
      for (const arr of lineArrays) {
        const items = tryParseJsonArray(arr) ?? tryParseJsonArray(repairJsonArrayCandidate(arr));
        if (items) {
          facts.push(...items);
        }
      }
      if (facts.length > 0) {
        logger.info(`[ParseFacts] Parsed ${facts.length} facts from multi-array format`);
        return facts;
      }
    }
  } catch {
    // ignore
  }

  // Strategy 5: Pull all double-quoted strings
  const quoted = extractQuotedStrings(content);
  if (quoted.length > 0) {
    logger.info(`[ParseFacts] Extracted ${quoted.length} facts from quoted strings`);
    return quoted;
  }

  // Strategy 6: Bracketed non-JSON lines
  const brackets = extractBracketLines(content);
  if (brackets.length > 0) {
    logger.info(`[ParseFacts] Extracted ${brackets.length} facts from bracket lines`);
    return brackets;
  }

  // Strategy 7: Numbered / bulleted list
  const listFacts = content
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 20 && !line.startsWith('{') && !line.startsWith('['));
  if (listFacts.length >= 2) {
    logger.info(`[ParseFacts] Extracted ${listFacts.length} facts from list format`);
    return listFacts;
  }

  const preview = content.length > 500 ? content.substring(0, 500) + '...' : content;
  logger.warn(`[ParseFacts] Could not parse facts from response. Preview: ${preview}`);
  return [];
}

/** Pull text content from OpenAI-compatible chat completion payloads. */
export function extractChatCompletionContent(data: unknown): string | null {
  const choices = (data as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices;
  const message = choices?.[0]?.message;
  if (!message) return null;

  const content = message.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  // Thinking / reasoning models (DeepSeek, some local models)
  const reasoning = message.reasoning;
  if (typeof reasoning === 'string' && reasoning.trim()) {
    logger.info(`[LLM] Using 'reasoning' field from thinking model`);
    return reasoning;
  }

  // Some providers nest reasoning_content
  const reasoningContent = message.reasoning_content;
  if (typeof reasoningContent === 'string' && reasoningContent.trim()) {
    logger.info(`[LLM] Using 'reasoning_content' field from thinking model`);
    return reasoningContent;
  }

  // Array content parts (multimodal-style responses)
  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: string }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean);
    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private config: FactsConfig;

  constructor(config: FactsConfig) {
    this.config = config;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async generateFacts(artist: string, album: string, title: string): Promise<string[]> {
    const prompt = buildPrompt(this.config.prompt, {
      artist,
      album,
      title,
      factsCount: this.config.factsCount,
    });

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: getMaxTokens(this.config),
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        return parseFactsResponse(textContent.text);
      }
    } catch (error) {
      logger.error(`Anthropic API error: ${error}`);
      throw error;
    }

    return [];
  }
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private config: FactsConfig;

  constructor(config: FactsConfig) {
    this.config = config;
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async generateFacts(artist: string, album: string, title: string): Promise<string[]> {
    const prompt = buildPrompt(this.config.prompt, {
      artist,
      album,
      title,
      factsCount: this.config.factsCount,
    });

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        // max_completion_tokens replaces the deprecated max_tokens and is required
        // by reasoning models (gpt-5 family, o-series); accepted by gpt-4.x too.
        max_completion_tokens: getMaxTokens(this.config),
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return parseFactsResponse(content);
      }
    } catch (error) {
      logger.error(`OpenAI API error: ${error}`);
      throw error;
    }

    return [];
  }
}

export class OpenRouterProvider implements LLMProvider {
  private config: FactsConfig;

  constructor(config: FactsConfig) {
    this.config = config;
  }

  async generateFacts(artist: string, album: string, title: string): Promise<string[]> {
    const prompt = buildPrompt(this.config.prompt, {
      artist,
      album,
      title,
      factsCount: this.config.factsCount,
    });

    try {
      const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/lmgithu/roon-now-playing',
          'X-Title': 'Roon Now Playing',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: getMaxTokens(this.config),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = extractChatCompletionContent(data);
      if (content) {
        return parseFactsResponse(content);
      }
      logger.warn(`[OpenRouter] No content in response: ${JSON.stringify(data).slice(0, 500)}`);
    } catch (error) {
      logger.error(`OpenRouter API error: ${error}`);
      throw error;
    }

    return [];
  }
}

export class LocalLLMProvider implements LLMProvider {
  private config: FactsConfig;

  constructor(config: FactsConfig) {
    this.config = config;
  }

  async generateFacts(artist: string, album: string, title: string): Promise<string[]> {
    const prompt = buildPrompt(this.config.prompt, {
      artist,
      album,
      title,
      factsCount: this.config.factsCount,
    });

    const baseUrl = this.config.localBaseUrl || 'http://localhost:11434/v1';
    const url = `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const requestBody = {
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: getMaxTokens(this.config),
      temperature: 0.4,
    };

    logger.info(`[LocalLLM] Request URL: ${url}`);
    logger.info(`[LocalLLM] Model: ${this.config.model}`);
    logger.debug(`[LocalLLM] Request body: ${JSON.stringify(requestBody, null, 2)}`);

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      logger.info(`[LocalLLM] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[LocalLLM] Error response: ${errorText}`);
        throw new Error(`Local LLM API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = extractChatCompletionContent(data);

      if (content) {
        logger.info(`[LocalLLM] Got response content (${content.length} chars)`);
        return parseFactsResponse(content);
      }

      const rawPreview = JSON.stringify(data, null, 2);
      logger.warn(`[LocalLLM] No content in response. Raw response:\n${rawPreview}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error(`Cannot connect to local LLM at ${baseUrl}. Is Ollama/LM Studio running?`);
      }
      logger.error(`Local LLM API error: ${error}`);
      throw error;
    }

    return [];
  }
}

export function createLLMProvider(config: FactsConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'local':
      return new LocalLLMProvider(config);
    case 'anthropic':
    default:
      return new AnthropicProvider(config);
  }
}
