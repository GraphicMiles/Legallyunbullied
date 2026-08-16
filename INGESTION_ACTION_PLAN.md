# Legal Corpus Ingestion — Action Plan

## ✅ Completed

1. **Fixed path casing** in `staged.json` (lowercase → capitalized L)
2. **Converted Cybercrimes Act 2015** PDF to text (98KB, 43 pages)
3. **Added Cybercrimes Act** to `staged.json` manifest
4. **Created action plan** for remaining ingestion

##  Current State

| Metric | Value |
|--------|-------|
| Total acts in staged.json | 547 (was 546, +1 Cybercrimes) |
| Already ingested | 260 |
| Ready to ingest | 286 (285 original + 1 Cybercrimes) |
| Estimated sections | ~6,250 |
| Firestore Spark limit | 20,000 writes/day |
| Quota headroom | 13,750 writes (68% free) |

## 🚀 Ready to Run: Bulk Ingest (286 acts)

The bulk ingest script is ready. You need to run this on a machine with Firebase credentials configured.

### Prerequisites

```bash
# Set Firebase credentials
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"legally-unbullied-...","private_key":"-----BEGIN PRIVATE KEY-----\n..."}'

# Verify connection
node -e "const {getFirestore} = require('./server/firebaseAdmin'); console.log('✅ Firestore connected')"
```

### Execution (3 batches)

```bash
cd /home/user/Legallyunbullied

# Batch 1: Acts 0-100 (~2,100 sections)
echo "=== Batch 1: Acts 0-100 ===" && node scripts/bulk-ingest-firestore.js --start 0 --limit 100

# Batch 2: Acts 100-200 (~2,100 sections)
echo "=== Batch 2: Acts 100-200 ===" && node scripts/bulk-ingest-firestore.js --start 100 --limit 100

# Batch 3: Acts 200-286 (~1,800 sections)
echo "=== Batch 3: Acts 200-286 ===" && node scripts/bulk-ingest-firestore.js --start 200 --limit 100
```

**Total time:** ~30-60 minutes
**Quota usage:** ~6,250 writes (31% of daily limit)

## ️ Missing Acts (Need Manual Sourcing)

Three critical Acts are NOT in staged.json and need to be sourced manually:

### 1. Recovery of Premises Act (FCT Tenancy)
- **Why critical:** Abuja tenancy scenarios fail without this
- **Eval scenario:** `tenancy-abuja-eviction`
- **Jurisdiction:** Federal Capital Territory (not Lagos State)
- **Sources to check:**
  - https://placng.org (search manually)
  - https://www.lawpavilion.com
  - https://nigerialaw.org
  - National Assembly website: https://nass.gov.ng
- **Once PDF is obtained:**
  ```bash
  # Convert PDF to text
  node scripts/pdf-to-text.js --file legal_sources/federal_acts/recovery-of-premises-act.pdf
  
  # Clean the text file (remove headers, page numbers)
  # Then ingest:
  node scripts/ingest.js \
    --file legal_sources/federal_acts/recovery-of-premises-act.txt \
    --act "Recovery of Premises Act" \
    --practice-area tenancy \
    --jurisdiction "Federal Capital Territory"
  ```

### 2. Violence Against Persons (Prohibition) Act 2015
- **Why critical:** Domestic violence scenarios fail without this
- **Eval scenario:** `domestic-violence-abuse`
- **Sources to check:**
  - https://placng.org/lawsofnigeria/
  - Ministry of Women Affairs
  - UN Women Nigeria publications
- **Once PDF is obtained:**
  ```bash
  node scripts/pdf-to-text.js --file legal_sources/federal_acts/vapp-act-2015.pdf
  node scripts/ingest.js \
    --file legal_sources/federal_acts/vapp-act-2015.txt \
    --act "Violence Against Persons (Prohibition) Act 2015" \
    --practice-area criminal_rights \
    --jurisdiction "Federal"
  ```

### 3. Federal Competition and Consumer Protection Act (FCCPA) 2018
- **Why critical:** Consumer protection scenarios fail without this
- **Eval scenario:** `consumer-defective-goods`
- **Sources to check:**
  - FCCPC official website: https://fccpc.gov.ng
  - https://placng.org
  - Federal Gazette
- **Once PDF is obtained:**
  ```bash
  node scripts/pdf-to-text.js --file legal_sources/federal_acts/fccpa-2018.pdf
  node scripts/ingest.js \
    --file legal_sources/federal_acts/fccpa-2018.txt \
    --act "Federal Competition and Consumer Protection Act 2018" \
    --practice-area consumer_rights \
    --jurisdiction "Federal"
  ```

## 📈 Expected Eval Improvements

After bulk ingest (286 acts):
- **Pass rate:** ~80% → ~85%
- **Failing scenarios:** Police Act, National Minimum Wage, Trade Marks will resolve

After sourcing missing 3 Acts:
- **Pass rate:** ~85% → ~92%
- **Failing scenarios:** Abuja tenancy, domestic violence, consumer protection will resolve

## 🔧 Troubleshooting

### Firestore Quota Exhausted
If you hit the 20,000 write limit:
```bash
# Check progress
cat legal_sources/manifest/ingest_progress.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Ingested: {len(d.get(\"doneNames\", []))}')"

# Wait for daily reset (midnight Pacific Time)
# Or upgrade to Blaze plan (pay-as-you-go)
```

### PDF Conversion Issues
If `pdf-to-text.js` produces messy output:
1. Open the .txt file
2. Remove headers/footers/page numbers manually
3. Ensure section headers match pattern: `12. Section title.` or `12.—(1) Text...`
4. Re-run ingest

### Path Errors
If you see "cleaned file missing":
```bash
# Verify path casing
ls -la legal_sources/federal_acts_bulk/*.txt | head -5

# Fix staged.json paths if needed
python3 -c "
import json
with open('legal_sources/manifest/staged.json') as f:
    data = json.load(f)
for e in data:
    if 'cleanedPath' in e:
        e['cleanedPath'] = e['cleanedPath'].replace('/home/user/legally-unbullied/', '/home/user/Legallyunbullied/')
with open('legal_sources/manifest/staged.json', 'w') as f:
    json.dump(data, f, indent=2)
"
```

## 📋 Quick Reference

### Key Commands

```bash
# Check ingestion progress
cat legal_sources/manifest/ingest_progress.json | python3 -m json.tool | grep doneNames | wc -w

# Dry run (no writes)
node scripts/bulk-ingest-firestore.js --dry-run --limit 10

# Ingest single act
node scripts/ingest.js --file path/to/act.txt --act "Act Name" --practice-area tenancy --jurisdiction "Lagos State"

# Clear progress (restart from beginning)
rm legal_sources/manifest/ingest_progress.json

# Invalidate cache after ingestion
node -e "require('./server/legalCorpus').invalidateCache()"
```

### Firestore Collections

- `legal_provisions` — Individual section chunks (what the agent retrieves)
- `legal_sources` — Act metadata (not used in V1, reserved for future)

### Practice Areas

Valid values (must match exactly):
- `tenancy`
- `employment`
- `criminal_rights`
- `criminal_offences`
- `family_law`
- `land_property`
- `contract`
- `company_business`
- `consumer_rights`
- `constitutional_rights`
- `immigration_citizenship`
- `tax_finance`
- `intellectual_property`
- `transport_traffic`
- `education`
- `general`

---

**Next Steps:**
1. Configure Firebase credentials
2. Run bulk ingest (3 batches)
3. Source and ingest the 3 missing Acts
4. Re-run eval suite
5. Verify failing scenarios resolve
