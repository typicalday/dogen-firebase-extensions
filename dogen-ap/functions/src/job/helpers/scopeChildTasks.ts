/**
 * Helper for hierarchical task ID scoping and dependency resolution
 *
 * Applies parent task ID prefix to child tasks and resolves dependencies
 * to their scoped IDs. This ensures:
 *
 * 1. No ID collisions across orchestration phases
 * 2. Output shows actual IDs that will be created
 * 3. Dependencies reference correct scoped IDs
 *
 * Example:
 *   Parent: "0"
 *   Child: {id: "get-president", dependsOn: []}
 *   Result: {id: "0-get-president", dependsOn: []}
 *
 *   Parent: "0"
 *   Child: {id: "create-user", dependsOn: ["get-president"]}
 *   Result: {id: "0-create-user", dependsOn: ["0-get-president"]}
 */

import { ChildTaskSpec } from '../types';

export interface ScopeChildTasksResult {
  /**
   * Child tasks with scoped IDs and resolved dependencies
   */
  scopedChildren: ChildTaskSpec[];

  /**
   * Mapping from unprefixed custom IDs to scoped IDs
   * Used for debugging and validation
   */
  customIdMap: Map<string, string>;
}

/**
 * Applies hierarchical scoping to child task IDs and resolves dependencies
 *
 * @param parentTaskId - The ID of the parent task spawning these children
 * @param childSpecs - Array of child task specifications (may have unprefixed IDs)
 * @returns Scoped children and ID mapping
 *
 * @example
 * ```typescript
 * const { scopedChildren } = scopeChildTasks("0", [
 *   { id: "get-president", service: "ai", command: "service-agent", input: {...}, dependsOn: [] },
 *   { id: "create-user", service: "ai", command: "service-agent", input: {...}, dependsOn: ["get-president"] }
 * ]);
 *
 * // scopedChildren[0].id === "0-get-president"
 * // scopedChildren[1].id === "0-create-user"
 * // scopedChildren[1].dependsOn === ["0-get-president"]
 * ```
 */
export function scopeChildTasks(
  parentTaskId: string,
  childSpecs: ChildTaskSpec[]
): ScopeChildTasksResult {
  // FIRST PASS: Build mapping from unprefixed custom IDs to scoped IDs
  const customIdToActualId = new Map<string, string>();

  for (let i = 0; i < childSpecs.length; i++) {
    const childSpec = childSpecs[i];

    // Apply hierarchical scoping
    const scopedId = childSpec.id
      ? `${parentTaskId}-${childSpec.id}`  // Prefix custom ID with parent
      : `${parentTaskId}-${i}`;             // Auto-generate if no custom ID

    // Track mapping for dependency resolution
    if (childSpec.id) {
      customIdToActualId.set(childSpec.id, scopedId);
    }
  }

  // SECOND PASS: Apply scoping and resolve dependencies
  const scopedChildren: ChildTaskSpec[] = childSpecs.map((childSpec, i) => {
    // Apply same scoping logic
    const scopedId = childSpec.id
      ? `${parentTaskId}-${childSpec.id}`
      : `${parentTaskId}-${i}`;

    // Resolve dependencies: map unprefixed IDs to scoped IDs
    const resolvedDependencies: string[] = [];
    if (childSpec.dependsOn && childSpec.dependsOn.length > 0) {
      for (const depId of childSpec.dependsOn) {
        // Try to resolve unprefixed custom ID to scoped ID
        // If not found in our map, keep it as-is (might be from parent's siblings)
        const resolvedDepId = customIdToActualId.get(depId) ?? depId;
        resolvedDependencies.push(resolvedDepId);
      }
    }

    // Return scoped child with resolved dependencies
    return {
      ...childSpec,
      id: scopedId,
      dependsOn: resolvedDependencies.length > 0 ? resolvedDependencies : childSpec.dependsOn,
      // Also update input.dependsOn if it exists (for propagation)
      input: childSpec.input && resolvedDependencies.length > 0
        ? { ...childSpec.input, dependsOn: resolvedDependencies }
        : childSpec.input
    };
  });

  return {
    scopedChildren,
    customIdMap: customIdToActualId
  };
}
