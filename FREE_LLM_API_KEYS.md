# Free LLM API Keys Guide

This guide shows you how to get **FREE** LLM API keys with **NO credit card required** for the Legally Unbullied project.

## Quick Start (Recommended)

Get **Groq** first (already working for casual chat), then add **OpenRouter** as fallback:

1. **Groq** (Primary - Fast inference)
   - Sign up: https://console.groq.com/keys
   - Get key instantly, no credit card
   - 14 free models (Llama 3.1, Mixtral, etc.)
   - Rate limit: ~6,000 tokens/min

2. **OpenRouter** (Fallback - 35+ free models)
   - Sign up: https://openrouter.ai/keys
   - Sign in with Google/GitHub
   - One key for 35+ free models
   - Rate limit: 200 RPD (requests per day)

## All Free Providers (No Credit Card)

### 1. Groq ⭐ (Recommended - Primary)
**Best for**: Fast inference, casual chat, classification

**Sign up**: https://console.groq.com/keys

**Rate limit**: ~6,000 tokens/min

**Models**:
- `llama-3.1-8b-instant` (classification, chat)
- `llama-3.3-70b-versatile` (drafting)
- `mixtral-8x7b-32768` (fallback)

**How to get key**:
1. Go to https://console.groq.com/keys
2. Sign up with Google/GitHub
3. Click "Create API Key"
4. Copy the key (starts with `gsk_...`)
5. Add to `.env`: `GROQ_API_KEY=gsk_...`

---

### 2. OpenRouter ⭐ (Recommended - Fallback)
**Best for**: Wide model selection, OpenAI-compatible

**Sign up**: https://openrouter.ai/keys

**Rate limit**: 200 RPD (free tier)

**Models** (free, no credit card):
- `meta-llama/llama-3.1-8b-instruct:free`
- `meta-llama/llama-3.1-70b-instruct:free`
- `mistralai/mistral-7b-instruct:free`
- `google/gemma-2-9b-it:free`
- And 30+ more!

**How to get key**:
1. Go to https://openrouter.ai/keys
2. Sign in with Google or GitHub
3. Click "Create Key"
4. Copy the key (starts with `sk-or-...`)
5. Add to `.env`: `OPENROUTER_API_KEY=sk-or-...`

---

### 3. Cerebras ⭐ (Recommended - Ultra-Fast)
**Best for**: Ultra-fast inference, high rate limits

**Sign up**: https://cloud.cerebras.ai/

**Rate limit**: 1M tokens/day, 14,400 RPD

**Models**:
- `llama3.1-8b` (classification, chat)
- `llama3.1-70b` (drafting)

**How to get key**:
1. Go to https://cloud.cerebras.ai/
2. Sign up with email
3. Verify email
4. Go to API Keys section
5. Create new key
6. Add to `.env`: `CEREBRAS_API_KEY=...`

---

### 4. Google Gemini (Currently 503 Errors)
**Best for**: 1M context window, multimodal

**Sign up**: https://aistudio.google.com/app/apikey

**Rate limit**: 1,500 req/day

**Status**: ⚠️ Currently returning 503 errors

**Models**:
- `gemini-1.5-flash` (fast, 1M context)
- `gemini-1.5-pro` (powerful, 2M context)

**How to get key**:
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key
5. Add to `.env`: `GEMINI_API_KEY=...`

**Note**: Currently returning 503 errors. May work later or need new key.

---

### 5. Mistral AI
**Best for**: European data residency, ~1B tokens/month

**Sign up**: https://console.mistral.ai/

**Rate limit**: ~1 RPS, ~1B tokens/month

**Requirement**: Phone verification required

**Models**:
- `mistral-small-latest`
- `mistral-medium-latest`
- `mistral-large-latest`

**How to get key**:
1. Go to https://console.mistral.ai/
2. Sign up with email
3. Verify phone number (required)
4. Go to API Keys
5. Create new key
6. Add to `.env`: `MISTRAL_API_KEY=...`

---

### 6. Hugging Face Inference
**Best for**: 1000s of open-source models

**Sign up**: https://huggingface.co/settings/tokens

**Rate limit**: ~300 req/hour (shared)

**Models**: 1000s of open-source models

**How to get key**:
1. Go to https://huggingface.co/settings/tokens
2. Sign up/login
3. Click "New token"
4. Select "Read" role
5. Create token
6. Add to `.env`: `HF_API_KEY=hf_...`

---

### 7. Together AI
**Best for**: Open-source models, trial credits

**Sign up**: https://api.together.xyz/

**Rate limit**: $25 trial credits, then paid

**Models**: Llama, Mixtral, CodeLlama, etc.

**How to get key**:
1. Go to https://api.together.xyz/
2. Sign up with email
3. Get $25 free credits
4. Go to API Keys
5. Create new key
6. Add to `.env`: `TOGETHER_API_KEY=...`

**Note**: After $25 credits used, requires payment.

---

### 8. Cloudflare Workers AI
**Best for**: Edge inference, 10,000 neurons/day

**Sign up**: https://dash.cloudflare.com/

**Rate limit**: 10,000 neurons/day

**Models**: Llama, Mistral, Gemma, etc.

**How to get key**:
1. Go to https://dash.cloudflare.com/
2. Sign up for free account
3. Go to Workers & Pages
4. Create API token
5. Add to `.env`: `CLOUDFLARE_API_TOKEN=...`

---

## Provider Comparison

| Provider | Free Models | Rate Limit | Credit Card | Best For |
|----------|-------------|------------|-------------|----------|
| **Groq** | 14 | ~6,000 tok/min | ❌ No | Fast inference |
| **OpenRouter** | 35+ | 200 RPD | ❌ No | Wide selection |
| **Cerebras** | 2 | 14,400 RPD | ❌ No | Ultra-fast |
| **Gemini** | 2 | 1,500 RPD | ❌ No | 1M context |
| **Mistral** | 3 | ~1 RPS | ❌ No | EU data |
| **Hugging Face** | 1000s | ~300 req/hr | ❌ No | Open-source |
| **Together AI** | 20+ | $25 credits | ❌ No | Trial |
| **Cloudflare** | 10+ | 10k neurons/day | ❌ No | Edge |

## Recommended Setup

For **production use**, set up all 4 providers in this order:

```bash
# .env

# 1. Groq (primary - fastest)
GROQ_API_KEY=gsk_...

# 2. OpenRouter (fallback - 35+ models)
OPENROUTER_API_KEY=sk-or-...

# 3. Cerebras (second fallback - ultra-fast)
CEREBRAS_API_KEY=...

# 4. Gemini (third fallback - currently 503)
GEMINI_API_KEY=...
```

**Fallback chain**:
1. Groq → Fast, working for casual chat
2. OpenRouter → 35+ free models if Groq fails
3. Cerebras → Ultra-fast if OpenRouter fails
4. Gemini → Last resort (may work later)

## Troubleshooting

### Groq Returns 429 (Rate Limited)
**Solution**: System automatically falls back to OpenRouter/Cerebras/Gemini

### Gemini Returns 503
**Solution**: 
- Try generating new key at https://aistudio.google.com/app/apikey
- Or disable Gemini and rely on Groq/OpenRouter/Cerebras

### OpenRouter Returns 429
**Solution**: 
- Wait for rate limit reset (daily)
- System automatically falls back to Cerebras/Gemini

### All Providers Fail
**Solution**:
- Check all API keys are valid
- Verify no typos in `.env`
- Restart server after updating `.env`

## Testing Your Keys

Test each provider individually:

```bash
# Test Groq
curl -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.1-8b-instant","messages":[{"role":"user","content":"Hi"}]}'

# Test OpenRouter
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/llama-3.1-8b-instruct:free","messages":[{"role":"user","content":"Hi"}]}'

# Test Cerebras
curl -X POST https://api.cerebras.ai/v1/chat/completions \
  -H "Authorization: Bearer $CEREBRAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.1-8b","messages":[{"role":"user","content":"Hi"}]}'

# Test Gemini
curl -X POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent \
  -H "Authorization: Bearer $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hi"}]}]}'
```

## Summary

**Total Free Providers**: 8 (all no credit card required)

**Recommended Setup**:
1. ✅ Groq (primary)
2. ✅ OpenRouter (fallback)
3. ✅ Cerebras (second fallback)
4. ⚠️ Gemini (third fallback - currently 503)

**Total Free Models Available**: 50+

**Total Free Rate Limit**: ~20,000+ requests/day combined

**Cost**: $0 (all free tiers, no credit card)

Get your keys now and add them to `.env` to enable the full fallback chain!
