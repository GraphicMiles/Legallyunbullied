# Atomic Agent Architecture — Legally Unbullied

## Executive Summary

Transform the current waterfall pipeline into an **autonomous, event-driven agent system** with:
- **Tool Registry**: Independent, composable tools the agent can call dynamically
- **Agent Loop**: Decision-making engine that plans, executes, critiques, and iterates
- **SSE Streaming**: Real-time event flow from server to client
- **Event-Driven UI**: Components that react to agent events (not hardcoded stages)
- **Memory System**: User context, conversation history, and backward-compatible context

---

## Current State (Waterfall)

```
Server:
  classifyWithFallback → findProvisions → planResponse → draftWithFallback
  (sequential, blocking, no dynamic tool selection)

Client:
  LoadingState → ThinkingState → StreamText(law) → ContextCards → 
  StreamText(actions) → Verdict
  (hardcoded order, no event-driven rendering)

Problems:
  - Agent can't adapt based on intermediate results
  - No tool selection (always same sequence)
  - No iteration/refinement
  - ApprovalCard wired but never triggered
  - No memory/context persistence
```

---

## Target Architecture (Atomic Agent)

### 1. Tool Registry

**Concept**: Each tool is an independent, stateless function with a clear interface.

```javascript
// tools/registry.js
const TOOL_REGISTRY = {
  classify: {
    name: 'classify',
    description: 'Classify user question into practice area',
    parameters: {
      question: { type: 'string', required: true },
    },
    execute: async (params) => { /* ... */ },
  },
  
  search: {
    name: 'search',
    description: 'Search legal corpus for relevant provisions',
    parameters: {
      practiceArea: { type: 'string', required: true },
      jurisdiction: { type: 'string' },
      keywords: { type: 'array' },
    },
    execute: async (params) => { /* ... */ },
  },
  
  plan: {
    name: 'plan',
    description: 'Create response plan based on context',
    parameters: {
      question: { type: 'string' },
      classification: { type: 'object' },
      provisions: { type: 'array' },
    },
    execute: async (params) => { /* ... */ },
  },
  
  draft: {
    name: 'draft',
    description: 'Draft legal response',
    parameters: {
      question: { type: 'string' },
      plan: { type: 'object' },
      provisions: { type: 'array' },
    },
    execute: async (params) => { /* ... */ },
  },
  
  critique: {
    name: 'critique',
    description: 'Review and critique draft response',
    parameters: {
      draft: { type: 'string' },
      plan: { type: 'object' },
    },
    execute: async (params) => { /* ... */ },
  },
  
  askUser: {
    name: 'askUser',
    description: 'Request user input/clarification',
    parameters: {
      question: { type: 'string' },
      options: { type: 'array' },
    },
    execute: async (params) => { /* emits event, waits for user */ },
  },
  
  rate: {
    name: 'rate',
    description: 'Rate response options by quality',
    parameters: {
      options: { type: 'array' },
      criteria: { type: 'array' },
    },
    execute: async (params) => { /* ... */ },
  },
};
```

**Tool Interface**:
```javascript
{
  name: string,
  description: string,
  parameters: { [key]: { type, required, description } },
  execute: async (params, context) => {
    // Returns:
    return {
      success: boolean,
      result: any,
      events: Array<AgentEvent>,  // Events to emit during execution
    };
  }
}
```

---

### 2. Agent Loop

**Concept**: Autonomous decision-making engine that plans, executes, critiques, and iterates.

```javascript
// agent/loop.js
class AgentLoop {
  constructor() {
    this.tools = TOOL_REGISTRY;
    this.maxIterations = 10;
    this.memory = new AgentMemory();
  }
  
  async run(question, conversationContext) {
    // Initialize state
    const state = {
      question,
      context: conversationContext,
      memory: this.memory.load(conversationContext.userId),
      events: [],
      currentIteration: 0,
    };
    
    // Phase 1: Planning
    const plan = await this.plan(state);
    state.events.push({ type: 'plan_created', plan });
    
    // Phase 2: Execution Loop
    while (state.currentIteration < this.maxIterations) {
      state.currentIteration++;
      
      // Decide next action
      const action = await this.decideNextAction(state);
      
      if (action.type === 'complete') {
        state.events.push({ type: 'complete', result: state.result });
        break;
      }
      
      if (action.type === 'askUser') {
        state.events.push({ type: 'needs_input', ...action.payload });
        // Wait for user response (handled by SSE stream pause)
        const userResponse = await this.waitForUserInput();
        state.memory.addUserInput(userResponse);
        continue;
      }
      
      // Execute tool
      const tool = this.tools[action.tool];
      const result = await tool.execute(action.params, state);
      
      state.events.push(...result.events);
      state.memory.addToolResult(action.tool, result.result);
      
      // Critique result
      const critique = await this.critique(state, result.result);
      state.events.push({ type: 'critique', critique });
      
      // Decide: iterate or complete?
      if (critique.quality >= 0.85) {
        state.result = result.result;
        state.events.push({ type: 'complete', result: state.result });
        break;
      }
      
      // Refine and iterate
      state.events.push({ type: 'iterate', reason: critique.issues });
    }
    
    // Save memory
    this.memory.save(state.memory);
    
    return state.events;
  }
  
  async plan(state) {
    const prompt = `
      Given this legal question: ${state.question}
      And user context: ${JSON.stringify(state.context)}
      
      Create a step-by-step plan to answer this question.
      Consider:
      - What information do we need?
      - What tools should we call?
      - What's the optimal order?
      - What edge cases might arise?
    `;
    // Call LLM to generate plan
    return await this.callLLM(prompt);
  }
  
  async decideNextAction(state) {
    const prompt = `
      Current state:
      - Question: ${state.question}
      - Tools called so far: ${state.memory.getToolCalls()}
      - Results: ${state.memory.getResults()}
      - Critiques: ${state.memory.getCritiques()}
      
      Decide next action:
      - 'tool': Call a specific tool (specify which)
      - 'askUser': Request user input
      - 'complete': We have a good answer
      - 'iterate': Refine previous result
      
      Respond with JSON: { "type": "...", "tool": "...", "params": {...} }
    `;
    return await this.callLLM(prompt);
  }
  
  async critique(state, result) {
    const prompt = `
      Review this response:
      ${result}
      
      Rate quality (0-1) on:
      - Accuracy: Does it cite correct laws?
      - Completeness: Does it address all issues?
      - Clarity: Is it easy to understand?
      - Actionability: Are next steps clear?
      
      Identify issues and suggest improvements.
      
      Respond with JSON: { "quality": 0.0-1.0, "issues": [...], "suggestions": [...] }
    `;
    return await this.callLLM(prompt);
  }
}
```

---

### 3. SSE Streaming

**Concept**: Server-Sent Events for real-time event flow.

```javascript
// server/sse.js
const express = require('express');
const router = express.Router();

router.post('/api/chat/stream', async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  
  const { question, conversationId } = req.body;
  
  // Create agent loop
  const agent = new AgentLoop();
  
  // Stream events
  try {
    const events = await agent.run(question, {
      conversationId,
      userId: req.user?.id,
      history: await getConversationHistory(conversationId),
    });
    
    for (const event of events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      
      // If event requires user input, pause stream
      if (event.type === 'needs_input') {
        // Stream pauses here, waits for client to send user response
        await new Promise((resolve) => {
          // Store resolve function, call it when client sends response
          pendingInputCallbacks.set(conversationId, resolve);
        });
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// Client sends user input back
router.post('/api/chat/input', async (req, res) => {
  const { conversationId, input } = req.body;
  
  if (pendingInputCallbacks.has(conversationId)) {
    pendingInputCallbacks.get(conversationId)(input);
    pendingInputCallbacks.delete(conversationId);
  }
  
  res.json({ success: true });
});
```

**Event Schema**:
```javascript
{
  type: 'tool_start' | 'tool_complete' | 'critique' | 'iterate' | 
        'needs_input' | 'complete' | 'error',
  timestamp: number,
  tool?: string,
  params?: object,
  result?: any,
  critique?: { quality: number, issues: string[], suggestions: string[] },
  question?: string,
  options?: Array<{ label: string, value: string }>,
}
```

---

### 4. Event-Driven UI

**Concept**: Components subscribe to events, render when relevant events arrive.

```javascript
// public/agent-ui.js
class AgentUI {
  constructor() {
    this.components = new Map();
    this.eventQueue = [];
  }
  
  registerComponent(type, component) {
    this.components.set(type, component);
  }
  
  async connect(question) {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          const event = JSON.parse(data);
          this.handleEvent(event);
        }
      }
    }
  }
  
  handleEvent(event) {
    switch (event.type) {
      case 'plan_created':
        this.components.get('thinking')?.showPlan(event.plan);
        break;
      
      case 'tool_start':
        this.components.get('toolChips')?.addTool(event.tool, event.params);
        break;
      
      case 'tool_complete':
        this.components.get('toolChips')?.completeTool(event.tool, event.result);
        break;
      
      case 'stream_start':
        this.components.get('streaming')?.start(event.section, event.text);
        break;
      
      case 'stream_chunk':
        this.components.get('streaming')?.appendChunk(event.text);
        break;
      
      case 'needs_input':
        this.components.get('approval')?.show(event.question, event.options);
        break;
      
      case 'critique':
        this.components.get('thinking')?.showCritique(event.critique);
        break;
      
      case 'complete':
        this.components.get('verdict')?.show(event.result);
        break;
      
      case 'error':
        this.components.get('error')?.show(event.message);
        break;
    }
  }
}
```

**Component Event Subscriptions**:
```javascript
// Each component declares what events it handles
const componentRegistry = {
  loading: {
    handles: ['tool_start', 'tool_complete'],
    render: (event) => { /* ... */ },
  },
  
  thinking: {
    handles: ['plan_created', 'critique', 'iterate'],
    render: (event) => { /* ... */ },
  },
  
  toolChips: {
    handles: ['tool_start', 'tool_complete'],
    render: (event) => { /* ... */ },
  },
  
  streaming: {
    handles: ['stream_start', 'stream_chunk', 'stream_end'],
    render: (event) => { /* ... */ },
  },
  
  contextCards: {
    handles: ['tool_complete'],  // When search completes
    render: (event) => { /* ... */ },
  },
  
  approval: {
    handles: ['needs_input'],
    render: (event) => { /* ... */ },
  },
  
  verdict: {
    handles: ['complete'],
    render: (event) => { /* ... */ },
  },
};
```

---

### 5. Memory System

**Concept**: Persistent memory for user context, conversation history, and agent state.

```javascript
// agent/memory.js
class AgentMemory {
  constructor() {
    this.store = new Map();  // userId -> Memory
  }
  
  load(userId) {
    return this.store.get(userId) || new Memory(userId);
  }
  
  save(memory) {
    this.store.set(memory.userId, memory);
  }
}

class Memory {
  constructor(userId) {
    this.userId = userId;
    this.conversations = [];
    this.userPreferences = {};
    this.toolResults = [];
    this.critiques = [];
  }
  
  addConversation(msg) {
    this.conversations.push(msg);
  }
  
  addToolResult(tool, result) {
    this.toolResults.push({ tool, result, timestamp: Date.now() });
  }
  
  addCritique(critique) {
    this.critiques.push(critique);
  }
  
  getRecentConversations(n = 5) {
    return this.conversations.slice(-n);
  }
  
  getToolCalls() {
    return this.toolResults.map(t => t.tool);
  }
  
  getResults() {
    return this.toolResults;
  }
  
  getCritiques() {
    return this.critiques;
  }
  
  serialize() {
    return {
      userId: this.userId,
      conversations: this.conversations,
      userPreferences: this.userPreferences,
      toolResults: this.toolResults.slice(-20),  // Keep last 20
      critiques: this.critiques.slice(-10),      // Keep last 10
    };
  }
}
```

**Database Schema** (Firestore):
```javascript
// /users/{userId}/memory
{
  userId: string,
  createdAt: timestamp,
  updatedAt: timestamp,
  conversations: [{
    id: string,
    messages: [{
      role: 'user' | 'agent',
      content: string,
      timestamp: number,
      events: Array<AgentEvent>,
    }],
  }],
  preferences: {
    practiceAreas: string[],
    jurisdictions: string[],
    communicationStyle: 'formal' | 'casual',
  },
}

// /agents/{conversationId}/state
{
  conversationId: string,
  currentIteration: number,
  plan: object,
  toolCalls: [{
    tool: string,
    params: object,
    result: any,
    timestamp: number,
  }],
  critiques: [{
    quality: number,
    issues: string[],
    suggestions: string[],
    timestamp: number,
  }],
  status: 'running' | 'complete' | 'paused' | 'error',
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create `tools/` directory with registry
- [ ] Migrate existing functions to tool format
- [ ] Implement `AgentLoop` class (basic version)
- [ ] Add SSE endpoint skeleton

### Phase 2: Event System (Week 3-4)
- [ ] Implement event schema
- [ ] Create SSE streaming with backpressure
- [ ] Build client-side `AgentUI` class
- [ ] Wire components to event handlers

### Phase 3: Memory (Week 5-6)
- [ ] Design Firestore schema for memory
- [ ] Implement `AgentMemory` class
- [ ] Add conversation history loading
- [ ] Implement user preferences

### Phase 4: Intelligence (Week 7-8)
- [ ] Implement planning phase
- [ ] Add critique loop
- [ ] Implement tool selection logic
- [ ] Add iteration/refinement

### Phase 5: User Input (Week 9-10)
- [ ] Implement `askUser` tool
- [ ] Handle stream pause/resume
- [ ] Wire ApprovalCard to `needs_input` event
- [ ] Test multi-turn conversations

### Phase 6: Polish (Week 11-12)
- [ ] Add error recovery
- [ ] Implement timeouts
- [ ] Add progress indicators
- [ ] Optimize performance
- [ ] Write tests

---

## Migration Strategy

### Backward Compatibility
```javascript
// Keep old endpoint for legacy clients
router.post('/api/chat', legacyChatHandler);

// New endpoint for atomic agent
router.post('/api/chat/stream', atomicChatHandler);

// Client detects capability
const supportsStreaming = await checkSSESupport();
const endpoint = supportsStreaming ? '/api/chat/stream' : '/api/chat';
```

### Gradual Rollout
1. Deploy both endpoints simultaneously
2. Route 10% of traffic to new endpoint
3. Monitor metrics (latency, errors, user satisfaction)
4. Gradually increase to 100%
5. Remove old endpoint after 30 days

---

## Key Benefits

| Feature | Waterfall (Current) | Atomic (Target) |
|---------|---------------------|-----------------|
| **Tool Selection** | Hardcoded sequence | Dynamic, based on context |
| **Iteration** | None | Critique → Refine → Repeat |
| **User Input** | Never triggered | Agent asks when needed |
| **Memory** | None | Persistent user context |
| **Streaming** | Sequential stages | Real-time events |
| **Error Recovery** | Fails completely | Retries, adapts, degrades gracefully |
| **Customization** | Fixed pipeline | Configurable agent behavior |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Increased latency** | Parallel tool execution where possible |
| **LLM cost** | Cache common classifications, limit iterations |
| **Complexity** | Extensive logging, monitoring, circuit breakers |
| **SSE reliability** | Fallback to REST, reconnection logic |
| **Memory bloat** | TTL on old data, size limits |

---

## Next Steps

1. **Review this architecture** — Confirm it aligns with your vision
2. **Prioritize phases** — Which features are most critical?
3. **Define success metrics** — What does "working" look like?
4. **Start Phase 1** — Begin with tool registry and basic agent loop

---

## Questions to Consider

1. Should the agent be fully autonomous, or should users approve each tool call?
2. How many iterations is "too many" before we force completion?
3. What's the maximum acceptable latency for a response?
4. Should memory be per-user or per-conversation?
5. Do we need human-in-the-loop for legal accuracy, or trust the LLM?
