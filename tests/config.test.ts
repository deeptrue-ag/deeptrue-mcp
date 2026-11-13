import { loadConfig } from '../src/config.js';
import { hasScope, authMaterialFromHeaders } from '../src/auth.js';

describe('loadConfig', () => {
  it('normalizes API bases to /v1/', () => {
    const config = loadConfig({
      DEEPTRUE_API_BASE: 'http://localhost:8001',
      DEEPTRUE_SURVEY_ENGINE_BASE: 'http://localhost:8050/v1',
      MCP_PUBLIC_URL: 'http://localhost:3100/',
    });
    expect(config.apiBase).toBe('http://localhost:8001/v1/');
    expect(config.surveyEngineBase).toBe('http://localhost:8050/v1/');
    expect(config.publicUrl).toBe('http://localhost:3100');
    expect(config.resourceUrl).toBe('http://localhost:3100/mcp');
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
