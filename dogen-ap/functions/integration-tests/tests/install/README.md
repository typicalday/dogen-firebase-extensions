# Install/Setup Tests

This directory contains unit tests for the Dogen installation and setup functionality, particularly the security rules configuration system.

## Test Files

### `securityRules.spec.ts`

**Unit tests** for the Firebase Security Rules injection logic that automatically configures Firestore Security Rules with Dogen authentication helpers.

**Note**: These tests focus on the **logic** of rules injection without calling the Firebase Security Rules API (which doesn't have an emulator). The tests recreate the injection logic and validate it against various rule structures.

**Test Coverage:**

1. **Dogen Rules Injection**
   - Injecting rules into default/empty rules
   - Preventing duplicate injection (idempotency)
   - Injecting into existing custom rules
   - Proper placement at service level

2. **Helper Functions**
   - `isDogenAuthenticated()` function injection
   - `isDogenAuthorized(role)` function injection
   - Correct function logic and parameters

3. **Access Rules**
   - Admin access rules creation
   - Dogen match block at service level
   - Proper rule structure

4. **Edge Cases**
   - Complex nested rule structures
   - Multiple existing helper functions
   - Rules with comments
   - rules_version = '2' preservation

5. **Error Handling**
   - Empty/missing rules handling
   - Invalid rule structure detection

## Running the Tests

### Run all install tests:
```bash
npm run test:install
```

### Run with existing emulators:
```bash
./integration-tests/scripts/test-with-emulator.sh install --no-start
```

### Run with debug output:
```bash
DEBUG=true npm run test:install
```

### Run all tests including install:
```bash
npm run test:all
```

## Test Requirements

- Firebase emulators (Auth, Firestore, Storage)
- Node.js and npm
- TypeScript

## What the Tests Verify

1. **Correct Rule Injection**: Verifies that Dogen rules are injected at the correct position (after `service cloud.firestore {`)

2. **Idempotency**: Ensures that running the configuration multiple times doesn't duplicate rules

3. **Preservation of Existing Rules**: Confirms that existing custom rules are not overwritten or damaged

4. **Proper Function Definitions**: Validates that helper functions are correctly defined with proper logic

5. **Access Control**: Verifies that admin access rules are properly created

6. **Edge Case Handling**: Tests complex scenarios like nested rules, multiple functions, and comments

## Expected Behavior

When `configureDogenSecurityRules()` is called:

1. Fetches current Firestore Security Rules
2. Checks if Dogen rules already exist (via `isDogenAuthenticated` check)
3. If not present, injects:
   - Helper functions (`isDogenAuthenticated`, `isDogenAuthorized`)
   - Access rules (match block with admin authorization)
4. Places all Dogen content at the service level (right after `service cloud.firestore {`)
5. Preserves all existing rules and structure

## Test Structure

```typescript
describe("Security Rules Configuration Tests", function() {
  describe("Dogen Rules Injection", function() { ... })
  describe("Helper Function Tests", function() { ... })
  describe("Access Rules Tests", function() { ... })
  describe("Edge Cases", function() { ... })
  describe("Error Handling", function() { ... })
})
```

## Troubleshooting

### Tests failing with "not found" errors
- Ensure Firebase emulators are running
- Check that the Security Rules emulator is enabled

### Tests timing out
- Increase timeout in test file (currently 30s)
- Check emulator logs for issues

### Rules not being applied
- Verify project ID matches emulator configuration
- Check that `releaseFirestoreRulesetFromSource()` is working

## Related Files

- `/src/utils/securityRules.ts` - Main security rules management utilities
- `/src/install/runInstall.ts` - Installation script that uses security rules
- `/src/config.ts` - Configuration including `enableDogenSecurityRules` flag
