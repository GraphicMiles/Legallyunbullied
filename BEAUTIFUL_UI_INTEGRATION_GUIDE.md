# Beautiful UI Integration Guide

## Overview

All 9 Beautiful UI components have been created and are ready to use. This guide shows how to integrate them into the existing Legally Unbullied agent pipeline.

## Components Created

1. ✅ **BeUILoadingState** - Drive variant loading indicator
2. ✅ **BeUIThinking** - Tabbed thinking/reasoning display
3. ✅ **BeUIStreamingText** - Streaming text with inline citations
4. ✅ **BeUIApprovalCard** - Human-in-the-loop approval requests
5. ✅ **BeUIToolChips** - Compact tool call indicators
6. ✅ **BeUITaskRows** - Multi-step task progress tracker
7. ✅ **BeUIContextCards** - Source-attributed knowledge chunks
8. ✅ **BeUIPromptBar** - Enhanced composer with @-mentions and /-commands
9. ✅ **BeUIRecommendation** - Action recommendation with confidence meter

## File Locations

- **CSS**: `public/styles/beui-components.css`
- **Components**: `public/components/BeUI*.js`
- **HTML**: Updated to load all component scripts

## Quick Start Example

```javascript
// Create a loading state
const loading = new BeUILoadingState(document.getElementById('loading-container'), {
  label: 'Analyzing your question',
  variant: 'drive'
});
loading.start();

// Create thinking display
const thinking = new BeUIThinking(document.getElementById('thinking-container'), {
  defaultOpen: true,
  defaultTab: 'steps'
});

// Add steps
thinking.addStep({
  title: 'Classifying question',
  detail: 'Identifying practice area and jurisdiction',
  status: 'is-complete'
});

thinking.addStep({
  title: 'Searching legal sources',
  detail: 'Finding relevant statutes and case law',
  status: 'is-active'
});

// Add reasoning
thinking.addReasoning('This appears to be a tenancy dispute involving eviction without proper notice...');

// Add search queries
thinking.addSearch({ query: 'Lagos State Tenancy Law 2011 eviction notice requirements' });

// Create streaming text
const streaming = new BeUIStreamingText(document.getElementById('answer-container'), {
  speed: 30,
  showCursor: true
});

streaming.setText('Under the **Lagos State Tenancy Law 2011**, a landlord must provide...');
streaming.addCitation({
  position: 50,
  label: 's.13',
  source: 'Lagos State Tenancy Law 2011'
});

streaming.startStreaming(() => {
  console.log('Streaming complete!');
  streaming.addSourcesPill([
    { label: 's.13', source: 'Lagos State Tenancy Law 2011' },
    { label: 's.20', source: 'Lagos State Tenancy Law 2011' }
  ]);
});

// Create context cards
const context = new BeUIContextCards(document.getElementById('context-container'));

context.addCard({
  type: 'STATUTE',
  title: 'Lagos State Tenancy Law 2011, s.13',
  excerpt: 'A landlord shall not evict a tenant without giving proper notice...'
});

// Create recommendation
const recommendation = new BeUIRecommendation(document.getElementById('recommendation-container'), {
  action: 'File a complaint with the Lagos State Magistrate Court',
  confidence: 85,
  reasoning: 'Based on the illegal eviction without proper notice, you have strong grounds for a court order...',
  alternatives: [
    'Contact the landlord directly with a formal notice',
    'Seek mediation through the Lagos State Citizens Mediation Centre'
  ],
  onAccept: () => console.log('User accepted recommendation')
});
```

## Integration into Existing Pipeline

### Current Pipeline Flow

```
User submits question
  ↓
Loading state (BeUILoadingState)
  ↓
Classification
  ↓
Thinking/Reasoning (BeUIThinking)
  ↓
Search legal sources
  ↓
Planning
  ↓
Drafting answer
  ↓
Streaming response (BeUIStreamingText)
  ↓
Show context cards (BeUIContextCards)
  ↓
Show recommendation (BeUIRecommendation)
```

### Modified `runPipeline()` Function

Replace the existing pipeline in `app.js` with this enhanced version:

```javascript
async function runPipeline(convo, agentMsg, token) {
  const question = lastUserText(convo);
  
  // 1. Show loading state
  const loadingContainer = document.createElement('div');
  live.refs.body.appendChild(loadingContainer);
  const loading = new BeUILoadingState(loadingContainer, {
    label: 'Churning',
    variant: 'drive'
  });
  loading.start();
  
  // 2. Classify
  setStepActive(agentMsg, 1);
  
  let response;
  try {
    response = await callChatApi(question);
  } catch (err) {
    loading.destroy();
    finishWithError(convo, agentMsg, token, err.message);
    return;
  }
  
  loading.destroy();
  
  if (token !== pipelineToken) return;
  
  // Handle casual chat
  if (response.isCasual) {
    agentMsg.casualReply = response.casualReply;
    agentMsg.status = "casual";
    renderCasualReply(agentMsg, response.casualReply);
    finalizeAnswer(agentMsg, token);
    return;
  }
  
  // 3. Show thinking component
  const thinkingContainer = document.createElement('div');
  live.refs.body.appendChild(thinkingContainer);
  const thinking = new BeUIThinking(thinkingContainer, {
    defaultOpen: true,
    defaultTab: 'steps'
  });
  
  // Add classification step
  thinking.addStep({
    title: 'Classifying question',
    detail: `${response.classification.practice_area} · ${response.classification.jurisdiction}`,
    status: 'is-complete'
  });
  
  // Add reasoning if available
  if (response.classification.reasoning_approach) {
    thinking.addReasoning(response.classification.reasoning_approach);
  }
  
  // 4. Search legal sources
  setStepActive(agentMsg, 2);
  
  thinking.addStep({
    title: 'Searching legal sources',
    detail: `Found ${response.result?.sources?.length || 0} relevant provisions`,
    status: 'is-complete'
  });
  
  // Add search queries to thinking
  if (response.result?.sources) {
    response.result.sources.forEach(source => {
      thinking.addSearch({ query: source.label });
    });
  }
  
  // 5. Planning
  setStepActive(agentMsg, 3);
  
  if (response.plan) {
    thinking.addStep({
      title: 'Planning response',
      detail: response.plan.analysis,
      status: 'is-complete'
    });
    
    thinking.switchTab('reasoning');
    thinking.addReasoning(response.plan.response_structure);
  }
  
  // 6. Drafting
  setStepActive(agentMsg, 4);
  
  thinking.addStep({
    title: 'Drafting answer',
    detail: 'Generating response with citations',
    status: 'is-complete'
  });
  
  thinking.complete();
  
  // 7. Stream the answer
  const answerContainer = document.createElement('div');
  live.refs.body.appendChild(answerContainer);
  
  const streaming = new BeUIStreamingText(answerContainer, {
    speed: 30,
    showCursor: true
  });
  
  streaming.setText(response.result.lawMd);
  
  // Add citations
  if (response.result.sources) {
    response.result.sources.forEach((source, idx) => {
      // You'll need to determine citation positions based on your response format
      streaming.addCitation({
        position: (idx + 1) * 100, // Example positioning
        label: source.label,
        source: source.label,
        onClick: () => {
          // Scroll to context card
          const card = document.getElementById(`context-${idx}`);
          if (card) card.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }
  
  await new Promise((resolve) => {
    streaming.startStreaming(resolve);
  });
  
  // 8. Show context cards
  if (response.result.sources && response.result.sources.length > 0) {
    const contextContainer = document.createElement('div');
    live.refs.body.appendChild(contextContainer);
    
    const context = new BeUIContextCards(contextContainer);
    
    response.result.sources.forEach((source, idx) => {
      context.addCard({
        type: source.type || 'SOURCE',
        title: source.label,
        excerpt: source.excerpt
      });
    });
  }
  
  // 9. Show recommendation
  if (response.result.escalate !== undefined) {
    const recommendationContainer = document.createElement('div');
    live.refs.body.appendChild(recommendationContainer);
    
    const recommendation = new BeUIRecommendation(recommendationContainer, {
      action: response.result.escalate 
        ? 'This likely needs a lawyer' 
        : 'You can likely handle this yourself',
      confidence: response.result.escalate ? 75 : 85,
      reasoning: response.result.escalateReason,
      alternatives: response.result.followUps || [],
      onAccept: () => {
        if (response.result.escalate) {
          window.open(NBA_DIRECTORY_URL, '_blank');
        }
      }
    });
  }
  
  // Finalize
  agentMsg.status = "done";
  agentMsg.result = response.result;
  finalizeAnswer(agentMsg, token);
}
```

## Server-Side Changes

Update your server response format to include the new fields:

```javascript
// In server/chatRoute.js
{
  classification: {
    practice_area: 'tenancy',
    jurisdiction: 'Lagos State',
    urgency: 'High',
    reasoning_approach: 'Analyze notice requirements under Lagos State Tenancy Law...'
  },
  plan: {
    analysis: 'This is an illegal eviction case',
    response_structure: '1. Explain legal requirements, 2. Analyze the violation, 3. Provide remedies',
    key_provisions: ['s.13', 's.20']
  },
  result: {
    lawMd: 'Under the **Lagos State Tenancy Law 2011**...',
    actionsMd: '- File a complaint\n- Gather evidence',
    sources: [
      {
        type: 'STATUTE',
        label: 'Lagos State Tenancy Law 2011, s.13',
        excerpt: 'A landlord shall not evict a tenant without...'
      }
    ],
    escalate: true,
    escalateReason: 'Illegal eviction requires court intervention',
    followUps: [
      'What evidence do I need?',
      'How long does the court process take?'
    ]
  }
}
```

## Testing the Components

Create a test page to verify all components work:

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="styles/beui-components.css">
</head>
<body>
  <div id="test-container"></div>
  
  <script src="components/BeUILoadingState.js"></script>
  <script src="components/BeUIThinking.js"></script>
  <!-- ... other components ... -->
  
  <script>
    // Test each component
    const container = document.getElementById('test-container');
    
    const loading = new BeUILoadingState(container, { label: 'Testing' });
    loading.start();
    
    setTimeout(() => {
      loading.destroy();
      
      const thinking = new BeUIThinking(container);
      thinking.addStep({ title: 'Step 1', status: 'is-complete' });
      thinking.addStep({ title: 'Step 2', status: 'is-active' });
      
      const streaming = new BeUIStreamingText(container);
      streaming.setText('This is a test response with a citation');
      streaming.addCitation({ position: 30, label: 's.1' });
      streaming.startStreaming();
    }, 2000);
  </script>
</body>
</html>
```

## Component API Reference

### BeUILoadingState

```javascript
new BeUILoadingState(container, {
  label: 'Churning',           // Loading label
  showTimer: true,             // Show elapsed time
  variant: 'drive'             // 'drive' or 'pixels'
});

loading.start();               // Start timer
loading.stop();                // Stop timer
loading.updateTimer(5.2);      // Update timer manually
loading.destroy();             // Remove from DOM
```

### BeUIThinking

```javascript
new BeUIThinking(container, {
  defaultOpen: true,           // Start expanded
  defaultTab: 'steps'          // 'steps', 'reasoning', 'search', 'coding'
});

thinking.addStep({ title, detail, status });
thinking.addReasoning(text);
thinking.addSearch({ query });
thinking.addCoding({ code });
thinking.switchTab('reasoning');
thinking.toggle();
thinking.complete();
thinking.destroy();
```

### BeUIStreamingText

```javascript
new BeUIStreamingText(container, {
  speed: 30,                   // Characters per second
  showCursor: true             // Show blinking cursor
});

streaming.setText(text);
streaming.addCitation({ position, label, source, onClick });
streaming.startStreaming(onComplete);
streaming.stopStreaming();
streaming.addSourcesPill(sources);
streaming.destroy();
```

### BeUIApprovalCard

```javascript
new BeUIApprovalCard(container, {
  question: 'Which jurisdiction?',
  options: ['Lagos State', 'Federal'],
  onApprove: (value) => {},
  onReject: () => {}
});

approval.destroy();
```

### BeUIToolChips

```javascript
new BeUIToolChips(container);

const id = tools.addTool({ name: 'Search', status: 'is-running' });
tools.updateTool(id, { status: 'is-complete' });
tools.clear();
tools.destroy();
```

### BeUITaskRows

```javascript
new BeUITaskRows(container);

const id = tasks.addTask({ 
  name: 'Review contract',
  detail: 'Analyzing 50 clauses',
  status: 'is-running'
});
tasks.updateTask(id, { status: 'is-complete' });
tasks.setTasks([...]);
tasks.clear();
tasks.destroy();
```

### BeUIContextCards

```javascript
new BeUIContextCards(container, {
  maxVisible: 3
});

context.addCard({
  type: 'STATUTE',
  title: 'Lagos State Tenancy Law 2011, s.13',
  excerpt: 'A landlord shall not evict...'
});
context.setCards([...]);
context.clear();
context.destroy();
```

### BeUIPromptBar

```javascript
new BeUIPromptBar(container, {
  placeholder: 'Ask a question...',
  mentions: ['Lagos State Tenancy Law', 'Labour Act'],
  commands: [
    { name: 'help', description: 'Show help' },
    { name: 'clear', description: 'Clear conversation' }
  ],
  onSubmit: (text) => {},
  onCommand: (command) => {}
});

promptBar.setValue('text');
promptBar.getValue();
promptBar.clear();
promptBar.setDisabled(true);
promptBar.setSubmitting(true);
promptBar.destroy();
```

### BeUIRecommendation

```javascript
new BeUIRecommendation(container, {
  action: 'File a complaint',
  confidence: 85,
  reasoning: 'Based on the evidence...',
  alternatives: ['Option A', 'Option B'],
  onAccept: () => {},
  onAlternative: (alt) => {}
});

recommendation.update({ action, confidence, ... });
recommendation.destroy();
```

## Next Steps

1. **Test each component** individually using the test page
2. **Update server response format** to include new fields
3. **Integrate into pipeline** using the modified `runPipeline()` function
4. **Test end-to-end** with real legal questions
5. **Gather user feedback** and iterate on the UI

## Support

- Component styles: `public/styles/beui-components.css`
- Component scripts: `public/components/BeUI*.js`
- Integration example: See modified `runPipeline()` above
- API reference: See component API reference above

## Notes

- All components are vanilla JavaScript (no framework dependencies)
- Components use CSS custom properties for theming
- All animations respect `prefers-reduced-motion`
- Components are mobile-responsive
- All components include proper cleanup with `destroy()` method
