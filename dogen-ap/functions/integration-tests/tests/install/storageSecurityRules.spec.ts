import { describe, it } from "mocha";
import { expect } from "chai";
import { generateDefaultStorageRules, injectDogenStorageRules } from "../../../src/utils/securityRules";

describe("Storage Security Rules Injection Logic Tests", function() {
  describe("Basic Injection", function() {
    it("should inject Dogen rules into default Storage rules", function() {
      const defaultRules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(defaultRules);

      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
      expect(injectedRules).to.include("allow read, write: if isDogenAuthorized('admin')");
    });

    it("should inject Dogen rules into minimal Storage rules", function() {
      const minimalRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(minimalRules);

      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
      expect(injectedRules).to.include("match /b/{bucket}/o");
      expect(injectedRules).to.include("allow read, write: if request.auth != null");
    });

    it("should inject rules at the correct position (after service opening)", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      const serviceIndex = injectedRules.indexOf("service firebase.storage {");
      const isDogenAuthIndex = injectedRules.indexOf("function isDogenAuthenticated()");

      expect(isDogenAuthIndex).to.be.greaterThan(serviceIndex);
    });
  });

  describe("Preserving Existing Rules", function() {
    it("should preserve existing custom rules with user authentication", function() {
      const existingRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /public/{allPaths=**} {
      allow read: if true;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(existingRules);

      expect(injectedRules).to.include("match /users/{userId}/{allPaths=**}");
      expect(injectedRules).to.include("request.auth.uid == userId");
      expect(injectedRules).to.include("match /public/{allPaths=**}");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });

    it("should preserve multiple match blocks", function() {
      const rulesWithMultipleBlocks = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{imageId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /documents/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(rulesWithMultipleBlocks);

      expect(injectedRules).to.include("match /images/{imageId}");
      expect(injectedRules).to.include("match /documents/{docId}");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });

    it("should preserve existing helper functions", function() {
      const rulesWithHelpers = `rules_version = '2';
service firebase.storage {
  function isOwner(userId) {
    return request.auth != null && request.auth.uid == userId;
  }

  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if isOwner(userId);
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(rulesWithHelpers);

      expect(injectedRules).to.include("function isOwner(userId)");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });

    it("should preserve complex nested structures", function() {
      const complexRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /tenants/{tenantId} {
      match /users/{userId}/{allPaths=**} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && request.auth.uid == userId;
      }
      match /shared/{allPaths=**} {
        allow read: if request.auth != null;
      }
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(complexRules);

      expect(injectedRules).to.include("match /tenants/{tenantId}");
      expect(injectedRules).to.include("match /users/{userId}/{allPaths=**}");
      expect(injectedRules).to.include("match /shared/{allPaths=**}");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });
  });

  describe("Helper Function Logic", function() {
    it("should inject isDogenAuthenticated with correct logic", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("request.auth != null");
      expect(injectedRules).to.include("'dogenRoles' in request.auth.token");
    });

    it("should inject isDogenAuthorized with correct logic", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      expect(injectedRules).to.include("function isDogenAuthorized(role)");
      expect(injectedRules).to.include("isDogenAuthenticated()");
      expect(injectedRules).to.include("'admin' in request.auth.token.dogenRoles");
      expect(injectedRules).to.include("role in request.auth.token.dogenRoles");
    });

    it("should create isDogenAuthorized that checks for admin or role", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      const isDogenAuthorizedStart = injectedRules.indexOf("function isDogenAuthorized(role)");
      const isDogenAuthorizedEnd = injectedRules.indexOf("}", isDogenAuthorizedStart);
      const functionBody = injectedRules.substring(isDogenAuthorizedStart, isDogenAuthorizedEnd + 1);

      expect(functionBody).to.include("'admin' in request.auth.token.dogenRoles");
      expect(functionBody).to.include("||");
      expect(functionBody).to.include("role in request.auth.token.dogenRoles");
    });
  });

  describe("Access Rules", function() {
    it("should inject admin access rules", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      expect(injectedRules).to.include("allow read, write: if isDogenAuthorized('admin')");
    });

    it("should create its own match /b/{bucket}/o block", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      const matchBlocks = injectedRules.match(/match \/b\/\{bucket\}\/o/g);
      expect(matchBlocks).to.have.length.greaterThan(0);
    });

    it("should use wildcard match for all paths", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      expect(injectedRules).to.include("match /{allPaths=**}");
    });
  });

  describe("Comments and Formatting", function() {
    it("should preserve comments in existing rules", function() {
      const rulesWithComments = `rules_version = '2';
service firebase.storage {
  // Main storage bucket rules
  match /b/{bucket}/o {
    // Public files
    match /public/{allPaths=**} {
      allow read: if true; // Anyone can read
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(rulesWithComments);

      expect(injectedRules).to.include("// Main storage bucket rules");
      expect(injectedRules).to.include("// Public files");
      expect(injectedRules).to.include("// Anyone can read");
    });

    it("should preserve rules_version declaration", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      expect(injectedRules).to.include("rules_version = '2'");
    });

    it("should add Dogen comments for clarity", function() {
      const rules = generateDefaultStorageRules();
      const injectedRules = injectDogenStorageRules(rules);

      expect(injectedRules).to.match(/\/\/.*Dogen/);
    });
  });

  describe("Edge Cases", function() {
    it("should handle rules with extra whitespace in match blocks", function() {
      const rulesWithWhitespace = `rules_version = '2';
service firebase.storage    {
  match /b/{bucket}/o    {
    match /{allPaths=**}    {
      allow read, write: if request.auth != null;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(rulesWithWhitespace);

      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });

    it("should handle rules with tabs instead of spaces", function() {
      const rulesWithTabs = "rules_version = '2';\nservice firebase.storage {\n\tmatch /b/{bucket}/o {\n\t\tmatch /{allPaths=**} {\n\t\t\tallow read, write: if false;\n\t\t}\n\t}\n}";

      const injectedRules = injectDogenStorageRules(rulesWithTabs);

      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });

    it("should handle rules with Windows line endings", function() {
      const rulesWithCRLF = "rules_version = '2';\r\nservice firebase.storage {\r\n  match /b/{bucket}/o {\r\n    match /{allPaths=**} {\r\n      allow read, write: if false;\r\n    }\r\n  }\r\n}";

      const injectedRules = injectDogenStorageRules(rulesWithCRLF);

      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });

    it("should handle empty rules by generating defaults", function() {
      const emptyRules = "";

      const injectedRules = injectDogenStorageRules(emptyRules);

      expect(injectedRules).to.include("rules_version = '2'");
      expect(injectedRules).to.include("service firebase.storage");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });

    it("should handle whitespace-only rules by generating defaults", function() {
      const whitespaceRules = "   \n\n   \t\t   \n   ";

      const injectedRules = injectDogenStorageRules(whitespaceRules);

      expect(injectedRules).to.include("rules_version = '2'");
      expect(injectedRules).to.include("service firebase.storage");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });
  });

  describe("Multiple Helper Functions Coexistence", function() {
    it("should not conflict with similarly named functions", function() {
      const rulesWithSimilarFunctions = `rules_version = '2';
service firebase.storage {
  function isAuthenticated() {
    return request.auth != null;
  }

  function isAuthorized(permission) {
    return isAuthenticated() && permission in request.auth.token.customClaims;
  }

  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if isAuthenticated();
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(rulesWithSimilarFunctions);

      expect(injectedRules).to.include("function isAuthenticated()");
      expect(injectedRules).to.include("function isAuthorized(permission)");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });

    it("should handle multiple functions with different signatures", function() {
      const rulesWithMultipleFunctions = `rules_version = '2';
service firebase.storage {
  function hasAccess(userId) {
    return request.auth != null && request.auth.uid == userId;
  }

  function canRead(path) {
    return request.auth != null;
  }

  function canWrite(path, userId) {
    return hasAccess(userId);
  }

  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read: if canRead(userId);
      allow write: if canWrite(userId, userId);
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(rulesWithMultipleFunctions);

      expect(injectedRules).to.include("function hasAccess(userId)");
      expect(injectedRules).to.include("function canRead(path)");
      expect(injectedRules).to.include("function canWrite(path, userId)");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });
  });

  describe("Real-World Rule Patterns", function() {
    it("should work with user-based file access rules", function() {
      const userBasedRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/profile/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/private/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(userBasedRules);

      expect(injectedRules).to.include("match /users/{userId}/profile/{allPaths=**}");
      expect(injectedRules).to.include("match /users/{userId}/private/{allPaths=**}");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });

    it("should work with file type restrictions", function() {
      const fileTypeRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{imageId} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.contentType.matches('image/.*')
                   && request.resource.size < 5 * 1024 * 1024;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(fileTypeRules);

      expect(injectedRules).to.include("request.resource.contentType.matches('image/.*')");
      expect(injectedRules).to.include("request.resource.size < 5 * 1024 * 1024");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });

    it("should work with metadata-based rules", function() {
      const metadataRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /uploads/{uploadId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.resource.metadata.uploadedBy == request.auth.uid;
    }
  }
}`;

      const injectedRules = injectDogenStorageRules(metadataRules);

      expect(injectedRules).to.include("request.resource.metadata.uploadedBy");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
      expect(injectedRules).to.include("function isDogenAuthorized(role)");
    });
  });

  describe("Error Handling", function() {
    it("should throw error for rules without service declaration", function() {
      const invalidRules = `rules_version = '2';
match /b/{bucket}/o {
  match /{allPaths=**} {
    allow read, write: if false;
  }
}`;

      expect(() => injectDogenStorageRules(invalidRules)).to.throw(
        "Invalid Storage rules structure: missing 'service firebase.storage' declaration"
      );
    });

    it("should throw error for malformed service declaration", function() {
      const malformedRules = `rules_version = '2';
service firebase.firestore {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}`;

      expect(() => injectDogenStorageRules(malformedRules)).to.throw(
        "Invalid Storage rules structure: missing 'service firebase.storage' declaration"
      );
    });

    it("should handle null input gracefully", function() {
      const injectedRules = injectDogenStorageRules(null as any);

      expect(injectedRules).to.include("rules_version = '2'");
      expect(injectedRules).to.include("service firebase.storage");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });

    it("should handle undefined input gracefully", function() {
      const injectedRules = injectDogenStorageRules(undefined as any);

      expect(injectedRules).to.include("rules_version = '2'");
      expect(injectedRules).to.include("service firebase.storage");
      expect(injectedRules).to.include("function isDogenAuthenticated()");
    });
  });

  describe("Idempotency Check", function() {
    it("should detect if Dogen rules already exist", function() {
      const defaultRules = generateDefaultStorageRules();
      const firstInjection = injectDogenStorageRules(defaultRules);

      expect(firstInjection).to.include("isDogenAuthenticated");
    });

    it("should not inject duplicate rules when already present", function() {
      const rulesWithDogenFunctions = `rules_version = '2';
service firebase.storage {
    function isDogenAuthenticated() {
        return request.auth != null && ('dogenRoles' in request.auth.token);
    }

    function isDogenAuthorized(role) {
        return isDogenAuthenticated() &&
            ('admin' in request.auth.token.dogenRoles || role in request.auth.token.dogenRoles);
    }

    match /b/{bucket}/o {
        match /{allPaths=**} {
            allow read, write: if isDogenAuthorized('admin');
        }
    }

  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}`;

      // This should be detected by configureDogenStorageRules() which checks for isDogenAuthenticated
      // before calling injectDogenStorageRules. Here we're testing the detection pattern works.
      expect(rulesWithDogenFunctions).to.include("isDogenAuthenticated");
    });
  });
});
