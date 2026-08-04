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

/** Strip markdown fences and lightly normalize typography. */
export function normalizeFactsText(text: string): string {
  let content = text.trim();

  // Prefer fenced JSON block if present
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim();
  }

  // Curly double quotes → straight (outer JSON delimiters from some models).
  // Curly apostrophes/singles → ASCII apostrophe so titles like METZ’s stay intact
  // without introducing extra " boundaries that shatter facts.
  content = content
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  return content.trim();
}

function cleanFact(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function countUnescapedQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) n++;
  }
  return n;
}

/**
 * Rejoin facts shattered by unescaped mid-string quotes followed by a comma
 * (e.g. album title "Ecstasy in the Shadow of Ecstasy", next fragment starts with `, "…`).
 *
 * When the previous fact has an open quote and the next piece starts with junk
 * (`, "` / `",`), close the quote on prev. If the remainder is a full new
 * sentence, keep it as a separate fact instead of gluing into a mega-string.
 */
export function rejoinSplitFacts(facts: string[]): string[] {
  if (facts.length <= 1) return facts;

  const out: string[] = [];
  for (const raw of facts) {
    const f = cleanFact(raw);
    if (!f) continue;
    if (out.length === 0) {
      out.push(f);
      continue;
    }

    const prev = out[out.length - 1]!;
    const prevEndsSentence = /[.!?…]["')\]]?\s*$/u.test(prev);
    const prevOddQuotes = countUnescapedQuotes(prev) % 2 === 1;
    const nextStartsWithJunk = /^[,;:]+/.test(f) || /^["']\s*[,.]/.test(f);
    const nextIsOrphan =
      nextStartsWithJunk ||
      /^["']\s*[,.]?\s*["']?[A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű]/.test(f) ||
      (/^["']/.test(f) && !prevEndsSentence && f.length < 100);

    // Classic shatter: open title quote + next chunk is `, "Next full fact…`
    if (prevOddQuotes && nextStartsWithJunk) {
      const closed = prev.endsWith('"') ? prev : `${prev}"`;
      const rest = f.replace(/^[,;:"'\s]+/, '').trim();
      out[out.length - 1] = cleanFact(closed);
      if (rest.length >= 40 && /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(rest[0] ?? '')) {
        out.push(rest);
      } else if (rest.length > 0) {
        out[out.length - 1] = cleanFact(`${closed} ${rest}`);
      }
      continue;
    }

    if (prevOddQuotes || (nextIsOrphan && !prevEndsSentence)) {
      // Glue: drop leading junk from the orphan piece
      let tail = f.replace(/^[,;:\s]+/, ' ').trimStart();
      if (prevOddQuotes && !prev.endsWith('"')) {
        // Close open quote, then continue with remaining text
        if (tail.startsWith('"')) {
          tail = tail.slice(1).replace(/^\s*/, ' ').trimStart();
          out[out.length - 1] = cleanFact(`${prev}"${tail ? ` ${tail}` : ''}`);
        } else {
          out[out.length - 1] = cleanFact(`${prev}" ${tail}`);
        }
      } else {
        const sep = prev.endsWith(' ') || tail.startsWith(' ') ? '' : ' ';
        out[out.length - 1] = cleanFact(`${prev}${sep}${tail}`);
      }
      continue;
    }

    out.push(f);
  }
  return out;
}

/** Drop chain-of-thought / prompt echoes that models sometimes return as "facts". */
export function looksLikeReasoningLeak(fact: string): boolean {
  const f = fact.trim();
  const lower = f.toLowerCase();
  // Tiny debris only (do not treat short real facts like "Fact one." as leaks)
  if (f.length < 4) return true;

  const patterns: RegExp[] = [
    /\bwe need to generate\b/i,
    /\blet'?s (research|investigate|recall|check)\b/i,
    /\bknown facts\s*:/i,
    /\bi recall (that|from)\b/i,
    /\bfrom memory\b/i,
    /\bbetter\s*:/i,
    /\bhmm\.?\s*$/i,
    /\bfacts should be in\b/i,
    /\bmust be concise\b/i,
    /\bensure facts are\b/i,
    /\bgenerate \d+\s+interesting\b/i,
    /\breturn only a valid json\b/i,
    /\blesser-known facts about\b/i,
    /\bthe prompt\b/i,
    /\bchain[- ]of[- ]thought\b/i,
    /\bnot sure\.?\s*$/i,
    /\blet'?s (see|think|figure)\b/i,
    /\baccording to (my |the )?(knowledge|training)\b/i,
    /\bi (don'?t|do not) have (enough |reliable )?info/i,
    /\bas an ai\b/i,
    /\bplaceholder\b/i,
    /\btrack says various artists\b/i,
    /\bbut track says\b/i,
    /\bfocus on recording history\b/i,
  ];
  if (patterns.some((p) => p.test(lower))) return true;

  // Meta planning that isn't a musical fact
  if (/^(we |i |let'?s |ok[,.]|okay[,.]|first[,]|second[,]|third[,])/i.test(f) && /fact|research|generate|album|song/i.test(f) && f.length < 220) {
    if (/\b(need to|should|must|will try|let me)\b/i.test(lower)) return true;
  }

  return false;
}

function tryParseJsonArray(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed.map(cleanFact).filter((s) => s.length > 0);
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
        .map((item) =>
          cleanFact(
            String(
              (item as { fact?: string; text?: string }).fact ??
                (item as { text?: string }).text ??
                ''
            )
          )
        )
        .filter((s) => s.length > 0);
    }
  } catch {
    // not valid JSON
  }
  return null;
}

/**
 * Scan a JSON-like string array and extract top-level elements.
 *
 * Critical: a `"` only ends an element when the next non-whitespace char is
 * `,` or `]` (or EOF). Unescaped quotes around song titles mid-fact are kept
 * inside the element — the old regex fallback split those into extra "facts".
 *
 * Example broken input the naive extractor mishandled:
 *   ["The track "Come Together" was recorded in 1969.", "Second fact."]
 */
export function scanJsonStringArray(text: string): string[] {
  const start = text.indexOf('[');
  if (start === -1) return [];

  const facts: string[] = [];
  let i = start + 1;
  const n = text.length;

  const skipWs = (): void => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };

  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (text[i] === ']') {
      i++; // consume closing bracket
      skipWs();
      // Support multiple one-element arrays on separate lines: ["a"]\n["b"]
      if (i < n && text[i] === '[') {
        i++;
        continue;
      }
      break;
    }
    if (text[i] === ',') {
      i++;
      continue;
    }
    if (text[i] === '[') {
      // Nested or next array opener
      i++;
      continue;
    }

    if (text[i] !== '"') {
      // Skip unexpected tokens (comments, bare words) until quote/comma/bracket
      i++;
      continue;
    }

    // Start of a string element
    i++; // past opening "
    let buf = '';
    let closed = false;

    while (i < n) {
      const ch = text[i]!;

      if (ch === '\\' && i + 1 < n) {
        const next = text[i + 1]!;
        // Common JSON escapes
        if (next === 'n') buf += '\n';
        else if (next === 'r') buf += '\r';
        else if (next === 't') buf += '\t';
        else if (next === '"' || next === '\\' || next === '/') buf += next;
        else if (next === 'u' && i + 5 < n) {
          const hex = text.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            buf += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          buf += next;
        } else {
          buf += next;
        }
        i += 2;
        continue;
      }

      if (ch === '"') {
        // Lookahead: element terminator vs mid-string song-title quote.
        // A quote ends the element only when followed (after whitespace) by
        //   ,  ]  " (next element, missing comma)  or EOF.
        // Song titles sit mid-sentence: next char is a letter, not a delimiter.
        // Special case: `"Title", "Next fact…` — comma then quote looks like
        // JSON, but if the buffer has no sentence end and an odd quote count
        // we may still be mid-fact (model forgot to escape). Prefer rejoin later;
        // still end here when the following element looks like a new sentence.
        let j = i + 1;
        while (j < n && /\s/.test(text[j]!)) j++;
        const next = j < n ? text[j]! : '';
        let endsElement =
          next === '' || next === ',' || next === ']' || next === '"';

        if (endsElement && next === ',') {
          // Unbalanced quotes in buf → this " closes a mid-fact title, not the element.
          // (e.g. az "Ecstasy in the Shadow of Ecstasy", "A szám…)
          if (countUnescapedQuotes(buf) % 2 === 1) {
            endsElement = false;
          } else {
            // Peek past comma: if next token is " + capital letter, treat as new element.
            // If next is " + lowercase / punctuation fragment, keep quote as internal.
            let k = j + 1;
            while (k < n && /\s/.test(text[k]!)) k++;
            if (k < n && text[k] === '"') {
              let m = k + 1;
              while (m < n && /\s/.test(text[m]!)) m++;
              const first = m < n ? text[m]! : '';
              const looksNewFact =
                /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(first) &&
                (buf.length >= 40 || /[.!?…]["')\]]?\s*$/u.test(buf.trim()));
              const looksOrphan =
                first === ',' || first === '.' || /[a-záéíóöőúüű]/.test(first);
              if (!looksNewFact && looksOrphan) {
                endsElement = false;
              }
            }
          }
        }

        if (endsElement) {
          facts.push(cleanFact(buf));
          // Leave i on the delimiter (or EOF). If next element opens with ",
          // outer loop will pick it up — do not skip past that quote.
          i = j;
          closed = true;
          break;
        }

        // Internal unescaped quote (e.g. song title) — keep it
        buf += '"';
        i++;
        continue;
      }

      buf += ch;
      i++;
    }

    if (!closed && buf.trim().length > 0) {
      // Truncated trailing fact
      facts.push(cleanFact(buf));
    }
  }

  return facts.filter((f) => f.length > 0);
}

/**
 * Fallback for one-fact-per-line arrays that are fully valid on their own line:
 * ["Fact 1"]
 * ["Fact 2"]
 * Does NOT use non-greedy \[.*?\] across a single multi-element array (that
 * falsely splits on brackets/quotes inside facts).
 */
function extractPerLineArrays(text: string): string[] {
  const facts: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) continue;
    const parsed = tryParseJsonArray(trimmed) ?? scanJsonStringArray(trimmed);
    if (parsed.length === 1) {
      facts.push(parsed[0]!);
    } else if (parsed.length > 1 && trimmed.indexOf('],[') === -1) {
      // Single line with a full multi-element array
      return parsed;
    }
  }
  return facts;
}

/**
 * Bracketed non-JSON lines (no quotes):
 * [Stone Cold Moron features Colin Hawkins on drums...]
 */
function extractBracketLines(text: string): string[] {
  const facts: string[] = [];
  for (const line of text.split(/\n+/)) {
    const m = line.trim().match(/^\[\s*(.+?)\s*\]$/);
    if (!m) continue;
    let body = m[1]!.trim();
    if (
      (body.startsWith('"') && body.endsWith('"')) ||
      (body.startsWith("'") && body.endsWith("'"))
    ) {
      body = body.slice(1, -1);
    }
    body = cleanFact(body);
    // Must look like a sentence, not a short title fragment
    if (body.length >= 24 && !body.startsWith('{')) {
      facts.push(body);
    }
  }
  return facts;
}

function finalizeFacts(facts: string[], maxFacts?: number): string[] {
  let out = rejoinSplitFacts(facts.map(cleanFact).filter((f) => f.length > 0));

  // Drop prompt / chain-of-thought leaks
  const cleaned = out.filter((f) => !looksLikeReasoningLeak(f));
  if (cleaned.length > 0) {
    out = cleaned;
  } else if (out.length > 0) {
    // Entire payload was reasoning — refuse to show it
    logger.warn('[ParseFacts] All parsed items looked like reasoning leaks; dropping');
    return [];
  }

  // Only when over-count: drop short title-like fragments (the old bug mode),
  // then cap to maxFacts. Never strip short-but-valid facts when count is fine.
  if (maxFacts && out.length > maxFacts) {
    const sentences = out.filter((f) => f.length >= 40 || /[.!?…]["']?$/u.test(f));
    if (sentences.length >= Math.min(maxFacts, 2)) {
      out = sentences;
    } else {
      // Prefer longer strings over bare titles
      out = [...out].sort((a, b) => b.length - a.length);
    }
    out = out.slice(0, maxFacts);
  }

  // Second rejoin pass after filtering (orphan pieces may remain)
  out = rejoinSplitFacts(out);

  // Close any remaining open mid-fact quotes (truncation / shatter residue)
  out = out.map((f) => {
    if (countUnescapedQuotes(f) % 2 === 1 && !f.endsWith('"')) {
      return cleanFact(`${f}"`);
    }
    return f;
  });

  return out;
}

/**
 * Parse LLM output into a list of fact strings.
 *
 * Prefer strict JSON, then a top-level string-array scanner that keeps
 * mid-fact quotes (song titles) intact. Never use "match every quoted
 * substring" — that is what produced 9+ fragments for 5 facts.
 */
export function parseFactsResponse(text: string, maxFacts?: number): string[] {
  if (!text || !text.trim()) {
    logger.warn('[ParseFacts] Empty response content');
    return [];
  }

  const content = normalizeFactsText(text);

  // Strategy 1: strict JSON
  let parsed = tryParseJsonArray(content);
  if (parsed && parsed.length > 0) {
    return finalizeFacts(parsed, maxFacts);
  }

  // Strategy 2: top-level scanner on whole text / first array region
  const scanned = scanJsonStringArray(content);
  if (scanned.length > 0) {
    logger.info(`[ParseFacts] Scanned ${scanned.length} facts from near-JSON array`);
    return finalizeFacts(scanned, maxFacts);
  }

  // Strategy 3: one JSON array per line
  const perLine = extractPerLineArrays(content);
  if (perLine.length > 0) {
    logger.info(`[ParseFacts] Parsed ${perLine.length} facts from per-line arrays`);
    return finalizeFacts(perLine, maxFacts);
  }

  // Strategy 4: bracketed prose lines
  const brackets = extractBracketLines(content);
  if (brackets.length > 0) {
    logger.info(`[ParseFacts] Extracted ${brackets.length} facts from bracket lines`);
    return finalizeFacts(brackets, maxFacts);
  }

  // Strategy 5: numbered / bulleted list
  const listFacts = content
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length >= 24 && !line.startsWith('{') && !line.startsWith('['));
  if (listFacts.length >= 2) {
    logger.info(`[ParseFacts] Extracted ${listFacts.length} facts from list format`);
    return finalizeFacts(listFacts, maxFacts);
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
        return parseFactsResponse(textContent.text, this.config.factsCount);
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
        return parseFactsResponse(content, this.config.factsCount);
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
        return parseFactsResponse(content, this.config.factsCount);
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
        return parseFactsResponse(content, this.config.factsCount);
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
