import { DEFAULT_API_ORIGIN, DEFAULT_MCP_PUBLIC_URL, loadConfig } from '../src/config.js';
import { hasScope, authMaterialFromHeaders } from '../src/auth.js';

describe('loadConfig', () => {
  it('defaults to the production API origin', () => {
    const config = loadConfig({});
    expect(config.apiBase).toBe(`${DEFAULT_API_ORIGIN}/v1/`);
    expect(config.publicUrl).toBe(DEFAULT_MCP_PUBLIC_URL);
    expect(config.resourceUrl).toBe(`${DEFAULT_MCP_PUBLIC_URL}/mcp`);
    expect(config.oauthIssuerUrl).toBe(DEFAULT_API_ORIGIN);
    expect(config).not.toHaveProperty('surveyEngineBase');
  });

  it('lets DEEPTRUE_API_BASE override the origin and normalizes /v1/', () => {
    const config = loadConfig({
      DEEPTRUE_API_BASE: 'https://api.example.test/v1',
      MCP_PUBLIC_URL: 'https://mcp.example.test/',
    });
    expect(config.apiBase).toBe('https://api.example.test/v1/');
    expect(config.publicUrl).toBe('https://mcp.example.test');
    expect(config.resourceUrl).toBe('https://mcp.example.test/mcp');
    expect(config.oauthIssuerUrl).toBe('https://api.example.test');
  });
});

describe('hasScope', () => {
  it('treats mcp:write as superscope', () => {
    expect(hasScope({ token: 't', org: 'public', scopes: ['mcp:write'] }, 'mcp:fielding')).toBe(true);
    expect(hasScope({ token: 't', org: 'public', scopes: ['mcp:read'] }, 'mcp:write')).toBe(false);
  });

  it('does not grant mcp:pii via mcp:write', () => {
    expect(hasScope({ token: 't', org: 'public', scopes: ['mcp:write'] }, 'mcp:pii')).toBe(false);
    expect(hasScope({ token: 't', org: 'public', scopes: ['mcp:pii'] }, 'mcp:pii')).toBe(true);
  });
});

describe('authMaterialFromHeaders', () => {
  it('prefers API key header and detects dt_ bearer keys', () => {
    expect(
      authMaterialFromHeaders({
        authorization: 'Bearer dt_test_secret',
        'x-deeptrue-org': 'acme',
      }),
    ).toEqual({
      apiKey: 'dt_test_secret',
      bearerToken: undefined,
      org: 'acme',
    });
  });

  it('does not attach the process API key when the request presented an OAuth bearer', () => {
    expect(
      authMaterialFromHeaders(
        { authorization: 'Bearer oauth-user' },
        { apiKey: 'dt_server_admin', org: 'public' },
      ),
    ).toEqual({
      apiKey: undefined,
      bearerToken: 'oauth-user',
      org: 'public',
    });
  });
});
