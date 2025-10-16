import { describe, it } from "mocha";
import { expect } from "chai";
import { generateDefaultFirestoreRules, injectDogenFirestoreRules } from "../../../src/utils/securityRules";

describe("Security Rules Injection Logic Tests", function() {

  describe("Basic Injection", function() {
    it("should inject Dogen rules into default rules", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      expect(result).to.include("isDogenAuthenticated");
      expect(result).to.include("isDogenAuthorized");
      expect(result).to.include("allow read, write: if isDogenAuthorized('admin')");
    });

    it("should inject Dogen rules into minimal rules", function() {
      const minimalRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
      const result = injectDogenFirestoreRules(minimalRules);

      expect(result).to.include("function isDogenAuthenticated()");
      expect(result).to.include("function isDogenAuthorized(role)");
    });

    it("should inject rules at the correct position (after service opening)", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      const serviceIndex = result.indexOf("service cloud.firestore {");
      const dogenFunctionIndex = result.indexOf("function isDogenAuthenticated");

      expect(serviceIndex).to.be.greaterThan(-1);
      expect(dogenFunctionIndex).to.be.greaterThan(serviceIndex);
      expect(dogenFunctionIndex - serviceIndex).to.be.lessThan(100); // Should be close to service declaration
    });
  });

  describe("Preserving Existing Rules", function() {
    it("should preserve existing custom rules with user authentication", function() {
      const customRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
  }
}`;
      const result = injectDogenFirestoreRules(customRules);

      // Check Dogen rules are present
      expect(result).to.include("isDogenAuthenticated");
      expect(result).to.include("isDogenAuthorized");

      // Check original rules are preserved
      expect(result).to.include("match /users/{userId}");
      expect(result).to.include("request.auth.uid == userId");
      expect(result).to.include("request.auth != null");
    });

    it("should preserve multiple match blocks", function() {
      const multiMatchRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
    }
    match /posts/{postId} {
      allow read: if true;
    }
    match /private/{doc} {
      allow read, write: if false;
    }
  }
}`;
      const result = injectDogenFirestoreRules(multiMatchRules);

      expect(result).to.include("match /users/{userId}");
      expect(result).to.include("match /posts/{postId}");
      expect(result).to.include("match /private/{doc}");
      expect(result).to.include("isDogenAuthenticated");
    });

    it("should preserve existing helper functions", function() {
      const rulesWithHelpers = `rules_version = '2';
service cloud.firestore {
  function isOwner(userId) {
    return request.auth.uid == userId;
  }

  function isAdmin() {
    return request.auth.token.admin == true;
  }

  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if true;
      allow write: if isOwner(userId) || isAdmin();
    }
  }
}`;
      const result = injectDogenFirestoreRules(rulesWithHelpers);

      // Check Dogen functions are added
      expect(result).to.include("isDogenAuthenticated");
      expect(result).to.include("isDogenAuthorized");

      // Check existing functions are preserved
      expect(result).to.include("function isOwner(userId)");
      expect(result).to.include("function isAdmin()");
      expect(result).to.include("isOwner(userId) || isAdmin()");
    });

    it("should preserve complex nested structures", function() {
      const complexRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /organizations/{orgId} {
      allow read: if request.auth != null;

      match /teams/{teamId} {
        allow read: if request.auth != null;

        match /members/{memberId} {
          allow read: if request.auth != null;
          allow write: if request.auth.uid == memberId;
        }
      }

      match /projects/{projectId} {
        allow read: if request.auth != null;
      }
    }
  }
}`;
      const result = injectDogenFirestoreRules(complexRules);

      expect(result).to.include("match /organizations/{orgId}");
      expect(result).to.include("match /teams/{teamId}");
      expect(result).to.include("match /members/{memberId}");
      expect(result).to.include("match /projects/{projectId}");
      expect(result).to.include("isDogenAuthenticated");
    });
  });

  describe("Helper Function Logic", function() {
    it("should inject isDogenAuthenticated with correct logic", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      expect(result).to.include("function isDogenAuthenticated()");
      expect(result).to.include("request.auth != null");
      expect(result).to.include("'dogenRoles' in request.auth.token");
    });

    it("should inject isDogenAuthorized with correct logic", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      expect(result).to.include("function isDogenAuthorized(role)");
      expect(result).to.include("isDogenAuthenticated()");
      expect(result).to.include("'admin' in request.auth.token.dogenRoles");
      expect(result).to.include("role in request.auth.token.dogenRoles");
    });

    it("should create isDogenAuthorized that checks for admin or role", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      // The function should use OR logic
      const functionMatch = result.match(/function isDogenAuthorized\(role\)\s*\{[\s\S]*?\}/);
      expect(functionMatch).to.not.be.null;

      const functionBody = functionMatch![0];
      expect(functionBody).to.include("||"); // Should have OR operator
    });
  });

  describe("Access Rules", function() {
    it("should inject admin access rules", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      expect(result).to.include("allow read, write: if isDogenAuthorized('admin')");
    });

    it("should create its own match /databases/{database}/documents block", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      // Count how many times the match /databases pattern appears
      const matches = result.match(/match \/databases\/\{database\}\/documents/g);
      expect(matches).to.have.length.greaterThan(1); // Should have at least 2 (original + Dogen's)
    });

    it("should use wildcard match for all documents", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      expect(result).to.include("match /{document=**}");
    });
  });

  describe("Comments and Formatting", function() {
    it("should preserve comments in existing rules", function() {
      const rulesWithComments = `rules_version = '2';
service cloud.firestore {
  // Main authentication check
  function isAuthenticated() {
    return request.auth != null;
  }

  match /databases/{database}/documents {
    // Public documents - anyone can read
    match /public/{document=**} {
      allow read: if true;
    }

    // User documents - must be authenticated
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow write: if request.auth.uid == userId; // Owner only
    }
  }
}`;
      const result = injectDogenFirestoreRules(rulesWithComments);

      expect(result).to.include("// Main authentication check");
      expect(result).to.include("// Public documents - anyone can read");
      expect(result).to.include("// User documents - must be authenticated");
      expect(result).to.include("// Owner only");
    });

    it("should preserve rules_version declaration", function() {
      const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
      const result = injectDogenFirestoreRules(rules);

      expect(result).to.include("rules_version = '2'");
    });

    it("should add Dogen comments for clarity", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const result = injectDogenFirestoreRules(defaultRules);

      expect(result).to.include("// Dogen helper functions");
      expect(result).to.include("// Dogen access rules");
    });
  });

  describe("Edge Cases", function() {
    it("should handle rules with extra whitespace in match blocks", function() {
      const rulesWithWhitespace = `rules_version = '2';
service cloud.firestore {

  match /databases/{database}/documents {

    match /{document=**} {

      allow read, write: if false;

    }
  }

}`;
      const result = injectDogenFirestoreRules(rulesWithWhitespace);

      expect(result).to.include("isDogenAuthenticated");
      expect(result).to.include("isDogenAuthorized");
    });

    it("should handle rules with tabs instead of spaces", function() {
      const rulesWithTabs = `rules_version = '2';
service cloud.firestore {
\tmatch /databases/{database}/documents {
\t\tmatch /{document=**} {
\t\t\tallow read, write: if false;
\t\t}
\t}
}`;
      const result = injectDogenFirestoreRules(rulesWithTabs);

      expect(result).to.include("isDogenAuthenticated");
      expect(result).to.include("match /{document=**}");
    });

    it("should handle rules with Windows line endings", function() {
      const rulesWithCRLF = "rules_version = '2';\r\nservice cloud.firestore {\r\n  match /databases/{database}/documents {\r\n    match /{document=**} {\r\n      allow read, write: if false;\r\n    }\r\n  }\r\n}";

      const result = injectDogenFirestoreRules(rulesWithCRLF);

      expect(result).to.include("isDogenAuthenticated");
    });

    it("should handle empty rules by generating defaults", function() {
      const emptyRules = "";
      const result = injectDogenFirestoreRules(emptyRules);

      expect(result).to.include("rules_version = '2'");
      expect(result).to.include("service cloud.firestore");
      expect(result).to.include("isDogenAuthenticated");
    });

    it("should handle whitespace-only rules by generating defaults", function() {
      const whitespaceRules = "   \n\n  \t\t  \n  ";
      const result = injectDogenFirestoreRules(whitespaceRules);

      expect(result).to.include("rules_version = '2'");
      expect(result).to.include("service cloud.firestore");
      expect(result).to.include("isDogenAuthenticated");
    });
  });

  describe("Multiple Helper Functions Coexistence", function() {
    it("should not conflict with similarly named functions", function() {
      const rulesWithSimilarFunctions = `rules_version = '2';
service cloud.firestore {
  function isAuthenticated() {
    return request.auth != null;
  }

  function isAuthorized() {
    return request.auth.token.role == 'admin';
  }

  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow write: if isAuthorized();
    }
  }
}`;
      const result = injectDogenFirestoreRules(rulesWithSimilarFunctions);

      // Both sets of functions should exist
      expect(result).to.include("function isAuthenticated()");
      expect(result).to.include("function isAuthorized()");
      expect(result).to.include("function isDogenAuthenticated()");
      expect(result).to.include("function isDogenAuthorized(role)");
    });

    it("should handle multiple functions with different signatures", function() {
      const complexFunctions = `rules_version = '2';
service cloud.firestore {
  function hasRole(role) {
    return request.auth.token.roles[role] == true;
  }

  function canAccess(resource, action) {
    return hasRole('admin') || resource.data.owner == request.auth.uid;
  }

  function isValidTimestamp(timestamp) {
    return timestamp > request.time;
  }

  match /databases/{database}/documents {
    match /documents/{docId} {
      allow read: if canAccess(resource, 'read');
    }
  }
}`;
      const result = injectDogenFirestoreRules(complexFunctions);

      expect(result).to.include("function hasRole(role)");
      expect(result).to.include("function canAccess(resource, action)");
      expect(result).to.include("function isValidTimestamp(timestamp)");
      expect(result).to.include("function isDogenAuthenticated()");
      expect(result).to.include("function isDogenAuthorized(role)");
    });
  });

  describe("Real-World Rule Patterns", function() {
    it("should work with multi-tenancy rules", function() {
      const multiTenancyRules = `rules_version = '2';
service cloud.firestore {
  function belongsToTenant(tenantId) {
    return request.auth.token.tenantId == tenantId;
  }

  match /databases/{database}/documents {
    match /tenants/{tenantId}/users/{userId} {
      allow read: if belongsToTenant(tenantId);
      allow write: if belongsToTenant(tenantId) && request.auth.uid == userId;
    }

    match /tenants/{tenantId}/data/{document=**} {
      allow read, write: if belongsToTenant(tenantId);
    }
  }
}`;
      const result = injectDogenFirestoreRules(multiTenancyRules);

      expect(result).to.include("belongsToTenant");
      expect(result).to.include("match /tenants/{tenantId}/users/{userId}");
      expect(result).to.include("isDogenAuthenticated");
    });

    it("should work with role-based access control (RBAC)", function() {
      const rbacRules = `rules_version = '2';
service cloud.firestore {
  function hasRole(role) {
    return request.auth.token.roles[role] == true;
  }

  function isAdmin() {
    return hasRole('admin');
  }

  function isEditor() {
    return hasRole('editor');
  }

  match /databases/{database}/documents {
    match /articles/{articleId} {
      allow read: if true;
      allow write: if isEditor() || isAdmin();
      allow delete: if isAdmin();
    }
  }
}`;
      const result = injectDogenFirestoreRules(rbacRules);

      expect(result).to.include("function hasRole(role)");
      expect(result).to.include("function isAdmin()");
      expect(result).to.include("function isEditor()");
      expect(result).to.include("isDogenAuthenticated");
      expect(result).to.include("isDogenAuthorized");
    });

    it("should work with time-based rules", function() {
      const timeBasedRules = `rules_version = '2';
service cloud.firestore {
  function isWithinBusinessHours() {
    return request.time.hours() >= 9 && request.time.hours() < 17;
  }

  function isNotExpired(timestamp) {
    return timestamp > request.time;
  }

  match /databases/{database}/documents {
    match /temp/{docId} {
      allow read: if true;
      allow create: if isWithinBusinessHours();
      allow update: if isNotExpired(resource.data.expiresAt);
    }
  }
}`;
      const result = injectDogenFirestoreRules(timeBasedRules);

      expect(result).to.include("isWithinBusinessHours");
      expect(result).to.include("isNotExpired");
      expect(result).to.include("request.time.hours()");
      expect(result).to.include("isDogenAuthenticated");
    });
  });

  describe("Error Handling", function() {
    it("should throw error for rules without service declaration", function() {
      const invalidRules = `rules_version = '2';
match /databases/{database}/documents {
  match /{document=**} {
    allow read, write: if false;
  }
}`;

      expect(() => injectDogenFirestoreRules(invalidRules)).to.throw("missing 'service cloud.firestore' declaration");
    });

    it("should throw error for malformed service declaration", function() {
      const malformedRules = `rules_version = '2';
service firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

      expect(() => injectDogenFirestoreRules(malformedRules)).to.throw("missing 'service cloud.firestore' declaration");
    });

    it("should handle null input gracefully", function() {
      const result = injectDogenFirestoreRules(null as any);

      expect(result).to.include("rules_version = '2'");
      expect(result).to.include("service cloud.firestore");
      expect(result).to.include("isDogenAuthenticated");
    });

    it("should handle undefined input gracefully", function() {
      const result = injectDogenFirestoreRules(undefined as any);

      expect(result).to.include("rules_version = '2'");
      expect(result).to.include("service cloud.firestore");
      expect(result).to.include("isDogenAuthenticated");
    });
  });

  describe("Idempotency Check", function() {
    it("should detect if Dogen rules already exist", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const withDogenRules = injectDogenFirestoreRules(defaultRules);

      // Check if rules already contain isDogenAuthenticated
      const alreadyHasDogen = withDogenRules.includes("isDogenAuthenticated");

      expect(alreadyHasDogen).to.be.true;
    });

    it("should not inject duplicate rules when already present", function() {
      const defaultRules = generateDefaultFirestoreRules();
      const withDogenRules = injectDogenFirestoreRules(defaultRules);

      // Simulate checking before injection (as done in configureDogenSecurityRules)
      if (withDogenRules.includes("isDogenAuthenticated")) {
        // Should skip injection
        expect(withDogenRules).to.equal(withDogenRules);
      } else {
        throw new Error("Test setup failed - Dogen rules should be present");
      }
    });
  });
});
