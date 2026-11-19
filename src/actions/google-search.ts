/**
 * @purpose Protocol-agnostic Google Search action (`googleSearchAction`) exposed over REST and MCP.
 * @rationale Exposes stealth Google Search capabilities to LLMs and HTTP clients with strict schema validation and abort signal propagation.
 * @preconditions Input must satisfy TypeBox constraints; stealth browser backend must be functional.
 * @invariants Pure Web-Standard action; zero node:* imports; additionalProperties: false enforced on all schemas.
 */

import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { executeGoogleSearch } from '../services/search.js';

/**
 * @purpose Google Search action definition implementing the Shukoi action contract.
 * @rationale Enables agents and clients to perform organic web searches with rich metadata and canonical URL resolution.
 * @invariants Strict TypeBox schema contract; zero console.log invocations; propagates ctx.signal.
 */
export const googleSearchAction = defineAction({
  name: 'googleSearch',
  summary: 'Execute web search on Google with stealth antibot',
  description:
    'Searches Google and returns structured organic web search results including title, canonical URL, redirect URL, and snippet context.',
  authRequired: false,
  http: {
    method: 'POST',
    path: '/actions/google-search',
    successStatus: 200,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      title: 'Google Web Search',
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  input: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 500,
        description: 'Search keywords or phrase to query on Google',
      }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Maximum number of organic search results to return (1-50, default: 10)',
        }),
      ),
      language: Type.Optional(
        Type.String({
          minLength: 2,
          maxLength: 5,
          default: 'en',
          description: 'Search interface language code (e.g., "en", "id")',
        }),
      ),
      country: Type.Optional(
        Type.String({
          minLength: 2,
          maxLength: 5,
          default: 'us',
          description: 'Geolocation country code for localized results (e.g., "us", "id")',
        }),
      ),
      safeSearch: Type.Optional(
        Type.Boolean({
          default: true,
          description: 'Whether to enable Google SafeSearch content filtering (default: true)',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      query: Type.String({ description: 'Original search query executed' }),
      totalReturned: Type.Integer({ description: 'Count of search results returned' }),
      results: Type.Array(
        Type.Object(
          {
            title: Type.String({ description: 'Search result title' }),
            url: Type.String({ description: 'Canonical destination URL' }),
            redirectUrl: Type.String({ description: 'Google redirect tracking URL' }),
            snippet: Type.String({ description: 'Text snippet context' }),
          },
          { additionalProperties: false },
        ),
        { description: 'List of matching organic search results' },
      ),
      timestamp: Type.String({ description: 'ISO-8601 timestamp of query execution' }),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Executing Google search action', {
      query: input.query,
      limit: input.limit,
    });

    return await executeGoogleSearch(
      {
        query: input.query,
        limit: input.limit,
        language: input.language,
        country: input.country,
        safeSearch: input.safeSearch,
      },
      ctx.signal,
    );
  },
});
