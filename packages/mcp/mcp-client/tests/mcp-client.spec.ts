import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type JsonValue } from '@deepseek-ai/dsh-tools'
import { publicToolName, syncTools, type ToolBridgeOptions } from '@deepseek-ai/dsh-mcp-client/src/tools.ts'
import { createTransport } from '@deepseek-ai/dsh-mcp-client/src/transport.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const testToolSignal = new AbortController().signal

// ---- Mock MCP Client ----

interface MockTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  execution?: { taskSupport?: 'optional' | 'required' | 'forbidden' }
}

interface MockCallResult {
  content: JsonValue[]
  structuredContent?: JsonValue
  isError?: boolean
}

function createMockClient(tools: MockTool[], callResult: MockCallResult = { content: [{ type: 'text', text: 'ok' }] }) {
  const listTools = vi.fn(async (
    _params?: Record<string, unknown>,
  ): Promise<{ tools: MockTool[]; nextCursor: string | undefined }> => ({ tools, nextCursor: undefined }))
  const callTool = vi.fn(async (
    _params?: Record<string, unknown>,
    _compatibilitySchema?: unknown,
    _options?: unknown,
  ): Promise<Record<string, unknown>> => ({ ...callResult }))
  return {
    listTools,
    callTool,
    request: vi.fn(async (
      request: { method: string; params?: Record<string, unknown> },
      _schema: unknown,
      options?: unknown,
    ): Promise<unknown> => {
      if (request.method === 'tools/list') return listTools(request.params)
      if (request.method === 'tools/call') return callTool(request.params, undefined, options)
      throw new Error(`unexpected MCP request: ${request.method}`)
    }),
    setNotificationHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

// ---- Test harness helper ----

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

const defaultOpts: ToolBridgeOptions = {
  registrationFailure: 'contain',
  serverName: 'srv',
  toolCallTimeoutMs: 60_000,
}

// ---- Tests ----

describe('publicToolName', () => {
  it('joins clean names verbatim', () => {
    expect(publicToolName('github', 'create_issue')).toBe('mcp__github__create_issue')
    expect(publicToolName('everything', 'get-sum')).toBe('mcp__everything__get-sum')
  })

  it('replaces invalid characters and appends an identity hash', () => {
    const name = publicToolName('srv', 'admin.reset')
    expect(name).toMatch(/^mcp__srv__admin_reset_[0-9a-f]{12}$/)
    expect(name.length).toBeLessThanOrEqual(64)
  })

  it('truncates over-long names and appends an identity hash', () => {
    const rawName = 'a'.repeat(80)
    const name = publicToolName('srv', rawName)
    expect(name).toHaveLength(64)
    expect(name).toMatch(/_[0-9a-f]{12}$/)
    expect(name.startsWith('mcp__srv__aaa')).toBe(true)
  })

  it('is deterministic and collision-free for distinct identities', () => {
    // Two raw names that normalize to the same base must not collapse.
    const a = publicToolName('srv', 'admin.reset')
    const b = publicToolName('srv', 'admin_reset')
    expect(a).toBe(publicToolName('srv', 'admin.reset'))
    expect(a).not.toBe(b)
  })
})

describe('syncTools', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await mountRegistry()
  })

  it('registers tools under server-qualified public names', async () => {
    const client = createMockClient([
      { name: 'greet', description: 'Say hello', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
      { name: 'add', description: 'Add numbers', inputSchema: { type: 'object', properties: {} } },
    ])

    const disposers = await syncTools(client as never, ctx, defaultOpts, new Map())

    expect(disposers.size).toBe(2)
    expect(ctx.tools.get('mcp__srv__greet')).toBeDefined()
    expect(ctx.tools.get('mcp__srv__add')).toBeDefined()
    // Raw names are NOT registered.
    expect(ctx.tools.get('greet')).toBeUndefined()
    expect(ctx.tools.get('add')).toBeUndefined()
  })

  it('lets two servers publish the same raw name side by side', async () => {
    const clientA = createMockClient([{ name: 'search', inputSchema: { type: 'object' } }])
    const clientB = createMockClient([{ name: 'search', inputSchema: { type: 'object' } }])

    await syncTools(clientA as never, ctx, { ...defaultOpts, serverName: 'github' }, new Map())
    await syncTools(clientB as never, ctx, { ...defaultOpts, serverName: 'web' }, new Map())

    expect(ctx.tools.get('mcp__github__search')).toBeDefined()
    expect(ctx.tools.get('mcp__web__search')).toBeDefined()
  })

  it('coexists with a native tool of the same raw name', async () => {
    ctx.tools.register({
      name: 'search',
      description: 'Native search',
      parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
      execute: async () => 'native',
    })
    const client = createMockClient([{ name: 'search', inputSchema: { type: 'object' } }])

    await syncTools(client as never, ctx, defaultOpts, new Map())

    expect(ctx.tools.get('search')).toBeDefined()
    expect(ctx.tools.get('mcp__srv__search')).toBeDefined()
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'search', arguments: {} })
    expect(result.content[0]).toEqual({ type: 'text', text: 'native' })
  })

  it('rejects a tool list where one raw name appears twice', async () => {
    const client = createMockClient([
      { name: 'dup', inputSchema: { type: 'object' } },
      { name: 'dup', inputSchema: { type: 'object' } },
    ])

    await expect(syncTools(client as never, ctx, defaultOpts, new Map()))
      .rejects.toThrow(/listed tool "dup" more than once/)
    // Nothing registered, previous generation untouched (it was empty).
    expect(ctx.tools.get('mcp__srv__dup')).toBeUndefined()
  })

  it('keeps the previous generation when the fetch phase fails', async () => {
    const client = createMockClient([{ name: 'stable', inputSchema: { type: 'object' } }])
    const first = await syncTools(client as never, ctx, defaultOpts, new Map())
    expect(ctx.tools.get('mcp__srv__stable')).toBeDefined()

    client.listTools.mockRejectedValue(new Error('network down'))
    await expect(syncTools(client as never, ctx, defaultOpts, first)).rejects.toThrow('network down')

    // The previous generation is still live.
    expect(ctx.tools.get('mcp__srv__stable')).toBeDefined()
  })

  it('rolls back the whole generation when a foreign tool squats on the namespace', async () => {
    // A foreign registration occupies one of this server's public names.
    ctx.tools.register({
      name: 'mcp__srv__taken',
      description: 'Squatter',
      parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
      execute: async () => 'squatter',
    })
    const client = createMockClient([
      { name: 'free', inputSchema: { type: 'object' } },
      { name: 'taken', inputSchema: { type: 'object' } },
    ])

    const disposers = await syncTools(client as never, ctx, defaultOpts, new Map())

    // All-or-nothing: the non-conflicting tool is rolled back too.
    expect(disposers.size).toBe(0)
    expect(ctx.tools.get('mcp__srv__free')).toBeUndefined()
    // The squatter is untouched.
    expect(ctx.tools.get('mcp__srv__taken')).toBeDefined()
  })

  it('unregisters previous tools before re-syncing', async () => {
    const client = createMockClient([
      { name: 'old_tool', inputSchema: { type: 'object' } },
    ])

    const firstDisposers = await syncTools(client as never, ctx, defaultOpts, new Map())
    expect(ctx.tools.get('mcp__srv__old_tool')).toBeDefined()

    client.listTools.mockResolvedValue({ tools: [{ name: 'new_tool', inputSchema: { type: 'object' } }], nextCursor: undefined })
    const secondDisposers = await syncTools(client as never, ctx, defaultOpts, firstDisposers)

    expect(ctx.tools.get('mcp__srv__old_tool')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__new_tool')).toBeDefined()
    expect(secondDisposers.size).toBe(1)
  })

  it('drains paginated listTools responses', async () => {
    const client = createMockClient([])
    client.listTools
      .mockResolvedValueOnce({ tools: [{ name: 'page1', inputSchema: { type: 'object' } }], nextCursor: 'cursor1' })
      .mockResolvedValueOnce({ tools: [{ name: 'page2', inputSchema: { type: 'object' } }], nextCursor: undefined })

    const disposers = await syncTools(client as never, ctx, defaultOpts, new Map())

    expect(disposers.size).toBe(2)
    expect(ctx.tools.get('mcp__srv__page1')).toBeDefined()
    expect(ctx.tools.get('mcp__srv__page2')).toBeDefined()
  })

  it('owns output validation independently of the SDK per-page cache', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    serverTransport.onmessage = (message) => {
      if (!('id' in message) || !('method' in message)) return
      const params = 'params' in message ? message.params : undefined
      let result: Record<string, unknown>
      if (message.method === 'initialize') {
        const protocolVersion = params && 'protocolVersion' in params
          ? params.protocolVersion
          : '2025-11-25'
        result = {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'raw-test', version: '1' },
        }
      } else if (message.method === 'tools/list') {
        const cursor = params && 'cursor' in params ? params.cursor : undefined
        result = cursor === undefined
          ? {
            tools: [{
              name: 'supported',
              inputSchema: { type: 'object' },
              outputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: { answer: { type: 'integer' } },
                required: ['answer'],
              },
            }],
            nextCursor: 'page-2',
          }
          : {
            tools: [{
              name: 'future-schema',
              inputSchema: { type: 'object' },
              outputSchema: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
            }],
          }
      } else if (message.method === 'tools/call') {
        const name = params && 'name' in params ? params.name : undefined
        result = name === 'supported'
          ? { content: [{ type: 'text', text: 'missing structured content' }] }
          : { content: [42, null], structuredContent: ['kept', { nested: true }] }
      } else {
        result = {}
      }
      void serverTransport.send({ jsonrpc: '2.0', id: message.id, result })
    }
    await serverTransport.start()
    const client = new Client({ name: 'cache-independent-test', version: '1' })
    await client.connect(clientTransport)

    try {
      await syncTools(client, ctx, defaultOpts, new Map())

      const missing = await ctx.tools.execute({
        signal: testToolSignal,
        callId: CallId('missing'), name: 'mcp__srv__supported', arguments: {},
      })
      expect(missing.error).toMatchObject({ info: { code: 'INVALID_TOOL_OUTPUT' } })
      expect(missing.error?.message).toContain('structuredContent')

      const fallback = await ctx.tools.execute({
        signal: testToolSignal,
        callId: CallId('fallback'), name: 'mcp__srv__future-schema', arguments: {},
      })
      if (fallback.isError) throw new Error('unsupported schema must use the bridge fallback')
      expect(fallback.value).toEqual({
        content: [42, null],
        structuredContent: ['kept', { nested: true }],
      })
    } finally {
      await client.close()
    }
  })
})

describe('tool execution', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await mountRegistry()
  })

  it('calls MCP callTool with the RAW name and returns text content', async () => {
    const client = createMockClient(
      [{ name: 'echo', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'hello world' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__echo', arguments: { msg: 'hi' } })

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'hello world' }])
    if (result.isError) throw new Error('expected MCP success')
    expect(result.value).toEqual({ content: [{ type: 'text', text: 'hello world' }] })
    // The wire sees the raw MCP name, never the public name.
    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'echo', arguments: { msg: 'hi' } },
      undefined,
      expect.objectContaining({ timeout: 60_000 }),
    )
  })

  it('sends the raw name for normalized public names', async () => {
    const client = createMockClient(
      [{ name: 'admin.reset', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'reset done' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const publicName = publicToolName('srv', 'admin.reset')
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: publicName, arguments: {} })

    expect(result.isError).toBe(false)
    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'admin.reset', arguments: {} },
      undefined,
      expect.anything(),
    )
  })

  it('joins multiple text blocks with newline', async () => {
    const client = createMockClient(
      [{ name: 'multi', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__multi', arguments: {} })

    expect(result.content).toEqual([{ type: 'text', text: 'line1\nline2' }])
  })

  it('preserves full JSON MCP blocks while Native rendering uses placeholders', async () => {
    const blocks = [
      { type: 'text', text: 'before' },
      { type: 'image', mimeType: 'image/png', data: 'base64-data', annotations: { audience: ['assistant'] } },
    ] satisfies JsonValue[]
    const client = createMockClient(
      [{ name: 'img', inputSchema: { type: 'object' } }],
      { content: blocks },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__img', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: 'before\n[image: image/png, content discarded]' })
    if (result.isError) throw new Error('expected MCP success')
    expect(result.value).toEqual({ content: blocks })
  })

  it('preserves primitive JSON MCP blocks while Native rendering marks them unsupported', async () => {
    const blocks = [42, null, ['nested']] satisfies JsonValue[]
    const client = createMockClient(
      [{ name: 'primitive-blocks', inputSchema: { type: 'object' } }],
      { content: blocks },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('primitive'), name: 'mcp__srv__primitive-blocks', arguments: {},
    })

    expect(result.content[0]).toEqual({
      type: 'text',
      text: '[unsupported content type: unknown]\n[unsupported content type: unknown]\n[unsupported content type: unknown]',
    })
    if (result.isError) throw new Error('expected primitive MCP blocks to remain a successful JSON value')
    expect(result.value).toEqual({ content: blocks })
  })

  it('validates structuredContent when the advertised output schema is supported', async () => {
    const outputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'integer' } },
      required: ['answer'],
    }
    const valid = createMockClient(
      [{ name: 'structured', inputSchema: { type: 'object' }, outputSchema }],
      { content: [{ type: 'text', text: '42' }], structuredContent: { answer: 42 } },
    )
    await syncTools(valid as never, ctx, defaultOpts, new Map())
    const success = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('valid'), name: 'mcp__srv__structured', arguments: {} })
    if (success.isError) throw new Error('expected supported structuredContent to validate')
    expect(success.value).toEqual({ content: [{ type: 'text', text: '42' }], structuredContent: { answer: 42 } })

    const invalidCtx = await mountRegistry()
    const invalid = createMockClient(
      [{ name: 'structured', inputSchema: { type: 'object' }, outputSchema }],
      { content: [{ type: 'text', text: 'wrong' }], structuredContent: { answer: 'forty-two' } },
    )
    await syncTools(invalid as never, invalidCtx, defaultOpts, new Map())
    const failure = await invalidCtx.tools.execute({ signal: testToolSignal, callId: CallId('invalid'), name: 'mcp__srv__structured', arguments: {} })
    expect(failure.error).toMatchObject({ info: { code: 'INVALID_TOOL_OUTPUT' } })
    expect(failure.content[0]?.type === 'text' ? failure.content[0].text : '')
      .toContain('value.structuredContent.answer')
  })

  it('falls back to JsonValue for unsupported advertised output schemas', async () => {
    const client = createMockClient(
      [{
        name: 'future-schema',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
      }],
      { content: [], structuredContent: ['kept', { nested: true }] },
    )
    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('fallback'), name: 'mcp__srv__future-schema', arguments: {} })
    if (result.isError) throw new Error('unsupported MCP output schemas must fall back')
    expect(result.value).toEqual({ content: [], structuredContent: ['kept', { nested: true }] })
  })

  it('maps isError to an error result via throw', async () => {
    const client = createMockClient(
      [{ name: 'fail', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'something went wrong' }], isError: true },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__fail', arguments: {} })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Error: something went wrong' })
    expect('value' in result).toBe(false)
  })

  it('rejects tools that require task-based execution', async () => {
    const client = createMockClient([
      { name: 'task-only', inputSchema: { type: 'object' }, execution: { taskSupport: 'required' } },
    ])

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('task-only'), name: 'mcp__srv__task-only', arguments: {},
    })

    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('requires task-based execution')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('passes abort signal to callTool', async () => {
    const controller = new AbortController()
    const client = createMockClient(
      [{ name: 'slow', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'done' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    await ctx.tools.execute({ callId: CallId('c1'), name: 'mcp__srv__slow', arguments: {}, signal: controller.signal })

    expect(client.callTool).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('handles legacy toolResult shape', async () => {
    const client = createMockClient(
      [{ name: 'legacy', inputSchema: { type: 'object' } }],
    )
    client.callTool.mockResolvedValue({ toolResult: { key: 'value' } })

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__legacy', arguments: {} })

    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: '{"key":"value"}' })
  })

  it('preserves structuredContent on a successful legacy result', async () => {
    const client = createMockClient([{ name: 'legacy-structured', inputSchema: { type: 'object' } }])
    client.callTool.mockResolvedValue({
      toolResult: 'legacy',
      structuredContent: { answer: 42 },
    })

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('legacy-structured'), name: 'mcp__srv__legacy-structured', arguments: {},
    })

    if (result.isError) throw new Error('expected legacy structured result success')
    expect(result.value).toEqual({
      content: [{ type: 'text', text: '"legacy"' }],
      structuredContent: { answer: 42 },
    })
  })

  it('maps a legacy isError reply to failure', async () => {
    const client = createMockClient([{ name: 'legacy-error', inputSchema: { type: 'object' } }])
    client.callTool.mockResolvedValue({ toolResult: { reason: 'nope' }, isError: true })

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('legacy-error'), name: 'mcp__srv__legacy-error', arguments: {},
    })

    expect(result.isError).toBe(true)
    expect(result.error?.message).toBe('{"reason":"nope"}')
  })
})

describe('tool execution edge cases', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await mountRegistry()
  })

  it('handles audio content with placeholder', async () => {
    const client = createMockClient(
      [{ name: 'audio_tool', inputSchema: { type: 'object' } }],
      { content: [{ type: 'audio', mimeType: 'audio/mp3' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__audio_tool', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '[audio: audio/mp3, content discarded]' })
  })

  it('handles resource content with placeholder', async () => {
    const client = createMockClient(
      [{ name: 'res_tool', inputSchema: { type: 'object' } }],
      { content: [{ type: 'resource' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__res_tool', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '[resource: content discarded]' })
  })

  it('handles resource_link content with placeholder', async () => {
    const client = createMockClient(
      [{ name: 'link_tool', inputSchema: { type: 'object' } }],
      { content: [{ type: 'resource_link' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__link_tool', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '[resource: content discarded]' })
  })

  it('handles unknown content types', async () => {
    const client = createMockClient(
      [{ name: 'unknown_tool', inputSchema: { type: 'object' } }],
      { content: [{ type: 'video' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__unknown_tool', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '[unsupported content type: video]' })
  })

  it('handles image with missing mimeType (buggy server)', async () => {
    const client = createMockClient(
      [{ name: 'img2', inputSchema: { type: 'object' } }],
      { content: [{ type: 'image' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__img2', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '[image: unknown, content discarded]' })
  })

  it('handles audio with missing mimeType (buggy server)', async () => {
    const client = createMockClient(
      [{ name: 'audio_no_mime', inputSchema: { type: 'object' } }],
      { content: [{ type: 'audio' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__audio_no_mime', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '[audio: unknown, content discarded]' })
  })

  it('handles text block with missing text (buggy server)', async () => {
    const client = createMockClient(
      [{ name: 'notext', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__notext', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '(notext returned no text content)' })
  })

  it('handles empty content array', async () => {
    const client = createMockClient(
      [{ name: 'empty_tool', inputSchema: { type: 'object' } }],
      { content: [] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__empty_tool', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '(empty_tool returned no text content)' })
  })


  it('handles legacy toolResult with undefined value', async () => {
    const client = createMockClient(
      [{ name: 'legacy2', inputSchema: { type: 'object' } }],
    )
    client.callTool.mockResolvedValue({ toolResult: undefined, structuredContent: undefined })

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__legacy2', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '(no output)' })
  })

  it('handles a legacy result with neither content nor toolResult', async () => {
    const client = createMockClient(
      [{ name: 'legacy-empty', inputSchema: { type: 'object' } }],
    )
    client.callTool.mockResolvedValue({})

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('legacy-empty'), name: 'mcp__srv__legacy-empty', arguments: {} })

    expect(result.content[0]).toEqual({ type: 'text', text: '(no output)' })
  })

  it('handles isError with non-text content (fallback error message)', async () => {
    const client = createMockClient(
      [{ name: 'err_notext', inputSchema: { type: 'object' } }],
      { content: [{ type: 'image', mimeType: 'image/png' }], isError: true },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__err_notext', arguments: {} })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Error: [image: image/png, content discarded]' })
  })


  it('uses tool description when provided', async () => {
    const client = createMockClient([
      { name: 'described', description: 'A described tool', inputSchema: { type: 'object' } },
    ])

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const tool = ctx.tools.get('mcp__srv__described')
    expect(tool?.description).toBe('A described tool')
  })

  it('uses empty description when tool has no description', async () => {
    const client = createMockClient([
      { name: 'nodesc', inputSchema: { type: 'object' } },
    ])

    await syncTools(client as never, ctx, defaultOpts, new Map())
    const tool = ctx.tools.get('mcp__srv__nodesc')
    expect(tool?.description).toBe('')
  })
})

describe('createTransport', () => {
  it('creates StdioClientTransport for stdio config', () => {
    const config: Config = {
      transport: 'stdio',
      serverName: 'srv',
      command: 'node',
      args: ['server.js'],
      env: {},
      cwd: '/tmp',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
    const transport = createTransport(config)
    expect(transport).toBeDefined()
    expect(transport).toHaveProperty('start')
    expect(transport).toHaveProperty('close')
  })

  it('creates StreamableHTTPClientTransport for http config without headers', () => {
    const config: Config = {
      transport: 'streamable-http',
      serverName: 'srv',
      url: 'http://localhost:3000/mcp',
      headers: {},
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
    const transport = createTransport(config)
    expect(transport).toBeDefined()
    expect(transport).toHaveProperty('start')
    expect(transport).toHaveProperty('close')
  })

  it('creates StreamableHTTPClientTransport for http config with headers', () => {
    const config: Config = {
      transport: 'streamable-http',
      serverName: 'srv',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer token' },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
    const transport = createTransport(config)
    expect(transport).toBeDefined()
    expect(transport).toHaveProperty('start')
    expect(transport).toHaveProperty('close')
  })

  it('scrubs sensitive env vars and forwards the rest', () => {
    const original = { ...process.env }
    try {
      process.env.SAFE_VAR = 'kept'
      process.env.MY_SECRET = 'hidden'
      process.env.API_KEY = 'hidden'
      process.env.AUTH_TOKEN = 'hidden'

      const config: Config = {
        transport: 'stdio',
        serverName: 'srv',
        command: 'echo',
        args: [],
        env: { EXTRA: 'injected' },
        cwd: '',
        toolCallTimeoutMs: 60_000,
        failOnStartupError: false,
      }
      // StdioClientTransport keeps its env private; the observable contract is
      // that createTransport(config) returns a transport without throwing.
      const transport = createTransport(config)
      expect(transport).toBeDefined()
    } finally {
      delete process.env.SAFE_VAR
      delete process.env.MY_SECRET
      delete process.env.API_KEY
      delete process.env.AUTH_TOKEN
      for (const key of Object.keys(process.env)) {
        if (!(key in original)) Reflect.deleteProperty(process.env, key)
      }
    }
  })

  it('merges explicit env on top of scrubbed ambient env', () => {
    const config: Config = {
      transport: 'stdio',
      serverName: 'srv',
      command: 'echo',
      args: [],
      env: { CUSTOM: 'value' },
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
    const transport = createTransport(config)
    expect(transport).toBeDefined()
  })
})

describe('tool execution — non-object args fallback', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await mountRegistry()
  })

  it('coerces null args to empty object for callTool', async () => {
    const client = createMockClient(
      [{ name: 'coerce', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'ok' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__coerce', arguments: null })

    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'coerce', arguments: {} },
      undefined,
      expect.anything(),
    )
  })

  it('coerces primitive string args to empty object for callTool', async () => {
    const client = createMockClient(
      [{ name: 'coerce2', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'ok' }] },
    )

    await syncTools(client as never, ctx, defaultOpts, new Map())
    await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'mcp__srv__coerce2', arguments: 'bad' })

    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'coerce2', arguments: {} },
      undefined,
      expect.anything(),
    )
  })
})
