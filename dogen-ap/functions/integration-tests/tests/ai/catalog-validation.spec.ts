/**
 * Catalog Drift Detection Tests
 *
 * This test suite validates that all task capabilities defined in the catalog
 * have corresponding handler implementations. It prevents catalog drift where
 * tasks are added to the catalog but not implemented, or vice versa.
 *
 * NOTE: This test now uses the centralized handler registry which serves as
 * the single source of truth for all handler definitions. The registry
 * automatically keeps the catalog, processJob routing, and tests in sync.
 *
 * Purpose:
 * - Prevent AI from generating plans for non-existent handlers
 * - Catch catalog staleness after refactoring
 * - Ensure runtime failures are caught at test time
 * - Validate registry completeness and correctness
 */

import { expect } from "chai";
import {
  getTaskCatalog,
  findTaskCapability,
  isValidServiceCommand,
  getAvailableServices,
  getServiceCommands
} from "../../../lib/job/handlers/ai/orchestrate/catalog";
import {
  HANDLER_REGISTRY,
  getHandler,
  hasHandler,
} from "../../../lib/job/handlers/registry";
import * as fs from "fs";
import * as path from "path";


describe("Task Catalog Validation - Drift Detection", () => {
  describe("Catalog Completeness", () => {
    it("should have handlers for all cataloged tasks", () => {
      const catalog = getTaskCatalog();
      const missingHandlers: string[] = [];

      for (const capability of catalog) {
        const { service, command } = capability;

        // Verify handler exists in registry
        if (!hasHandler(service, command)) {
          missingHandlers.push(`${service}/${command}`);
        }

        // Verify handler function is valid
        const handler = getHandler(service, command);
        if (handler && typeof handler !== 'function') {
          missingHandlers.push(`${service}/${command} (invalid handler type)`);
        }
      }

      // Report all missing handlers
      if (missingHandlers.length > 0) {
        console.error("\n❌ Missing handlers for catalog entries:");
        missingHandlers.forEach(sc => console.error(`   - ${sc}`));
      }

      expect(missingHandlers,
        `Found ${missingHandlers.length} catalog entries without handlers: ${missingHandlers.join(", ")}`
      ).to.be.empty;
    });

    it("should have all handlers represented in catalog", () => {
      const catalog = getTaskCatalog();
      const catalogSet = new Set(
        catalog.map(c => `${c.service}/${c.command}`)
      );

      const undocumentedHandlers: string[] = [];

      // Check that every handler in registry is in catalog
      for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
        for (const command of Object.keys(commands)) {
          const key = `${service}/${command}`;
          if (!catalogSet.has(key)) {
            undocumentedHandlers.push(key);
          }
        }
      }

      // Report all undocumented handlers
      if (undocumentedHandlers.length > 0) {
        console.error("\n⚠️  Handlers exist but not in catalog:");
        undocumentedHandlers.forEach(sc => console.error(`   - ${sc}`));
      }

      expect(undocumentedHandlers,
        `Found ${undocumentedHandlers.length} handlers not in catalog: ${undocumentedHandlers.join(", ")}`
      ).to.be.empty;
    });

    it("should have correct catalog count", () => {
      const catalog = getTaskCatalog();

      // Count handlers in registry
      let handlerCount = 0;
      for (const commands of Object.values(HANDLER_REGISTRY)) {
        handlerCount += Object.keys(commands).length;
      }

      expect(catalog.length).to.equal(
        handlerCount,
        `Catalog has ${catalog.length} entries but handler registry has ${handlerCount} handlers`
      );
    });

    it("should have valid handler functions for all registry entries", () => {
      const errors: string[] = [];

      for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
        for (const [command, definition] of Object.entries(commands)) {
          const key = `${service}/${command}`;

          // Verify handler is a function
          if (typeof definition.handler !== 'function') {
            errors.push(`${key}: handler is not a function`);
          }

          // Verify definition has required fields
          if (!definition.description || typeof definition.description !== 'string') {
            errors.push(`${key}: missing or invalid description`);
          }

          if (!Array.isArray(definition.requiredParams)) {
            errors.push(`${key}: requiredParams must be an array`);
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Registry validation errors:");
        errors.forEach(err => console.error(`   - ${err}`));
      }

      expect(errors).to.be.empty;
    });
  });

  describe("Catalog Entry Validation", () => {
    it("should have valid required parameters for all catalog entries", () => {
      const catalog = getTaskCatalog();
      const errors: string[] = [];

      for (const capability of catalog) {
        const { service, command, requiredParams, optionalParams } = capability;
        const key = `${service}/${command}`;

        // Verify required params is an array
        if (!Array.isArray(requiredParams)) {
          errors.push(`${key}: requiredParams is not an array`);
        }

        // Verify optional params is an array
        if (!Array.isArray(optionalParams)) {
          errors.push(`${key}: optionalParams is not an array`);
        }

        // Verify no overlap between required and optional
        if (Array.isArray(requiredParams) && Array.isArray(optionalParams)) {
          const overlap = requiredParams.filter(p =>
            optionalParams.includes(p)
          );

          if (overlap.length > 0) {
            errors.push(
              `${key}: Parameters appear in both required and optional: ${overlap.join(", ")}`
            );
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Parameter validation errors:");
        errors.forEach(err => console.error(`   - ${err}`));
      }

      expect(errors).to.be.empty;
    });

    it("should have valid examples for all catalog entries", () => {
      const catalog = getTaskCatalog();
      const errors: string[] = [];

      for (const capability of catalog) {
        const { service, command, requiredParams, examples } = capability;
        const key = `${service}/${command}`;

        // Verify examples is an array with at least one entry
        if (!Array.isArray(examples) || examples.length === 0) {
          errors.push(`${key}: Must have at least one example`);
          continue;
        }

        for (let i = 0; i < examples.length; i++) {
          const example = examples[i];
          const exampleKey = `${key} example #${i + 1}`;

          // Verify example has input
          if (!example.input || typeof example.input !== 'object') {
            errors.push(`${exampleKey}: Missing or invalid input`);
          }

          // Verify example has description
          if (
            !example.description ||
            typeof example.description !== 'string' ||
            example.description.length < 10
          ) {
            errors.push(
              `${exampleKey}: Description must be a string with at least 10 characters`
            );
          }

          // Verify example includes all required params
          if (example.input && Array.isArray(requiredParams)) {
            for (const param of requiredParams) {
              if (!(param in example.input)) {
                errors.push(
                  `${exampleKey}: Missing required parameter '${param}'`
                );
              }
            }
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Example validation errors:");
        errors.forEach(err => console.error(`   - ${err}`));
      }

      expect(errors).to.be.empty;
    });

    it("should have non-empty descriptions for all catalog entries", () => {
      const catalog = getTaskCatalog();
      const errors: string[] = [];

      for (const capability of catalog) {
        const { service, command, description } = capability;
        const key = `${service}/${command}`;

        if (
          !description ||
          typeof description !== 'string' ||
          description.trim().length === 0
        ) {
          errors.push(`${key}: Description is empty or invalid`);
        } else if (description.length < 20) {
          errors.push(
            `${key}: Description is too short (${description.length} chars, should be at least 20)`
          );
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Description validation errors:");
        errors.forEach(err => console.error(`   - ${err}`));
      }

      expect(errors).to.be.empty;
    });
  });

  describe("Catalog Lookup Functions", () => {
    it("should correctly validate known service/command combinations", () => {
      // Test known valid combinations
      expect(isValidServiceCommand("firestore", "copy-collection")).to.be.true;
      expect(isValidServiceCommand("storage", "delete-path")).to.be.true;
      expect(isValidServiceCommand("ai", "process-inference")).to.be.true;
      expect(isValidServiceCommand("ai", "orchestrate")).to.be.true;
      expect(isValidServiceCommand("authentication", "create-user")).to.be.true;
    });

    it("should reject unknown service/command combinations", () => {
      expect(isValidServiceCommand("unknown", "command")).to.be.false;
      expect(isValidServiceCommand("firestore", "invalid-command")).to.be.false;
      expect(isValidServiceCommand("storage", "copy-file")).to.be.false;
    });

    it("should provide capability information for all services", () => {
      const services = getAvailableServices();

      expect(services).to.include("firestore");
      expect(services).to.include("storage");
      expect(services).to.include("ai");
      expect(services).to.include("authentication");
      expect(services).to.be.an("array").with.lengthOf(4);
    });

    it("should provide commands for each service", () => {
      const firestoreCommands = getServiceCommands("firestore");
      expect(firestoreCommands).to.be.an("array").with.lengthOf.at.least(10);
      expect(firestoreCommands).to.include("copy-collection");
      expect(firestoreCommands).to.include("create-document");

      const storageCommands = getServiceCommands("storage");
      expect(storageCommands).to.be.an("array").with.lengthOf(1);
      expect(storageCommands).to.include("delete-path");

      const aiCommands = getServiceCommands("ai");
      expect(aiCommands).to.be.an("array").with.lengthOf(2);
      expect(aiCommands).to.include("process-inference");
      expect(aiCommands).to.include("orchestrate");

      const authCommands = getServiceCommands("authentication");
      expect(authCommands).to.be.an("array").with.lengthOf(7);
      expect(authCommands).to.include("create-user");
      expect(authCommands).to.include("set-user-claims");
    });

    it("should find capability details by service and command", () => {
      const capability = findTaskCapability("firestore", "copy-collection");

      expect(capability).to.exist;
      expect(capability?.service).to.equal("firestore");
      expect(capability?.command).to.equal("copy-collection");
      expect(capability?.description).to.be.a("string");
      expect(capability?.requiredParams).to.be.an("array");
      expect(capability?.optionalParams).to.be.an("array");
      expect(capability?.examples).to.be.an("array").with.lengthOf.at.least(1);
    });
  });

  describe("Handler File Existence", () => {
    it("should have handler files for all catalog entries", () => {
      const catalog = getTaskCatalog();
      const missingFiles: string[] = [];
      const handlersDir = path.resolve(__dirname, "../../../src/job/handlers");

      for (const capability of catalog) {
        const { service, command } = capability;

        // Convert command to filename format
        // Special handling for CSV/JSON - they use uppercase in filenames
        let fileName = command
          .replace(/-csv$/i, "CSV")
          .replace(/-json$/i, "JSON")
          .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

        // Construct expected file path
        let handlerPath: string;
        if (service === "ai" && command === "orchestrate") {
          // Special case: orchestrate handler is in ai/orchestrate/handler.ts
          handlerPath = path.join(handlersDir, service, "orchestrate", "handler.ts");
        } else {
          handlerPath = path.join(handlersDir, service, `${fileName}.ts`);
        }

        // Check if file exists
        if (!fs.existsSync(handlerPath)) {
          missingFiles.push(`${service}/${command} -> ${handlerPath}`);
        }
      }

      if (missingFiles.length > 0) {
        console.error("\n❌ Missing handler files:");
        missingFiles.forEach(file => console.error(`   - ${file}`));
      }

      expect(missingFiles).to.be.empty;
    });
  });

  describe("processTask.ts Routing Validation", () => {
    it("should successfully route all catalog entries via registry", () => {
      const catalog = getTaskCatalog();
      const routingErrors: string[] = [];

      // Verify that processJob.ts uses the registry
      const processJobPath = path.resolve(__dirname, "../../../src/job/processJob.ts");
      const processJobContent = fs.readFileSync(processJobPath, "utf-8");

      // Check that processJob imports from registry
      if (!processJobContent.includes("from \"./handlers/registry\"")) {
        routingErrors.push("processJob.ts does not import from registry");
      }

      // Check that processJob uses getHandler function
      if (!processJobContent.includes("getHandler")) {
        routingErrors.push("processJob.ts does not use getHandler function");
      }

      // Verify all catalog entries have handlers in registry
      for (const capability of catalog) {
        const { service, command } = capability;
        const key = `${service}/${command}`;

        // Check if handler exists in registry
        if (!hasHandler(service, command)) {
          routingErrors.push(`${key}: No handler found in registry`);
          continue;
        }

        // Verify handler is a valid function
        const handler = getHandler(service, command);
        if (typeof handler !== 'function') {
          routingErrors.push(`${key}: Handler is not a function`);
        }
      }

      if (routingErrors.length > 0) {
        console.error("\n❌ Routing validation errors:");
        routingErrors.forEach(err => console.error(`   - ${err}`));
      }

      expect(routingErrors).to.be.empty;
    });
  });

  describe("Integration - Example Validation", () => {
    it("should validate at least one example from each catalog entry", () => {
      const catalog = getTaskCatalog();
      const validationErrors: string[] = [];

      for (const capability of catalog) {
        const { service, command, examples } = capability;
        const key = `${service}/${command}`;

        if (examples.length === 0) {
          validationErrors.push(`${key}: No examples to validate`);
          continue;
        }

        // Verify example would be accepted by catalog validation
        if (!isValidServiceCommand(service, command)) {
          validationErrors.push(
            `${key}: Example uses invalid service/command combination`
          );
        }

        // Verify capability can be found
        const foundCapability = findTaskCapability(service, command);
        if (!foundCapability) {
          validationErrors.push(
            `${key}: Example's service/command not found in catalog`
          );
        }
      }

      if (validationErrors.length > 0) {
        console.error("\n❌ Example integration errors:");
        validationErrors.forEach(err => console.error(`   - ${err}`));
      }

      expect(validationErrors).to.be.empty;
    });
  });

  describe("Catalog Statistics", () => {
    it("should report catalog statistics", () => {
      const catalog = getTaskCatalog();
      const services = getAvailableServices();

      console.log("\n📊 Task Catalog Statistics:");
      console.log(`   Total catalog entries: ${catalog.length}`);
      console.log(`   Services: ${services.length}`);

      for (const service of services) {
        const commands = getServiceCommands(service);
        console.log(`   - ${service}: ${commands.length} commands`);
      }

      // Count total examples
      const totalExamples = catalog.reduce(
        (sum, cap) => sum + cap.examples.length,
        0
      );
      console.log(`   Total examples: ${totalExamples}`);

      // Average examples per capability
      const avgExamples = (totalExamples / catalog.length).toFixed(1);
      console.log(`   Average examples per capability: ${avgExamples}`);
    });
  });

  describe("Synchronization Recommendations", () => {
    it("should provide synchronization recommendations", () => {
      console.log("\n📝 Handler Registry Architecture - NEW SIMPLIFIED WORKFLOW:");
      console.log("   ✅ SINGLE SOURCE OF TRUTH: src/job/handlers/registry.ts");
      console.log("");
      console.log("   When adding a new handler:");
      console.log("      1. Create handler file in handlers/{service}/{command}.ts");
      console.log("      2. Add entry to HANDLER_REGISTRY in handlers/registry.ts");
      console.log("      3. That's it! The following happens automatically:");
      console.log("         - processJob.ts routes via registry lookup");
      console.log("         - catalog.ts derives from registry");
      console.log("         - Tests validate against registry");
      console.log("");
      console.log("   Benefits:");
      console.log("      - DRY principle: Define handlers in ONE place");
      console.log("      - Type safety: Handler signatures enforced");
      console.log("      - No drift: Catalog/routing/tests stay in sync");
      console.log("      - Easy maintenance: Add/remove handlers in one location");
      console.log("");
      console.log("   When removing a handler:");
      console.log("      1. Delete handler file");
      console.log("      2. Remove entry from HANDLER_REGISTRY");
      console.log("      3. Everything else updates automatically");
      console.log("");
      console.log("   Run 'npm run test:ai' to validate registry completeness");
    });
  });
});
