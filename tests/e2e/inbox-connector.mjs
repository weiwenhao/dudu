// An actual MCP server, loaded by DSH's MCP plugin. Its two tools read fixed test mail and accept a draft.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'intake', version: '1.0.0' });
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const mail = [
  { id: 'mail-1', subject: '供应商合同', body: '请核对第三条，给一份修改建议。' },
  { id: 'mail-2', subject: '下月安排', body: '请决定下月是否继续合作。' },
];
if (process.argv[2] === 'read') { console.log(JSON.stringify(mail)); process.exit(0); }
server.registerTool('list', { description: 'Read the test inbox', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(mail));
server.registerTool('draft', { description: 'Accept a draft', inputSchema: {}, annotations: { readOnlyHint: false } }, async () => text({ saved: true }));
await server.connect(new StdioServerTransport());
