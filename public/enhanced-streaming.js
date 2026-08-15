/**
 * Enhanced Streaming with BeUIStreamingText Integration
 * 
 * This module provides a wrapper around the streaming logic that uses
 * BeUIStreamingText for better UX with rolling blur effects.
 */

/**
 * Stream answer using BeUIStreamingText component
 * 
 * @param {HTMLElement} container - Container element for streaming text
 * @param {Object} result - Result object from API (lawMd, actionsMd, sources, followUps)
 * @param {Object} options - Streaming options
 * @param {Function} options.onDone - Callback when streaming completes
 * @param {number} options.token - Pipeline token for cancellation
 */
export function streamWithBeUI(container, result, options = {}) {
  const { onDone, token } = options;
  
  // Check if BeUIStreamingText is available
  if (!window.BeUIStreamingText) {
    console.warn('BeUIStreamingText not available, falling back to basic streaming');
    return null;
  }
  
  // Create BeUIStreamingText instance
  const streamingComponent = new window.BeUIStreamingText(container, {
    text: result.lawMd,
    sources: result.sources || [],
    followUps: result.followUps || []
  });
  
  // Set up completion handler
  const originalOnDone = streamingComponent.onDone;
  streamingComponent.onDone = () => {
    if (originalOnDone) originalOnDone();
    if (onDone) onDone();
  };
  
  return streamingComponent;
}

/**
 * Enhanced streamAnswerSequence that uses BeUIStreamingText
 * 
 * @param {Object} agentMsg - Agent message object
 * @param {Object} answerBlock - Answer block with refs
 * @param {number} token - Pipeline token
 */
export function enhancedStreamAnswerSequence(agentMsg, answerBlock, token) {
  const r = agentMsg.result;
  const refs = answerBlock._refs;
  
  // Check if we should use BeUIStreamingText
  const useBeUIStreaming = window.BeUIStreamingText && refs.lawSection.textEl;
  
  if (useBeUIStreaming) {
    // Use BeUIStreamingText for law section
    refs.lawSection.el.classList.add("is-live");
    refs.lawSection.liveDot.style.display = "inline-block";
    
    const streamingComponent = streamWithBeUI(
      refs.lawSection.textEl,
      {
        lawMd: r.lawMd,
        sources: r.sources,
        followUps: r.followUps
      },
      {
        token,
        onDone: () => {
          if (token !== window.pipelineToken) return;
          
          const stickAfterLaw = window.isNearBottom();
          refs.lawSection.el.classList.remove("is-live");
          refs.lawSection.liveDot.style.display = "none";
          
          // Append context cards manually (BeUIStreamingText handles sources dropdown)
          if (r.sources && r.sources.length > 0) {
            window.appendContextCards(refs.lawSection.el, r.sources);
          }
          
          window.scrollChatToBottom(stickAfterLaw);
          
          // Continue with actions section using basic streaming
          setTimeout(() => {
            if (token !== window.pipelineToken) return;
            streamActionsSection(agentMsg, answerBlock, token);
          }, 300);
        }
      }
    );
    
    // Store component reference for cleanup
    agentMsg._streamingComponent = streamingComponent;
  } else {
    // Fall back to basic streaming
    window.streamText(refs.lawSection.textEl, r.lawMd, {
      token,
      onDone: () => {
        if (token !== window.pipelineToken) return;
        streamActionsSection(agentMsg, answerBlock, token);
      }
    });
  }
}

/**
 * Stream actions section (after law section completes)
 */
function streamActionsSection(agentMsg, answerBlock, token) {
  const r = agentMsg.result;
  const refs = answerBlock._refs;
  
  const stickBeforeActions = window.isNearBottom();
  refs.actionsSection.el.style.display = "";
  refs.actionsSection.el.classList.add("is-live");
  refs.actionsSection.liveDot.style.display = "inline-block";
  window.scrollChatToBottom(stickBeforeActions);
  
  window.streamText(refs.actionsSection.textEl, r.actionsMd, {
    token,
    onDone: () => {
      if (token !== window.pipelineToken) return;
      const stickAfterActions = window.isNearBottom();
      refs.actionsSection.el.classList.remove("is-live");
      refs.actionsSection.liveDot.style.display = "none";
      window.scrollChatToBottom(stickAfterActions);
      
      setTimeout(() => {
        if (token !== window.pipelineToken) return;
        showVerdictAndFollowUps(agentMsg, answerBlock, token);
      }, 250);
    }
  });
}

/**
 * Show verdict and follow-ups (after actions section completes)
 */
function showVerdictAndFollowUps(agentMsg, answerBlock, token) {
  const refs = answerBlock._refs;
  
  const stickBeforeVerdict = window.isNearBottom();
  refs.verdict.style.display = "";
  window.scrollChatToBottom(stickBeforeVerdict);
  
  setTimeout(() => {
    if (token !== window.pipelineToken) return;
    const stickBeforeFollowUps = window.isNearBottom();
    refs.followUps.style.display = "";
    window.scrollChatToBottom(stickBeforeFollowUps);
    
    setTimeout(() => {
      if (token !== window.pipelineToken) return;
      const stickBeforeMeta = window.isNearBottom();
      refs.meta.style.display = "";
      window.scrollChatToBottom(stickBeforeMeta);
      window.finalizeAnswer(agentMsg, token);
    }, 200);
  }, 200);
}
