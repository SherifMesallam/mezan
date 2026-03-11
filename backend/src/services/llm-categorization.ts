/**
 * LLM-based categorization: calls an external LLM API to suggest a category
 * from anonymized merchant/vendor text (+ optional location).
 * Uses anonymous learning signals as few-shot examples when available.
 */

export interface LLMCategorizationConfig {
  apiKey: string;
  baseURL?: string; // default https://api.openai.com/v1
  model?: string;   // e.g. gpt-4o-mini, gpt-3.5-turbo
}

export interface UserCategory {
  id: string;
  name: string;
  nameAr?: string | null;
}

export interface LearningExample {
  merchantNormalized: string;
  categoryName: string;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Call the LLM to suggest a category name from the list.
 * Returns the category id that best matches the LLM's response, or null if unclear.
 */
export async function suggestCategoryWithLLM(
  config: LLMCategorizationConfig,
  anonymizedText: string,
  userCategories: UserCategory[],
  options: {
    locationTile?: string | null;
    region?: string;
    learningExamples?: LearningExample[];
  } = {}
): Promise<string | null> {
  if (!anonymizedText || !anonymizedText.trim()) return null;
  if (userCategories.length === 0) return null;

  const categoryNames = userCategories.map((c) => c.name);
  const systemPrompt = buildSystemPrompt(categoryNames, options.learningExamples);
  const userPrompt = buildUserPrompt(anonymizedText.trim(), options.locationTile, options.region);

  const body = {
    model: config.model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 50,
    temperature: 0.2,
  };

  const baseURL = (config.baseURL || DEFAULT_BASE).replace(/\/$/, '');
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const suggestedName = normalizeCategoryResponse(content, categoryNames);
  const match = userCategories.find(
    (c) =>
      c.name.toLowerCase() === suggestedName.toLowerCase() ||
      (c.nameAr && c.nameAr.trim() === suggestedName)
  );
  return match?.id ?? userCategories.find((c) => c.name.toLowerCase().includes(suggestedName.toLowerCase()))?.id ?? null;
}

function buildSystemPrompt(
  categoryNames: string[],
  learningExamples?: LearningExample[]
): string {
  const list = categoryNames.map((n) => `- ${n}`).join('\n');
  let prompt = `You are a financial expense categorizer for a MENA (Middle East/North Africa) expense tracker. Your task is to suggest exactly one category from the following list based only on the vendor/merchant name (no amounts or numbers). Reply with only the category name, nothing else.

Categories:
${list}

Rules:
- Reply with exactly one category name from the list above.
- If the vendor is ambiguous, pick the most likely category (e.g. Fawry → Bills, Starbucks → Food).
- Consider common MENA/Egypt vendors: Fawry (bills/payments), Vodafone/Orange/WE/Etisalat (Bills), supermarkets and restaurants (Food), Uber/Careem (Transport), etc.
`;

  if (learningExamples && learningExamples.length > 0) {
    prompt += `\nLearn from these past examples (merchant → category):\n`;
    for (const ex of learningExamples.slice(0, 15)) {
      prompt += `- "${ex.merchantNormalized}" → ${ex.categoryName}\n`;
    }
    prompt += `Prefer the same category for similar merchant names.\n`;
  }

  return prompt;
}

function buildUserPrompt(
  anonymizedText: string,
  locationTile?: string | null,
  region?: string
): string {
  let prompt = `Vendor/merchant (anonymized): "${anonymizedText}"`;
  if (region) prompt += `\nRegion: ${region}`;
  if (locationTile) prompt += `\nLocation hint (coarse): ${locationTile}`;
  prompt += `\nSuggested category (one word or short phrase from the list):`;
  return prompt;
}

function normalizeCategoryResponse(content: string, categoryNames: string[]): string {
  const trimmed = content.split(/[\n.,]/)[0].trim();
  const match = categoryNames.find(
    (n) => n.toLowerCase() === trimmed.toLowerCase() || trimmed.toLowerCase().includes(n.toLowerCase())
  );
  if (match) return match;
  return trimmed;
}
