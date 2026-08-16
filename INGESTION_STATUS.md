# Legal Corpus Ingestion Status

## Current State

| Metric | Value |
|--------|-------|
| Total acts in staged.json | 546 |
| Already ingested | 260 |
| Remaining to ingest | 285 |
| Total sections remaining | ~6,226 |
| Firestore Spark daily limit | 20,000 writes |
| Can complete in one day | ✅ YES |

## What's Already In Firestore (from 260 acts)

✅ **Working well:**
- Criminal Code Act (criminal_offences)
- Labour Act (employment)
- Land Use Act (land_property)
- Constitution (constitutional_rights)
- Matrimonial Causes Act (family_law)
- Evidence Act (general)
- ACJA 2015 (criminal_rights)
- Lagos State Tenancy Law 2011 (tenancy)

## Eval Failures — Root Cause Analysis

| Scenario | Expected Law | Status | Issue |
|----------|--------------|--------|-------|
| tenancy-abuja-eviction | Recovery of Premises Act | ❌ MISSING | Not in staged.json, not in Firestore |
| domestic-violence-abuse | Violence Against Persons Act | ❌ MISSING | Not in staged.json |
| consumer-defective-goods | FCCPA 2018 | ❌ MISSING | Not in staged.json |
| criminal-arrest-without-warrant | Criminal Code Act | ✅ Ingested | Agent cites ACJA instead (both valid) |
| traffic-fake-checkpoint | Police Act | ⏳ Remaining | In staged.json, will be ingested |
| minimum-wage-simple | National Minimum Wage Act |  Remaining | In staged.json, will be ingested |

## Action Plan

### Phase 1: Bulk Ingest Remaining 285 Acts (TODAY)

The path casing in `staged.json` has been fixed. To run the ingestion:

```bash
# On a machine with FIREBASE_SERVICE_ACCOUNT_JSON configured:
cd /home/user/Legallyunbullied

# Batch 1: Acts 0-100
node scripts/bulk-ingest-firestore.js --start 0 --limit 100

# Batch 2: Acts 100-200  
node scripts/bulk-ingest-firestore.js --start 100 --limit 100

# Batch 3: Acts 200-285
node scripts/bulk-ingest-firestore.js --start 200 --limit 100
```

**Quota usage:** ~6,226 writes (well under 20,000 limit)

### Phase 2: Source Missing Acts (MANUAL)

These 4 Acts need to be sourced and ingested separately:

#### 1. Recovery of Premises Act (FCT/Abuja tenancy)
- **Why needed:** Abuja uses this Act, not Lagos State Tenancy Law
- **Eval scenario:** `tenancy-abuja-eviction`
- **Sources to check:**
  - https://placng.org (search for "Recovery of Premises")
  - https://www.lawpavilion.com
  - https://nigerialaw.org
- **Manual ingest command:**
  ```bash
  node scripts/ingest.js \
    --file legal_sources/federal_acts/recovery-of-premises-act.txt \
    --act "Recovery of Premises Act" \
    --practice-area tenancy \
    --jurisdiction "Federal Capital Territory"
  ```

#### 2. Violence Against Persons (Prohibition) Act 2015
- **Why needed:** Domestic violence, sexual assault scenarios
- **Eval scenario:** `domestic-violence-abuse`
- **Sources to check:**
  - https://placng.org/lawsofnigeria/laws/VAPP.pdf (try variations)
  - Official gazette PDFs
- **Manual ingest command:**
  ```bash
  node scripts/ingest.js \
    --file legal_sources/federal_acts/vapp-act-2015.txt \
    --act "Violence Against Persons (Prohibition) Act 2015" \
    --practice-area criminal_rights \
    --jurisdiction "Federal"
  ```

#### 3. Federal Competition and Consumer Protection Act (FCCPA) 2018
- **Why needed:** Consumer protection, defective goods scenarios
- **Eval scenario:** `consumer-defective-goods`
- **Sources to check:**
  - https://placng.org
  - FCCPC official website
- **Manual ingest command:**
  ```bash
  node scripts/ingest.js \
    --file legal_sources/federal_acts/fccpa-2018.txt \
    --act "Federal Competition and Consumer Protection Act 2018" \
    --practice-area consumer_rights \
    --jurisdiction "Federal"
  ```

#### 4. Cybercrimes (Prohibition, Prevention, etc.) Act 2015
- **Status:** ✅ PDF exists at `legal_sources/federal_acts/cybercrimes-act-2015.pdf`
- **Action:** Convert PDF to text and ingest
  ```bash
  node scripts/pdf-to-text.js --file legal_sources/federal_acts/cybercrimes-act-2015.pdf
  node scripts/ingest.js \
    --file legal_sources/federal_acts/cybercrimes-act-2015.txt \
    --act "Cybercrimes (Prohibition, Prevention, etc.) Act 2015" \
    --practice-area criminal_offences \
    --jurisdiction "Federal"
  ```

## Firebase Configuration

To run ingestion, you need:

```bash
# Set this environment variable
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"..."}'

# Or in .env file:
FIREBASE_SERVICE_ACCOUNT_JSON='...'
```

Get this from:
1. Firebase Console → Project Settings → Service Accounts
2. Generate new private key
3. Copy the JSON content

## Expected Results After Ingestion

After completing both phases:
- **Eval pass rate:** Should increase from ~80% to ~90%+
- **Abuja tenancy:** Will return proper Recovery of Premises Act citations
- **Domestic violence:** Will cite VAPP Act properly
- **Consumer protection:** Will cite FCCPA sections
- **Cybercrimes:** Will be available for online crime scenarios

## Firestore Quota Tracking

| Day | Acts Ingested | Sections Written | Cumulative |
|-----|---------------|------------------|------------|
| Today | 100 | ~2,100 | 2,100 |
| Today | 100 | ~2,100 | 4,200 |
| Today | 85 | ~1,800 | 6,000 |
| **Total** | **285** | **~6,000** | **6,000/20,000** |

**Safety margin:** 14,000 writes remaining for app operations
