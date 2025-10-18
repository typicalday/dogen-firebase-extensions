import * as admin from "firebase-admin";
import { Timestamp, DocumentReference } from "firebase-admin/firestore";
import { JobTask } from "./jobTask";
import * as utils from "../utils/utils";

const db = admin.firestore();

export enum JobStatus {
  Started = "started",
  Succeeded = "succeeded",
  Failed = "failed",
}

export class Job {
  ref: DocumentReference;
  abortOnFailure: boolean;
  tasks: JobTask[];
  name: String;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  maxTasks: number;
  maxDepth: number;
  timeout?: number;
  verbose: boolean;

  constructor({
    ref,
    abortOnFailure,
    tasks,
    name,
    status,
    createdAt,
    updatedAt,
    maxTasks,
    maxDepth,
    timeout,
    verbose,
  }: {
    abortOnFailure: boolean;
    name: String;
    tasks: JobTask[];
    ref?: DocumentReference;
    outputMessage?: string;
    status?: JobStatus;
    createdAt?: Date;
    updatedAt?: Date;
    maxTasks?: number;
    maxDepth?: number;
    timeout?: number;
    verbose?: boolean;
  }) {
    this.ref = ref ?? db.collection(utils.jobCollectionPath).doc();
    this.abortOnFailure = abortOnFailure;
    this.name = name;
    this.maxTasks = maxTasks ?? 100;
    this.maxDepth = maxDepth ?? 10;
    this.timeout = timeout;
    this.verbose = verbose ?? false;

    // Auto-generate IDs for tasks without explicit IDs
    // Root tasks always have depth 0
    this.tasks = tasks.map((task, index) => {
      if (!task.id || task.id === "") {
        task.id = String(index);
      }
      // Ensure root tasks have depth 0 if not explicitly set
      if (task.depth === undefined) {
        task.depth = 0;
      }
      return task;
    });

    this.status = status || JobStatus.Started;
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }

  persist(): Promise<FirebaseFirestore.WriteResult> {
    return this.ref.set(this.toFirestore());
  }

  update({
    status,
    updatedAt,
  }: {
    outputMessage?: string;
    status: JobStatus;
    updatedAt: Date;
  }) {
    this.status = status;
    this.updatedAt = updatedAt;
    return this;
  }

  toFirestore(): Record<string, any> {
    return {
      name: this.name,
      abortOnFailure: this.abortOnFailure,
      status: this.status,
      tasks: this.tasks.map((task) => task.toFirestore()),
      maxTasks: this.maxTasks,
      maxDepth: this.maxDepth,
      timeout: this.timeout,
      verbose: this.verbose,
      createdAt: Timestamp.fromDate(this.createdAt),
      updatedAt: Timestamp.fromDate(this.updatedAt),
    };
  }
}
