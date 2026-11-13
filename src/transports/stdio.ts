import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpConfig } from '../config.js';
import { createDeepTrueMcpServer } from '../server.js';

export async function startStdioServer(config: McpConfig): Promise<void> {
  const server = createDeepTrueMcpServer(config, {
    authMaterial: {
      apiKey: config.apiKey,
      org: config.org,
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
