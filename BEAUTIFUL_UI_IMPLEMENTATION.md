# Beautiful UI Implementation Plan

## Overview
Implementing 9 Beautiful UI components for the Legally Unbullied legal-advisor agent, adapted from beautifului.dev for vanilla JavaScript.

## Current Stack
- **Plain JavaScript** (vanilla JS, no framework)
- **Express** server
- **Firebase** for auth/database
- **Design System**: Black/white/gold (#f2b705 accent)
- **Font Awesome** icons

## Component Mapping

### 1. Loading State (Drive Variant)
**Purpose**: Initial "agent is working" state before tokens arrive
**Location**: Shown when user submits question, before classification starts
**Features**:
- Pixel-grid loader with shimmer animation
- Elapsed timer (e.g., "Churning 2m 3.0s")
- Drive variant (circular progress indicator)

**Implementation**:
- Class: `BeUILoadingState`
- Methods: `start()`, `stop()`, `updateTimer(seconds)`
- CSS: Grid of pixels with staggered shimmer animation

### 2. Thinking Component (Tabbed)
**Purpose**: Expandable reasoning/planning traces
**Location**: Replaces current `.trace` component
**Features**:
- Tabbed interface: Steps | Reasoning | Search | Coding
- Expandable/collapsible
- Shows classification, planning, search results

**Implementation**:
- Class: `BeUIThinking`
- Tabs: `{ steps: [], reasoning: [], search: [], coding: [] }`
- Methods: `addStep()`, `addReasoning()`, `addSearch()`, `toggle()`
- Integration: Replace current trace rendering in `runPipeline()`

### 3. Streaming Text
**Purpose**: Stream the legal answer with inline sources
**Location**: Main answer content area
**Features**:
- Character-by-character streaming
- Inline source chips (clickable citations)
- "N sources" pill at the end
- Follow-up suggestions below

**Implementation**:
- Class: `BeUIStreamingText`
- Methods: `stream(text)`, `addCitation()`, `complete()`
- Integration: Replace `streamText()` in `streamAnswerSequence()`

### 4. Approval Card
**Purpose**: Human-in-the-loop clarifying questions
**Location**: Shown when agent needs user input before proceeding
**Features**:
- Question text
- Selectable option buttons
- Submit action

**Implementation**:
- Class: `BeUIApprovalCard`
- Methods: `show(question, options)`, `onSelect(callback)`
- Integration: New server response type `needsApproval`

### 5. Tool Chips
**Purpose**: Show tool calls as compact collapsible chips
**Location**: Inside Thinking component or as separate row
**Features**:
- Chip per tool call (search, draft, check)
- Collapsible details
- Status indicator (running/complete/failed)

**Implementation**:
- Class: `BeUIToolChips`
- Methods: `addChip(tool, status)`, `updateChip(id, status)`
- Integration: Track tool calls in pipeline

### 6. Task Rows
**Purpose**: Multi-step workflow status
**Location**: For complex legal workflows
**Features**:
- Row per task (review contract → flag clauses → draft summary)
- Status: running | completed | failed
- Live updates

**Implementation**:
- Class: `BeUITaskRows`
- Methods: `addTask(name)`, `updateTask(id, status)`
- Integration: Future enhancement for complex workflows

### 7. Context Cards
**Purpose**: Retrieved knowledge chunks with sources
**Location**: Replaces current `.context-card`
**Features**:
- Source-attributed chunks
- File/type badges (PDF, CSV, Statute)
- Expandable excerpts

**Implementation**:
- Class: `BeUIContextCards`
- Methods: `addCard(source, excerpt, type)`
- Integration: Replace `buildContextCard()` in `buildAnswerBlock()`

### 8. Prompt Bar
**Purpose**: Enhanced composer with @-mentions and /-commands
**Location**: Replaces current composer
**Features**:
- @-mention sources/documents
- /-commands (/help, /clear)
- Model picker dropdown
- Dictation button (future)

**Implementation**:
- Class: `BeUIPromptBar`
- Methods: `addMention()`, `addCommand()`, `onSubmit()`
- Integration: Replace current `#composer-form`

### 9. Recommendation Card
**Purpose**: Concrete next actions with confidence meter
**Location**: Replaces current verdict section
**Features**:
- Action recommendation
- Confidence meter (0-100%)
- Accept/Alternatives buttons

**Implementation**:
- Class: `BeUIRecommendation`
- Methods: `show(action, confidence, alternatives)`
- Integration: Replace `buildVerdictEl()` in `buildAnswerBlock()`

## Implementation Order

1. **Phase 1: Core Pipeline** (Loading → Thinking → Streaming)
   - Loading State
   - Thinking (tabbed)
   - Streaming Text
   - Context Cards

2. **Phase 2: Interaction** (Approval → Recommendation)
   - Approval Card
   - Recommendation Card

3. **Phase 3: Advanced** (Tools → Tasks → Prompt)
   - Tool Chips
   - Task Rows
   - Prompt Bar

## Design Principles

1. **Keep our branding**: Black/white/gold color scheme
2. **Adopt their patterns**: Spacing, animations, interactions
3. **Vanilla JS**: No React/Vue dependencies
4. **Progressive enhancement**: Components work without JS animations
5. **Accessible**: ARIA labels, keyboard navigation, reduced motion

## File Structure

```
public/
├── styles/
│   └── beui-components.css      # All component styles
├── components/
│   ├── BeUILoadingState.js
│   ├── BeUIThinking.js
│   ├── BeUIStreamingText.js
│   ├── BeUIApprovalCard.js
│   ├── BeUIToolChips.js
│   ├── BeUITaskRows.js
│   ├── BeUIContextCards.js
│   ├── BeUIPromptBar.js
│   └── BeUIRecommendation.js
└── app.js                        # Updated with component integration
```

## Integration Points

### Server Response Changes
```javascript
// Current
{
  classification: {...},
  plan: {...},
  result: {
    lawMd: "...",
    actionsMd: "...",
    sources: [...],
    escalate: true,
    followUps: [...]
  }
}

// Enhanced
{
  classification: {...},
  thinking: {
    steps: [...],
    reasoning: [...],
    search: [...],
    coding: [...]
  },
  plan: {...},
  result: {
    lawMd: "...",
    actionsMd: "...",
    citations: [...],  // Inline citations
    sources: [...],
    recommendation: {
      action: "...",
      confidence: 85,
      alternatives: [...]
    },
    followUps: [...]
  },
  needsApproval: {  // Optional
    question: "...",
    options: [...]
  }
}
```

## Testing Checklist

- [ ] Loading state shows before classification
- [ ] Thinking tabs show classification, planning, search
- [ ] Streaming text animates smoothly
- [ ] Context cards show with proper badges
- [ ] Recommendation card shows confidence meter
- [ ] Approval card pauses pipeline for user input
- [ ] Tool chips show for multi-step operations
- [ ] Task rows show for complex workflows
- [ ] Prompt bar accepts @-mentions and /-commands
- [ ] All components respect reduced motion preference
- [ ] Keyboard navigation works throughout
- [ ] Mobile responsive on all components

## Timeline

- **Phase 1**: 2-3 days (core pipeline)
- **Phase 2**: 1-2 days (interaction components)
- **Phase 3**: 2-3 days (advanced features)
- **Total**: 5-8 days

## Notes

- Keep existing CSS variables for consistency
- Use existing Font Awesome icons where possible
- Maintain current design tokens (spacing, typography)
- Components should be self-contained and reusable
- Document each component with usage examples
