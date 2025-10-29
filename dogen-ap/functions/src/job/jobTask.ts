import { Timestamp, DocumentReference } from "firebase-admin/firestore";
import { sanitizeForFirestore } from "../utils/sanitizeForFirestore";

export enum FirebaseTaskStatus {
  Pending = "pending",
  Planned = "planned",
  Approved = "approved",
  Started = "started",
  Succeeded = "succeeded",
  Failed = "failed",
  Aborted = "aborted",
}

/**
 * Task specification for creating new tasks
 */
export interface TaskSpec {
  id?: string;
  service: string;
  command: string;
  input?: Record<string, any>;
  dependsOn?: string[];
}

export class JobTask {
  id: string;
  service: string;
  command: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  trace?: Record<string, any>;
  childTasks?: TaskSpec[];
  status?: FirebaseTaskStatus = FirebaseTaskStatus.Pending;
  startedAt?: Date;
  completedAt?: Date;
  dependsOn?: string[];
  depth: number;

  constructor({
    id,
    service,
    command,
    input,
    output,
    trace,
    childTasks,
    status,
    startedAt,
    completedAt,
    dependsOn,
    depth,
  }: {
    id?: string;
    service: string;
    command: string;
    ref?: DocumentReference;
    input?: Record<string, any>;
    output?: Record<string, any>;
    trace?: Record<string, any>;
    childTasks?: TaskSpec[];
    status?: FirebaseTaskStatus;
    startedAt?: Date;
    completedAt?: Date;
    dependsOn?: string[];
    depth?: number;
  }) {
    let error: string | null = null;

    if (typeof service !== "string" || service.trim() === "") {
      error = "Invalid input: service must be a non-empty string";
    }

    if (typeof command !== "string" || command.trim() === "") {
      error = "Invalid input: command must be a non-empty string";
    }

    this.id = id || "";
    this.service = service;
    this.command = command;
    this.input = input || {};
    this.output = output || (error ? { error } : {});
    this.trace = trace;
    this.childTasks = childTasks;
    this.status = status || (error ? FirebaseTaskStatus.Failed : FirebaseTaskStatus.Pending);
    this.startedAt = startedAt;
    this.completedAt = completedAt;
    this.dependsOn = dependsOn;
    this.depth = depth ?? 0;
  }

  update({
    output,
    trace,
    childTasks,
    status,
    startedAt,
    completedAt,
  }: {
    output?: Record<string, any>;
    trace?: Record<string, any>;
    childTasks?: TaskSpec[];
    status?: FirebaseTaskStatus;
    startedAt?: Date;
    completedAt?: Date;
  }): JobTask {
    this.output = output || this.output;
    this.trace = trace || this.trace;
    this.childTasks = childTasks || this.childTasks;
    this.status = status || this.status;
    this.startedAt = startedAt || this.startedAt;
    this.completedAt = completedAt || this.completedAt;

    return this;
  }

  toFirestore(): Record<string, any> {
    return sanitizeForFirestore({
      id: this.id,
      service: this.service,
      command: this.command,
      input: this.input,
      output: this.output,
      trace: this.trace,
      childTasks: this.childTasks,
      status: this.status,
      startedAt: this.startedAt ? Timestamp.fromDate(this.startedAt) : null,
      completedAt: this.completedAt ? Timestamp.fromDate(this.completedAt) : null,
      dependsOn: this.dependsOn,
      depth: this.depth,
    });
  }
}
